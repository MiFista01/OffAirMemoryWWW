import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { GuestPlaybackCoreService } from '@services';
import { filter, Subscription } from 'rxjs';
import { TvGuideComponent } from './tv-guide/tv-guide.component';

type RemoteBtn = {
  id: string;
  label: string;
  src: string;
  pressedSrc: string;
  /** art-pixel rect on 72×176 remote.webp */
  x: number;
  y: number;
  w: number;
  h: number;
  slug?: string;
};

@Component({
  selector: 'app-guest',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    TranslateModule,
    TvGuideComponent,
  ],
  templateUrl: './guest.component.html',
  styleUrl: './guest.component.scss',
})
export class GuestComponent implements OnInit, OnDestroy {
  arrowVisible = false;
  remoteVisible = false;
  /** When false, motion/tap won't reveal the remote. */
  remoteEnabled = true;
  tvOn = true;
  zoomed = false;
  /** Open wall picture: FAQ (left) or WHY (right). */
  wallOpen: 'faq' | 'why' | null = null;
  activeSlug = 'nickelodeon';
  pressedId: string | null = null;
  guideOpen = false;
  private remoteHover = false;

  /** Center of D-pad on remote.webp (72×176). Tweak x/y if off. */
  readonly guideBtn: RemoteBtn = {
    id: 'guid',
    label: 'Guide',
    src: '/imgs/remote/guid.webp',
    pressedSrc: '/imgs/remote/guid pressed.webp',
    x: 26,
    y: 40,
    w: 22,
    h: 25,
  };

  /** Left/right of D-pad on remote.webp (72×176). Tweak x/y if off. */
  readonly soundBtns: RemoteBtn[] = [
    {
      id: 'sound-minus',
      label: 'Volume down',
      src: '/imgs/remote/sound -.webp',
      pressedSrc: '/imgs/remote/sound - pressed.webp',
      x: 17,
      y: 47,
      w: 9,
      h: 12,
    },
    {
      id: 'sound-plus',
      label: 'Volume up',
      src: '/imgs/remote/sound +.webp',
      pressedSrc: '/imgs/remote/sound + pressed.webp',
      x: 48,
      y: 47,
      w: 9,
      h: 12,
    },
  ];

  /** Positions tuned to blank face of remote.webp (72×176). */
  readonly channels: RemoteBtn[] = [
    {
      id: 'nick',
      slug: 'nickelodeon',
      label: 'Nickelodeon',
      src: '/imgs/remote/nick.webp',
      pressedSrc: '/imgs/remote/nick pressed.webp',
      x: 18,
      y: 80,
      w: 37,
      h: 21,
    },
    {
      id: 'cn',
      slug: 'cartoon-network',
      label: 'Cartoon Network',
      src: '/imgs/remote/cn.webp',
      pressedSrc: '/imgs/remote/cn pressed.webp',
      x: 18,
      y: 103,
      w: 37,
      h: 21,
    },
    {
      id: 'jetix',
      slug: 'jetix',
      label: 'Jetix',
      src: '/imgs/remote/jetix.webp',
      pressedSrc: '/imgs/remote/jetix pressed.webp',
      x: 17,
      y: 126,
      w: 39,
      h: 19,
    },
    {
      id: 'as',
      slug: 'adult-swim',
      label: 'Adult Swim',
      src: '/imgs/remote/as.webp',
      pressedSrc: '/imgs/remote/as pressed.webp',
      x: 18,
      y: 147,
      w: 37,
      h: 19,
    },
  ];

  private hideTimer?: ReturnType<typeof setTimeout>;
  private readonly hideDelayMs = 2400;
  /** Min pointer travel (px) before wake on move — not every pixel. */
  private readonly pointerWakePx = 28;
  private wakePointerX = 0;
  private wakePointerY = 0;
  private wakePointerReady = false;
  private routeSub?: Subscription;
  private tvOnSub?: Subscription;

  /** Bezel lights on 384×216 art — bottom-right of CRT. Tweak x/y if off. */
  readonly tvPowerBtn = {
    id: 'tv-power',
    x: 102,
    y: 147,
    w: 9,
    h: 9,
  };

  readonly tvRemoteBtn = {
    id: 'tv-remote',
    x: 110,
    y: 147,
    w: 9,
    h: 9,
  };

  /** Wall FAQ picture on 384×216 art — left of TV. Tweak x/y if off. */
  readonly faqPic = {
    x: 36,
    y: 52,
    w: 48,
    h: 56,
  };

  /** Wall WHY picture — right of TV. Tweak x/y if off. */
  readonly whyPic = {
    x: 248,
    y: 58,
    w: 48,
    h: 39,
  };

  get wallFocusX(): number {
    const pic = this.wallOpen === 'why' ? this.whyPic : this.faqPic;
    return ((pic.x + pic.w / 2) / 384) * 100;
  }

  get wallFocusY(): number {
    const pic = this.wallOpen === 'why' ? this.whyPic : this.faqPic;
    return ((pic.y + pic.h / 2) / 216) * 100;
  }

