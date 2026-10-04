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
  /** Hot: remanifest / startLoad — same encode generation. */
  hotRecover(): void;
  /** Hard: /start + full HLS reattach. */
  rebootStream(force?: boolean): void;
  /** True while seam/wait watchdog is armed (silent or overlay). */
  seamWatchActive?: boolean;
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

  /**
   * Soft-protect against remanifest flicker — but NOT a frozen last frame.
   * Stuck credits logo has readyState≥2 with no future buffer → must escalate.
   */
  hasPlaybackAnchor(): boolean {
    const v = this.host.videoRef?.nativeElement;
    if (!v || v.ended) return false;
    if (this.isMediaTimeStuck()) return false;
    if (this.isActuallyPlaying()) return true;
    // Brief waiting blip right after play — keep soft.
    if (Date.now() - this.lastPlayingAt < 4_000) return true;
    try {
      if (v.buffered?.length > 0) {
        const end = v.buffered.end(v.buffered.length - 1);
        // Need real future media — not just the frame already on screen.
        if (end > v.currentTime + 1.5) return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  /** currentTime flat while "playing"/waiting → freeze on last .ts (credits logo). */
  isMediaTimeStuck(sec = 8): boolean {
    const v = this.host.videoRef?.nativeElement;
    if (!v) return false;
    const t = v.currentTime;
    const now = Date.now();
    if (
      this.stuckSampleAt === 0 ||
      Math.abs(t - this.stuckSampleTime) > 0.35
    ) {
      this.stuckSampleAt = now;
      this.stuckSampleTime = t;
      return false;
    }
    return now - this.stuckSampleAt >= sec * 1000;
  }

  markPlaying(): void {
    this.lastPlayingAt = Date.now();
    this.stuckSampleAt = Date.now();
    this.stuckSampleTime = this.host.videoRef?.nativeElement?.currentTime ?? 0;
  }

  msSincePlaying(): number {
    return this.lastPlayingAt ? Date.now() - this.lastPlayingAt : Infinity;
  }

  nudgeToLiveEdge(): void {
    const h = this.host;
    const hls = h.hls;
    const v = h.videoRef?.nativeElement;
    if (!hls || !v) return;
    const live = hls.liveSyncPosition;
    if (live == null || !Number.isFinite(live)) return;
    const lag = live - v.currentTime;
    // Never seek backward — liveSync sits behind the real edge; snapping back = micro-repeat.
    // Only catch up when clearly behind the sliding window.
    if (lag < 4) {
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

  /** Soft recover: reload playlist at live edge without /start. */
  private lastHotAt = 0;
  private lastPlayingAt = 0;
  private stuckSampleAt = 0;
  private stuckSampleTime = 0;
  private hotFailStreak = 0;
  /** After playlist 404/503 — block remanifest storms until gap ends. */
  private playlistGapUntil = 0;
  /** Debounce brief `waiting` blips during healthy live play. */
  private lastBufferNudgeAt = 0;

  markPlaylistGap(sec = 12): void {
    this.playlistGapUntil = Math.max(
      this.playlistGapUntil,
      Date.now() + sec * 1000,
    );
  }

  inPlaylistGap(): boolean {
    return Date.now() < this.playlistGapUntil;
  }

  clearPlaylistGap(): void {
    this.playlistGapUntil = 0;
    this.hotFailStreak = 0;
  }

  hotRecover(): void {
    const h = this.host;
    const hls = h.hls;
    const url = h.streamUrl;
    if (!hls || !url || h.rebooting) return;
    // Still have picture/buffer (or just played) — remanifest = short fragment restart.
    if (this.hasPlaybackAnchor()) {
      this.resumeIfPaused();
      return;
    }
    if (this.inPlaylistGap()) {
      console.warn('[tv] hot recover blocked — playlist gap');
      h.loading = true;
      if (!h.waitMessage) h.waitMessage = 'Подключаем эфир…';
      return;
    }
    const now = Date.now();
    if (now - this.lastHotAt < 20_000) return;
    this.lastHotAt = now;

    // Probe first — remanifest on 404/503 just spam-loops the console.
    void (async () => {
      try {
        const probeUrl = `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`;
        const res = await fetch(probeUrl, {
          method: 'GET',
          cache: 'no-store',
          mode: 'cors',
        });
        if (res.status === 503 || res.status === 404) {
          this.hotFailStreak += 1;
          this.markPlaylistGap(res.status === 404 ? 15 : 10);
          console.warn(
            `[tv] hot recover skipped — playlist ${res.status} (streak ${this.hotFailStreak})`,
          );
          if (!this.hasPlaybackAnchor()) {
            h.loading = true;
            h.waitMessage = 'Подключаем эфир…';
          }
          this.handlePlaylistPreparing();
          if (this.hotFailStreak >= 4) {
            this.hotFailStreak = 0;
            // One hard attempt, then gap so we don't /start storm.
            this.markPlaylistGap(20);
            h.rebootStream();
            return;
          }
          h.stream.requestSeamSync(h.slug);
          return;
        }
        if (!res.ok) {
          this.markPlaylistGap(10);
          h.rebootStream();
          return;
        }
        // Buffer may have returned while we probed — do not wipe the timeline.
        if (this.hasPlaybackAnchor()) {
          this.resumeIfPaused();
          hls.startLoad(-1);
          return;
        }
        this.hotFailStreak = 0;
        // Soft: continue loading current source — full remanifest only if still dead.
        console.warn('[tv] hot recover — soft startLoad (no remanifest)');
        hls.startLoad(-1);
        this.resumeIfPaused();
        setTimeout(() => {
          if (this.hasPlaybackAnchor() || h.rebooting) return;
          console.warn('[tv] hot recover — remanifest (still dead)');
          hls.stopLoad();
          hls.loadSource(probeUrl);
          hls.startLoad(-1);
        }, 4_000);
      } catch {
        this.markPlaylistGap(10);
        h.rebootStream();
      }
    })();
  }

  onBufferIssue(): void {
    const h = this.host;
    if (h.rebooting || h.loading) return;
    if (h.crt === 'off-air' || h.crt === 'powering-off') return;

    // Frozen last frame (credits logo) — escalate, don't soft-ignore.
    if (this.isMediaTimeStuck(8)) {
      console.warn('[tv] media time stuck — stall recover');
      this.recoverOrReboot();
      return;
    }

    // Brief waiting with real future buffer — ignore (do not ask server → hot).
    if (this.hasPlaybackAnchor()) {
      this.resumeIfPaused();
      return;
    }

    const now = Date.now();
    if (now - this.lastBufferNudgeAt < 8_000) {
      this.resumeIfPaused();
      return;
    }
    this.lastBufferNudgeAt = now;

    // Prefer server hint over blind /start — only after real empty buffer.
    h.stream.reportPlayIssue(h.slug, 'buffering');
    // First seconds after attach segments are still being written — do not reboot.
    if (Date.now() - h.attachAt < 20_000) {
      this.resumeIfPaused();
      return;
    }
    this.resumeIfPaused();
    clearTimeout(h.stallTimer);
    // NAS encode can stall briefly — wait longer before /start reboot
    h.stallTimer = setTimeout(() => this.recoverOrReboot(), 12_000);
  }

  recoverOrReboot(): void {
    const h = this.host;
    if (h.rebooting || h.loading) return;
    if (h.crt === 'off-air' || h.crt === 'powering-off') return;
    if (this.hasPlaybackAnchor()) {
      this.resumeIfPaused();
      return;
    }

    h.stream.reportPlayIssue(h.slug, 'stall');
    // Mid-seam: /start wall-clock used to kill bridge → rewind + A/V mix.
    // Soft only; hard only if server hint=hard or media truly stuck past seam watch.
    if (h.seamWatchActive) {
      console.warn('[tv] stall during seam — soft only (no /start)');
      this.hotRecover();
      clearTimeout(h.stallTimer);
      h.stallTimer = setTimeout(() => {
        if (this.hasPlaybackAnchor()) return;
        if (h.seamWatchActive && !this.isMediaTimeStuck(12)) {
          console.warn('[tv] seam stall still soft — request sync');
          h.stream.requestSeamSync(h.slug);
          this.hotRecover();
          return;
        }
        h.rebootStream();
      }, 45_000);
      return;
    }

    // Brief underrun / WS blip while the cartoon was just playing — never /start.
    // Hard only when the frame is frozen for real (credits / dead encode).
    if (!this.isMediaTimeStuck(15) && this.msSincePlaying() < 90_000) {
      console.warn('[tv] stall — soft only (recent play, not frozen)');
      this.hotRecover();
      clearTimeout(h.stallTimer);
      h.stallTimer = setTimeout(() => {
        if (this.hasPlaybackAnchor()) return;
        if (!this.isMediaTimeStuck(15) && this.msSincePlaying() < 120_000) {
          console.warn('[tv] stall — still soft (no freeze)');
          this.hotRecover();
          return;
        }
        h.rebootStream();
      }, 25_000);
      return;
    }

    // Soft first — hard only if still dead after a longer beat (NAS blips).
    this.hotRecover();
    clearTimeout(h.stallTimer);
    h.stallTimer = setTimeout(() => {
      if (this.hasPlaybackAnchor()) return;
      console.warn('[tv] stall — second soft before /start');
      this.hotRecover();
      clearTimeout(h.stallTimer);
      h.stallTimer = setTimeout(() => {
        if (this.hasPlaybackAnchor()) return;
        h.rebootStream();
      }, 18_000);
    }, 18_000);
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
        // Cold boot only — mid-watch /start must not black out with chyron.
        if (this.msSincePlaying() > 60_000) {
          h.loading = true;
          h.waitMessage = 'Почти готово…';
        }
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
   * Wait until m3u8 has a small cushion of real .ts (not just the first one).
   * Cold encode with -re is slow — attaching on 1 segment = micro-pauses on first cartoon.
   * Probe from the *end* (live edge) — delete_segments often 404s old MEDIA-SEQUENCE entries.
   */
  async waitUntilOk(url: string, gen: number, tries = 90): Promise<void> {
    const h = this.host;
    const playlistUrl = new URL(url, window.location.origin).href;
    let last = 0;
    let withSegs = 0;
    let okStreak = 0;
    const minSegs = 3;
    const needOkStreak = 2;

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
          okStreak = 0;
          await this.delay(500);
          continue;
        }

        const body = await res.text();
        const segs = body
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => !!l && !l.startsWith('#') && /\.ts($|\?)/i.test(l));
        if (segs.length < minSegs) {
          withSegs = 0;
          okStreak = 0;
          await this.delay(500);
          continue;
        }
        withSegs += 1;

        // Newest first — oldest sliding-window entries are often already deleted
        const candidates = [...segs].reverse().slice(0, 5);
        let playable = false;
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
          if (segRes.ok || segRes.status === 206) {
            playable = true;
            break;
          }
        }

        if (playable) {
          okStreak += 1;
          if (okStreak >= needOkStreak) return;
        } else {
          okStreak = 0;
          // Playlist has segments for a few polls but all probed .ts 404 —
          // do NOT attach: that freezes on one frame and storms 404s.
          if (withSegs >= 6) {
            console.warn(
              '[tv] playlist segs all 404 — keep waiting (likely mid-wipe)',
            );
            withSegs = 0;
          }
        }
      } catch (e) {
        okStreak = 0;
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

    // Playing through buffer — lone edge 404s are delete_segments noise.
    // Remanifest here = micro-repeat on the CRT.
    if (this.hasPlaybackAnchor()) {
      h.recoverCooldownUntil = now + 2_000;
      return;
    }

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
    if (this.hasPlaybackAnchor()) {
      this.resumeIfPaused();
      hls.startLoad(-1);
      return;
    }

    const now = Date.now();
    if (now - h.remanifestAt > 30_000) h.remanifestCount = 0;
    if (now - h.remanifestAt < 5_000 && h.remanifestCount > 0) return;

    h.remanifestAt = now;
    h.remanifestCount += 1;

    if (h.remanifestCount >= 2) {
      console.warn('[tv] remanifest exhausted — /start reboot');
      h.remanifestCount = 0;
      h.badFragSn = null;
      h.rebootStream();
      return;
    }

    // Prefer soft continue over wipe+remanifest.
    console.warn('[tv] stale HLS — soft startLoad');
    try {
      hls.startLoad(-1);
      this.resumeIfPaused();
    } catch {
      if (!h.rebooting) h.rebootStream();
    }
  }

  /** Episode seam: ffmpeg alive, m3u8 not ready yet (local /stream → 503). */
  handlePlaylistPreparing(): void {
    const h = this.host;
    if (h.rebooting) return;
    // Picture still moving — nginx/Nest blip (e.g. former auth_request 500).
    // Never flash "Подключаем эфир…" / /start over a live cartoon.
    if (this.isActuallyPlaying() || this.hasPlaybackAnchor()) {
      this.markPlaylistGap(8);
      h.hls?.startLoad(-1);
      this.resumeIfPaused();
      return;
    }
    // Frozen last frame during 503 — don't sit in loading forever.
    if (this.isMediaTimeStuck(8)) {
      console.warn('[tv] 503 + media stuck — hard reattach');
      h.rebootStream(true);
      return;
    }
    this.markPlaylistGap(12);
    const now = Date.now();
    if (!h.prepare503Started) h.prepare503Started = now;
    h.prepare503LastAt = now;
    h.prepare503Count += 1;
    const elapsed = now - h.prepare503Started;
    // Escalate sooner — 120s left CRT frozen on credits logo.
    if (elapsed >= 35_000 || h.prepare503Count >= 10) {
      console.warn('[tv] playlist 503 too long — /start reattach');
      h.prepare503Started = 0;
      h.prepare503Count = 0;
      h.prepare503LastAt = 0;
      this.markPlaylistGap(20);
      h.rebootStream(true);
      return;
    }
    if (h.prepare503Count === 1 || h.prepare503Count % 5 === 0) {
      console.warn(
        `[tv] playlist HTTP 503 — preparing (${Math.round(elapsed / 1000)}s, wait)`,
      );
    }
    // Soft wait only — no chyron while buffer may still play.
    if (h.prepare503Count >= 2 || elapsed >= 1500) {
      if (!this.hasPlaybackAnchor()) {
        h.loading = true;
        h.waitMessage = 'Подключаем эфир…';
      }
    }
    clearTimeout(h.prepare503Timer);
    const delay = Math.min(2000 + h.prepare503Count * 400, 6000);
    h.prepare503Timer = setTimeout(() => {
      if (h.rebooting) return;
      // Ask server — do not remanifest into a missing file.
      h.stream.requestSeamSync(h.slug);
      h.hls?.startLoad(-1);
    }, delay);
  }

  /**
   * Drop seam overlay once — do not key off waitMessage alone (that spammed
   * "seam wait cleared" on every FRAG forever and fought 404→reboot loops).
   */
  endPlaylistPreparing(reason: string): void {
    const h = this.host;
    if (!(h.prepare503Started > 0)) return;
    if (reason === 'level' || reason === 'manifest') return;
    // Still in gap after wipe — don't clear overlay / don't invite hot recover.
    if (this.inPlaylistGap()) return;
    const last503 = h.prepare503LastAt || h.prepare503Started;
    if (last503 && Date.now() - last503 < 1000) return;
    const v = h.videoRef.nativeElement;
    if (reason === 'frag' && v.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
      return;
    }
    h.prepare503Started = 0;
    h.prepare503Count = 0;
    h.prepare503LastAt = 0;
    clearTimeout(h.prepare503Timer);
    if (
      h.waitMessage === 'Следующая серия…' ||
      h.waitMessage === 'Следующая серия' ||
      h.waitMessage === 'Стык серии'
    ) {
      h.waitMessage = 'Подключаем эфир…';
    }
    h.loading = false;
    this.clearPlaylistGap();
    console.warn(`[tv] seam wait cleared (${reason})`);
  }

  attach(url: string, opts?: { fromStart?: boolean }): void {
    const h = this.host;
    const video = h.videoRef.nativeElement;
    const keepSound = h.soundOn;
    const fromStart = !!opts?.fromStart;
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
        // Dual-slot promote: play from oldest segment (episode head still in window).
        // Normal watch: sit behind live edge so NAS -re underruns less.
        startPosition: fromStart ? 0 : -1,
        liveSyncDurationCount: fromStart ? 2 : 8,
        liveMaxLatencyDurationCount: fromStart ? 12 : 24,
        maxLiveSyncPlaybackRate: 1.0,
        // Thicker buffer = fewer silent micro-pauses on cold first cartoon
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        backBufferLength: 30,
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
        if (fromStart) {
          console.warn('[tv] dual-slot attach from playlist start (keep intro)');
        }
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
            // Dual-slot fromStart: -1 would jump to live edge and skip the intro again.
            setTimeout(
              () => h.hls?.startLoad(fromStart ? 0 : -1),
              1000,
            );
            return;
          }

          // Mid-play frag blip — keep buffer; don't reload live edge (micro-repeat).
          if (this.isActuallyPlaying()) {
            this.resumeIfPaused();
            return;
          }
          h.hls?.startLoad(fromStart ? 0 : -1);
          return;
        }

        if (
          data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
          data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR
        ) {
          const code = (data.response as { code?: number } | undefined)?.code;
          // 503 = preparing. 500 = nginx auth/mirror/upstream blip — same soft path.
          // 404/410 = missing playlist mid-seam.
          if (
            code === 503 ||
            code === 500 ||
            code === 404 ||
            code === 410
          ) {
            this.markPlaylistGap(12);
            this.handlePlaylistPreparing();
            // Throttled server hint — not on every hls retry tick.
            if (h.prepare503Count === 1 || h.prepare503Count % 4 === 0) {
              h.stream.reportPlayIssue(h.slug, 'playlist404');
            }
            return;
          }
        }

        if (data.fatal && h.hls) {
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            // recoverMediaError mid-live often desyncs audio/video SourceBuffers
            // (Rex video + Infinite Train audio after seam). Prefer soft reload.
            if (this.hasPlaybackAnchor() || h.seamWatchActive) {
              console.warn('[tv] MEDIA_ERROR mid-play — startLoad (no recoverMediaError)');
              h.hls.startLoad(-1);
              this.resumeIfPaused();
              return;
            }
            console.warn('[tv] MEDIA_ERROR fatal — recoverMediaError once');
            h.hls.recoverMediaError();
            this.resumeIfPaused();
            return;
          }
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            this.markPlaylistGap(10);
            this.handlePlaylistPreparing();
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
