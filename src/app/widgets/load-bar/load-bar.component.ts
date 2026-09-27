import { Component, Input, HostBinding } from '@angular/core';
import { CommonModule } from '@angular/common';
interface loadBarColor{
  startColor: string;
  middleColor: string;
  endColor: string;
}


/**
 * Load bar component for progress visualization with customizable colors and dimensions.
 * 
 * Progress bar widget component featuring customizable progress display with gradient
 * color support and dynamic sizing. Includes host binding for CSS custom properties
 * and responsive progress width calculation for smooth progress visualization.
 * 
 * Inputs:
 * - progress: Number value representing progress percentage (0-100)
 * - height: Height of the progress bar in pixels (default: 10)
 * - color: Object containing gradient colors with startColor, middleColor, and endColor
 * 
 * Features:
 * - Dynamic CSS custom property binding for color gradients
 * - Responsive progress width calculation with percentage display
 * - Customizable height with pixel-based sizing
 * - Gradient color support for visual progress indication
 * - Host binding for efficient style property updates
 * - Flexible color configuration for different progress states
 */
@Component({
  selector: 'app-load-bar',
  standalone: true,
  imports: [
    CommonModule,
  ],
  templateUrl: './load-bar.component.html',
  styleUrl: './load-bar.component.scss'
})
export class LoadBarComponent {
  @Input() progress: number = 0;
  @Input() height: number = 10;
  @Input() showProgress: boolean = false;
  @Input() text: string = '';
  @Input() color: loadBarColor = {
    startColor: '#000',
    middleColor: '#000',
    endColor: '#fff'
  };

  @HostBinding('style.--start-color')
  get startColor() {
    return this.color.startColor;
  }

  @HostBinding('style.--middle-color')
  get middleColor() {
    return this.color.middleColor;
  }

  @HostBinding('style.--end-color')
  get endColor() {
    return this.color.endColor;
  }

  @HostBinding('style.--progress-width')
  get progressWidth() {
    return this.progress + '%';
  }

  @HostBinding('style.--progress-text-size')
  get progressTextSize() {
    return (this.height * 0.8) + 'px';
  }
}
