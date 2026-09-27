import { TestBed } from '@angular/core/testing';

import { UsersCoreService } from './users.core.service';

describe('UsersCoreService', () => {
  let service: UsersCoreService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(UsersCoreService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
