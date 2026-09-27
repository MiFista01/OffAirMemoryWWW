import { Injectable, signal } from '@angular/core';
import { AlbumItem, LightboxComponent } from '@widgets';
import { LightboxDirective } from '@directives';

/**
 * Service that manages lightbox state using Angular signals.
 * 
 * Acts as a communication hub between components/directives and the LightboxComponent widget.
 * All operations are communicated through signals for reactive state management.
 * 
 * @example
 * Loading an album and opening it:
 *```typescript
 * constructor(private lightbox: LightboxService) {}
 * 
 * openGallery() {
 *   const images: AlbumItem[] = [
 *     { src: 'image1.jpg', thumb: 'thumb1.jpg' },
 *     { src: 'image2.jpg', thumb: 'thumb2.jpg' }
 *   ];
 *   
 *   // Load album first
 *   this.lightbox.loadAlbum(images, 'myGallery');
 *   
 *   // Then open specific image (or use LightboxDirective)
 *   this.lightbox.openAlbumItem('myGallery', 0);
 * }
 * ```
 * ```html
 * <img [lightbox] [options]="{ albumName: 'myGallery', index: 0 }" src="thumb.jpg">
 * ```
 * 
 * @example
 * Opening a single image:
 *```typescript
 * this.lightbox.loadSingleImage({ src: 'image.jpg', thumb: 'thumb.jpg' });
 * ```
 * ```html
 * <img [lightbox] [options]="{ image: { src: 'image.jpg', thumb: 'thumb.jpg' } }" src="thumb.jpg">
 * ```
 * 
 * @see {@link LightboxComponent} - Widget that listens to service signals
 * @see {@link LightboxDirective} - Directive that uses this service
 */
@Injectable({
  providedIn: 'root'
})
export class LightboxService {

  private loadAlbum_$ = signal<{album: AlbumItem[], albumName: string} | null>(null);
  private loadSingleImage_$ = signal<AlbumItem | null>(null);
  private removeAlbum_$ = signal<string>('');
  private openAlbumItem_$ = signal<{albumName: string, index: number} | null>(null);

  loadAlbum(album: AlbumItem[], albumName: string) {
    this.loadAlbum_$.set({album, albumName});
  }

  loadSingleImage(image: AlbumItem) {
    const newImage = { ...image, loaded: false };
    this.loadSingleImage_$.set(newImage);
  }

  removeAlbum(albumName: string) {
    this.removeAlbum_$.set(albumName);
  }

  openAlbumItem(albumName: string, index: number) {
    this.openAlbumItem_$.set({albumName, index});
  }

  signals() {
    return {
      loadAlbum: this.loadAlbum_$.asReadonly(),
      loadSingleImage: this.loadSingleImage_$.asReadonly(),
      removeAlbum: this.removeAlbum_$.asReadonly(),
      openAlbumItem: this.openAlbumItem_$.asReadonly()
    }
  }
}
