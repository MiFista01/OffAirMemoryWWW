import { BehaviorSubject, Observable } from 'rxjs';

/**
 * Abstract base service for managing collections of data with reactive state management.
 * Provides common CRUD operations and reactive data streaming capabilities.
 * 
 * @template T - The type of items stored in the collection
 */
export abstract class CoreService<T> {
  private readonly $data = new BehaviorSubject<T[]>([]);

  dataSub(): Observable<T[]> {
    return this.$data.asObservable();
  }
  data(): T[] {
    return this.$data.getValue() as T[];
  }

  addItem(item: T): void {
    const current = this.$data.getValue();
    this.$data.next([...current, item]);
  }

  setValues(values: T[]): void {
    this.$data.next(values)
  }

  deleteItem(id: number): void {
    const current = this.$data.getValue();
    this.$data.next(current.filter(item => (item as any).id !== id));
  }
  clear(): void {
    this.$data.next([]);
  }
}