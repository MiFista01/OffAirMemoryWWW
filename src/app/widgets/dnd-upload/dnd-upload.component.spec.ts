import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DndUploadComponent } from './dnd-upload.component';

describe('DndUploadComponent', () => {
  let component: DndUploadComponent;
  let fixture: ComponentFixture<DndUploadComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DndUploadComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DndUploadComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
