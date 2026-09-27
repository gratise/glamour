import { describe, expect, it } from 'vitest';
import { viewportSchema } from './index.js';

describe('viewportSchema', () => {
  it('defaults device scale factor to one', () => {
    expect(viewportSchema.parse({ width: 390, height: 844 })).toEqual({
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
    });
  });

  it('rejects non-positive dimensions', () => {
    expect(() => viewportSchema.parse({ width: 0, height: 844 })).toThrow();
  });
});
