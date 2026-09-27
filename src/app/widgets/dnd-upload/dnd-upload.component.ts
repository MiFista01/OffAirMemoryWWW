import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { MessageService } from 'primeng/api';
import { FileUpload, FileUploadEvent, FileUploadModule } from 'primeng/fileupload';
import { ToastModule } from 'primeng/toast';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-dnd-upload',
  standalone: true,
  imports: [
    CommonModule,
    FileUploadModule,
    ToastModule,
    TranslateModule
  ],
  templateUrl: './dnd-upload.component.html',
  styleUrl: './dnd-upload.component.scss'
})
export class DndUploadComponent {
  @ViewChild('fileUpload') fileUpload!: FileUpload;

  @Input() url: string = '';
  @Input() name: string = '';
  @Input() accept: string = 'image/*';
  @Input() maxFileSize: number = 1000000;
  @Input() fileLimit: number = 10;
  @Input() body: { [key: string]: any } = {};
  @Input() autoUpload: boolean = false;

  @Output() onUploadSuccess = new EventEmitter<any>();

  toUploadFiles: any[] = [];
  savedFiles: any[] = [];
  tempFiles: any[] = [];

  clearFiles() {
    this.toUploadFiles = [];
    this.savedFiles = [];
    this.tempFiles = [];
    this.fileUpload.clear();
    this.onUploadSuccess.emit({
      savedFiles: [],
      tempFiles: []
    })
  }

  constructor(
    private readonly messageService: MessageService,
    private readonly translate: TranslateService,
  ) { }

  onUpload(event: FileUploadEvent) {

    const { status, message, files } = (event.originalEvent as any).body;
    if (status) {
      this.messageService.add({
        severity: 'success',
        summary: this.translate.instant('widgets.dndUpload.fileUploaded'),
        detail: this.translate.instant('widgets.dndUpload.uploadSuccess')
      });
    } else {
      this.messageService.add({
        severity: 'error',
        summary: this.translate.instant('widgets.dndUpload.uploadError'),
        detail: message || this.translate.instant('widgets.dndUpload.uploadFailed')
      });
      return;
    }

    const uploadedFiles = files || [];

    uploadedFiles.forEach((newFile: any) => {
      const exists = this.tempFiles.some(existingFile =>
        existingFile.originalName === newFile.name
      );
      if (!exists) {
        this.tempFiles.push(newFile);
      }
    });

    this.onUploadSuccess.emit({
      savedFiles: this.savedFiles,
      tempFiles: this.tempFiles
    });
  }
  onSelect(event: any) {
    const files = Array.from(event.files);

    if (files.length > this.fileLimit) {
      this.messageService.clear();

      this.messageService.add({
        severity: 'warn',
        summary: this.translate.instant('widgets.dndUpload.fileLimitExceeded'),
        detail: this.translate.instant('widgets.dndUpload.fileLimitExceededDescription', { fileLimit: this.fileLimit }),
        life: 5000
      });
    }

    this.toUploadFiles = [
      ...files.slice(0, this.fileLimit - this.savedFiles.length)
    ];
    this.savedFiles = [
      ...this.savedFiles,
      ...files.slice(0, this.fileLimit - this.savedFiles.length)
    ];
  }

  onError(event: any) {
    this.messageService.clear();
    this.messageService.add({
      severity: 'error',
      summary: this.translate.instant('widgets.dndUpload.uploadError'),
      detail: this.translate.instant('widgets.dndUpload.uploadErrorDescription'),
      life: 5000
    });
  }

  onBeforeUpload(event: any) {
    for (const [key, value] of Object.entries(this.body)) {
      event.formData.append(key, value);
    }
  }
  onRemoveUploadedFile(event: any) {
    this.toUploadFiles = this.toUploadFiles.filter(file => file.name !== event.name);
    this.savedFiles = this.savedFiles.filter(file => file.name !== event.name);
    this.tempFiles = this.tempFiles.filter(file => file.originalName !== event.name);
  }

}
