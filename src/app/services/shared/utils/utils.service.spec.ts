import { TestBed } from '@angular/core/testing';

import { UilsService } from './utils.service';

describe('UilsService', () => {
  let service: UilsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(UilsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
