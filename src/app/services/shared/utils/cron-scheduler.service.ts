import { Injectable, WritableSignal, inject, DestroyRef } from '@angular/core';
import { Observable, of } from 'rxjs';
import { CronExpressionParser } from 'cron-parser';
import { Subscription, timer } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
@Injectable({
  providedIn: 'root'
})
export class CronSchedulerService {
  private activeSchedules = new Map<string, Subscription>();
  private destroyRef = inject(DestroyRef);

  scheduleSignalUpdate<T>(
    cronExpression: string,
    scheduleName: string,
    signal: WritableSignal<T>,
    updateFn: () => Observable<T>,
    destroyRef?: DestroyRef
  ): void {
    this.stopSchedule(scheduleName);

    const scheduleNext = (): Observable<T> => {
      try {
        const interval = CronExpressionParser.parse(
          cronExpression,
          {
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone
          }
        );
        const nextExecution = interval.next();
        const msUntilNext = Math.max(0, nextExecution.getTime() - Date.now());

        return timer(msUntilNext).pipe(
          switchMap(() => {
            return updateFn().pipe(
              switchMap((value) => {
                signal.set(value);
                return scheduleNext();
              }),
              catchError((error) => {
                console.error(`Error in scheduled update for ${scheduleName}:`, error);
                return scheduleNext();
              })
            );
          })
        );
      } catch (error) {
        console.error(`Error parsing cron expression ${cronExpression}:`, error);
        return of(null as T);
      }
    };

    const subscription = scheduleNext()
      .pipe(
        takeUntilDestroyed(destroyRef || this.destroyRef)
      )
      .subscribe();

    this.activeSchedules.set(scheduleName, subscription);
  }

  schedule(
  cronExpression: string,
  scheduleName: string,
  action: () => void | Promise<void>,
  destroyRef?: DestroyRef
): void {
  this.stopSchedule(scheduleName);

  const scheduleNext = (): Observable<void> => {
    try {
      const interval = CronExpressionParser.parse(
        cronExpression,
        {
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone
        }
      );
      const nextExecution = interval.next();
      const msUntilNext = Math.max(0, nextExecution.getTime() - Date.now());

      return timer(msUntilNext).pipe(
        switchMap(() => {
          try {
            action();
          } catch (error) {
            console.error(`Error in scheduled task ${scheduleName}:`, error);
          }
          return scheduleNext();
        }),
        catchError((error) => {
          console.error(`Error in scheduled task ${scheduleName}:`, error);
          return scheduleNext();
        })
      );
    } catch (error) {
      console.error(`Error parsing cron expression ${cronExpression}:`, error);
      return of(undefined);
    }
  };

  const subscription = scheduleNext()
    .pipe(
      takeUntilDestroyed(destroyRef || this.destroyRef)
    )
    .subscribe();

  this.activeSchedules.set(scheduleName, subscription);
}

  stopSchedule(scheduleName: string): void {
    const subscription = this.activeSchedules.get(scheduleName);
    if (subscription) {
      subscription.unsubscribe();
      this.activeSchedules.delete(scheduleName);
    }
  }

  stopAll(): void {
    this.activeSchedules.forEach(sub => sub.unsubscribe());
    this.activeSchedules.clear();
  }
}
