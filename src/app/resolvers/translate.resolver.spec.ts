import { TestBed } from '@angular/core/testing';
import { ResolveFn } from '@angular/router';

import { translateResolver } from './translate.resolver';

describe('translateResolver', () => {
  const executeResolver: ResolveFn<boolean> = (...resolverParameters) => 
      TestBed.runInInjectionContext(() => translateResolver(...resolverParameters));

  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('should be created', () => {
    expect(executeResolver).toBeTruthy();
  });
});
