import { Injectable } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class DragDropService {
  private $dragStart = new BehaviorSubject<boolean>(false);
  private $dragTypes = new BehaviorSubject<string[]>([]);
  private $dragFiles = new BehaviorSubject<File[]>([]);
  dragStart = false

  dragState$ = combineLatest([
    this.$dragStart,
    this.$dragTypes,
    this.$dragFiles
  ]).pipe(
    map(([isDragging, types, files]) => {
      return {
        isDragging,
        types,
        files,
        hasFiles: files.length > 0,
        isImage: types.some(type => type.startsWith('image/')),
        isDocument: types.some(type => type.startsWith('application/'))
      }
    })
  );

  startDrag(types: string[], files: File[] = []): void {
    this.dragStart = true
    this.$dragStart.next(true);
    this.$dragTypes.next(types);
    this.$dragFiles.next(files);
  }

  endDrag(): void {
    console.log('endDrag');
    this.dragStart = false
    this.$dragStart.next(false);
    this.$dragTypes.next([]);
    this.$dragFiles.next([]);
  }

  canDropInZone(allowedTypes: string[]): Observable<boolean> {
    return this.dragState$.pipe(
      tap(state => console.log( state.types, allowedTypes)),
      map(state =>
        state.isDragging &&
        state.types.some(type => allowedTypes.some(allowed => type.includes(allowed)))
      )
    );
  }
}
