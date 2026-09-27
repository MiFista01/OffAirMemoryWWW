import { Directive, HostListener, Input } from '@angular/core';
import { LightboxService } from '@services';
import { AlbumItem, LightboxComponent } from '@widgets';

interface LightboxOptions {
  albumName?: string;
  index?: number;
  image?: AlbumItem;
}

/**
 * Directive that opens the lightbox widget on element click.
 * 
 * Integrates with LightboxService to open either an album item or a single image.
 * Works with the LightboxComponent widget to display images in a modal overlay.
 * 
 * @example
 * Using with an album (requires album to be loaded first via LightboxService):
 *
 * ```html
 * <img [lightbox] [options]="{ albumName: 'gallery', index: 0 }" src="thumb.jpg">
 * ```
 * @example
 * Using with a single image:
 * ```html
 * <img [lightbox] [options]="{ image: { src: 'full.jpg', thumb: 'thumb.jpg' } }" src="thumb.jpg">
 * ```
 * @example
 * Complete workflow in a component:
 *
 * ```typescript
 * // 1. Load album via service
 * this.lightbox.loadAlbum(images, 'gallery');
 * ```
 * ```html
 * <!-- 2. Use directive in template -->
 * <img [lightbox] [options]="{ albumName: 'gallery', index: 0 }" src="thumb.jpg">
 * ```
 * 
 * @see {@link LightboxService} - Service for loading albums and managing lightbox state
 * @see {@link LightboxComponent} - Widget component that displays the lightbox modal
 */
@Directive({
  selector: '[lightbox]',
  standalone: true
})
export class LightboxDirective {
  @Input() options: LightboxOptions = { albumName: '', index: -1 };
  constructor(private readonly lightbox: LightboxService) { }

  @HostListener('click')
  onClick() {
    if (this.options.albumName && this.options.index !== undefined) {
      this.lightbox.openAlbumItem(this.options.albumName, this.options.index);
    } else if (this.options.image) {
      this.lightbox.loadSingleImage({ ...this.options.image });
    } else {
      throw new Error('Invalid lightbox options');
    }
  }
}
