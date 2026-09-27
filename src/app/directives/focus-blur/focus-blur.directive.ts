import { Directive, ElementRef, HostListener, Input, Renderer2 } from '@angular/core';

@Directive({
  selector: '[appFocusBlur]',
  standalone: true
})
export class FocusBlurDirective {
  @Input('appFocusBlur') noFocusClass = '';

  constructor(
    private el: ElementRef<HTMLElement>,
    private renderer: Renderer2
  ) {}

  ngOnInit(): void {
    this.sync();
  }

  @HostListener('focus')
  onFocus(): void {
    this.sync(true);
  }

  @HostListener('blur')
  onBlur(): void {
    this.sync(false);
  }

  private sync(forceFocused?: boolean): void {
    const host = this.el.nativeElement;
    const active = document.activeElement as HTMLElement | null;

    const focused =
      typeof forceFocused === 'boolean'
        ? forceFocused
        : this.isActuallyFocused(host, active);

    let base = (this.noFocusClass ?? '').trim();
    if (base.length > 0) base += '-';

    const focusedClass = `${base}focused`;
    const blurredClass = `${base}blurred`;

    if (focused) {
      this.renderer.removeClass(host, blurredClass);
      this.renderer.addClass(host, focusedClass);
    } else {
      this.renderer.removeClass(host, focusedClass);
      this.renderer.addClass(host, blurredClass);
    }
  }

  private isActuallyFocused(host: HTMLElement, active: HTMLElement | null): boolean {
    if (active === host) return true;

    if (host.tagName === 'IFRAME') {
      const frame = host as HTMLIFrameElement;

      if (document.activeElement === frame) return true;

      try {
        return Boolean(frame.contentWindow?.document?.hasFocus?.());
      } catch {
        return false;
      }
    }

    return false;
  }
}