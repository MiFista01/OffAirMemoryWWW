import { Pipe, PipeTransform } from '@angular/core';
import { UtilsService } from '@services';

/**
 * Time duration formatting pipe for countdown timer.
 * 
 * Transforms end date into remaining time in HH:MM:SS format.
 * Returns 'true' string when countdown is finished (time <= 0).
 * Use with interval tick to trigger updates.
 */
@Pipe({
  name: 'timeDuration',
  standalone: true
})
export class TimeDurationPipe implements PipeTransform {
  constructor(
    private readonly utils: UtilsService
  ) {}
  transform(endDate: Date | string | null, _tick?: number): string | boolean {
    return this.utils.getTimerDuration(endDate, _tick);
  }
}
