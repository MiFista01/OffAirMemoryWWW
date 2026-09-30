import { environment } from '@env';
import {
  StreamCoreService,
  StreamStartResponse,
  StreamStatusResponse,
} from '@services';
import Hls from 'hls.js';
import { firstValueFrom } from 'rxjs';

/** Host surface for HLS attach/wait/recovery (`this as ChannelWatchHlsHost`). */
export type ChannelWatchHlsHost = {
  stream: StreamCoreService;
  videoRef: { nativeElement: HTMLVideoElement };
  bootGen: number;
  slug: string;
  streamUrl: string;
  loading: boolean;
  rebooting: boolean;
  crt: string;
  soundOn: boolean;
  needsGesture: boolean;
  waitMessage: string;
  meta: { episodeId?: number; offsetSec?: number };
  hls?: Hls;
  attachAt: number;
  frag404Streak: number;
  lastFrag404Url: string;
  remanifestAt: number;
  remanifestCount: number;
  badFragSn: number | string | null;
  recoverCooldownUntil: number;
  frag404Burst: number;
  frag404BurstStarted: number;
  prepare503Timer?: ReturnType<typeof setTimeout>;
  prepare503Started: number;
  prepare503Count: number;
  /** Last 503 timestamp — don't clear overlay on a stale LEVEL reload mid-seam. */
  prepare503LastAt: number;
  stallTimer?: ReturnType<typeof setTimeout>;
  onWaiting: () => void;
  onStalled: () => void;
  onEnded: () => void;
  onPlaying: () => void;
  beginPowerOn(): void;
  onHlsReady(): void;
  startHeartbeat(): void;
  goOffAir(message?: string): void;
  rebootStream(): void;
};

/** HLS attach / wait / recovery — component owns the video element and CRT UI. */
export class ChannelWatchHls {
  constructor(private readonly host: ChannelWatchHlsHost) {}

  resumeIfPaused(): void {
    const h = this.host;
    const v = h.videoRef.nativeElement;
    if (!v.paused) return;
    v.muted = !h.soundOn;
    void v.play().catch(() => {
      if (h.soundOn) {
        v.muted = true;
        h.soundOn = false;
        h.needsGesture = true;
        void v.play().catch(() => undefined);
      }
    });
  }

  isActuallyPlaying(): boolean {
    const v = this.host.videoRef.nativeElement;
    return (
      !v.paused &&
      !v.ended &&
      v.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
    );
  }

  nudgeToLiveEdge(): void {
    const h = this.host;
    const hls = h.hls;
    const v = h.videoRef?.nativeElement;
    if (!hls || !v) return;
    const live = hls.liveSyncPosition;
    if (live == null || !Number.isFinite(live)) return;
    // Only snap if we're clearly behind — avoid forward/back flicker
    if (Math.abs(v.currentTime - live) < 1.5) {
      this.resumeIfPaused();
      return;
    }
    try {
      v.currentTime = live;
    } catch {
      /* ignore */
    }
    this.resumeIfPaused();
  }

  onBufferIssue(): void {
    const h = this.host;
    if (h.rebooting || h.loading) return;
    if (h.crt === 'off-air' || h.crt === 'powering-off') return;
    // First seconds after attach segments are still being written — do not reboot.
    if (Date.now() - h.attachAt < 20_000) {
      this.nudgeToLiveEdge();
      return;
    }
    this.nudgeToLiveEdge();
    clearTimeout(h.stallTimer);
    // NAS encode can stall briefly — wait longer before /start reboot
    h.stallTimer = setTimeout(() => this.recoverOrReboot(), 8000);
  }

  recoverOrReboot(): void {
    const h = this.host;
    if (h.rebooting || h.loading) return;
    if (h.crt === 'off-air' || h.crt === 'powering-off') return;
    if (this.isActuallyPlaying()) return;

    if (h.hls) {
      try {
        this.nudgeToLiveEdge();
        h.hls.startLoad();
      } catch {
        /* fall through */
      }
    }

    clearTimeout(h.stallTimer);
    h.stallTimer = setTimeout(() => h.rebootStream(), 10_000);
  }

  delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  toPlayableUrl(streamUrl: string): string {
    try {
      const u = new URL(streamUrl, window.location.origin);
      if (!u.pathname.startsWith('/stream')) return streamUrl;
      const base = (environment.streamBase || '').replace(/\/$/, '');
      // Always absolute — relative `/stream/...` breaks `new URL(seg, playlistUrl)`
      // in waitUntilOk (TypeError → silent m3u8-only loop, no .ts).
      return base
        ? `${base}${u.pathname}`
        : new URL(u.pathname, window.location.origin).href;
    } catch {
      return streamUrl;
    }
  }

