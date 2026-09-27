import { Directive, ElementRef } from '@angular/core';
import DOMPurify from 'dompurify';

/**
 * Post markdown directive that applies custom CSS classes to markdown-rendered HTML elements
 * and sanitizes content using DOMPurify for security. Monitors DOM changes to dynamically
 * apply styling to newly added markdown content.
 */
@Directive({
  selector: '[postMarkdown]',
  standalone: true
})
export class PostMarkdownDirective {
  private observer!: MutationObserver;
  private tagClassMap: [string, string[]][] = [
    ['font-medium', ['p', 'a', 'ul', 'ol', 'h3', 'table', 'td']],
    ['font-big', ['h2']],
    ['font-large', ['h1']],
  ];

  constructor(
    private el: ElementRef,
  ) { }

  ngAfterViewInit() {
    this.applyClasses();
    this.sanitizeContent();

    this.observer = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              this.applyClassesToElement(node as HTMLElement);
            }
          });
        }
      });
    });

    this.observer.observe(
      this.el.nativeElement,
      {
        childList: true,
        subtree: true,
        characterData: false,
        attributes: false
      }
    );
  }

  ngOnDestroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
  }
  
  private applyClassesToElement(element: HTMLElement) {
    this.tagClassMap.forEach(([className, tags]) => {
      if (tags.includes(element.tagName.toLowerCase())) {
        element.classList.add(className);
      }
    });
  }

  private applyClasses() {
    this.tagClassMap.forEach(([className, tags]) => {
      tags.forEach((tag) => {
        this.el.nativeElement.querySelectorAll(tag).forEach((el: HTMLElement) => {
          el.classList.add(className);
        });
      });
    });
  }
  private sanitizeContent() {
    const html = this.el.nativeElement.innerHTML;
    const sanitizedPurify = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['p', 'h1', 'h2', 'h3', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'br', 'hr', 'blockquote', 'img'],
      ALLOWED_ATTR: ['href', 'class', 'target', 'src', 'alt'],
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur']
    });
    if (sanitizedPurify) {
      this.el.nativeElement.innerHTML = sanitizedPurify;
    }
  }
}