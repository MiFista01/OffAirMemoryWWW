import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { environment } from '@env';
import {
  GuestPlaybackCoreService,
  StreamCoreService,
  StreamStartResponse,
  StreamStatusResponse,
} from '@services';
import { LoadBarComponent } from '@widgets';
import Hls from 'hls.js';
import { firstValueFrom, Subscription } from 'rxjs';

type CrtState = 'waiting' | 'powering-on' | 'on' | 'powering-off' | 'off-air';

/** Must match `crt-power-on` duration in SCSS */
const CRT_POWER_ON_MS = 1400;
/** Must match `crt-video-collapse` duration in SCSS */
const CRT_POWER_OFF_MS = 700;

@Component({
  selector: 'app-channel-watch',
  standalone: true,
  imports: [CommonModule, LoadBarComponent],
  templateUrl: './channel-watch.component.html',
  styleUrl: './channel-watch.component.scss',
})
export class ChannelWatchComponent implements AfterViewInit, OnDestroy {
  @ViewChild('video', { static: true })
  videoRef!: ElementRef<HTMLVideoElement>;

  private routeSub?: ReturnType<ActivatedRoute['paramMap']['subscribe']>;
  private playbackSub?: Subscription;
  private volumeHudTimer?: ReturnType<typeof setTimeout>;
  private readonly volumeStep = 0.1;
  private readonly volumeHudMs = 1400;
  private hls?: Hls;
  private slug = '';
  private streamUrl = '';
  private stallTimer?: ReturnType<typeof setTimeout>;
  private crtTimer?: ReturnType<typeof setTimeout>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private bootGen = 0;
  private rebooting = false;
  private rebootCount = 0;
  private rebootWindowStarted = 0;
  private attachAt = 0;
  private frag404Streak = 0;
  private lastFrag404Url = '';
  private remanifestAt = 0;
  private remanifestCount = 0;
  /** SN that already caused a remanifest — second 404 → reboot, no seek thrash */
  private badFragSn: number | string | null = null;
  private recoverCooldownUntil = 0;
  private onWaiting = () => this.onBufferIssue();
  private onStalled = () => this.onBufferIssue();
  /** Live HLS must not go OFF AIR on `ended` — usually encoder gap or empty window. */
  private onEnded = () => {
    if (this.loading || this.rebooting) return;
    if (this.crt === 'off-air' || this.crt === 'powering-off') return;
    console.warn('[tv] unexpected ended — recover (not off air)');
    void firstValueFrom(this.stream.start(this.slug)).catch(() => undefined);
    this.onBufferIssue();
  };
  private onPlaying = () => {
    clearTimeout(this.stallTimer);
    this.loading = false;
    // Playback recovered — clear hole-recovery state
    this.remanifestCount = 0;
    this.badFragSn = null;
    this.frag404Streak = 0;
    this.lastFrag404Url = '';
  };

  crt: CrtState = 'waiting';
  soundOn = false;
  volumePercent = 0;
  volumeHudVisible = false;
  readonly volumeBarColor = {
    startColor: '#2a5a2a',
    middleColor: '#6ab04c',
    endColor: '#c8f090',
  };
  needsGesture = false;
  error: string | null = null;
  loading = true;
  waitMessage = 'Подключаем эфир…';
  meta: { episodeId?: number; offsetSec?: number } = {};

  constructor(
    private route: ActivatedRoute,
    private stream: StreamCoreService,
    private playback: GuestPlaybackCoreService,
  ) {}

  ngAfterViewInit(): void {
    this.playbackSub = this.playback.volumeStep.subscribe((delta) => {
      this.adjustVolume(delta);
    });

    this.routeSub = this.route.paramMap.subscribe((params) => {
      const slug = params.get('slug');
      if (!slug) {
        this.goOffAir('No channel');
        return;
      }
      if (slug === this.slug && this.hls) return;
      clearTimeout(this.crtTimer);
      clearTimeout(this.stallTimer);
      this.stopHeartbeat();
      this.frag404Streak = 0;
      this.lastFrag404Url = '';
      this.remanifestCount = 0;
      this.remanifestAt = 0;
      this.badFragSn = null;
      this.recoverCooldownUntil = 0;
      this.rebootCount = 0;
      this.slug = slug;
      this.crt = 'waiting';
      void this.bootStream();
    });
  }

