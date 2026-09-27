import { CommonModule } from '@angular/common';
import { Component, effect, HostListener } from '@angular/core';
import { fadeInOutAnimation } from '@animations';
import { LightboxService } from '@services';
import { Subscription, takeWhile, timer } from 'rxjs';
import { LightboxDirective } from '@directives';

export interface AlbumItem {
  src: string;
  thumb: string;
}
interface EnchantAlbumItem extends AlbumItem {
  loaded: boolean;
}

/**
 * Widget component that displays images in a modal overlay with navigation.
 * 
 * Provides full-screen image gallery with keyboard navigation (Arrow keys, Escape).
 * Listens to LightboxService signals to load albums, open images, and manage state.
 * 
 * @example
 * Include in app template (usually in app.component.html):
 *
 * ```html
 * <app-lightbox></app-lightbox>
 * ```
 * 
 * @example
 * Complete workflow:
 * 
 * ```typescript
 * // In a other component
 * constructor(private lightbox: LightboxService) {}
 * 
 * ngOnInit() {
 *   // Load album
 *   this.lightbox.loadAlbum(images, 'gallery');
 * }
 * ```
 * ```html
 * <!-- Use directive in template -->
 * <img [lightbox] [options]="{ albumName: 'gallery', index: 0 }" src="thumb.jpg">
 * ```
 * 
 * The widget automatically opens when LightboxService signals are triggered.
 * 
 * @see {@link LightboxService} - Service that sends commands via signals
 * @see {@link LightboxDirective} - Directive for declarative lightbox opening
 */
@Component({
  selector: 'app-lightbox',
  standalone: true,
  imports: [
    CommonModule
  ],
  templateUrl: './lightbox.component.html',
  styleUrl: './lightbox.component.scss',
  animations: [fadeInOutAnimation]
})
export class LightboxComponent {
  private closeTimer_: Subscription | undefined = undefined;
  albums = new Map<string, EnchantAlbumItem[]>();
  openAlbum: EnchantAlbumItem[] = [];
  index = -1;
  currentAlbum: string = "";
  isOpen = false;

  constructor(private readonly lightbox: LightboxService) {
    const { loadAlbum, removeAlbum, openAlbumItem, loadSingleImage } = this.lightbox.signals();
    effect(() => {
      const album = loadAlbum();
      if (album) {
        this.loadAlbum(album.album, album.albumName);
      }
    });
    effect(() => {
      const albumName = removeAlbum();
      if (albumName) {
        this.albums.delete(albumName);
      }
    });
    effect(() => {
      const album = openAlbumItem();
      if (album) {
        this.openAlbumItem(album.albumName, album.index);
        this.isOpen = true;
      }
    });
    effect(() => {
      const image = loadSingleImage();
      if (image) {
        this.loadSingleImage(image);
        this.isOpen = true;
      }
    });
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    if (!this.isOpen) return;
    
    switch (event.key) {
      case 'Escape':
        this.close();
        break;
      case 'ArrowLeft':
        this.prev();
        break;
      case 'ArrowRight':
        this.next();
        break;
    }
  }

  private loadAlbum(album: AlbumItem[], albumName: string = 'default') {
    if (albumName) {
      this.currentAlbum = albumName;
      this.albums.set(albumName, album.map(item => ({ ...item, loaded: false })));
    } else {
      this.albums.set('default', album.map(item => ({ ...item, loaded: false })));
    }
  }
  private loadSingleImage(image: AlbumItem) {
    this.closeTimer_?.unsubscribe();
    this.albums.set('temp', [{ ...image, loaded: false }]);
    this.currentAlbum = 'temp';
    this.openAlbum = [{ ...image, loaded: false }];
    this.index = 0;
    this.isOpen = true;
  }

  next() {
    let album = this.albums.get(this.currentAlbum);
    if (!album) album = this.albums.get('default');
    if (!album) return;

    if (this.index < album.length - 1) {
      this.index++;
    }
  }

  prev() {
    let album = this.albums.get(this.currentAlbum);
    if (!album) album = this.albums.get('default');
    if (!album) return;

    if (this.index > 0) {
      this.index--;
    }
  }

  close() {
    this.isOpen = false;
    this.closeTimer_?.unsubscribe();
    this.closeTimer_ = timer(600).pipe(
      takeWhile(() => !this.isOpen)
    ).subscribe(() => {
      this.openAlbum = [];
      this.index = -1;
      this.currentAlbum = '';
    });
  }

  private openAlbumItem(albumName: string, index: number) {
    this.index = index;
    this.currentAlbum = albumName;
    this.openAlbum = this.albums.get(albumName) || [];
    this.closeTimer_?.unsubscribe();
  }

  onLoad(event: Event, index: number) {
    if (!this.albums.has(this.currentAlbum)) return;
    const album = this.albums.get(this.currentAlbum)!;
    if (index < 0 || index >= album.length) return;
    album[index].loaded = true;

    this.openAlbum[index].loaded = true;
  }
}
