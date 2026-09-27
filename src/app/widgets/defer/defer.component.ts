import { Component, Input, SimpleChanges } from '@angular/core';
import { deferAnimation } from '@animations';

/**
 * Defer component for lazy loading content with animated transitions and placeholder support.
 * 
 * Lazy loading widget component featuring deferred content rendering with timer-based
 * loading, animated transitions between content and placeholder states, and content
 * projection for flexible content display. Uses Angular's @defer directive with
 * conditional rendering based on data availability and includes custom animations
 * for smooth loading transitions with placeholder content support for enhanced UX.
 */
@Component({
  selector: 'app-defer',
  standalone: true,
  imports: [
  ],
  templateUrl: './defer.component.html',
  styleUrl: './defer.component.scss',
  animations: [deferAnimation]
})
export class DeferComponent<T = any> {
  @Input() data: T | undefined = undefined;

  get isValidData(): boolean {
    return this.hasValidData(this.data);
  }
  ngOnInit(): void {

  }
  hasValidData(data: any): boolean {
    if (data === undefined) return false;
    if (data === null) return false;
    if (data === '') return false;
    if (Array.isArray(data)) {
      return true;
    }
    if (data instanceof Map) {
      return true;
    }
    if (typeof data === 'object') {
      return Object.keys(data).length > 0;
    }
    return true;
  }

}