  /**
   * /start → if not playable yet, poll /status?ensure=true (~2s).
   * Do not attach the player until streamUrl exists — otherwise a 404 storm on an empty folder.
   */
  async waitUntilPlayable(slug: string, gen: number): Promise<string> {
    const h = this.host;
    let res: StreamStartResponse | StreamStatusResponse =
      await firstValueFrom(h.stream.start(slug));
    if (gen !== h.bootGen) throw new Error('cancelled');

    h.meta = {
      episodeId: 'episodeId' in res ? res.episodeId : undefined,
      offsetSec: 'offsetSec' in res ? res.offsetSec : undefined,
    };

    for (let i = 0; i < 90; i++) {
      if (gen !== h.bootGen) throw new Error('cancelled');

      if (res.status === 'off') {
        throw new Error(res.message || 'Сейчас не в эфире');
      }

      const playable = !!(res.playable ?? res.ready) && !!res.streamUrl;
      if (playable && res.streamUrl) {
        const url = this.toPlayableUrl(res.streamUrl);
        h.streamUrl = url;
        h.waitMessage = 'Почти готово…';
        await this.waitUntilOk(url, gen);
        if (gen !== h.bootGen) throw new Error('cancelled');
        return url;
      }

      h.waitMessage =
        res.message || 'Эфир есть, подготавливаем поток — подождите';
      const delayMs = Math.max(1000, res.pollAfterMs ?? 2000);
      await this.delay(delayMs);
      if (gen !== h.bootGen) throw new Error('cancelled');

      res = await firstValueFrom(h.stream.status(slug, { ensure: true }));
    }

    throw new Error('Playlist not ready');
  }

