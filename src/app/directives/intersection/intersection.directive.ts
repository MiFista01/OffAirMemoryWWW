import { Directive, ElementRef, EventEmitter, Input, Output } from '@angular/core';
import { debounceTime, Subject, takeUntil, timer } from 'rxjs';

/**
 * Directive that observes when an element enters or leaves the viewport
 * using the Intersection Observer API. Emits intersection events with optional debouncing.
 * 
 * @example
 *
 * <div appIntersection 
 *      [debounceTime]="300" 
 *      [threshold]="0.5"
 *      (intersection)="onIntersection($event)">
 *   Content to observe
 * </div>
 *  */
@Directive({
  selector: '[appIntersection]',
  standalone: true
})
export class IntersectionDirective {
  @Input() debounceTime: number = 0;
  @Input() threshold: number = 0.5;
  @Output() intersection: EventEmitter<boolean> = new EventEmitter<boolean>();

  private observer: IntersectionObserver | null = null;
  private destroy$ = new Subject<void>();
  private intersection$ = new Subject<boolean>();

  constructor(private el: ElementRef) { }

  ngOnInit(): void {
    this.intersection$
      .pipe(
        debounceTime(this.debounceTime),
        takeUntil(this.destroy$)
      )
      .subscribe(isIntersecting => {
        this.intersection.emit(isIntersecting);
      });

    this.setupObserver();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.disconnectObserver();
  }

  private setupObserver(): void {
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        this.intersection$.next(entry.isIntersecting);
      });
    }, {
      threshold: this.threshold,
      rootMargin: '0px'
    });

    this.observer.observe(this.el.nativeElement);
  }

  private disconnectObserver(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
}
