import { Component, ContentChild, CUSTOM_ELEMENTS_SCHEMA, ElementRef, EventEmitter, Input, Output, SimpleChanges, TemplateRef, TrackByFunction, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NumberToArrayPipe } from '@pipes';
import { Swiper, SwiperOptions } from 'swiper/types';
import { timer } from 'rxjs';
import { UtilsService } from '@services';


/**
 * Universal Swiper component for creating sliders with various effects.
 * 
 * This component wraps Swiper Web Components and provides a convenient interface
 * for creating sliders with support for different effects (fade, cards, cube, flip, coverflow).
 * @note
 * For fade effect, set fadeEffect.crossFade: true for smooth cross-fade transition.
 * For cards effect, set slidesPerView: 3 or more and background-color via CSS to avoid overlapping.
 * The component automatically sets CSS transitions for slide animations.
 * 
 * Usage example:
 * @example
 * <app-swiper [items]="itemsArray" [setSlide]="currentSlide" [options]="swiperOptions">
 *   <ng-template #slideTemplate let-item>
 *     <div class="slide-content">{{ item.content }}</div>
 *   </ng-template>
 * </app-swiper>
 * 
 * @example
 * const options: SwiperOptions = {
 *   effect: 'fade',
 *   fadeEffect: {
 *     crossFade: true,
 *   },
 *   speed: 500,
 * };
 * 
 */
@Component({
  selector: 'app-swiper',
  standalone: true,
  imports: [
    CommonModule,
    NumberToArrayPipe
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './swiper.component.html',
  styleUrl: './swiper.component.scss'
})
export class SwiperComponent {
  @ContentChild('slideTemplate') slideTemplate?: TemplateRef<any>;
  @ViewChild('swiperContainer', { read: ElementRef }) swiperContainer!: ElementRef;

  @Input() items: any[] = [];
  @Input() setSlide = 0;
  @Input() options: SwiperOptions = {};
  @Input() slidesDirection = false;
  @Input() trackBy: TrackByFunction<any> = (index: number, item: any) => index;

  @Output() slideChange = new EventEmitter<number>();

  private swiper: Swiper | undefined = undefined;
  private defaultSpeed = 500

  constructor(private readonly utils: UtilsService) {}

  ngAfterViewInit() {
    this.setAttributes();
    const speed = this.options.speed || this.defaultSpeed;
    this.swiperContainer.nativeElement.style.setProperty('--swiper-transition-duration', `${speed}ms`);
    timer(10).subscribe(() => {
      this.swiperContainer.nativeElement.initialize();
      this.swiper = this.swiperContainer.nativeElement.swiper;
      this.attachInteractiveSlidesFix();
      timer(10).subscribe(() => {
        if (this.swiper) {
          this.goToSlide(this.setSlide, speed);
        }
        this.syncInteractiveSlidesPointerEvents();
      });
    });
  }
  
  ngOnChanges(changes: SimpleChanges) {
    if (changes['setSlide'] && this.swiper) {
      const speed = this.options.speed || this.defaultSpeed;
      this.goToSlide(this.setSlide, speed);
    }
    if (changes['items'] && this.swiper && !changes['items'].firstChange) {
      timer(100).subscribe(() => {
        this.swiper?.update();
        this.swiper?.updateSize();
        this.swiper?.updateSlides();
        this.syncInteractiveSlidesPointerEvents();
      });
    }
  }
  private setAttributes() {
    if (!this.swiperContainer?.nativeElement || !this.options) return;

    const el = this.swiperContainer.nativeElement;

    for(const [key, value] of Object.entries(this.options)) {
      const slug = this.utils.slugify(key);
      let attributeValue: any = value;
      if (typeof value === 'object' && !Array.isArray(value)) {
        attributeValue = JSON.stringify(value);
      } else if (typeof value === 'boolean') {
        attributeValue = String(value);
      } else if (typeof value === 'number') {
        attributeValue = String(value);
      } else {
        attributeValue = String(value);
      }
      el.setAttribute(slug, attributeValue);
    }
  }

  next(): void {
    if (this.swiper) {
      this.swiper.slideNext();
    }
  }
  prev(): void {
    if (this.swiper) {
      this.swiper.slidePrev();
    }
  }
  update(): void {
    if (!this.swiper) {
      return;
    }
    timer(10).subscribe(() => {
      this.swiper?.update();
      this.swiper?.updateSize();
      this.swiper?.updateSlides();
      this.syncInteractiveSlidesPointerEvents();
    });
  }

  setSlideChange(event: Event) {
    if (event.target !== this.swiperContainer.nativeElement) return;
    const swiperInstance = (event as CustomEvent).detail[0] as Swiper;
    this.syncInteractiveSlidesPointerEvents();
    this.slideChange.emit(swiperInstance.realIndex);
  }

  private goToSlide(index: number, speed: number): void {
    if (!this.swiper) {
      return;
    }

    if (this.options.loop) {
      this.swiper.slideToLoop(index, speed);
      return;
    }

    this.swiper.slideTo(index, speed);
  }

  private attachInteractiveSlidesFix(): void {
    if (!this.swiper || !this.needsInteractiveSlidesFix()) {
      return;
    }

    this.syncInteractiveSlidesPointerEvents();
    this.swiper.on('slideChange', () => this.syncInteractiveSlidesPointerEvents());
    this.swiper.on('transitionEnd', () => this.syncInteractiveSlidesPointerEvents());
  }

  private needsInteractiveSlidesFix(): boolean {
    return this.options.effect === 'cube' || this.options.effect === 'fade';
  }

  private syncInteractiveSlidesPointerEvents(): void {
    if (!this.swiper || !this.needsInteractiveSlidesFix()) {
      return;
    }

    const activeIndex = this.swiper.activeIndex;
    const container = this.swiperContainer.nativeElement as HTMLElement;
    container.querySelectorAll('swiper-slide').forEach((slide, index) => {
      (slide as HTMLElement).style.pointerEvents = index === activeIndex ? 'auto' : 'none';
    });
  }

  ngOnDestroy(): void {
    if (this.swiper) {
      this.swiper.destroy();
    }
  }
}
