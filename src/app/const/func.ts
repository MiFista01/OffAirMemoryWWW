/** Shared helpers — extend per project. */
export function round(value: number, mode: 'ceil' | 'floor' | number = 0): number {
  if (value == null) return value;

  if (mode === 'ceil') {
    return Math.ceil(value);
  }
  if (mode === 'floor') {
    return Math.floor(value);
  }

  const precision = typeof mode === 'number' ? mode : 0;
  if (precision < 0) {
    const multiplier = Math.pow(10, -precision);
    return Math.round(value / multiplier) * multiplier;
  }
  const multiplier = Math.pow(10, precision);
  return Math.round(value * multiplier) / multiplier;
}

export function getTimePercentage(startDate: Date, endDate: Date): number {
  const now = Date.now();
  const start = startDate.getTime();
  const end = endDate.getTime();
  if (end <= start) return 100;
  return Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
}

/** Mutates object: removes `id` and `*Id` keys recursively. */
export function stripIdKeys(obj: unknown, seen = new WeakSet<object>()): void {
  if (obj === null || typeof obj !== 'object') return;
  if (seen.has(obj as object)) return;
  seen.add(obj as object);

  if (Array.isArray(obj)) {
    obj.forEach((item) => stripIdKeys(item, seen));
    return;
  }

  const keysToDelete = Object.keys(obj as object).filter(
    (key) => key === 'id' || /Id$/.test(key),
  );
  keysToDelete.forEach((key) => delete (obj as Record<string, unknown>)[key]);

  Object.values(obj as object).forEach((value) => stripIdKeys(value, seen));
}