  /**
   * Wait until m3u8 lists a .ts that actually exists.
   * Probe from the *end* (live edge) — ffmpeg delete_segments often 404s the first
   * MEDIA-SEQUENCE entry while newer ones are fine.
   */
  async waitUntilOk(url: string, gen: number, tries = 60): Promise<void> {
    const h = this.host;
    const playlistUrl = new URL(url, window.location.origin).href;
    let last = 0;
    let withSegs = 0;

    for (let i = 0; i < tries; i++) {
      if (gen !== h.bootGen) return;
      try {
        const res = await fetch(playlistUrl, {
          method: 'GET',
          cache: 'no-store',
          mode: 'cors',
        });
        last = res.status;
        if (!res.ok) {
          await this.delay(500);
          continue;
        }

        const body = await res.text();
        const segs = body
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => !!l && !l.startsWith('#') && /\.ts($|\?)/i.test(l));
        if (!segs.length) {
          withSegs = 0;
          await this.delay(500);
          continue;
        }
        withSegs += 1;

        // Newest first — oldest sliding-window entries are often already deleted
        const candidates = [...segs].reverse().slice(0, 5);
        for (const seg of candidates) {
          const segUrl = new URL(seg, playlistUrl).href;
          const segRes = await fetch(segUrl, {
            method: 'GET',
            cache: 'no-store',
            mode: 'cors',
            headers: { Range: 'bytes=0-0' },
          });
          last = segRes.status;
          try {
            await segRes.body?.cancel();
          } catch {
            /* ignore */
          }
          if (segRes.ok || segRes.status === 206) return;
        }

        // Playlist has segments for a few polls but all probed .ts 404 —
        // do NOT attach: that freezes on one frame and storms 404s.
        // Keep waiting for a real playable .ts (encode still starting).
        if (withSegs >= 6) {
          console.warn(
            '[tv] playlist segs all 404 — keep waiting (likely mid-wipe)',
          );
          withSegs = 0;
        }
      } catch (e) {
        console.warn('[tv] waitUntilOk blip', e);
      }
      await this.delay(500);
    }
    throw new Error(`Playlist not ready (last HTTP ${last})`);
  }

  /**
   * Hole in live HLS: remanifest once. Many different SN 404s (zombie playlist
   * after ffmpeg died) → /start immediately — don't remanifest forever.
   */
  recoverMissingFragment(playlistUrl: string, sn?: number | string): void {
    const h = this.host;
    if (h.rebooting) return;
    const now = Date.now();
    if (now < h.recoverCooldownUntil) return;

    if (now - h.frag404BurstStarted > 15_000) {
      h.frag404BurstStarted = now;
      h.frag404Burst = 0;
    }
    h.frag404Burst += 1;

    // Sliding window of dead .ts while encode dead → /start, not remanifest spam.
    // Threshold 4: delete_segments often yields 1–2 benign 404s at the live edge.
    if (h.frag404Burst >= 4 || h.remanifestCount >= 2) {
      console.warn(
        `[tv] ${h.frag404Burst} frag 404s — /start (encode likely dead)`,
      );
      h.recoverCooldownUntil = now + 8_000;
      h.frag404Burst = 0;
      h.remanifestCount = 0;
      h.badFragSn = null;
      h.rebootStream();
      return;
    }

    if (sn != null && sn === h.badFragSn && h.remanifestCount >= 1) {
      console.warn(
        `[tv] fragment sn=${sn} still missing after remanifest — /start`,
      );
      h.recoverCooldownUntil = now + 8_000;
      h.remanifestCount = 0;
      h.badFragSn = null;
      h.rebootStream();
      return;
    }

    if (sn != null) h.badFragSn = sn;
    h.recoverCooldownUntil = now + 1_200;
    this.recoverStaleHls(playlistUrl);
  }

  /** Reload m3u8 and stay on live edge — do not seek mid-window. */
  recoverStaleHls(playlistUrl: string): void {
    const h = this.host;
    const hls = h.hls;
    if (!hls || h.rebooting) return;

    const now = Date.now();
    if (now - h.remanifestAt > 30_000) h.remanifestCount = 0;
    if (now - h.remanifestAt < 2_000 && h.remanifestCount > 0) return;

    h.remanifestAt = now;
    h.remanifestCount += 1;

    if (h.remanifestCount >= 2) {
      console.warn('[tv] remanifest exhausted — /start reboot');
      h.remanifestCount = 0;
      h.badFragSn = null;
      h.rebootStream();
      return;
    }

    console.warn('[tv] stale HLS — remanifest + live edge');
    try {
      hls.stopLoad();
      const sep = playlistUrl.includes('?') ? '&' : '?';
      hls.loadSource(`${playlistUrl}${sep}_=${Date.now()}`);
      hls.startLoad(-1);
      setTimeout(() => this.nudgeToLiveEdge(), 600);
    } catch {
      if (!h.rebooting) h.rebootStream();
    }
  }

  /** Episode seam: ffmpeg alive, m3u8 not ready yet (local /stream → 503). */
  handlePlaylistPreparing(): void {
    const h = this.host;
    if (h.rebooting) return;
    const now = Date.now();
    if (!h.prepare503Started) h.prepare503Started = now;
    h.prepare503LastAt = now;
    h.prepare503Count += 1;
    const elapsed = now - h.prepare503Started;
    // Up to ~2 min (DuckTales→Spider-Man cold seek on NAS/dev)
    if (elapsed < 120_000) {
      if (h.prepare503Count === 1 || h.prepare503Count % 5 === 0) {
        console.warn(
          `[tv] playlist HTTP 503 — preparing (${Math.round(elapsed / 1000)}s, wait)`,
        );
      }
      // One blip / early solo-seam 503 → don't flash "Следующая серия" yet.
      if (h.prepare503Count >= 2 || elapsed >= 1500) {
        h.loading = true;
        h.waitMessage = 'Следующая серия…';
      }
      clearTimeout(h.prepare503Timer);
      const delay = Math.min(2000 + h.prepare503Count * 400, 6000);
      h.prepare503Timer = setTimeout(() => {
        if (h.rebooting) return;
        h.hls?.startLoad(-1);
      }, delay);
      return;
    }
    console.warn('[tv] playlist 503 too long — /start reattach');
    h.prepare503Started = 0;
    h.prepare503Count = 0;
    h.prepare503LastAt = 0;
    h.rebootStream();
  }

  /**
   * Drop seam overlay only when media is actually back — not on every live
   * LEVEL reload (that cleared "Следующая серия" too early).
   */
  endPlaylistPreparing(reason: string): void {
    const h = this.host;
    const seamWait =
      h.prepare503Started > 0 || h.waitMessage === 'Следующая серия…';
    if (!seamWait) return;
    // Live playlist polls fire LEVEL_LOADED constantly — ignore for overlay.
    if (reason === 'level' || reason === 'manifest') return;
    const last503 = h.prepare503LastAt || h.prepare503Started;
    if (last503 && Date.now() - last503 < 1000) return;
    const v = h.videoRef.nativeElement;
    // Wait until we can paint frames again (not just a speculative frag fetch).
    if (reason === 'frag' && v.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
      return;
    }
    h.prepare503Started = 0;
    h.prepare503Count = 0;
    h.prepare503LastAt = 0;
    clearTimeout(h.prepare503Timer);
    h.loading = false;
    console.warn(`[tv] seam wait cleared (${reason})`);
  }

  attach(url: string): void {
    const h = this.host;
    const video = h.videoRef.nativeElement;
    const keepSound = h.soundOn;
    h.hls?.destroy();
    h.soundOn = keepSound;
    video.muted = !keepSound;
    h.attachAt = Date.now();
    // keep loading true until first playing — otherwise stall/frag-404 → false reboot

    video.removeEventListener('waiting', h.onWaiting);
    video.removeEventListener('stalled', h.onStalled);
    video.removeEventListener('ended', h.onEnded);
    video.removeEventListener('playing', h.onPlaying);
    video.addEventListener('waiting', h.onWaiting);
    video.addEventListener('stalled', h.onStalled);
    video.addEventListener('ended', h.onEnded);
    video.addEventListener('playing', h.onPlaying);

    if (Hls.isSupported()) {
      h.hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        // Further behind live edge — late joiners / NAS delete_segments → fewer 404 loops
        liveSyncDurationCount: 7,
        liveMaxLatencyDurationCount: 22,
        maxLiveSyncPlaybackRate: 1.0,
        manifestLoadingMaxRetry: 12,
        manifestLoadingRetryDelay: 1000,
        // Don't hammer the same missing .ts (hls.js default can loop for ages)
        fragLoadingMaxRetry: 2,
        fragLoadingRetryDelay: 500,
      });
      h.hls.attachMedia(video);
      h.hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        h.hls?.loadSource(url);
      });
      h.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        h.frag404Streak = 0;
        h.lastFrag404Url = '';
        // Do NOT reset remanifestCount / badFragSn here — that restarted skip/remanifest thrash
        // Seam overlay: cleared via frag/playing, not every manifest poll.
        if (keepSound) {
          video.muted = false;
          if (h.crt === 'waiting' || h.crt === 'off-air') {
            h.beginPowerOn();
          } else if (h.crt !== 'powering-on' && h.crt !== 'powering-off') {
            h.crt = 'on';
          }
          void video.play().catch(() => undefined);
        } else {
          h.onHlsReady();
        }
      });
      // Append seam: clear overlay on real media, not live playlist polls.
      h.hls.on(Hls.Events.FRAG_LOADED, () => {
        this.endPlaylistPreparing('frag');
      });
      h.hls.on(Hls.Events.FRAG_BUFFERED, () => {
        this.endPlaylistPreparing('buffered');
      });
      h.hls.on(Hls.Events.ERROR, (_e, data) => {
        if (h.rebooting) return;
        if (h.crt === 'off-air' || h.crt === 'powering-off') return;

        const warmingUp = Date.now() - h.attachAt < 20_000 || h.loading;

        if (
          data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR ||
          data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT
        ) {
          const code = (data.response as { code?: number } | undefined)?.code;

          if (code === 404) {
            this.recoverMissingFragment(url, data.frag?.sn);
            return;
          }

          if (warmingUp) {
            setTimeout(() => h.hls?.startLoad(-1), 1000);
            return;
          }

          h.hls?.startLoad(-1);
          return;
        }

        if (
          data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
          data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR
        ) {
          const code = (data.response as { code?: number } | undefined)?.code;
          // 503 = Nest static "HLS preparing" (episode seam / seek) — wait, no /start storm.
          if (code === 503) {
            this.handlePlaylistPreparing();
            return;
          }
          if (code === 404 || code === 410) {
            // Brief wipe between encodes — wait like 503, don't /start-storm.
            if (warmingUp || h.prepare503Started > 0) {
              this.handlePlaylistPreparing();
              return;
            }
            const now = Date.now();
            if (!h.prepare503Started) h.prepare503Started = now;
            h.prepare503LastAt = now;
            h.prepare503Count += 1;
            if (h.prepare503Count < 3) {
              console.warn(
                `[tv] playlist HTTP ${code} — wait/retry (${h.prepare503Count})`,
              );
              clearTimeout(h.prepare503Timer);
              h.prepare503Timer = setTimeout(() => {
                if (h.rebooting) return;
                h.hls?.startLoad(-1);
              }, 1200);
              return;
            }
            console.warn(
              `[tv] playlist HTTP ${code} — /start reattach (not off air)`,
            );
            h.prepare503Started = 0;
            h.prepare503Count = 0;
            h.prepare503LastAt = 0;
            h.rebootStream();
            return;
          }
        }

        if (data.fatal && h.hls) {
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            h.hls.recoverMediaError();
            this.resumeIfPaused();
            return;
          }
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            // Nest down / EBUSY crash → CONNECTION_REFUSED — wait, don't reboot loop.
            const code = (data.response as { code?: number } | undefined)?.code;
            if (!code || code === 0) {
              this.handlePlaylistPreparing();
              return;
            }
            h.hls.startLoad();
            if (!warmingUp) this.onBufferIssue();
            return;
          }
          if (!warmingUp) h.rebootStream();
        }
      });
      return;
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.addEventListener(
        'loadedmetadata',
        () => h.onHlsReady(),
        { once: true },
      );
    } else {
      h.goOffAir('HLS not supported in this browser');
    }
  }
}
