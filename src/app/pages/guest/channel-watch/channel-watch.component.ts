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
  private prepare503Timer?: ReturnType<typeof setTimeout>;
  private prepare503Started = 0;
  private prepare503Count = 0;
  private offAirRetryTimer?: ReturnType<typeof setTimeout>;
  private offAirRetryCount = 0;
  /** User turned CRT off via bezel — don't auto-retry until they turn it on. */
  private userPoweredOff = false;
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
    clearTimeout(this.offAirRetryTimer);
    this.offAirRetryCount = 0;
    this.loading = false;
    // Playback recovered — clear hole-recovery state
    this.frag404Burst = 0;
    this.frag404BurstStarted = 0;
    this.remanifestCount = 0;
    this.badFragSn = null;
    this.frag404Streak = 0;
    this.lastFrag404Url = '';
    this.prepare503Started = 0;
    this.prepare503Count = 0;
    clearTimeout(this.prepare503Timer);
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
    this.playbackSub.add(
      this.playback.powerToggle.subscribe(() => this.onPowerToggle()),
    );

    this.routeSub = this.route.paramMap.subscribe((params) => {
      const slug = params.get('slug');
      if (!slug) {
        this.goOffAir('No channel');
        return;
      }
      if (slug === this.slug && this.hls) return;
      clearTimeout(this.crtTimer);
      clearTimeout(this.stallTimer);
      clearTimeout(this.offAirRetryTimer);
      this.stopHeartbeat();
      this.frag404Streak = 0;
      this.lastFrag404Url = '';
      this.remanifestCount = 0;
      this.remanifestAt = 0;
      this.badFragSn = null;
      this.recoverCooldownUntil = 0;
      this.rebootCount = 0;
      this.offAirRetryCount = 0;
      this.slug = slug;
      if (this.userPoweredOff) {
        this.crt = 'off-air';
        this.playback.setTvOn(false);
        this.loading = false;
        return;
      }
      this.crt = 'waiting';
      void this.bootStream();
    });
  }

  onVideoClick(): void {
    if (this.crt === 'off-air') {
      if (this.userPoweredOff) {
        this.powerOnByUser();
        return;
      }
      this.retryFromOffAir();
      return;
    }
    if (this.crt === 'powering-off') return;
    const v = this.videoRef.nativeElement;
    this.soundOn = true;
    this.needsGesture = false;
    v.muted = false;
    v.volume = 1;
    void v.play().catch(() => undefined);
    this.flashVolumeHud();
  }

  private onPowerToggle(): void {
    if (
      this.crt === 'off-air' ||
      this.crt === 'waiting' ||
      this.userPoweredOff
    ) {
      this.powerOnByUser();
      return;
    }
    if (this.crt === 'powering-off') return;
    this.powerOffByUser();
  }

  private powerOffByUser(): void {
    this.userPoweredOff = true;
    this.playback.setTvOn(false);
    clearTimeout(this.offAirRetryTimer);
    this.offAirRetryCount = 99;
    this.goOffAir('Power off');
  }

  private powerOnByUser(): void {
    if (!this.slug) return;
    this.userPoweredOff = false;
    this.playback.setTvOn(true);
    this.offAirRetryCount = 0;
    clearTimeout(this.offAirRetryTimer);
    this.rebootCount = 0;
    this.remanifestCount = 0;
    this.badFragSn = null;
    this.crt = 'waiting';
    this.error = null;
    this.waitMessage = 'Подключаем эфир…';
    void this.bootStream();
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
    this.playback.setTvOn(true);
  }

  private goOffAir(message?: string): void {
    if (this.crt === 'off-air' || this.crt === 'powering-off') return;

    clearTimeout(this.stallTimer);
    clearTimeout(this.crtTimer);
    clearTimeout(this.offAirRetryTimer);
    this.stopHeartbeat();
    this.bootGen += 1;
    this.loading = false;
    this.rebooting = false;
    this.needsGesture = false;
    if (message) this.error = message;

    const noRetry =
      !!message &&
      /No channel|not supported|HLS not supported|Power off/i.test(message);

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
      this.playback.setTvOn(false);
      // Nest restart / wiped HLS → don't sit on OFF AIR until manual reload
      if (!noRetry && this.slug) {
        this.scheduleOffAirRetry(message);
      }
    }, CRT_POWER_OFF_MS);
  }

  /** After Nest reboot / playlist wipe: auto /start like channel switch. */
  private scheduleOffAirRetry(message?: string): void {
    clearTimeout(this.offAirRetryTimer);
    if (!this.slug) return;
    // Real schedule off-air — a couple of probes, then stop
    const softOff = !!message && /не в эфире/i.test(message);
    const max = softOff ? 2 : 5;
    if (this.offAirRetryCount >= max) return;

    const delay = softOff
      ? 8000
      : Math.min(12_000, 2500 + this.offAirRetryCount * 2000);
    this.offAirRetryTimer = setTimeout(() => this.retryFromOffAir(), delay);
  }

  private retryFromOffAir(): void {
    if (!this.slug) return;
    if (this.userPoweredOff) return;
    if (this.crt !== 'off-air' && this.crt !== 'waiting') return;
    if (this.loading || this.rebooting) return;

    this.offAirRetryCount += 1;
    this.rebootCount = 0;
    this.remanifestCount = 0;
    this.badFragSn = null;
    this.crt = 'waiting';
    this.error = null;
    this.waitMessage = 'Переподключаем эфир…';
    console.warn(
      `[tv] off-air retry ${this.offAirRetryCount} — /start (Nest may have restarted)`,
    );
    void this.bootStream();
  }

  private async bootStream(): Promise<void> {
    const gen = ++this.bootGen;
    this.loading = true;
    this.error = null;
    this.waitMessage = 'Подключаем эфир…';
    this.hls?.destroy();
    this.hls = undefined;
    clearTimeout(this.stallTimer);
    // Touch idle TTL during /start + /status poll (before MANIFEST_PARSED).
    this.startHeartbeat();

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
      // Always absolute — relative `/stream/...` breaks `new URL(seg, playlistUrl)`
      // in waitUntilOk (TypeError → silent m3u8-only loop, no .ts).
      return base ? `${base}${u.pathname}` : new URL(u.pathname, window.location.origin).href;
    } catch {
      return streamUrl;
    }
  }

  /**
   * Wait until m3u8 lists a .ts that actually exists.
   * Probe from the *end* (live edge) — ffmpeg delete_segments often 404s the first
   * MEDIA-SEQUENCE entry while newer ones are fine.
   */
  private async waitUntilOk(url: string, gen: number, tries = 60): Promise<void> {
    const playlistUrl = new URL(url, window.location.origin).href;
    let last = 0;
    let withSegs = 0;

    for (let i = 0; i < tries; i++) {
      if (gen !== this.bootGen) return;
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

  private frag404Burst = 0;
  private frag404BurstStarted = 0;

  /**
   * Hole in live HLS: remanifest once. Many different SN 404s (zombie playlist
   * after ffmpeg died) → /start immediately — don't remanifest forever.
   */
  private recoverMissingFragment(
    playlistUrl: string,
    sn?: number | string,
  ): void {
    if (this.rebooting) return;
    const now = Date.now();
    if (now < this.recoverCooldownUntil) return;

    if (now - this.frag404BurstStarted > 15_000) {
      this.frag404BurstStarted = now;
      this.frag404Burst = 0;
    }
    this.frag404Burst += 1;

    // Sliding window of dead .ts while encode dead → /start, not remanifest spam.
    // Threshold 4: delete_segments often yields 1–2 benign 404s at the live edge.
    if (this.frag404Burst >= 4 || this.remanifestCount >= 2) {
      console.warn(
        `[tv] ${this.frag404Burst} frag 404s — /start (encode likely dead)`,
      );
      this.recoverCooldownUntil = now + 8_000;
      this.frag404Burst = 0;
      this.remanifestCount = 0;
      this.badFragSn = null;
      this.rebootStream();
      return;
    }

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
    this.recoverCooldownUntil = now + 1_200;
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

  /** Episode seam: ffmpeg alive, m3u8 not ready yet (local /stream → 503). */
  private handlePlaylistPreparing(): void {
    if (this.rebooting) return;
    const now = Date.now();
    if (!this.prepare503Started) this.prepare503Started = now;
    this.prepare503Count += 1;
    const elapsed = now - this.prepare503Started;
    // Up to ~2 min (DuckTales→Spider-Man cold seek on NAS/dev)
    if (elapsed < 120_000) {
      if (this.prepare503Count === 1 || this.prepare503Count % 5 === 0) {
        console.warn(
          `[tv] playlist HTTP 503 — preparing (${Math.round(elapsed / 1000)}s, wait)`,
        );
      }
      this.loading = true;
      this.waitMessage = 'Следующая серия…';
      clearTimeout(this.prepare503Timer);
      const delay = Math.min(2000 + this.prepare503Count * 400, 6000);
      this.prepare503Timer = setTimeout(() => {
        if (this.rebooting) return;
        this.hls?.startLoad(-1);
      }, delay);
      return;
    }
    console.warn('[tv] playlist 503 too long — /start reattach');
    this.prepare503Started = 0;
    this.prepare503Count = 0;
    this.rebootStream();
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
    // Allow recover even from off-air / powering-off — playlist 404 often left us there
    if (this.crt === 'powering-off') {
      clearTimeout(this.crtTimer);
      this.crt = 'waiting';
    }
    if (this.isActuallyPlaying()) return;

    const now = Date.now();
    if (now - this.rebootWindowStarted > 60_000) {
      this.rebootWindowStarted = now;
      this.rebootCount = 0;
    }
    this.rebootCount += 1;
    if (this.rebootCount > 4) {
      console.warn('[tv] reboot circuit open — off air + auto-retry');
      this.goOffAir('Broadcast ended');
      return;
    }

    this.rebooting = true;
    if (this.crt === 'off-air') this.crt = 'waiting';
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
          // 503 = Nest static "HLS preparing" (episode seam / seek) — wait, no /start storm.
          if (code === 503) {
            this.handlePlaylistPreparing();
            return;
          }
          if (code === 404 || code === 410) {
            if (warmingUp) {
              setTimeout(() => this.hls?.startLoad(), 1500);
              return;
            }
            console.warn(
              `[tv] playlist HTTP ${code} — /start reattach (not off air)`,
            );
            this.rebootStream();
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
    clearTimeout(this.offAirRetryTimer);
    clearTimeout(this.prepare503Timer);
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
