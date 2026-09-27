import { CheckCurrentDatePipe } from './date.pipe';

describe('DatePipe', () => {
  it('create an instance', () => {
    const pipe = new CheckCurrentDatePipe();
    expect(pipe).toBeTruthy();
  });
});