  get isWallOpen(): boolean {
    return this.wallOpen !== null;
  }

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private playback: GuestPlaybackCoreService,
  ) {}

  ngOnInit(): void {
    this.syncSlugFromRoute();
    this.tvOn = this.playback.isTvOn;
    this.tvOnSub = this.playback.tvOn.subscribe((on) => {
      this.tvOn = on;
    });
    this.routeSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.syncSlugFromRoute());
  }

  tvPowerSrc(): string {
    return encodeURI(
      this.tvOn ? '/imgs/remote/turn on.webp' : '/imgs/remote/turn off.webp',
    );
  }

  tvRemoteSrc(): string {
    return encodeURI(
      this.remoteEnabled
        ? '/imgs/remote/remote on.webp'
        : '/imgs/remote/remote off.webp',
    );
  }

  onTvPowerClick(): void {
    this.playback.togglePower();
  }

  onTvRemoteClick(): void {
    this.remoteEnabled = !this.remoteEnabled;
    if (!this.remoteEnabled) {
      this.remoteVisible = false;
      this.remoteHover = false;
    }
  }

  onFaqClick(): void {
    this.toggleWallPic('faq');
  }

  onWhyClick(): void {
    this.toggleWallPic('why');
  }

  private toggleWallPic(kind: 'faq' | 'why'): void {
    if (this.wallOpen === kind) {
      this.closeWallPic();
      return;
    }
    this.zoomed = false;
    this.guideOpen = false;
    this.remoteVisible = false;
    this.remoteHover = false;
    this.arrowVisible = false;
    clearTimeout(this.hideTimer);
    this.wallOpen = kind;
  }

  closeWallPic(): void {
    this.wallOpen = null;
  }

  btnSrc(btn: RemoteBtn): string {
    const held =
      this.pressedId === btn.id ||
      (btn.id === 'guid' ? this.guideOpen : this.activeSlug === btn.slug);
    return encodeURI(held ? btn.pressedSrc : btn.src);
  }

  onBtnPointerDown(btn: RemoteBtn, ev: Event): void {
    ev.preventDefault();
    this.pressedId = btn.id;
  }

  onBtnPointerUp(): void {
    this.pressedId = null;
  }

  onChannelClick(ch: RemoteBtn): void {
    this.pressedId = null;
    if (!ch.slug || this.activeSlug === ch.slug) return;
    void this.router.navigate(['tv', ch.slug], { relativeTo: this.route });
  }

  onGuideClick(): void {
    this.pressedId = null;
    if (this.isWallOpen) this.closeWallPic();
    this.guideOpen = !this.guideOpen;
    if (this.guideOpen) {
      this.remoteVisible = false;
      this.remoteHover = false;
    }
  }

  onSoundClick(btn: RemoteBtn): void {
    this.pressedId = null;
    this.playback.stepVolume(btn.id === 'sound-plus' ? 1 : -1);
  }

  onRemoteEnter(): void {
    if (this.guideOpen || this.isWallOpen || !this.remoteEnabled) return;
    this.remoteHover = true;
    this.showUi();
  }

  onRemoteLeave(): void {
    this.remoteHover = false;
    this.pressedId = null;
    this.scheduleHideUi();
  }

  @HostListener('document:pointerdown', ['$event'])
  onPointerDown(ev: PointerEvent): void {
    this.wakePointerX = ev.clientX;
    this.wakePointerY = ev.clientY;
    this.wakePointerReady = true;
    this.onPointerActivity();
  }

  @HostListener('document:pointermove', ['$event'])
  onPointerMove(ev: PointerEvent): void {
    if (!this.wakePointerReady) {
      this.wakePointerX = ev.clientX;
      this.wakePointerY = ev.clientY;
      this.wakePointerReady = true;
      return;
    }
    const dx = ev.clientX - this.wakePointerX;
    const dy = ev.clientY - this.wakePointerY;
    if (Math.hypot(dx, dy) < this.pointerWakePx) return;
    this.wakePointerX = ev.clientX;
    this.wakePointerY = ev.clientY;
    this.onPointerActivity();
  }

  private onPointerActivity(): void {
    this.showUi();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isWallOpen) {
      this.closeWallPic();
      return;
    }
    if (this.guideOpen) {
      this.guideOpen = false;
      return;
    }
    if (this.zoomed) {
      this.zoomed = false;
    }
  }

  onGuideClosed(): void {
    this.guideOpen = false;
    this.remoteVisible = false;
  }

  onGuideChannelPick(slug: string): void {
    if (!slug || this.activeSlug === slug) return;
    void this.router.navigate(['tv', slug], { relativeTo: this.route });
  }

  onArrowClick(): void {
    if (this.isWallOpen) {
      this.closeWallPic();
      return;
    }
    this.zoomed = !this.zoomed;
    this.arrowVisible = false;
    clearTimeout(this.hideTimer);
  }

  ngOnDestroy(): void {
    clearTimeout(this.hideTimer);
    this.routeSub?.unsubscribe();
    this.tvOnSub?.unsubscribe();
  }

  private showUi(): void {
    if (this.isWallOpen) return;
    this.arrowVisible = true;
    if (!this.guideOpen && this.remoteEnabled) {
      this.remoteVisible = true;
    }
    clearTimeout(this.hideTimer);
    if (!this.remoteHover) {
      this.scheduleHideUi();
    }
  }

  private scheduleHideUi(): void {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.arrowVisible = false;
      if (!this.guideOpen) {
        this.remoteVisible = false;
      }
    }, this.hideDelayMs);
  }

  private syncSlugFromRoute(): void {
    const child = this.route.firstChild;
    const slug = child?.snapshot.paramMap.get('slug');
    if (slug) this.activeSlug = slug;
  }
}
