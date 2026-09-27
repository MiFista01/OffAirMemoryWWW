import { TestBed } from '@angular/core/testing';
import { CanActivateFn } from '@angular/router';

import { userInitGuard } from './user-init.guard';

describe('userInitGuard', () => {
  const executeGuard: CanActivateFn = (...guardParameters) => 
      TestBed.runInInjectionContext(() => userInitGuard(...guardParameters));

  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('should be created', () => {
    expect(executeGuard).toBeTruthy();
  });
});
