import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';

export type GuestVolumeStep = -1 | 1;

@Injectable({ providedIn: 'root' })
export class GuestPlaybackCoreService {
  private readonly volumeStep$ = new Subject<GuestVolumeStep>();
  private readonly powerToggle$ = new Subject<void>();
  private readonly tvOn$ = new BehaviorSubject<boolean>(true);

  readonly volumeStep: Observable<GuestVolumeStep> =
    this.volumeStep$.asObservable();

  readonly powerToggle: Observable<void> = this.powerToggle$.asObservable();

  readonly tvOn: Observable<boolean> = this.tvOn$.asObservable();

  get isTvOn(): boolean {
    return this.tvOn$.value;
  }

  stepVolume(delta: GuestVolumeStep): void {
    this.volumeStep$.next(delta);
  }

  togglePower(): void {
    this.powerToggle$.next();
  }

  setTvOn(on: boolean): void {
    if (this.tvOn$.value !== on) {
      this.tvOn$.next(on);
    }
  }
}
