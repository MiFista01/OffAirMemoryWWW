import { Component, ContentChildren, QueryList } from '@angular/core';
import { GalleryImageComponent } from '../gallery-image/gallery-image.component';
import { Subscription, timer } from 'rxjs';
import { LightboxService } from '@services';
/**
 * Gallery container component that manages a collection of images with lightbox functionality.
 * Uses content projection to display child gallery images and provides lightbox modal
 * viewing capabilities with navigation between images.
 */
@Component({
  selector: 'gallery',
  standalone: true,
  templateUrl: './gallery.component.html',
  styleUrl: './gallery.component.scss'
})
export class GalleryComponent {
  @ContentChildren(GalleryImageComponent, { descendants: true }) imgs!: QueryList<GalleryImageComponent>;
  private imgs_ = new Subscription();
  album: any[] = [];

  constructor(private readonly lightbox: LightboxService) {

  }
  ngAfterViewInit(): void {
    this.buildAlbum();
    this.imgs_.unsubscribe();
    this.imgs_ = this.imgs.changes.subscribe(() => {
      this.buildAlbum();
    });
  }

  buildAlbum(albumName = 'gallery'): void {
    this.album = [];
    let checkAlbumItemName = new Set<string>();

    timer(10).subscribe(() => { // wait for the images to be initialized and remove error with premature replacement variable
      this.imgs.forEach((item, index) => {
        checkAlbumItemName.add(item.albumName);
        item.albumName = item.albumName ? item.albumName : albumName;
        item.index = index;
        const albumImg = {
          src: item.src,
          thumb: item.thumb,
        }
        this.album.push(albumImg);
      });

      if (checkAlbumItemName.size > 1) {
        throw new Error('All gallery images must have the same album name');
      }
      const values = Array.from(checkAlbumItemName);
      this.lightbox.loadAlbum(this.album, values[0]);
    })
  }

  ngOnDestroy(): void {
    this.imgs_.unsubscribe();
  }
}
