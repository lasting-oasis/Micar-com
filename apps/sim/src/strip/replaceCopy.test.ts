import { describe, it, expect } from 'vitest';
import { replaceCopy } from './ReplacePrompt';

describe('replaceCopy', () => {
  it('names the money that will be replaced, with separators and no decimals', () => {
    expect(replaceCopy(1350)).toBe('Your $1,350 from this session will be replaced by your saved account.');
    expect(replaceCopy(1234567.8)).toBe('Your $1,234,568 from this session will be replaced by your saved account.');
    expect(replaceCopy(0)).toBe('Your $0 from this session will be replaced by your saved account.');
  });
});