  onVideoClick(): void {
    if (this.crt === 'off-air' || this.crt === 'powering-off') return;
    const v = this.videoRef.nativeElement;
    this.soundOn = true;
    this.needsGesture = false;
    v.muted = false;
    v.volume = 1;
    void v.play().catch(() => undefined);
    this.flashVolumeHud();
  }

  private adjustVolume(delta: -1 | 1): void {
    if (this.crt === 'off-air' || this.crt === 'powering-off') return;
    const v = this.videoRef.nativeElement;
    let vol = v.volume;
    if (!this.soundOn && delta > 0) {
      vol = Math.max(this.volumeStep, vol);
    }
    vol = Math.min(1, Math.max(0, vol + delta * this.volumeStep));
    v.volume = vol;
    if (vol <= 0) {
      v.muted = true;
      this.soundOn = false;
      this.flashVolumeHud();
      return;
    }
    v.muted = false;
    this.soundOn = true;
    this.needsGesture = false;
    void v.play().catch(() => undefined);
    this.flashVolumeHud();
  }

  private flashVolumeHud(): void {
    if (this.crt !== 'on') return;
    const v = this.videoRef.nativeElement;
    const level = v.muted || !this.soundOn ? 0 : v.volume;
    this.volumePercent = Math.round(Math.min(1, Math.max(0, level)) * 100);
    this.volumeHudVisible = true;
    clearTimeout(this.volumeHudTimer);
    this.volumeHudTimer = setTimeout(() => {
      this.volumeHudVisible = false;
    }, this.volumeHudMs);
  }

  /** CRT warm-up — call only once HLS can actually play. */
  private beginPowerOn(): void {
    if (
      this.crt === 'on' ||
      this.crt === 'powering-on' ||
      this.crt === 'powering-off'
    ) {
      return;
    }
    clearTimeout(this.crtTimer);
    this.crt = 'powering-on';
    this.crtTimer = setTimeout(() => this.finishPowerOn(), CRT_POWER_ON_MS);
  }

  private finishPowerOn(): void {
    if (this.crt !== 'powering-on') return;
    clearTimeout(this.crtTimer);
    this.crt = 'on';
  }

  private goOffAir(message?: string): void {
    if (this.crt === 'off-air' || this.crt === 'powering-off') return;

    clearTimeout(this.stallTimer);
    clearTimeout(this.crtTimer);
    this.stopHeartbeat();
    this.bootGen += 1;
    this.loading = false;
    this.rebooting = false;
    this.needsGesture = false;
    if (message) this.error = message;

    this.crt = 'powering-off';
    const video = this.videoRef?.nativeElement;
    try {
      video?.pause();
    } catch {
      /* ignore */
    }

    this.crtTimer = setTimeout(() => {
      this.hls?.destroy();
      this.hls = undefined;
      if (video) {
        video.removeAttribute('src');
        video.load();
      }
      this.crt = 'off-air';
    }, CRT_POWER_OFF_MS);
  }

