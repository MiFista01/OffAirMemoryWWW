import { TestBed } from '@angular/core/testing';

import { CronSchedulerService } from './cron-scheduler.service';

describe('CronSchedulerService', () => {
  let service: CronSchedulerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CronSchedulerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
