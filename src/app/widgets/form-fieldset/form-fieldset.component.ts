import { Component, Input } from '@angular/core';

/**
 * Form fieldset component for structured form layout with customizable width and content projection.
 * 
 * Form layout widget component featuring HTML fieldset structure with legend and content projection
 * for organized form presentation. Includes dynamic CSS custom property setting for form width
 * customization and content projection slots for flexible form content arrangement.
 * 
 * Inputs:
 * - formWidth: CSS width value for form container (default: '90%')
 * 
 * Features:
 * - HTML fieldset structure with semantic legend element
 * - Content projection for legend and form content
 * - Dynamic CSS custom property injection for width control
 * - Responsive form layout with customizable dimensions
 * - Consistent form styling with font-large legend typography
 */
@Component({
  selector: 'app-form-fieldset',
  standalone: true,
  imports: [],
  templateUrl: './form-fieldset.component.html',
  styleUrl: './form-fieldset.component.scss'
})
export class FormFieldsetComponent {
  @Input() formWidth: string = '90%';
  ngOnInit(): void {
    document.documentElement.style.setProperty('--form-width', this.formWidth);
  }
}
