import { Pipe, PipeTransform } from '@angular/core';
import { UtilsService } from '@services';

/**
 * Number formatting pipe for converting large numbers into abbreviated format with suffixes.
 * 
 * Transforms numeric values into human-readable format using standard suffixes (K, M, B, T, Q, Qi, S)
 * for thousands, millions, billions, trillions, quadrillions, quintillions, and sextillions.
 * Handles edge cases for null, undefined, and non-numeric values, and provides precise
 * decimal formatting with automatic trailing zero removal for clean number display.
 */
@Pipe({
  name: 'numberFormat',
  standalone: true
})
export class NumberFormatPipe implements PipeTransform {
  constructor(
    private readonly utils: UtilsService
  ) {}

  transform(value: any): string {
    return this.utils.numberFormat(value);
  }

}
