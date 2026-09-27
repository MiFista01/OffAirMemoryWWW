import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'numberToArray',
  standalone: true
})
export class NumberToArrayPipe implements PipeTransform {

  transform(value: number): number[] {
    if(!value) return [];
    return Array.from({length: value}, (_, i) => i);
  }

}
