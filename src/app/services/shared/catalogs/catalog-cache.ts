import { Observable, of, shareReplay, tap } from 'rxjs';

export const CATALOG_CACHE_TTL_MS = 5 * 60_000;

interface CatalogCacheEntry<T> {
  data?: T;
  loaded: boolean;
  fetchedAt?: number;
  subscribers: number;
  evictTimer?: ReturnType<typeof setTimeout>;
}

export class CatalogCache {
  private readonly entries = new Map<string, CatalogCacheEntry<unknown>>();

  constructor(private readonly ttlMs = CATALOG_CACHE_TTL_MS) {}

  clear(): void {
    for (const entry of this.entries.values()) {
      if (entry.evictTimer) {
        clearTimeout(entry.evictTimer);
      }
    }
    this.entries.clear();
  }

  observe$<T>(
    key: string,
    load: () => Observable<T>,
    empty: T
  ): Observable<T> {
    return new Observable<T>((subscriber) => {
      let entry = this.entries.get(key) as CatalogCacheEntry<T> | undefined;
      if (!entry) {
        entry = { loaded: false, subscribers: 0 };
        this.entries.set(key, entry);
      }

      entry.subscribers++;
      if (entry.evictTimer) {
        clearTimeout(entry.evictTimer);
        entry.evictTimer = undefined;
      }

      const isStale =
        entry.loaded &&
        entry.fetchedAt != null &&
        Date.now() - entry.fetchedAt > this.ttlMs;

      const source =
        entry.loaded && !isStale
          ? of(entry.data as T)
          : load().pipe(
            tap((data) => {
              entry!.data = (data ?? empty) as T;
              entry!.loaded = true;
              entry!.fetchedAt = Date.now();
            }),
            shareReplay({ bufferSize: 1, refCount: true }),
          );

      const sub = source.subscribe(subscriber);

      return () => {
        sub.unsubscribe();
        entry!.subscribers = Math.max(0, entry!.subscribers - 1);
        if (entry!.subscribers > 0) {
          return;
        }

        entry!.evictTimer = setTimeout(() => {
          const current = this.entries.get(key) as CatalogCacheEntry<T> | undefined;
          if (current && current.subscribers === 0) {
            this.entries.delete(key);
          }
        }, this.ttlMs);
      };
    });
  }
}
