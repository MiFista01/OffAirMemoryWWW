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
  /** User set volume to 0 — survive dual-slot attach/remanifest. */
  userPrefersMute?: boolean;
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
  /** Dual-slot URL switch in flight. */
  switchingSlot?: boolean;
  /** Ms epoch — soft recover must not remanifest / rewind after slot switch. */
  switchGraceUntil?: number;
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

  /** Stuck in first seconds after dual-slot attach — NOT end-slate. */
  isIntroStuck(maxSec = 20): boolean {
    const v = this.host.videoRef?.nativeElement;
    if (!v) return false;
    const t = v.currentTime;
    if (!Number.isFinite(t) || t > maxSec) return false;
    const grace = this.host.switchGraceUntil ?? 0;
    const recentAttach = Date.now() - this.host.attachAt < 45_000;
    if (!recentAttach && Date.now() >= grace) return false;
    return this.isMediaTimeStuck(5);
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
  /** Hard gate — browser fires waiting/stalled hundreds/sec when frozen. */
  private lastBufferIssueAt = 0;

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
    // Server holding for guide catch-up / promote defer — remanifest rewinds credits.
    if (h.seamWatchActive) {
      console.warn('[tv] hot recover blocked — seam hold');
      this.resumeIfPaused();
      return;
    }
    // Just switched to next episode @0 — remanifest seeks live edge / rewinds intro.
    if (h.switchGraceUntil && Date.now() < h.switchGraceUntil) {
      console.warn('[tv] hot recover — post-switch nudge (keep @0)');
      this.resumeIfPaused();
      try {
        hls.startLoad(this.isIntroStuck() ? 0 : -1);
      } catch {
        try {
          hls.startLoad(0);
        } catch {
          /* ignore */
        }
      }
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
          // Never /start from hot-fail streak — that wipes preparing HLS → more 503.
          h.stream.requestSeamSync(h.slug);
          return;
        }
        if (!res.ok) {
          this.markPlaylistGap(10);
          h.stream.requestSeamSync(h.slug);
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
    if (h.rebooting) return;
    if (h.crt === 'off-air' || h.crt === 'powering-off') return;
    // waiting/stalled fire in a tight loop on a frozen frame — never burn CPU.
    const now = Date.now();
    if (now - this.lastBufferIssueAt < 2_500) return;
    this.lastBufferIssueAt = now;

    const prepFor =
      h.prepare503Started > 0 ? now - h.prepare503Started : 0;
    // Overlay alone must not block forever; 503 escalate below.
    if (h.loading && prepFor < 40_000 && h.prepare503Started === 0) {
      if (!this.isMediaTimeStuck(8)) return;
    }
    if (
      h.prepare503Started > 0 &&
      prepFor >= (this.isMediaTimeStuck(6) ? 20_000 : 45_000)
    ) {
      if (h.switchingSlot || Date.now() < (h.switchGraceUntil ?? 0)) {
        h.stream.requestSeamSync(h.slug);
        return;
      }
      console.warn('[tv] 503 stuck — force /start from buffer watchdog');
      // Do not clear prepare here — rebootStream clears only if /start commits.
      h.rebootStream(true);
      return;
    }

    // Brief waiting with real future buffer — ignore.
    if (this.hasPlaybackAnchor()) {
      this.resumeIfPaused();
      return;
    }

    // Intro freeze after dual-slot switch (Transformers stuck @0–2s).
    // Must NOT report ended / startLoad(-1) — that kills the new show.
    if (this.isIntroStuck()) {
      if (now - this.lastBufferNudgeAt < 4_000) {
        this.resumeIfPaused();
        return;
      }
      this.lastBufferNudgeAt = now;
      console.warn('[tv] media time stuck — intro watchdog (keep @0)');
      this.resumeIfPaused();
      try {
        h.hls?.startLoad(0);
      } catch {
        /* ignore */
      }
      h.stream.reportPlayIssue(h.slug, 'buffering');
      clearTimeout(h.stallTimer);
      h.stallTimer = setTimeout(() => {
        if (this.hasPlaybackAnchor()) return;
        if (this.isIntroStuck()) {
          console.warn('[tv] intro still stuck — /start reattach');
          h.rebootStream(true);
          return;
        }
        this.recoverOrReboot();
      }, 12_000);
      return;
    }

    // Frozen frame but playlist may still be fine (end-slate / NAS lag).
    if (this.isMediaTimeStuck(8)) {
      if (now - this.lastBufferNudgeAt < 8_000) {
        this.resumeIfPaused();
        return;
      }
      this.lastBufferNudgeAt = now;
      console.warn('[tv] media time stuck — end-slate watchdog');
      h.seamWatchActive = true;
      this.resumeIfPaused();
      // Remanifest (-1) on credits rewinds the ending during promote-defer.
      // Keep last frame; server switch / seam sync advances — but don't wait 45s.
      console.warn('[tv] end-slate — hold last frame (no remanifest)');
      h.stream.reportPlayIssue(h.slug, 'ended');
      h.stream.requestSeamSync(h.slug);
      clearTimeout(h.stallTimer);
      h.stallTimer = setTimeout(() => this.recoverOrReboot(), 18_000);
      return;
    }

    if (now - this.lastBufferNudgeAt < 8_000) {
      this.resumeIfPaused();
      return;
    }
    this.lastBufferNudgeAt = now;

    h.stream.reportPlayIssue(h.slug, 'buffering');
    if (now - h.attachAt < 20_000) {
      this.resumeIfPaused();
      return;
    }
    this.resumeIfPaused();
    clearTimeout(h.stallTimer);
    h.stallTimer = setTimeout(() => this.recoverOrReboot(), 20_000);
  }

  recoverOrReboot(): void {
    const h = this.host;
    if (h.rebooting) return;
    const now = Date.now();
    if (now - this.lastBufferIssueAt < 2_000) return;
    this.lastBufferIssueAt = now;
    const prepFor =
      h.prepare503Started > 0 ? now - h.prepare503Started : 0;
    if (h.loading && prepFor < 40_000 && h.prepare503Started === 0) {
      if (!this.isMediaTimeStuck(8)) return;
    }
    if (prepFor >= 45_000) {
      if (!h.switchingSlot) h.rebootStream(true);
      return;
    }
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
      h.stream.requestSeamSync(h.slug);
      clearTimeout(h.stallTimer);
      h.stallTimer = setTimeout(() => {
        if (this.hasPlaybackAnchor()) return;
        if (this.isMediaTimeStuck(12) || h.prepare503Started > 0) {
          console.warn('[tv] seam stall — escalate /start');
          h.rebootStream(true);
          return;
        }
        console.warn('[tv] seam stall still soft — request sync');
        h.stream.requestSeamSync(h.slug);
      }, 45_000);
      return;
    }

    // Brief underrun while picture still has future buffer — soft only.
    // Frozen / no anchor → allow rebootStream (was blocked 90s by lastPlayingAt).
    if (!this.isMediaTimeStuck(12) && this.hasPlaybackAnchor()) {
      console.warn('[tv] stall — soft only (recent play, not frozen)');
      this.hotRecover();
      clearTimeout(h.stallTimer);
      h.stallTimer = setTimeout(() => {
        if (this.hasPlaybackAnchor()) return;
        h.rebootStream(false);
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
        h.rebootStream(true);
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
        return url; // cold boot always attaches separately
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
   * Returns fromStart=true only when the *head* of the window is also on disk —
   * otherwise dual-slot attach@0 storms 404 on deleted intro segments.
   */
  async waitUntilOk(
    url: string,
    gen: number,
    tries = 90,
  ): Promise<{ fromStart: boolean }> {
    const h = this.host;
    const playlistUrl = new URL(url, window.location.origin).href;
    let last = 0;
    let withSegs = 0;
    let tailStreak = 0;
    let headStreak = 0;
    const minSegs = 3;
    const needOkStreak = 2;

    const probeSeg = async (seg: string): Promise<boolean> => {
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
      return segRes.ok || segRes.status === 206;
    };

    for (let i = 0; i < tries; i++) {
      if (gen !== h.bootGen) return { fromStart: false };
      try {
        const res = await fetch(playlistUrl, {
          method: 'GET',
          cache: 'no-store',
          mode: 'cors',
        });
        last = res.status;
        if (!res.ok) {
          tailStreak = 0;
          headStreak = 0;
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
          tailStreak = 0;
          headStreak = 0;
          await this.delay(500);
          continue;
        }
        withSegs += 1;

        // Tail (live edge) must work — otherwise folder mid-wipe.
        let tailOk = false;
        for (const seg of [...segs].reverse().slice(0, 5)) {
          if (await probeSeg(seg)) {
            tailOk = true;
            break;
          }
        }

        // Head = oldest listed — needed for dual-slot intro attach.
        let headOk = false;
        for (const seg of segs.slice(0, 3)) {
          if (await probeSeg(seg)) {
            headOk = true;
            break;
          }
        }

        if (tailOk) {
          tailStreak += 1;
          if (headOk) headStreak += 1;
          else headStreak = 0;

          if (headStreak >= needOkStreak) {
            return { fromStart: true };
          }
          // Standby burned past intro — attach live edge, skip 404 storm @0.
          if (tailStreak >= needOkStreak + 2 && headStreak === 0) {
            console.warn(
              '[tv] playlist head .ts gone — attach live edge (no intro seek)',
            );
            return { fromStart: false };
          }
        } else {
          tailStreak = 0;
          headStreak = 0;
          if (withSegs >= 6) {
            console.warn(
              '[tv] playlist segs all 404 — keep waiting (likely mid-wipe)',
            );
            withSegs = 0;
          }
        }
      } catch (e) {
        tailStreak = 0;
        headStreak = 0;
        console.warn('[tv] waitUntilOk blip', e);
      }
      await this.delay(500);
    }
    throw new Error(`Playlist not ready (last HTTP ${last})`);
  }

  /**
   * Hole in live HLS: remanifest / catch live edge.
   * Many .ts 404s with a LIVE playlist are delete_segments lag (NAS) — NOT a dead
   * encode. /start here kills ffmpeg → play/freeze stutter loops.
   */
  recoverMissingFragment(playlistUrl: string, sn?: number | string): void {
    const h = this.host;
    if (h.rebooting) return;
    const now = Date.now();
    if (now < h.recoverCooldownUntil) return;

    // Playing through buffer — lone edge 404s are delete_segments noise.
    if (this.hasPlaybackAnchor() || this.isActuallyPlaying()) {
      h.recoverCooldownUntil = now + 3_000;
      this.resumeIfPaused();
      return;
    }

    if (now - h.frag404BurstStarted > 20_000) {
      h.frag404BurstStarted = now;
      h.frag404Burst = 0;
    }
    h.frag404Burst += 1;

    // Probe playlist: if m3u8 is OK, only soft catch-up — never /start.
    void (async () => {
      let playlistDead = false;
      try {
        const probeUrl = `${playlistUrl}${playlistUrl.includes('?') ? '&' : '?'}_=${Date.now()}`;
        const res = await fetch(probeUrl, {
          method: 'GET',
          cache: 'no-store',
          mode: 'cors',
        });
        playlistDead =
          res.status === 404 || res.status === 503 || res.status === 410;
      } catch {
        playlistDead = true;
      }

      if (!playlistDead) {
        h.recoverCooldownUntil = now + 4_000;
        // Right after dual-slot intro seek: head .ts often deleted — jump live edge.
        if (
          Date.now() < (h.switchGraceUntil ?? 0) &&
          h.frag404Burst >= 2
        ) {
          console.warn(
            '[tv] frag 404 during post-switch — abandon intro, live edge',
          );
          try {
            h.hls?.startLoad(-1);
          } catch {
            this.recoverStaleHls(playlistUrl);
          }
          this.resumeIfPaused();
          h.stream.requestSeamSync(h.slug);
          return;
        }
        if (h.frag404Burst === 1 || h.frag404Burst % 6 === 0) {
          console.warn(
            `[tv] frag 404 burst=${h.frag404Burst} but playlist OK — soft catch-up (no /start)`,
          );
        }
        this.recoverStaleHls(playlistUrl);
        h.stream.requestSeamSync(h.slug);
        return;
      }

      // Playlist truly gone — only then escalate (after a real burst).
      if (h.frag404Burst >= 8) {
        console.warn(
          `[tv] ${h.frag404Burst} frag 404s + dead playlist — /start`,
        );
        h.recoverCooldownUntil = now + 15_000;
        h.frag404Burst = 0;
        h.remanifestCount = 0;
        h.badFragSn = null;
        h.rebootStream(false);
        return;
      }

      h.recoverCooldownUntil = now + 2_000;
      if (sn != null) h.badFragSn = sn;
      this.handlePlaylistPreparing();
      h.stream.requestSeamSync(h.slug);
    })();
  }

  /** Reload m3u8 and stay on live edge — do not seek mid-window. */
  recoverStaleHls(playlistUrl: string): void {
    const h = this.host;
    const hls = h.hls;
    if (!hls || h.rebooting) return;
    if (this.hasPlaybackAnchor() || this.isActuallyPlaying()) {
      this.resumeIfPaused();
      return;
    }

    const now = Date.now();
    if (now - h.remanifestAt > 30_000) h.remanifestCount = 0;
    if (now - h.remanifestAt < 8_000 && h.remanifestCount > 0) return;

    h.remanifestAt = now;
    h.remanifestCount += 1;

    if (h.remanifestCount >= 4) {
      console.warn('[tv] remanifest exhausted — seam sync (no /start)');
      h.remanifestCount = 0;
      h.badFragSn = null;
      h.stream.requestSeamSync(h.slug);
      return;
    }

    console.warn('[tv] stale HLS — soft startLoad');
    try {
      hls.startLoad(-1);
      this.resumeIfPaused();
    } catch {
      h.stream.requestSeamSync(h.slug);
    }
  }

  /** Episode seam: ffmpeg alive, m3u8 not ready yet (local /stream → 503). */
  handlePlaylistPreparing(): void {
    const h = this.host;
    if (h.rebooting) return;
    // Picture still moving — nginx/Nest blip (e.g. former auth_request 500).
    // Never flash connect chyron / /start over a live cartoon.
    if (this.isActuallyPlaying() || this.hasPlaybackAnchor()) {
      this.markPlaylistGap(8);
      // Keep playing from buffer — do NOT startLoad (that spam-GETs 503 → red console).
      this.resumeIfPaused();
      return;
    }
    this.markPlaylistGap(20);
    const now = Date.now();
    if (!h.prepare503Started) h.prepare503Started = now;
    // LEVEL_LOAD_ERROR can fire dozens/sec before stopLoad sticks — throttle count.
    if (now - h.prepare503LastAt < 1_500 && h.prepare503Count > 0) {
      try {
        h.hls?.stopLoad();
      } catch {
        /* ignore */
      }
      return;
    }
    h.prepare503LastAt = now;
    h.prepare503Count += 1;
    const elapsed = now - h.prepare503Started;
    // Stop hls.js from reloading the dead m3u8 every ~2s (console 503 flood).
    try {
      h.hls?.stopLoad();
    } catch {
      /* ignore */
    }
    // Escalate sooner when picture already frozen (was 45s → ~96s with seam soft).
    const stuckPic = this.isMediaTimeStuck(6);
    const escalateMs = stuckPic ? 20_000 : 45_000;
    const escalateCount = stuckPic ? 8 : 15;
    if (elapsed >= escalateMs || h.prepare503Count >= escalateCount) {
      if (h.switchingSlot || Date.now() < (h.switchGraceUntil ?? 0)) {
        h.stream.requestSeamSync(h.slug);
        return;
      }
      console.warn('[tv] playlist 503 too long — /start reattach');
      h.rebootStream(true);
      return;
    }
    if (h.prepare503Count === 1 || h.prepare503Count % 8 === 0) {
      console.warn(
        `[tv] playlist HTTP 503 — preparing (${Math.round(elapsed / 1000)}s, wait)`,
      );
      // Wrong-slot after promote: server should answer switch + live URL.
      h.stream.reportPlayIssue(h.slug, 'playlist404');
      h.stream.requestSeamSync(h.slug);
    }
    // Soft wait only — no chyron while buffer may still play.
    if (h.prepare503Count >= 3 || elapsed >= 4_000) {
      if (!this.hasPlaybackAnchor()) {
        h.loading = true;
        h.waitMessage = 'Подключаем эфир…';
      }
    }
    clearTimeout(h.prepare503Timer);
    const delay = Math.min(3_000 + h.prepare503Count * 500, 10_000);
    h.prepare503Timer = setTimeout(() => {
      if (h.rebooting) return;
      const el = h.prepare503Started ? Date.now() - h.prepare503Started : 0;
      if (el >= 45_000) {
        if (h.switchingSlot) {
          h.stream.requestSeamSync(h.slug);
          return;
        }
        console.warn('[tv] playlist 503 timer — /start reattach');
        h.rebootStream(true);
        return;
      }
      // Probe live slot URL; do NOT re-enter handlePlaylistPreparing (count storm).
      h.stream.requestSeamSync(h.slug);
      if (!this.hasPlaybackAnchor() && h.prepare503Started > 0) {
        try {
          h.hls?.startLoad(-1);
        } catch {
          /* ignore */
        }
      }
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
    const keepSound = h.soundOn && !h.userPrefersMute;
    const fromStart = !!opts?.fromStart;
    try {
      h.hls?.destroy();
    } catch {
      /* ignore */
    }
    h.hls = undefined;
    // Hard flush MSE/SourceBuffers — otherwise prior slot credits can flash
    // mid-next episode when the timeline holes / remanifest (X-Men under Kim).
    try {
      video.pause();
    } catch {
      /* ignore */
    }
    try {
      video.removeAttribute('src');
      video.load();
    } catch {
      /* ignore */
    }
    // Hard flush blanks the CRT — keep chyron until first frame (avoid silent black screen).
    if (fromStart || !this.hasPlaybackAnchor()) {
      h.loading = true;
      if (!h.waitMessage) h.waitMessage = 'Подключаем эфир…';
    }
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
        // Prefetch ~18s (~5 MB @ 2.2 Mbps) — was 30/60 (more mobile waste).
        maxBufferLength: 18,
        maxMaxBufferLength: 36,
        backBufferLength: 18,
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
        if (fromStart) {
          // Fragments appear on LEVEL_LOADED — startPosition:0 alone often snaps to live edge.
          h.hls?.once(Hls.Events.LEVEL_LOADED, (_ev, levelData) => {
            const frags = levelData?.details?.fragments ?? [];
            const first = frags[0];
            const start =
              first && Number.isFinite(first.start) ? first.start : 0;
            console.warn(
              `[tv] dual-slot attach from playlist start (keep intro @${start.toFixed(1)}s)`,
            );
            try {
              h.hls?.startLoad(start);
            } catch {
              h.hls?.startLoad(0);
            }
          });
        } else {
          h.hls?.startLoad(-1);
        }
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
          // 503 = preparing. 502 = proxy/nginx blip or missing dir.
          // 500 = mirror/upstream. 404/410 = missing playlist mid-seam.
          if (
            code === 503 ||
            code === 502 ||
            code === 500 ||
            code === 404 ||
            code === 410
          ) {
            // Mark preparing ASAP — before any stall timer can /start-wipe.
            if (!h.prepare503Started) h.prepare503Started = Date.now();
            h.prepare503LastAt = Date.now();
            this.markPlaylistGap(20);
            this.handlePlaylistPreparing();
            // Rare server ping only — play-issue mid-prepare used to /start-wipe → more 503.
            if (h.prepare503Count === 3 || h.prepare503Count % 12 === 0) {
              h.stream.requestSeamSync(h.slug);
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
          if (!warmingUp) h.rebootStream(false);
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
