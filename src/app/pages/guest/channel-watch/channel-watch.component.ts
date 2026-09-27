import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  inject,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { StreamCoreService } from '@services';
import Hls from 'hls.js';
import { Subscription } from 'rxjs';

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

  private readonly route = inject(ActivatedRoute);
  private readonly stream = inject(StreamCoreService);
  private sub?: Subscription;
  private hls?: Hls;

  error: string | null = null;
  loading = true;
  meta: { episodeId?: number; offsetSec?: number } = {};

  ngAfterViewInit(): void {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (!slug) {
      this.error = 'No channel';
      this.loading = false;
      return;
    }
    this.sub = this.stream.start(slug).subscribe({
      next: (res) => {
        this.meta = { episodeId: res.episodeId, offsetSec: res.offsetSec };
        this.attach(res.streamUrl);
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || err?.message || 'Stream failed';
        this.loading = false;
      },
    });
  }

  private attach(url: string): void {
    const video = this.videoRef.nativeElement;
    if (Hls.isSupported()) {
      this.hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      this.hls.loadSource(url);
      this.hls.attachMedia(video);
      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        void video.play().catch(() => undefined);
      });
      return;
    }
    // Safari
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      void video.play().catch(() => undefined);
    } else {
      this.error = 'HLS not supported in this browser';
    }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.hls?.destroy();
  }
}
