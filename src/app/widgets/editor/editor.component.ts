import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, SecurityContext, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { marked } from 'marked';
import { Editor, NgxEditorModule, Toolbar } from 'ngx-editor';
import TurndownService from 'turndown';
import { timer } from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DomSanitizer } from '@angular/platform-browser';
import DOMPurify from 'dompurify';

/**
 * Rich text editor component with markdown support, image upload, and content sanitization.
 * 
 * Advanced markdown editor widget featuring ngx-editor integration with customizable toolbar,
 * HTML to markdown conversion, and comprehensive content sanitization using DOMPurify.
 * 
 * Inputs:
 * - placeholder: Editor placeholder text with translation support
 * - useImg: Boolean flag to enable/disable image upload functionality
 * - submitPlaceholder: Text for submit button with translation support
 * - imgPlaceholder: Text for image upload button with translation support
 * - replyToUser: Optional username for reply-to display in comment threads
 * - markdownContent: Initial markdown content for editor initialization
 * 
 * Outputs:
 * - mkd: EventEmitter<string> - Emits converted markdown content on submit
 * 
 * Features:
 * - Customizable toolbar with bold, italic, lists, headings, and links
 * - Image upload with file type validation (JPEG, PNG, GIF, WebP)
 * - HTML to markdown conversion using TurndownService with custom rules
 * - Content sanitization using DOMPurify to prevent XSS attacks
 * - Focus state management for conditional button enabling
 * - Reply-to-user display for threaded discussions
 * - Secure content handling with allowed tags and attributes filtering
 */
@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [
    CommonModule,
    NgxEditorModule,
    FormsModule,
    TranslateModule
  ],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss'
})
export class EditorComponent {
  @Input() placeholder: string = '';
  @Input() useImg: boolean = false;
  @Input() useToolbar: boolean = true;
  @Input() submitPlaceholder: string = '';
  @Input() imgPlaceholder: string = '';
  @Input() replyToUser: string | undefined;
  @Input() markdownContent: string = ``;
  @Input() formBtnsToggle: boolean = false;
  @Output() mkd = new EventEmitter<string>();

  private focusHandler = () => this.onFocus();
  private blurHandler = () => this.onBlur();
  private pasteHandler = (event: Event) => this.onPaste(event as ClipboardEvent);

  html: string = '';
  completed: boolean = false;
  isEditorFocused = false;

  get mkdText(): string {
    return this.toMarkdown();
  }

  editor!: Editor;
  toolbar: Toolbar = [
    ['bold', 'italic'],
    ['blockquote'],
    ['ordered_list', 'bullet_list', ],
    [{ heading: ['h1', 'h2', 'h3'] }],
    ['link'],
    ['horizontal_rule']
  ];

  constructor(
    private readonly sanitizer: DomSanitizer,
    private readonly translate: TranslateService
  ) { }

  ngOnInit(): void {
    this.editor = new Editor({
      // attributes: {
      //   class: 'font-medium'
      // }
    });
    this.html = this.sanitizeMarkdown(this.markdownContent);

    this.editor.view.dom.addEventListener('focus', this.focusHandler);
    this.editor.view.dom.addEventListener('blur', this.blurHandler);
    this.editor.view.dom.addEventListener('paste', this.pasteHandler, true);
  }
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['markdownContent']) {
      const rawHtml = marked(this.markdownContent) as string;
      this.html = this.sanitizeHtml(rawHtml);

    }
  }

  private sanitizeHtml(html: string): string {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['p', 'h1', 'h2', 'h3', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'br', 'hr', 'blockquote', 'img'],
      ALLOWED_ATTR: ['href', 'class', 'target', 'src', 'alt', 'title'],
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur']
    });
  }
  private sanitizeMarkdown(markdown: string): string {
    const rawHtml = marked(markdown) as string;
    return this.sanitizeHtml(rawHtml);
  }

  onFocus() {
    this.isEditorFocused = true;
  }

  onBlur() {
    timer(100).subscribe(() => this.isEditorFocused = false);
  }

  onPaste(event: ClipboardEvent) {
    
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;
  
    const pastedText = clipboardData.getData('text/plain');
    if (!pastedText) return;
  
    if (this.isMarkdownText(pastedText)) {
      const htmlContent = this.sanitizeMarkdown(pastedText);
      
      event.preventDefault();
      this.editor.commands.insertHTML(htmlContent).exec();
    }
  }

  private isMarkdownText(text: string): boolean {
    const markdownPatterns = [
      /^#{1,6}\s+/m,
      /\*\*.*?\*\*/,
      /\*.*?\*/,
      /_.*?_/,
      /`.*?`/,
      /```[\s\S]*?```/,
      /^\s*[-*+]\s+/m,
      /^\s*\d+\.\s+/m,
      /\[.*?\]\(.*?\)/,
      /!\[.*?\]\(.*?\)/,
      /^>\s+/m,
      /^---+$/m,
      /^\|.*\|$/m,
    ];

    return markdownPatterns.some(pattern => pattern.test(text));
  }

  toMarkdown() {
    const cleanHtml = this.sanitizeHtml(this.html);
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '_',
      strongDelimiter: '**',
      hr: '---',
    });
    turndownService.addRule('strong', {
      filter: ['strong', 'b'],
      replacement: function (content) {
        let suffix = ' ';
        return '**' + content + '**' + suffix;
      }
    });
    turndownService.addRule('em', {
      filter: ['em', 'i'],
      replacement: function (content) {
        let suffix = ' ';
        return '_' + content + '_' + suffix;
      }
    });
    const markdown = turndownService.turndown(cleanHtml);
    return markdown;
  }

  uploadImg(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      if (!this.isValidImageType(file.type)) {
        alert(this.translate.instant('errors.invalidImageType'));
      }
      const fileUrl = URL.createObjectURL(file);
      const sanitized = this.sanitizer.sanitize(SecurityContext.URL, fileUrl) as string;
      this.editor.commands.insertImage(sanitized).exec()
    }
  }
  private isValidImageType(type: string): boolean {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    return allowedTypes.includes(type);
  }

  submit() {
    this.mkd.emit(this.toMarkdown());
  }

  clear() {
    this.html = '';
    this.editor.commands.insertHTML('').exec();
  }

  ngOnDestroy(): void {
    if (this.editor?.view?.dom) {
      this.editor.view.dom.removeEventListener('focus', this.focusHandler);
      this.editor.view.dom.removeEventListener('blur', this.blurHandler);
      this.editor.view.dom.removeEventListener('paste', this.pasteHandler, true);
    }
    if (this.editor) {
      this.editor.destroy();
    }
  }
}