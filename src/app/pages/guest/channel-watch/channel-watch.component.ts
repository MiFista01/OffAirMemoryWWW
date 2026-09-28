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
  StreamCoreService,
  StreamStartResponse,
  StreamStatusResponse,
} from '@services';
import Hls from 'hls.js';
import { firstValueFrom } from 'rxjs';

type CrtState = 'waiting' | 'powering-on' | 'on' | 'powering-off' | 'off-air';

/** Must match `crt-power-on` duration in SCSS */
const CRT_POWER_ON_MS = 1400;
/** Must match `crt-video-collapse` duration in SCSS */
const CRT_POWER_OFF_MS = 700;

@Component({
  selector: 'app-channel-watch',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './channel-watch.component.html',
  styleUrl: './channel-watch.component.scss',
})
export class ChannelWatchComponent implements AfterViewInit, OnDestroy {
  @ViewChild('video', { static: true })
  videoRef!: ElementRef<HTMLVideoElement>;

  private routeSub?: ReturnType<ActivatedRoute['paramMap']['subscribe']>;
  private hls?: Hls;
  private slug = '';
  private streamUrl = '';
  private stallTimer?: ReturnType<typeof setTimeout>;
  private crtTimer?: ReturnType<typeof setTimeout>;
  private bootGen = 0;
  private rebooting = false;
  private rebootCount = 0;
  private rebootWindowStarted = 0;
  private attachAt = 0;
  private onWaiting = () => this.onBufferIssue();
  private onStalled = () => this.onBufferIssue();
  private onEnded = () => this.goOffAir();
  private onPlaying = () => {
    clearTimeout(this.stallTimer);
    this.loading = false;
  };

  crt: CrtState = 'waiting';
  soundOn = false;
  needsGesture = false;
  error: string | null = null;
  loading = true;
  waitMessage = 'Подключаем эфир…';
  meta: { episodeId?: number; offsetSec?: number } = {};

  constructor(
    private route: ActivatedRoute,
    private stream: StreamCoreService,
  ) {}

  ngAfterViewInit(): void {
    this.routeSub = this.route.paramMap.subscribe((params) => {
      const slug = params.get('slug');
      if (!slug) {
        this.goOffAir('No channel');
        return;
      }
      if (slug === this.slug && this.hls) return;
      clearTimeout(this.crtTimer);
      clearTimeout(this.stallTimer);
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
  }

  /** CRT warm-up — call only once HLS can actually play. */
  private beginPowerOn(): void {
    if (this.crt === 'powering-on' || this.crt === 'powering-off') return;
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

  /** Wait for a real m3u8. 404/503 during seek is normal, not "off air". */
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
        if (res.ok) return;
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
    void this.startPlayback();
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

  private onBufferIssue(): void {
    if (this.rebooting || this.loading) return;
    if (this.crt === 'off-air' || this.crt === 'powering-off') return;
    // First seconds after attach segments are still being written — do not reboot.
    if (Date.now() - this.attachAt < 15_000) {
      this.resumeIfPaused();
      return;
    }
    this.resumeIfPaused();
    clearTimeout(this.stallTimer);
    this.stallTimer = setTimeout(() => this.recoverOrReboot(), 4000);
  }

  private recoverOrReboot(): void {
    if (this.rebooting || this.loading) return;
    if (this.crt === 'off-air' || this.crt === 'powering-off') return;
    if (this.isActuallyPlaying()) return;

    if (this.hls) {
      try {
        this.hls.startLoad();
        this.resumeIfPaused();
      } catch {
        /* fall through */
      }
    }

    clearTimeout(this.stallTimer);
    this.stallTimer = setTimeout(() => this.rebootStream(), 6000);
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
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 8,
        maxLiveSyncPlaybackRate: 1.0,
        manifestLoadingMaxRetry: 12,
        manifestLoadingRetryDelay: 1000,
        fragLoadingMaxRetry: 10,
        fragLoadingRetryDelay: 1000,
      });
      this.hls.attachMedia(video);
      this.hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        this.hls?.loadSource(url);
      });
      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (keepSound) {
          video.muted = false;
          this.beginPowerOn();
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
          // While segments are still being written — soft retry, no off air.
          if (warmingUp) {
            setTimeout(() => this.hls?.startLoad(), 1000);
            return;
          }
          this.hls?.startLoad();
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
    const video = this.videoRef?.nativeElement;
    video?.removeEventListener('waiting', this.onWaiting);
    video?.removeEventListener('stalled', this.onStalled);
    video?.removeEventListener('ended', this.onEnded);
    video?.removeEventListener('playing', this.onPlaying);
    this.routeSub?.unsubscribe();
    this.hls?.destroy();
  }
}
