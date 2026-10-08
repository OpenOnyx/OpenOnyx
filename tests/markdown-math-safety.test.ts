import { describe, expect, it } from 'vitest';
import { protectInvalidMath } from '../src/utils/markdownMathSafety';

describe('protectInvalidMath', () => {
  it('keeps replacement characters readable instead of sending them to KaTeX', () => {
    expect(protectInvalidMath('Value: $bad � text$')).toBe('Value: \\$bad � text\\$');
  });

  it('keeps unsupported Unicode symbols visible as ordinary text', () => {
    expect(protectInvalidMath('$text ʧ$')).toBe('\\$text ʧ\\$');
  });

  it('leaves valid math and ordinary dollar text unchanged', () => {
    expect(protectInvalidMath('$x^2$ and $5')).toBe('$x^2$ and $5');
  });
});
