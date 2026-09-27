import { Injectable } from '@angular/core';
import { environment } from '@env';
import { RequestsService } from '@services';
import { Observable } from 'rxjs';

export type StreamStartResponse = {
  channel: string;
  streamUrl: string;
  episodeId: number;
  offsetSec: number;
  source: string;
  remainingCount: number;
};

@Injectable({ providedIn: 'root' })
export class StreamCoreService {
  constructor(private readonly req: RequestsService) {}

  start(
    slug: string,
    opts?: { tz?: string; profile?: string },
  ): Observable<StreamStartResponse> {
    const tz = opts?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const profile = opts?.profile ?? '720p';
    const q = `tz=${encodeURIComponent(tz)}&profile=${encodeURIComponent(profile)}`;
    return this.req.Get<StreamStartResponse>(
      `${environment.apiUrl}/stream/${encodeURIComponent(slug)}/start?${q}`,
    );
  }
}
