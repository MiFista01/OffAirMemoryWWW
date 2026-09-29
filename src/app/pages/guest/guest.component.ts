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
  zoomed = false;
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
  private readonly hideDelayMs = 1400;
  private routeSub?: Subscription;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private playback: GuestPlaybackCoreService,
  ) {}

  ngOnInit(): void {
    this.syncSlugFromRoute();
    this.routeSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.syncSlugFromRoute());
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
    this.guideOpen = !this.guideOpen;
  }

  onSoundClick(btn: RemoteBtn): void {
    this.pressedId = null;
    this.playback.stepVolume(btn.id === 'sound-plus' ? 1 : -1);
  }

  onRemoteEnter(): void {
    this.remoteHover = true;
    this.showUi();
  }

  onRemoteLeave(): void {
    this.remoteHover = false;
    this.pressedId = null;
    this.scheduleHideUi();
  }

  @HostListener('document:pointermove')
  @HostListener('document:pointerdown')
  onPointerActivity(): void {
    this.showUi();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
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
  }

  onGuideChannelPick(slug: string): void {
    if (!slug || this.activeSlug === slug) return;
    void this.router.navigate(['tv', slug], { relativeTo: this.route });
  }

  onArrowClick(): void {
    this.zoomed = !this.zoomed;
    this.arrowVisible = false;
    clearTimeout(this.hideTimer);
  }

  ngOnDestroy(): void {
    clearTimeout(this.hideTimer);
    this.routeSub?.unsubscribe();
  }

  private showUi(): void {
    this.arrowVisible = true;
    clearTimeout(this.hideTimer);
    if (!this.remoteHover) {
      this.scheduleHideUi();
    }
  }

  private scheduleHideUi(): void {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.arrowVisible = false;
    }, this.hideDelayMs);
  }

  private syncSlugFromRoute(): void {
    const child = this.route.firstChild;
    const slug = child?.snapshot.paramMap.get('slug');
    if (slug) this.activeSlug = slug;
  }
}
