import { TestBed } from '@angular/core/testing';

import { AuthCoreService } from './auth.core.service';

describe('AuthService', () => {
  let service: AuthCoreService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AuthCoreService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
