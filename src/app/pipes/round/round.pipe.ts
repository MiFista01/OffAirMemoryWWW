import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'round',
  standalone: true
})
export class RoundPipe implements PipeTransform {
  transform(value: number, mode?: number | 'ceil' | 'floor'): number {
    if (value == null) return value;

    if (mode === 'ceil') {
      return Math.ceil(value);
    }
    if (mode === 'floor') {
      return Math.floor(value);
    }

    const precision = typeof mode === 'number' ? mode : 0;
    const multiplier = Math.pow(10, precision);
    return Math.round(value * multiplier) / multiplier;
  }
}
