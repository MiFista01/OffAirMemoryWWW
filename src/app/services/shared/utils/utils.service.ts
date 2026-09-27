import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class UtilsService {
  /**
   * Evaluates a value against a set of filter rules with flexible matching options.
   * Each rule can specify exact matching, partial matching, and individual negation.
   */
  filterRules(
    value: any,
    array: {
      type?: 'part' | 'start' | 'end',
      value: any,
      invert?: boolean
    }[],
  ): boolean {
    const rule = array.find((item) => {
      if (!item.type) {
        return item.value === value;
      } else {
        switch (item.type) {
          case 'part':
            return value.includes(item.value);
          case 'start':
            return value.startsWith(item.value);
          case 'end':
            return value.endsWith(item.value);
          default:
            return false;
        }
      }
    });

    if (!rule) return true;

    return false;
  }

  isEmpty(value: any) {
    if (value == null) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
  }

  buildQueryString(params: Record<string, any>): string {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value != null) {
        searchParams.append(key, String(value));
      }
    });
    return searchParams.toString();
  }

  slugify(value: string): string {
    return value
      .replace(/([A-Z])/g, '-$1')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/^-/, '')
      .replace(/-+/g, '-')
      .trim();
  }

  numberFormat(value: number): string {
    if (!value || isNaN(value)) return '0';
    if (typeof value !== 'number') {
      return String(value);
    }
    if (value === null || value === undefined || isNaN(value)) {
      return '0';
    }
    if (value < 1000 && value > -1000) {
      return value.toString();
    }
    let validValue = Math.abs(value);
    const numberSuffixes = [
      { suffix: "K", value: 1000 },
      { suffix: "M", value: 1000000 },
      { suffix: "B", value: 1000000000 },
      { suffix: "T", value: 1000000000000 },
      { suffix: "Q", value: 1000000000000000 },
      { suffix: "Qi", value: 1000000000000000000 },
      { suffix: "S", value: 1000000000000000000000 },
    ];
    let output = ""
    for (let i = numberSuffixes.length - 1; i >= 0; i--) {
      const suffix = numberSuffixes[i];
      if (validValue / suffix.value < 1) {
        continue;
      }
      output = (validValue / suffix.value).toFixed(2) + suffix.suffix;
      break;
    }

    if (output === "") {
      const lastSuffix = numberSuffixes[numberSuffixes.length - 1];
      const formatted = (validValue / lastSuffix.value).toFixed(2);
      output = formatted.replace(/\.?0+$/, '') + lastSuffix.suffix;
    }
    return value > 0 ? output : '-' + output;
  }

  getTimerDuration(
    endDate: Date | string | null,
    tick?: number,
  ): string | boolean {
    const seconds = this.getRemainingSeconds(endDate);
    if (seconds == null || seconds <= 0) {
      return true;
    }
    return this.formatDurationSeconds(seconds);
  }

  /** Remaining whole seconds until endDate; null if no endDate. */
  getRemainingSeconds(endDate: Date | string | null | undefined): number | null {
    if (!endDate) return null;
    const endTime = typeof endDate === 'string'
      ? new Date(endDate).getTime()
      : endDate.getTime();
    if (Number.isNaN(endTime)) return null;
    return Math.floor((endTime - Date.now()) / 1000);
  }

  /** Format a duration in seconds as HH:MM:SS. */
  formatDurationSeconds(totalSeconds: number): string {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
}
