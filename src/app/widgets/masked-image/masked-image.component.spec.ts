import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MaskedImageComponent } from './masked-image.component';

describe('MaskedImageComponent', () => {
  let component: MaskedImageComponent;
  let fixture: ComponentFixture<MaskedImageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MaskedImageComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MaskedImageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
