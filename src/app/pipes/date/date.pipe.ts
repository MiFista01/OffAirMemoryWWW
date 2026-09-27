import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'checkCurrentDate',
  standalone: true
})
export class CheckCurrentDatePipe implements PipeTransform {

  transform(dateString: string): string {
    if (!dateString || dateString === "" || dateString === null) return "";
    const [day, month, year] = dateString.split('.').map(Number);
    const date = new Date(year + 2000, month - 1, day);
    const today = new Date();

    const dateOnly = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    );
    const todayOnly = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );

    if (dateOnly.getTime() === todayOnly.getTime()) {
      return "today";
    }

    const yesterday = new Date(todayOnly);
    yesterday.setDate(yesterday.getDate() - 1);

    if (dateOnly.getTime() === yesterday.getTime()) {
      return "yesterday";
    }

    return dateString;
  }
}
