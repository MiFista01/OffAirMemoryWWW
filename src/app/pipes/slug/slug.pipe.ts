import { Pipe, PipeTransform } from '@angular/core';

/**
 * Slug transformation pipe for converting strings into URL-friendly format.
 * 
 * Transforms input strings into URL-safe slugs by converting camelCase to kebab-case,
 * removing special characters, replacing spaces with hyphens, and cleaning up
 * multiple consecutive hyphens. Ensures consistent URL formatting for routing
 * and navigation purposes with proper string sanitization.
 */
@Pipe({
  name: 'slug',
  standalone: true
})
export class SlugPipe implements PipeTransform {

  transform(value: string): string {
    return value
      .replace(/([A-Z])/g, '-$1')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/^-/, '')
      .replace(/-+/g, '-')
      .trim();
  }

}
