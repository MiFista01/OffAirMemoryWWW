import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FormFieldsetComponent } from './form-fieldset.component';

describe('FormFieldsetComponent', () => {
  let component: FormFieldsetComponent;
  let fixture: ComponentFixture<FormFieldsetComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FormFieldsetComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(FormFieldsetComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