  private async bootStream(): Promise<void> {
    const gen = ++this.bootGen;
    this.loading = true;
    this.error = null;
    this.waitMessage = 'Подключаем эфир…';
    this.hls?.destroy();
    this.hls = undefined;
    clearTimeout(this.stallTimer);

    if (this.crt === 'off-air' || this.crt === 'powering-off') {
      this.crt = 'waiting';
    }

    try {
      const url = await this.waitUntilPlayable(this.slug, gen);
      if (gen !== this.bootGen) return;
      this.attach(url);
      this.rebooting = false;
    } catch (err: unknown) {
      if (gen !== this.bootGen) return;
      this.loading = false;
      this.rebooting = false;
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: string }).message)
          : 'Stream failed';
      this.goOffAir(msg || 'Stream failed');
    }
  }

  /**
   * /start → if not playable yet, poll /status?ensure=true (~2s).
   * Do not attach the player until streamUrl exists — otherwise a 404 storm on an empty folder.
   */
  private async waitUntilPlayable(slug: string, gen: number): Promise<string> {
    let res: StreamStartResponse | StreamStatusResponse =
      await firstValueFrom(this.stream.start(slug));
    if (gen !== this.bootGen) throw new Error('cancelled');

    this.meta = {
      episodeId: 'episodeId' in res ? res.episodeId : undefined,
      offsetSec: 'offsetSec' in res ? res.offsetSec : undefined,
    };

    for (let i = 0; i < 90; i++) {
      if (gen !== this.bootGen) throw new Error('cancelled');

      if (res.status === 'off') {
        throw new Error(res.message || 'Сейчас не в эфире');
      }

      const playable = !!(res.playable ?? res.ready) && !!res.streamUrl;
      if (playable && res.streamUrl) {
        const url = this.toPlayableUrl(res.streamUrl);
        this.streamUrl = url;
        this.waitMessage = 'Почти готово…';
        await this.waitUntilOk(url, gen);
        if (gen !== this.bootGen) throw new Error('cancelled');
        return url;
      }

      this.waitMessage =
        res.message || 'Эфир есть, подготавливаем поток — подождите';
      const delayMs = Math.max(1000, res.pollAfterMs ?? 2000);
      await this.delay(delayMs);
      if (gen !== this.bootGen) throw new Error('cancelled');

      res = await firstValueFrom(
        this.stream.status(slug, { ensure: true }),
      );
    }

    throw new Error('Playlist not ready');
  }

  private toPlayableUrl(streamUrl: string): string {
    try {
      const u = new URL(streamUrl, window.location.origin);
      if (!u.pathname.startsWith('/stream')) return streamUrl;
      const base = (environment.streamBase || '').replace(/\/$/, '');
      return base ? `${base}${u.pathname}` : u.pathname;
    } catch {
      return streamUrl;
    }
  }

  /**
   * Wait until m3u8 lists a .ts that actually exists.
   * Probe from the *end* (live edge) — ffmpeg delete_segments often 404s the first
   * MEDIA-SEQUENCE entry while newer ones are fine (seen as m3u8 spam, no air).
   */
  private async waitUntilOk(url: string, gen: number, tries = 60): Promise<void> {
    let last = 0;
    for (let i = 0; i < tries; i++) {
      if (gen !== this.bootGen) return;
      try {
        const res = await fetch(url, {
          method: 'GET',
          cache: 'no-store',
          mode: 'cors',
        });
        last = res.status;
        if (res.ok) {
          const body = await res.text();
          const segs = body
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => !!l && !l.startsWith('#') && /\.ts($|\?)/i.test(l));
          if (!segs.length) {
            await this.delay(500);
            continue;
          }
          // Newest first — oldest sliding-window entries are often already deleted
          const candidates = [...segs].reverse().slice(0, 5);
          for (const seg of candidates) {
            const segUrl = new URL(seg, url).href;
            const segRes = await fetch(segUrl, {
              method: 'GET',
              cache: 'no-store',
              mode: 'cors',
              headers: { Range: 'bytes=0-0' },
            });
            last = segRes.status;
            if (segRes.ok || segRes.status === 206) {
              try {
                await segRes.body?.cancel();
              } catch {
                /* ignore */
              }
              return;
            }
            try {
              await segRes.body?.cancel();
            } catch {
              /* ignore */
            }
          }
        }
        // 404/503 while ffmpeg is seeking — just wait
      } catch {
        /* network blip */
      }
      await this.delay(500);
    }
    throw new Error(`Playlist not ready (last HTTP ${last})`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private async startPlayback(): Promise<void> {
    const v = this.videoRef.nativeElement;
    v.volume = 1;
    v.muted = false;
    try {
      await v.play();
      this.soundOn = true;
      this.needsGesture = false;
      return;
    } catch {
      /* muted fallback */
    }
    v.muted = true;
    this.soundOn = false;
    try {
      await v.play();
      this.needsGesture = true;
    } catch {
      this.needsGesture = true;
    }
  }

  private onHlsReady(): void {
    this.beginPowerOn();
    this.startHeartbeat();
    void this.startPlayback();
  }

  /** Nest kills idle encodes (~60s). Touch while the CRT is on. */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    const slug = this.slug;
    if (!slug) return;
    const tick = () => {
      if (!this.slug || this.slug !== slug) return;
      if (this.crt === 'off-air' || this.crt === 'powering-off') return;
      void firstValueFrom(this.stream.heartbeat(slug)).catch(() => undefined);
    };
    tick();
    this.heartbeatTimer = setInterval(tick, 20_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private resumeIfPaused(): void {
    const v = this.videoRef.nativeElement;
    if (!v.paused) return;
    v.muted = !this.soundOn;
    void v.play().catch(() => {
      if (this.soundOn) {
        v.muted = true;
        this.soundOn = false;
        this.needsGesture = true;
        void v.play().catch(() => undefined);
      }
    });
  }

  private isActuallyPlaying(): boolean {
    const v = this.videoRef.nativeElement;
    return (
      !v.paused &&
      !v.ended &&
      v.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
    );
  }

  private nudgeToLiveEdge(): void {
    const hls = this.hls;
    const v = this.videoRef?.nativeElement;
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

  /**
   * Hole in live HLS: remanifest once (no timeline skipping — that caused
   * forward/back flicker). Same SN still 404 → /start reboot.
   */
  private recoverMissingFragment(
    playlistUrl: string,
    sn?: number | string,
  ): void {
    if (this.rebooting) return;
    const now = Date.now();
    if (now < this.recoverCooldownUntil) return;

    if (sn != null && sn === this.badFragSn && this.remanifestCount >= 1) {
      console.warn(
        `[tv] fragment sn=${sn} still missing after remanifest — /start`,
      );
      this.recoverCooldownUntil = now + 8_000;
      this.remanifestCount = 0;
      this.badFragSn = null;
      this.rebootStream();
      return;
    }

    if (sn != null) this.badFragSn = sn;
    this.recoverCooldownUntil = now + 2_500;
    this.recoverStaleHls(playlistUrl);
  }

  /** Reload m3u8 and stay on live edge — do not seek mid-window. */
  private recoverStaleHls(playlistUrl: string): void {
    const hls = this.hls;
    if (!hls || this.rebooting) return;

    const now = Date.now();
    if (now - this.remanifestAt > 30_000) this.remanifestCount = 0;
    if (now - this.remanifestAt < 2_000 && this.remanifestCount > 0) return;

    this.remanifestAt = now;
    this.remanifestCount += 1;

    if (this.remanifestCount >= 2) {
      console.warn('[tv] remanifest exhausted — /start reboot');
      this.remanifestCount = 0;
      this.badFragSn = null;
      this.rebootStream();
      return;
    }

    console.warn('[tv] stale HLS — remanifest + live edge');
    try {
      hls.stopLoad();
      const sep = playlistUrl.includes('?') ? '&' : '?';
      hls.loadSource(`${playlistUrl}${sep}_=${Date.now()}`);
      hls.startLoad(-1);
      // One gentle live snap after manifest lands — not every 404
      setTimeout(() => this.nudgeToLiveEdge(), 600);
    } catch {
      if (!this.rebooting) this.rebootStream();
    }
  }

  private onBufferIssue(): void {
    if (this.rebooting || this.loading) return;
    if (this.crt === 'off-air' || this.crt === 'powering-off') return;
    // First seconds after attach segments are still being written — do not reboot.
    if (Date.now() - this.attachAt < 20_000) {
      this.nudgeToLiveEdge();
      return;
    }
    this.nudgeToLiveEdge();
    clearTimeout(this.stallTimer);
    // NAS encode can stall briefly — wait longer before /start reboot
    this.stallTimer = setTimeout(() => this.recoverOrReboot(), 8000);
  }

  private recoverOrReboot(): void {
    if (this.rebooting || this.loading) return;
    if (this.crt === 'off-air' || this.crt === 'powering-off') return;
    if (this.isActuallyPlaying()) return;

    if (this.hls) {
      try {
        this.nudgeToLiveEdge();
        this.hls.startLoad();
      } catch {
        /* fall through */
      }
    }

    clearTimeout(this.stallTimer);
    this.stallTimer = setTimeout(() => this.rebootStream(), 10_000);
  }

  private rebootStream(): void {
    if (this.rebooting || this.loading) return;
    if (this.crt === 'off-air' || this.crt === 'powering-off') return;
    if (this.isActuallyPlaying()) return;

    const now = Date.now();
    if (now - this.rebootWindowStarted > 60_000) {
      this.rebootWindowStarted = now;
      this.rebootCount = 0;
    }
    this.rebootCount += 1;
    if (this.rebootCount > 4) {
      console.warn('[tv] reboot circuit open — off air');
      this.goOffAir('Broadcast ended');
      return;
    }

    this.rebooting = true;
    console.warn('[tv] stall — /start + reattach HLS');
    void this.bootStream();
  }

  private attach(url: string): void {
    const video = this.videoRef.nativeElement;
    const keepSound = this.soundOn;
    this.hls?.destroy();
    this.soundOn = keepSound;
    video.muted = !keepSound;
    this.attachAt = Date.now();
    // keep loading true until first playing — otherwise stall/frag-404 → false reboot

    video.removeEventListener('waiting', this.onWaiting);
    video.removeEventListener('stalled', this.onStalled);
    video.removeEventListener('ended', this.onEnded);
    video.removeEventListener('playing', this.onPlaying);
    video.addEventListener('waiting', this.onWaiting);
    video.addEventListener('stalled', this.onStalled);
    video.addEventListener('ended', this.onEnded);
    video.addEventListener('playing', this.onPlaying);

    if (Hls.isSupported()) {
      this.hls = new Hls({
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
      this.hls.attachMedia(video);
      this.hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        this.hls?.loadSource(url);
      });
      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.frag404Streak = 0;
        this.lastFrag404Url = '';
        // Do NOT reset remanifestCount / badFragSn here — that restarted skip/remanifest thrash
        if (keepSound) {
          video.muted = false;
          if (this.crt === 'waiting' || this.crt === 'off-air') {
            this.beginPowerOn();
          } else if (this.crt !== 'powering-on' && this.crt !== 'powering-off') {
            this.crt = 'on';
          }
          void video.play().catch(() => undefined);
        } else {
          this.onHlsReady();
        }
      });
      this.hls.on(Hls.Events.ERROR, (_e, data) => {
        if (this.rebooting) return;
        if (this.crt === 'off-air' || this.crt === 'powering-off') return;

        const warmingUp = Date.now() - this.attachAt < 20_000 || this.loading;

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
            setTimeout(() => this.hls?.startLoad(-1), 1000);
            return;
          }

          this.hls?.startLoad(-1);
          return;
        }

        if (
          data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
          data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR
        ) {
          const code = (data.response as { code?: number } | undefined)?.code;
          if (warmingUp && (code === 404 || code === 503)) {
            setTimeout(() => this.hls?.startLoad(), 1000);
            return;
          }
          if (code === 404 || code === 410) {
            this.goOffAir('Broadcast ended');
            return;
          }
        }

        if (data.fatal && this.hls) {
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            this.hls.recoverMediaError();
            this.resumeIfPaused();
            return;
          }
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            this.hls.startLoad();
            if (!warmingUp) this.onBufferIssue();
            return;
          }
          if (!warmingUp) this.rebootStream();
        }
      });
      return;
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.addEventListener(
        'loadedmetadata',
        () => this.onHlsReady(),
        { once: true },
      );
    } else {
      this.goOffAir('HLS not supported in this browser');
    }
  }

  ngOnDestroy(): void {
    this.bootGen += 1;
    clearTimeout(this.stallTimer);
    clearTimeout(this.crtTimer);
    clearTimeout(this.volumeHudTimer);
    this.stopHeartbeat();
    const video = this.videoRef?.nativeElement;
    video?.removeEventListener('waiting', this.onWaiting);
    video?.removeEventListener('stalled', this.onStalled);
    video?.removeEventListener('ended', this.onEnded);
    video?.removeEventListener('playing', this.onPlaying);
    this.routeSub?.unsubscribe();
    this.playbackSub?.unsubscribe();
    this.hls?.destroy();
  }
}
