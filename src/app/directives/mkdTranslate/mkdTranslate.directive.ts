import { Directive, ElementRef, Input, Renderer2, SimpleChanges } from '@angular/core';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Directive that converts markdown-formatted translated strings to HTML with proper View Encapsulation.
 * 
 * Converts markdown syntax (e.g., **bold**, *italic*) to HTML using 'marked', sanitizes with DOMPurify,
 * and creates elements via Renderer2 to ensure Angular View Encapsulation attributes are applied.
 * 
 * **When to use:**
 * - Use this directive when you need formatted text (bold, italic, etc.) in translations
 * - For plain text translations, use the standard `translate` pipe instead
 * 
 * @example
 * ```html
 * <!-- ✅ Use directive for formatted text -->
 * <div [mkdTranslate]="'key' | translate: { value: 5 }"></div>
 * 
 * <!-- ❌ Use standard pipe for plain text -->
 * <div>{{ 'key' | translate }}</div>
 * 
 * ```
 * **Translation JSON:**
 * 
 * ```json
 * {
 *   "key": "... **{{value}}** ..."
 * }
 * ```
 */
@Directive({
  selector: '[mkdTranslate]',
  standalone: true
})
export class MkdTranslateDirective {
  @Input('mkdTranslate') content: string = '';
  private lastContent: string = '';
  
  constructor(
    private el: ElementRef<HTMLElement>,
    private renderer: Renderer2
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['content'] && this.content && this.content !== this.lastContent) {
      this.lastContent = this.content;
      
      const rawHtml = marked(this.content) as string;
      const sanitized = DOMPurify.sanitize(rawHtml, {
        ALLOWED_TAGS: ['strong', 'em', 'b', 'i', 'u', 'span', 'br', 'p'],
        ALLOWED_ATTR: ['class'],
        ALLOW_DATA_ATTR: false,
        FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
        FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover']
      });
      
      this.clearContent();
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(sanitized, 'text/html');
      const body = doc.body;
      
      Array.from(body.childNodes).forEach(node => {
        this.createElementFromNode(node, this.el.nativeElement);
      });
    } else {
      this.clearContent();
    }
  }
  
  private createElementFromNode(node: Node, parent: HTMLElement) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = this.renderer.createText(node.textContent || '');
      this.renderer.appendChild(parent, text);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      const tagName = element.tagName.toLowerCase();
      
      const newElement = this.renderer.createElement(tagName);
      
      if (element.className) {
        const classes = element.className.split(' ').filter(c => c);
        classes.forEach(className => {
          this.renderer.addClass(newElement, className);
        });
      }
      
      Array.from(element.childNodes).forEach(child => {
        this.createElementFromNode(child, newElement);
      });
      
      this.renderer.appendChild(parent, newElement);
    }
  }
  
  private clearContent() {
    this.renderer.setProperty(this.el.nativeElement, 'innerHTML', '');
  }
}
