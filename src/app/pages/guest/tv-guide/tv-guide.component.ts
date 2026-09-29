import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import {
  GuideChannel,
  GuideSlot,
  GuideTodayResponse,
  ScheduleCoreService,
} from '@services';
import { firstValueFrom } from 'rxjs';

type Sel = { channel: GuideChannel; slot: GuideSlot };

@Component({
  selector: 'app-tv-guide',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tv-guide.component.html',
  styleUrl: './tv-guide.component.scss',
})
export class TvGuideComponent implements OnInit, OnChanges, OnDestroy {
  @Input() open = false;
  @Input() activeSlug = '';
  @Output() closed = new EventEmitter<void>();
  @Output() channelPick = new EventEmitter<string>();

  @ViewChild('scrollBox') scrollBox?: ElementRef<HTMLElement>;

  loading = false;
  error: string | null = null;
  guide: GuideTodayResponse | null = null;
  selected: Sel | null = null;
  nowMs = Date.now();
  /** pixels per minute of airtime */
  readonly ppm = 3.2;
  readonly chColW = 132;

  private tick?: ReturnType<typeof setInterval>;
  private didScroll = false;

  constructor(private readonly schedule: ScheduleCoreService) {}

  ngOnInit(): void {
    this.tick = setInterval(() => {
      this.nowMs = Date.now();
    }, 1000);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open']?.currentValue === true) {
      this.didScroll = false;
      void this.load();
    }
  }

  ngOnDestroy(): void {
    if (this.tick) clearInterval(this.tick);
  }

  close(): void {
    this.closed.emit();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.guide = await firstValueFrom(this.schedule.todayGuide());
      this.pickNowOnActive();
      queueMicrotask(() => this.scrollToNow());
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Не удалось загрузить гид';
      this.guide = null;
    } finally {
      this.loading = false;
    }
  }

  trackW(): number {
    if (!this.guide) return 0;
    return Math.max(1, this.guide.airTimeHours * 60 * this.ppm);
  }

  hourMarks(): { label: string; left: number }[] {
    if (!this.guide) return [];
    const start = Date.parse(this.guide.airStartAt);
    const hours = Math.ceil(this.guide.airTimeHours);
    const out: { label: string; left: number }[] = [];
    for (let h = 0; h <= hours; h++) {
      const t = new Date(start + h * 3600_000);
      out.push({
        label: this.fmtHm(t),
        left: h * 60 * this.ppm,
      });
    }
    return out;
  }

  nowLeft(): number {
    if (!this.guide) return 0;
    const start = Date.parse(this.guide.airStartAt);
    const end = start + this.guide.airTimeHours * 3600_000;
    const t = Math.min(end, Math.max(start, this.nowMs));
    return ((t - start) / 60_000) * this.ppm;
  }

  nowPctInWindow(): number {
    if (!this.guide) return 0;
    const start = Date.parse(this.guide.airStartAt);
    const end = start + this.guide.airTimeHours * 3600_000;
    if (this.nowMs < start || this.nowMs > end) return -1;
    return ((this.nowMs - start) / (end - start)) * 100;
  }

  slotStyle(slot: GuideSlot): Record<string, string> {
    if (!this.guide) return {};
    const start = Date.parse(this.guide.airStartAt);
    const a = Date.parse(slot.startAt);
    const b = Date.parse(slot.endAt);
    const left = ((a - start) / 60_000) * this.ppm;
    const width = Math.max(28, ((b - a) / 60_000) * this.ppm);
    return {
      left: `${left}px`,
      width: `${width}px`,
    };
  }

  isLive(slot: GuideSlot): boolean {
    const a = Date.parse(slot.startAt);
    const b = Date.parse(slot.endAt);
    return this.nowMs >= a && this.nowMs < b;
  }

  progressPct(slot: GuideSlot): number {
    const a = Date.parse(slot.startAt);
    const b = Date.parse(slot.endAt);
    if (this.nowMs <= a) return 0;
    if (this.nowMs >= b) return 100;
    return ((this.nowMs - a) / (b - a)) * 100;
  }

  isSelected(ch: GuideChannel, slot: GuideSlot): boolean {
    return (
      this.selected?.channel.id === ch.id &&
      this.selected?.slot.episodeId === slot.episodeId &&
      this.selected?.slot.order === slot.order
    );
  }

  select(ch: GuideChannel, slot: GuideSlot): void {
    this.selected = { channel: ch, slot };
  }

  openChannel(ch: GuideChannel): void {
    this.channelPick.emit(ch.slug);
    this.close();
  }

  epLabel(slot: GuideSlot): string {
    if (slot.seasonNumber > 0 && slot.episodeNumber > 0) {
      return `S${slot.seasonNumber}E${String(slot.episodeNumber).padStart(2, '0')}`;
    }
    return '';
  }

  detailTime(slot: GuideSlot): string {
    const a = new Date(slot.startAt);
    const b = new Date(slot.endAt);
    const mins = Math.round(slot.durationSec / 60);
    return `${this.fmtHm(a)} – ${this.fmtHm(b)} · ${mins} мин`;
  }

  clockLabel(): string {
    return this.fmtHm(new Date(this.nowMs));
  }

  private fmtHm(d: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      hourCycle: 'h23',
      timeZone: this.guide?.tz || 'Europe/Tallinn',
    }).format(d);
  }

  private pickNowOnActive(): void {
    if (!this.guide) return;
    const ch =
      this.guide.channels.find((c) => c.slug === this.activeSlug) ??
      this.guide.channels[0];
    if (!ch?.slots?.length) {
      this.selected = null;
      return;
    }
    const live = ch.slots.find((s) => this.isLive(s));
    this.selected = { channel: ch, slot: live ?? ch.slots[0] };
  }

  private scrollToNow(): void {
    if (this.didScroll || !this.scrollBox || !this.guide) return;
    const el = this.scrollBox.nativeElement;
    const x = this.nowLeft() - el.clientWidth * 0.28;
    el.scrollLeft = Math.max(0, x);
    this.didScroll = true;
  }
}
