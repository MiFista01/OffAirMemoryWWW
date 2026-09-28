import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { filter, Subscription } from 'rxjs';

type RemoteChannel = {
  id: string;
  slug: string;
  label: string;
  src: string;
  pressedSrc: string;
  /** art-pixel rect on 72×176 remote.webp */
  x: number;
  y: number;
  w: number;
  h: number;
};

@Component({
  selector: 'app-guest',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    TranslateModule,
  ],
  templateUrl: './guest.component.html',
  styleUrl: './guest.component.scss',
})
export class GuestComponent implements OnInit, OnDestroy {
  arrowVisible = false;
  zoomed = false;
  activeSlug = 'nickelodeon';
  pressedId: string | null = null;
  private remoteHover = false;

  /** Positions tuned to blank face of remote.webp (72×176). */
  readonly channels: RemoteChannel[] = [
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
  ) {}

  ngOnInit(): void {
    this.syncSlugFromRoute();
    this.routeSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.syncSlugFromRoute());
  }

  channelSrc(ch: RemoteChannel): string {
    const down = this.pressedId === ch.id || this.activeSlug === ch.slug;
    return encodeURI(down ? ch.pressedSrc : ch.src);
  }

  onChannelPointerDown(ch: RemoteChannel, ev: Event): void {
    ev.preventDefault();
    this.pressedId = ch.id;
  }

  onChannelPointerUp(): void {
    this.pressedId = null;
  }

  onChannelClick(ch: RemoteChannel): void {
    this.pressedId = null;
    if (this.activeSlug === ch.slug) return;
    void this.router.navigate(['tv', ch.slug], { relativeTo: this.route });
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

  @HostListener('document:mousemove')
  onMouseMove(): void {
    this.showUi();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.zoomed) {
      this.zoomed = false;
    }
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
