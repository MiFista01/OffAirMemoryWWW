import { Injectable } from '@angular/core';
import { environment } from '@env';
import { RequestsService } from '@services';
import { Observable } from 'rxjs';

export type GuideSlot = {
  order: number;
  episodeId: number;
  durationSec: number;
  startAt: string;
  endAt: string;
  title: string;
  seasonNumber: number;
  episodeNumber: number;
  cartoonSlug: string | null;
  source: string;
};

export type GuideChannel = {
  id: number;
  slug: string;
  name: string;
  slots: GuideSlot[];
};

export type GuideTodayResponse = {
  date: string;
  tz: string;
  airWindowStart: string;
  airTimeHours: number;
  airStartAt: string;
  channels: GuideChannel[];
};

@Injectable({ providedIn: 'root' })
export class ScheduleCoreService {
  constructor(private readonly req: RequestsService) {}

  todayGuide(tz?: string): Observable<GuideTodayResponse> {
    const zone =
      tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Europe/Tallinn';
    return this.req.Get<GuideTodayResponse>(
      `${environment.apiUrl}/schedule-day/guide/today?tz=${encodeURIComponent(zone)}`,
    );
  }
}
