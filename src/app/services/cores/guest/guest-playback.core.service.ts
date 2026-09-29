import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

export type GuestVolumeStep = -1 | 1;

@Injectable({ providedIn: 'root' })
export class GuestPlaybackCoreService {
  private readonly volumeStep$ = new Subject<GuestVolumeStep>();

  readonly volumeStep: Observable<GuestVolumeStep> =
    this.volumeStep$.asObservable();

  stepVolume(delta: GuestVolumeStep): void {
    this.volumeStep$.next(delta);
  }
}
