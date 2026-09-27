import { TestBed } from '@angular/core/testing';

import { AccountCoreService } from './account.core.service';

describe('AccountCoreService', () => {
  let service: AccountCoreService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AccountCoreService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
