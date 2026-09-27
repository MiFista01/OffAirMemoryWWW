import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { LightboxDirective } from '@directives';
/**
 * Individual gallery image component that displays an image with click-to-open functionality.
 * Emits events to parent gallery component for lightbox modal display with optional
 * thumbnail and caption support.
 */
@Component({
  selector: 'gallery-image',
  standalone: true,
  imports: [
    LightboxDirective
  ],
  templateUrl: './gallery-image.component.html',
  styleUrl: './gallery-image.component.scss',
})
export class GalleryImageComponent {
  @Input() src = ""
  @Input() thumb = ""
  @Input() caption = ""
  @Input() index = 0
  @Input() albumName = ""
}
