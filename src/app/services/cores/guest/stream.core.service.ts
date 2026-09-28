import { Injectable } from '@angular/core';
import { environment } from '@env';
import { RequestsService } from '@services';
import { Observable } from 'rxjs';

export type StreamStatus =
  | 'live'
  | 'starting'
  | 'idle'
  | 'off';

export type StreamStartResponse = {
  channel: string;
  streamUrl: string | null;
  episodeId?: number;
  offsetSec?: number;
  source?: string;
  remainingCount?: number;
  ready?: boolean;
  playable?: boolean;
  status?: StreamStatus;
  pollAfterMs?: number;
  message?: string;
};

export type StreamStatusResponse = {
  channel: string;
  key?: string;
  alive?: boolean;
  ready: boolean;
  playable?: boolean;
  status: StreamStatus;
  streamUrl: string | null;
  ageSec?: number | null;
  pollAfterMs?: number;
  message?: string;
};

@Injectable({ providedIn: 'root' })
export class StreamCoreService {
  constructor(private readonly req: RequestsService) {}

  private qs(opts?: { tz?: string; profile?: string; ensure?: boolean }): string {
    const tz = opts?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const profile = opts?.profile ?? '720p';
    const parts = [
      `tz=${encodeURIComponent(tz)}`,
      `profile=${encodeURIComponent(profile)}`,
    ];
    if (opts?.ensure) parts.push('ensure=true');
    return parts.join('&');
  }

  start(
    slug: string,
    opts?: { tz?: string; profile?: string },
  ): Observable<StreamStartResponse> {
    return this.req.Get<StreamStartResponse>(
      `${environment.apiUrl}/stream/${encodeURIComponent(slug)}/start?${this.qs(opts)}`,
    );
  }

  status(
    slug: string,
    opts?: { tz?: string; profile?: string; ensure?: boolean },
  ): Observable<StreamStatusResponse> {
    return this.req.Get<StreamStatusResponse>(
      `${environment.apiUrl}/stream/${encodeURIComponent(slug)}/status?${this.qs(opts)}`,
    );
  }
}
