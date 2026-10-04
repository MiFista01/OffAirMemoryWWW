import { Injectable } from '@angular/core';
import { environment } from '@env';
import { RequestsService, SocketService } from '@services';
import { Observable } from 'rxjs';

export type StreamStatus =
  | 'live'
  | 'starting'
  | 'idle'
  | 'off';

export type StreamRecoverHint = 'wait' | 'hot' | 'hard' | 'none' | 'switch';

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
  slot?: 'a' | 'b';
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

export type StreamSocketStatus = {
  channel: string;
  status: 'live' | 'starting' | 'idle' | 'off' | 'seam';
  hint: StreamRecoverHint;
  episodeId?: number;
  scheduleItemId?: number;
  generation?: number;
  ready?: boolean;
  message?: string;
  streamUrl?: string;
  slot?: 'a' | 'b';
  at: string;
};

export type StreamPlayIssue =
  | 'stall'
  | 'frag404'
  | 'playlist404'
  | 'buffering'
  | 'ended';

@Injectable({ providedIn: 'root' })
export class StreamCoreService {
  private readonly socketUrl = `${environment.apiSocket}/stream`;
  private issueCooldownUntil = 0;

  constructor(
    private readonly req: RequestsService,
    private readonly sockets: SocketService,
  ) {}

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

  /** Keep ffmpeg idle TTL alive while the viewer watches (nginx no longer touches on /stream). */
  heartbeat(
    slug: string,
    opts?: { tz?: string; profile?: string },
  ): Observable<{ ok: boolean }> {
    return this.req.Get<{ ok: boolean }>(
      `${environment.apiUrl}/stream/${encodeURIComponent(slug)}/heartbeat?${this.qs(opts)}`,
    );
  }

  /** Open /stream namespace and join channel room. */
  connectWatch(
    slug: string,
    onStatus: (s: StreamSocketStatus) => void,
    opts?: { tz?: string; profile?: string },
  ): () => void {
    this.sockets.setConnection(this.socketUrl);
    const joinPayload = {
      slug,
      tz: opts?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      profile: opts?.profile ?? '720p',
    };
    const join = () => {
      this.sockets.sendMessage(this.socketUrl, 'stream:join', joinPayload);
    };
    const offStatus = this.sockets.onMessage(
      this.socketUrl,
      'stream:status',
      onStatus,
    );
    // Re-join room after every reconnect — otherwise status push is silent.
    const offConnect = this.sockets.onConnect(this.socketUrl, join);
    join();
    return () => {
      this.sockets.sendMessage(this.socketUrl, 'stream:leave', { slug });
      offConnect();
      offStatus();
    };
  }

  /** Debounced play problem → server recover hint. */
  reportPlayIssue(
    slug: string,
    issue: StreamPlayIssue,
    opts?: { tz?: string; profile?: string },
  ): void {
    const now = Date.now();
    if (now < this.issueCooldownUntil) return;
    this.issueCooldownUntil = now + 2500;
    this.sockets.setConnection(this.socketUrl);
    this.sockets.sendMessage(this.socketUrl, 'stream:play-issue', {
      slug,
      issue,
      tz: opts?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      profile: opts?.profile ?? '720p',
    });
  }

  /** Ask server for fresh stream status (unstick seam overlay). */
  requestSeamSync(
    slug: string,
    opts?: { tz?: string; profile?: string },
  ): void {
    this.sockets.setConnection(this.socketUrl);
    this.sockets.sendMessage(this.socketUrl, 'stream:sync', {
      slug,
      tz: opts?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      profile: opts?.profile ?? '720p',
    });
  }
}
