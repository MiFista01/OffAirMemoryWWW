import { Component, HostListener } from '@angular/core';
import { RouterModule } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { DragDropService, NgxTranslateService } from '@services';
import { ToastModule } from 'primeng/toast';
import { timer } from 'rxjs';
import { LightboxComponent } from '@widgets';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterModule,
    ToastModule,
    LightboxComponent
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  constructor(
    private readonly translate: TranslateService,
    private readonly customTranslate: NgxTranslateService,
    private readonly dragDrop: DragDropService,
  ) {
    this.translate.setDefaultLang('ee')
    this.customTranslate.initialize('ee');
    timer(1000).subscribe(() => {
      // this.translate.use('en');
    });
    
  }

  @HostListener('dragenter', ['$event'])
  onDragOver(event: DragEvent) {
    if (this.dragDrop.dragStart) return;
    event.preventDefault();

    const dataTransfer = event.dataTransfer;
    if (dataTransfer && dataTransfer.items) {

      const dragFiles = Object.values(dataTransfer.items)
        .reduce((acc, item) => {
          acc.types.push(item.type);
          return acc;
        }, { types: [], files: [] } as { types: string[], files: File[] }
        )
      if (dragFiles.types.length > 0) {
        this.dragDrop.startDrag(dragFiles.types, []);
      }
    }
  }

  @HostListener('dragleave', ['$event'])
  onDragLeave(event: DragEvent) {
    if (!event.relatedTarget || !document.contains(event.relatedTarget as Node)) {
      console.log('onDragLeave', event.relatedTarget);
      this.dragDrop.endDrag();
    }
  }
}
