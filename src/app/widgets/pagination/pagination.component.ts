import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, SimpleChanges } from '@angular/core';
import { maxPagination } from '@const';


/**
 * Pagination component for navigating through paginated data with smart page display logic.
 * 
 * Advanced pagination widget component featuring intelligent page calculation, navigation
 * controls, and optimized display logic. Includes smart page range calculation with dots
 * for large datasets, event emission for page changes, and trackBy optimization for
 * performance. Supports configurable page sizes and automatic pagination state management.
 * 
 * Inputs:
 * - pageSize: Number of items per page (default: 10)
 * - arrayLength: Total length of the data array (default: 1)
 * - currentPage: Currently active page (default: 1)
 * 
 * Outputs:
 * - pageChange: EventEmitter<number> - Emits when page changes
 * - next: EventEmitter<void> - Emits when navigating to next page
 * - prev: EventEmitter<void> - Emits when navigating to previous page
 * 
 * Features:
 * - Smart page range calculation with dots for large datasets
 * - Configurable maximum shown pages with constant-based limits
 * - Navigation button state management (enabled/disabled)
 * - TrackBy optimization for ngFor performance
 * - Automatic pagination visibility based on data size
 * - Event-driven navigation with parent component communication
 * - Responsive pagination display with ellipsis for page gaps
 * - Comprehensive page calculation algorithms for optimal UX
 */
@Component({
  selector: 'app-pagination',
  standalone: true,
  imports: [
    CommonModule
  ],
  templateUrl: './pagination.component.html',
  styleUrl: './pagination.component.scss'
})
export class PaginationComponent {
  /** 
   * Input properties for pagination configuration:
   * - pageSize: Number of items per page (default: 10)
   * - arrayLength: Total length of the data array (default: 1)
   * - currentPage: Currently active page (default: 1)
   */
  @Input() pageSize: number = 10;
  @Input() arrayLength: number = 1;
  @Input() currentPage: number = 1;

  /** 
   * Output events for pagination navigation:
   * - pageChange: Event emitted when page changes
   * - next: Event emitted when navigating to next page
   * - prev: Event emitted when navigating to previous page
   */
  @Output() pageChange = new EventEmitter<number>();
  @Output() next = new EventEmitter<void>();
  @Output() prev = new EventEmitter<void>();

  /** 
   * Internal properties for pagination:
   * - totalPages: Total number of pages
   * - pages: Array of page numbers to display
   * - maxShownPages: Maximum number of pages to show (default: 5)
   * - useDots: Whether to use dots for navigation
   */
  totalPages: number = 1;
  pages: number[] = [];
  maxShownPages: number = maxPagination;
  useDots: boolean = false;

  constructor() { }

  ngOnInit(): void {
    this.pageChange.emit(this.currentPage); // emit current page
    this.calculatePages(); // calculate pages
  }

  /**
   * Handles changes to Input properties
   * @param changes - Object containing the changes
  */
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['arrayLength']) {
      this.totalPages = this.getTotalPages(this.arrayLength);
    }
    if (changes['currentPage']) {
      if (this.totalPages > 5) {
        this.useDots = true;
      } else {
        this.useDots = false;
      }
      this.calculatePages(); // calculate pages
    }
  }

  /**
   * Navigates to specified page
   * @param page - Page number to navigate to
  */
  goToPage(page: number): void {
    this.pageChange.emit(page);
  }

  /**
   * Navigates to next page
   * Emits next event
  */
  nextPage(): void {
    this.next.emit();
  }

  /**
   * Navigates to previous page
   * Emits prev event
  */
  prevPage(): void {
    this.prev.emit();
  }

  /**
   * TrackBy function for ngFor optimization
   * @param index - Element index
   * @param item - Array item
   * @returns Unique identifier for the element
  */
  trackByFn(index: number, item: number): number {
    return item;
  }

  /**
   * Calculates total number of pages
   * @param arrayLength - Total length of the array
   * @returns Number of pages
  */
  getTotalPages(arrayLength: number): number {
    return Math.ceil(arrayLength / this.pageSize);
  }

  /**
   * Calculates array of pages to display
   * Determines which pages to show in pagination
  */
  calculatePages(): void {
    const pages: number[] = [];

    if (this.totalPages <= this.maxShownPages) {
      for (let i = 2; i <= this.totalPages - 1; i++) {
        pages.push(i);
      }
    } else {
      let start = Math.max(2, this.currentPage - Math.floor(this.maxShownPages / 2));
      let end = start + this.maxShownPages - 1;

      if (end > this.totalPages) {
        end = this.totalPages;
        start = end - this.maxShownPages + 1;
      }

      for (let i = start; i < end; i++) {
        pages.push(i);
      }
    }
    this.pages = pages;
  }

  /**
   * Checks if previous button should be enabled
   * @returns true if can navigate to previous page
  */
  controlPrevBtn(): boolean {
    if (this.currentPage === 1) { // if current page is 1
      return false; // return false
    }
    return true; // return true
  }

  /**
   * Checks if next button should be enabled
   * @returns true if can navigate to next page
  */
  controlNextBtn(): boolean {
    if (this.currentPage === this.totalPages) { // if current page is equal to total pages
      return false; // return false
    }
    return true; // return true
  }

  /**
   * Checks if next button should be shown
   * @returns true if there are more items than page size
   */
  toggleNextBtn(): boolean {
    return this.arrayLength > this.pageSize;
  }
}
