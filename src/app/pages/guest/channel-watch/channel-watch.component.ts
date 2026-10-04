import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  GuestPlaybackCoreService,
  StreamCoreService,
  type StreamSocketStatus,
} from '@services';
import { LoadBarComponent } from '@widgets';
import Hls from 'hls.js';
import { ChannelWatchHls } from './channel-watch-hls';
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
  private prepare503LastAt = 0;
  private offAirRetryTimer?: ReturnType<typeof setTimeout>;
  private offAirRetryCount = 0;
  /** User turned CRT off via bezel — don't auto-retry until they turn it on. */
  private userPoweredOff = false;
  private socketOff?: () => void;
  private lastSocketGen?: number;
  private seamWatchTimer?: ReturnType<typeof setTimeout>;
  private seamWatchAttempt = 0;
  /** Seam watchdog armed even when overlay is silent (playing through buffer). */
  private seamWatchActive = false;
  /** Dual-slot URL switch in flight — blocks /start from onEnded. */
  private switchingSlot = false;
  private onWaiting = () => this.hlsHelper.onBufferIssue();
  private onStalled = () => this.hlsHelper.onBufferIssue();
  /** Live HLS must not go OFF AIR on `ended` — usually encoder gap or empty window. */
  private onEnded = () => {
    if (this.loading || this.rebooting) return;
    if (this.crt === 'off-air' || this.crt === 'powering-off') return;
    // Dual-slot switch / seam — do NOT /start (kills standby / rewinds).
    if (this.seamWatchActive || this.switchingSlot) {
      console.warn('[tv] ended during seam/switch — soft sync only');
      this.stream.requestSeamSync(this.slug);
      this.hlsHelper.onBufferIssue();
      return;
    }
    console.warn('[tv] unexpected ended — recover (not off air)');
    void firstValueFrom(this.stream.start(this.slug)).catch(() => undefined);
    this.hlsHelper.onBufferIssue();
  };
  private onPlaying = () => {
    clearTimeout(this.stallTimer);
    clearTimeout(this.offAirRetryTimer);
    // Live picture — end silent seam watch (do not keep syncing forever).
    this.clearSeamWatch();
    this.hlsHelper.clearPlaylistGap();
    this.hlsHelper.markPlaying();
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
    this.prepare503LastAt = 0;
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
  /** Schedule ended — no "reconnect" hint (would confuse). */
  offAirCanReconnect = true;
  meta: { episodeId?: number; offsetSec?: number } = {};

  constructor(
    private route: ActivatedRoute,
    private stream: StreamCoreService,
    private playback: GuestPlaybackCoreService,
  ) {
    this.hlsHelper = new ChannelWatchHls(this as never);
  }

  private readonly hlsHelper: ChannelWatchHls;

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
      this.clearSeamWatch();
      this.lastSocketGen = undefined;
      this.prepare503Started = 0;
      this.prepare503Count = 0;
      this.prepare503LastAt = 0;
      clearTimeout(this.prepare503Timer);
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
      this.bindStreamSocket(slug);
      void this.bootStream();
    });
  }

  private bindStreamSocket(slug: string): void {
    this.socketOff?.();
    this.socketOff = this.stream.connectWatch(slug, (s) =>
      this.onStreamSocketStatus(s),
    );
  }

  private onStreamSocketStatus(s: StreamSocketStatus): void {
    if (s.channel !== this.slug) return;
    if (s.status === 'off') {
      this.clearSeamWatch();
      this.goOffAir(s.message ?? 'Сейчас не в эфире');
      return;
    }

    // Dual-slot switch first — must not be eaten by generation↑ soft path.
    if (s.hint === 'switch') {
      if (s.generation != null) this.lastSocketGen = s.generation;
      const nextUrl = s.streamUrl;
      if (!nextUrl) {
        console.warn('[tv] switch hint without streamUrl — soft sync');
        this.seamWatchActive = true;
        this.armSeamWatch();
        this.stream.requestSeamSync(this.slug);
        return;
      }
      console.warn(`[tv] dual-slot switch → ${nextUrl}`);
      this.seamWatchActive = true;
      this.seamWatchAttempt = 0;
      this.armSeamWatch();
      void this.switchToSlotUrl(nextUrl);
      return;
    }

    // Live status with streamUrl after reconnect — reattach if URL slot changed.
    if (
      s.streamUrl &&
      s.ready &&
      (s.hint === 'none' || s.status === 'live') &&
      this.streamUrl
    ) {
      const next = this.hlsHelper.toPlayableUrl(s.streamUrl);
      const cur = this.streamUrl;
      const nextPath = (() => {
        try {
          return new URL(next, window.location.origin).pathname;
        } catch {
          return next;
        }
      })();
      const curPath = (() => {
        try {
          return new URL(cur, window.location.origin).pathname;
        } catch {
          return cur;
        }
      })();
      if (nextPath !== curPath && !this.switchingSlot) {
        console.warn('[tv] status streamUrl≠current — dual-slot reattach');
        if (s.generation != null) this.lastSocketGen = s.generation;
        void this.switchToSlotUrl(s.streamUrl);
        return;
      }
    }

    if (s.generation != null && this.lastSocketGen != null) {
      if (s.generation > this.lastSocketGen) {
        this.lastSocketGen = s.generation;
        // Picture still moving / dual-slot switch in flight — silent gen bump.
        // Hard reattach mid-credits caused ending→rewind→ending loops.
        if (
          this.switchingSlot ||
          this.seamWatchActive ||
          this.hlsHelper.hasPlaybackAnchor() ||
          (this.hlsHelper.isActuallyPlaying() &&
            !this.hlsHelper.isMediaTimeStuck(6)) ||
          this.hlsHelper.msSincePlaying() < 45_000
        ) {
          console.warn('[tv] cursor generation↑ — soft (playing through)');
          this.seamWatchActive = true;
          this.armSeamWatch();
          return;
        }
        console.warn('[tv] cursor generation↑ — hard reattach');
        this.clearSeamWatch();
        this.hardReattach();
        return;
      }
    }
    if (s.generation != null) this.lastSocketGen = s.generation;

    if (s.hint === 'wait') {
      // Picture still flowing — silent seam watch (no chyron), but keep watchdog alive.
      if (
        this.hlsHelper.isActuallyPlaying() ||
        this.hlsHelper.hasPlaybackAnchor() ||
        (this.hlsHelper.msSincePlaying() < 30_000 &&
          !this.hlsHelper.isMediaTimeStuck(12))
      ) {
        this.seamWatchActive = true;
        this.armSeamWatch();
        return;
      }
      if (s.message) this.waitMessage = s.message;
      this.loading = true;
      this.seamWatchActive = true;
      this.armSeamWatch();
      return;
    }
    if (s.hint === 'hot') {
      // Soften: with real future buffer ignore hot (no remanifest flicker).
      if (this.hlsHelper.hasPlaybackAnchor()) {
        this.hlsHelper.resumeIfPaused();
        return;
      }
      // During playlist wipe gap — ignore hot (would 404-loop remanifest).
      if (this.hlsHelper.inPlaylistGap()) {
        if (s.message) this.waitMessage = s.message;
        this.loading = true;
        this.seamWatchActive = true;
        this.armSeamWatch();
        return;
      }
      if (s.message) this.waitMessage = s.message;
      this.seamWatchActive = true;
      this.armSeamWatch();
      this.hotRecover();
      return;
    }
    if (s.hint === 'hard') {
      this.clearSeamWatch();
      this.hardReattach();
    }
  }

  /** If seam wait never resolves, ask server again (then hard after a few tries). */
  private armSeamWatch(): void {
    clearTimeout(this.seamWatchTimer);
    const delay = Math.min(8_000 + this.seamWatchAttempt * 4_000, 20_000);
    this.seamWatchTimer = setTimeout(() => this.onSeamWatchFire(), delay);
  }

  private clearSeamWatch(): void {
    clearTimeout(this.seamWatchTimer);
    this.seamWatchTimer = undefined;
    this.seamWatchAttempt = 0;
    this.seamWatchActive = false;
  }

  private onSeamWatchFire(): void {
    if (
      !this.seamWatchActive ||
      this.crt === 'off-air' ||
      this.crt === 'powering-off'
    ) {
      this.clearSeamWatch();
      return;
    }
    // Picture healthy again — stop polling (was infinite requestSeamSync spam).
    if (
      this.hlsHelper.hasPlaybackAnchor() ||
      (this.hlsHelper.isActuallyPlaying() &&
        !this.hlsHelper.isMediaTimeStuck(12))
    ) {
      this.loading = false;
      this.clearSeamWatch();
      return;
    }

    this.seamWatchAttempt += 1;
    console.warn(
      `[tv] seam watch #${this.seamWatchAttempt} — sync status from server`,
    );
    this.stream.requestSeamSync(this.slug);

    // Soft forever unless media stuck AND playlist dead — #4 must not hardReattach
    // (that forced /start mid-seam → 503 / rewind).
    void (async () => {
      const stuck = this.hlsHelper.isMediaTimeStuck(12);
      if (!stuck) {
        this.hlsHelper.hotRecover();
        this.armSeamWatch();
        return;
      }
      const url = this.streamUrl;
      let dead = !url;
      if (url) {
        try {
          const probeUrl = `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`;
          const res = await fetch(probeUrl, {
            method: 'GET',
            cache: 'no-store',
            mode: 'cors',
          });
          dead = res.status === 404 || res.status === 503 || !res.ok;
        } catch {
          dead = true;
        }
      }
      if (stuck && dead && this.seamWatchAttempt >= 4) {
        console.warn('[tv] seam watch — stuck + dead playlist — hard reattach');
        this.clearSeamWatch();
        this.hardReattach();
        return;
      }
      console.warn('[tv] seam watch — soft only (stuck=' + stuck + ', dead=' + dead + ')');
      this.hlsHelper.hotRecover();
      this.armSeamWatch();
    })();
  }

  /** Dual-slot: attach new playlist without /start (standby already encoding). */
  private async switchToSlotUrl(rawUrl: string): Promise<void> {
    if (this.switchingSlot) {
      console.warn('[tv] dual-slot switch already in flight — skip');
      return;
    }
    this.switchingSlot = true;
    this.bootGen += 1;
    const gen = this.bootGen;
    // Keep current picture while next slot is probed — no "эфир" flash on seam.
    const hadPicture =
      this.hlsHelper.isActuallyPlaying() ||
      this.hlsHelper.hasPlaybackAnchor();
    this.loading = false;
    this.seamWatchActive = true;
    this.seamWatchAttempt = 0;
    // Do NOT stopLoad yet — old slot buffer covers the waitUntilOk gap.
    const url = this.hlsHelper.toPlayableUrl(rawUrl);
    const overlayTimer = setTimeout(() => {
      if (gen !== this.bootGen) return;
      if (
        this.hlsHelper.isActuallyPlaying() ||
        this.hlsHelper.hasPlaybackAnchor()
      ) {
        return;
      }
      this.loading = true;
      this.waitMessage = 'Подключаем эфир…';
    }, hadPicture ? 4_500 : 800);
    try {
      await this.hlsHelper.waitUntilOk(url, gen);
      if (gen !== this.bootGen) return;
      this.streamUrl = url;
      try {
        this.hls?.stopLoad();
      } catch {
        /* ignore */
      }
      this.hlsHelper.attach(url, { fromStart: true });
      this.clearSeamWatch();
      this.loading = false;
      console.warn('[tv] dual-slot switch attached (silent, from start)');
    } catch (e) {
      console.warn('[tv] dual-slot switch failed', e);
      this.seamWatchActive = true;
      this.armSeamWatch();
      this.stream.requestSeamSync(this.slug);
    } finally {
      clearTimeout(overlayTimer);
      this.switchingSlot = false;
    }
  }

  /** Remanifest only — same encode. */
  hotRecover(): void {
    // Do not clear loading here — hotRecover probes; overlay stays on 503/404.
    this.hlsHelper.hotRecover();
  }

  /** /start + full HLS reattach. */
  hardReattach(): void {
    // Force: loading/seam overlay must not block hard recover (frozen credits logo).
    this.clearSeamWatch();
    this.loading = false;
    this.rebooting = false;
    this.rebootStream(true);
  }

  onVideoClick(): void {
    if (this.crt === 'off-air') {
      if (this.userPoweredOff) {
        this.powerOnByUser();
        return;
      }
      if (!this.offAirCanReconnect) return;
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

    this.clearSeamWatch();
    clearTimeout(this.stallTimer);
    clearTimeout(this.crtTimer);
    clearTimeout(this.offAirRetryTimer);
    this.stopHeartbeat();
    this.bootGen += 1;
    this.loading = false;
    this.rebooting = false;
    this.needsGesture = false;
    if (message) this.error = message;

    const scheduleEnded =
      !!message &&
      /не в эфире|off air|Channel is off|закончен|Broadcast ended/i.test(
        message,
      );
    const noRetry =
      scheduleEnded ||
      (!!message &&
        /No channel|not supported|HLS not supported|Power off/i.test(message));
    // Schedule ended → "эфир закончился", no reconnect spam.
    this.offAirCanReconnect = this.userPoweredOff || !scheduleEnded;

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
    if (!this.offAirCanReconnect) return;
    // Real schedule off-air — do not spam /start
    const softOff =
      !!message && /не в эфире|off air|Channel is off/i.test(message);
    if (softOff) return;
    const max = 5;
    if (this.offAirRetryCount >= max) {
      this.offAirCanReconnect = false;
      return;
    }

    const delay = Math.min(12_000, 2500 + this.offAirRetryCount * 2000);
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

  private async bootStream(opts?: { deferChyronMs?: number }): Promise<void> {
    const gen = ++this.bootGen;
    const defer = Math.max(0, opts?.deferChyronMs ?? 0);
    this.error = null;
    clearTimeout(this.stallTimer);
    if (defer > 0) {
      // Keep last frame — show "эфир" only if still not playing after a beat.
      this.loading = false;
      this.stallTimer = setTimeout(() => {
        if (gen !== this.bootGen) return;
        if (this.hlsHelper.isActuallyPlaying()) return;
        this.loading = true;
        this.waitMessage = 'Подключаем эфир…';
      }, defer);
    } else {
      this.loading = true;
      this.waitMessage = 'Подключаем эфир…';
    }
    this.hls?.destroy();
    this.hls = undefined;
    // Touch idle TTL during /start + /status poll (before MANIFEST_PARSED).
    this.startHeartbeat();

    if (this.crt === 'off-air' || this.crt === 'powering-off') {
      this.crt = 'waiting';
    }

    try {
      const url = await this.hlsHelper.waitUntilPlayable(this.slug, gen);
      if (gen !== this.bootGen) return;
      clearTimeout(this.stallTimer);
      this.hlsHelper.attach(url);
      this.rebooting = false;
      this.loading = false;
    } catch (err: unknown) {
      if (gen !== this.bootGen) return;
      clearTimeout(this.stallTimer);
      this.loading = false;
      this.rebooting = false;
      this.goOffAir(this.streamErrorMessage(err));
    }
  }

  /** Nest body / HttpErrorResponse → readable off-air reason. */
  private streamErrorMessage(err: unknown): string {
    if (!err || typeof err !== 'object') return 'Stream failed';
    const e = err as {
      status?: number;
      message?: string;
      error?: { message?: string | string[] } | string;
    };
    const body = e.error;
    if (body && typeof body === 'object') {
      const m = body.message;
      if (typeof m === 'string' && m.trim()) return m;
      if (Array.isArray(m) && m.length) return m.join(', ');
    }
    if (typeof body === 'string' && body.trim()) return body;
    if (e.status === 400) return 'Channel is off air';
    return e.message || 'Stream failed';
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

  private frag404Burst = 0;
  private frag404BurstStarted = 0;
  /** Min gap between hard /start reboots — stops WS-blip → /start storms. */
  private lastHardRebootAt = 0;

  private rebootStream(force = false): void {
    if (this.rebooting) return;
    // loading alone must not block 503 escalation / forced recover.
    if (!force && this.loading && !this.prepare503Started) return;
    // Allow recover even from off-air / powering-off — playlist 404 often left us there
    if (this.crt === 'powering-off') {
      clearTimeout(this.crtTimer);
      this.crt = 'waiting';
    }
    if (!force && this.hlsHelper.isActuallyPlaying()) return;
    if (
      !force &&
      this.hlsHelper.msSincePlaying() < 60_000 &&
      !this.hlsHelper.isMediaTimeStuck(15)
    ) {
      console.warn('[tv] stall — skip /start (recent play)');
      this.hotRecover();
      return;
    }
    // Mid-seam stall → /start used to kill bridge encode. Soft unless force/stuck.
    if (
      !force &&
      this.seamWatchActive &&
      !this.switchingSlot &&
      !this.hlsHelper.isMediaTimeStuck(12)
    ) {
      console.warn('[tv] stall — blocked /start during seam (soft sync)');
      this.stream.requestSeamSync(this.slug);
      this.hotRecover();
      return;
    }

    const now = Date.now();
    if (!force && now - this.lastHardRebootAt < 60_000) {
      console.warn('[tv] stall — /start cooldown, soft only');
      this.hotRecover();
      return;
    }
    if (now - this.rebootWindowStarted > 60_000) {
      this.rebootWindowStarted = now;
      this.rebootCount = 0;
    }
    this.rebootCount += 1;
    if (this.rebootCount > 4) {
      console.warn('[tv] reboot circuit open — soft off + auto-retry');
      // Not "Broadcast ended" — that disables reconnect forever.
      this.goOffAir('Recover failed — retrying…');
      return;
    }

    this.lastHardRebootAt = now;
    this.rebooting = true;
    this.loading = false;
    if (this.crt === 'off-air') this.crt = 'waiting';
    const recentPlay = this.hlsHelper.msSincePlaying() < 20_000;
    console.warn(
      recentPlay
        ? '[tv] stall — /start soft (defer chyron)'
        : '[tv] stall — /start + reattach HLS',
    );
    void this.bootStream({ deferChyronMs: recentPlay ? 3_000 : 0 });
  }

  ngOnDestroy(): void {
    this.bootGen += 1;
    this.socketOff?.();
    this.socketOff = undefined;
    this.clearSeamWatch();
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
