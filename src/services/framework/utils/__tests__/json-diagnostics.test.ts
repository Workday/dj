import { describe, expect, test } from '@jest/globals';

import { jsoncSyntaxDetails, offsetToPosition } from '../json-diagnostics';

describe('offsetToPosition', () => {
  test('maps offsets to zero-based line and column', () => {
    const text = 'abc\ndef\n  ghi';
    expect(offsetToPosition(text, 0)).toEqual({ line: 0, col: 0 });
    expect(offsetToPosition(text, 2)).toEqual({ line: 0, col: 2 });
    expect(offsetToPosition(text, 4)).toEqual({ line: 1, col: 0 });
    expect(offsetToPosition(text, 10)).toEqual({ line: 2, col: 2 });
  });
});

describe('jsoncSyntaxDetails', () => {
  test('returns no details for valid JSON', () => {
    expect(jsoncSyntaxDetails('{ "name": "x" }')).toEqual([]);
  });

  test('maps syntax problems to error details positioned by offset', () => {
    const text = '{ "name": "x", "select": [ "a" "b" ] }';
    const details = jsoncSyntaxDetails(text);

    expect(details.length).toBeGreaterThan(0);
    for (const detail of details) {
      expect(detail.severity).toBe('error');
      expect(detail.instancePath).toBe('');
      expect(detail.message).toMatch(/^Invalid JSON: /);
      expect(typeof detail.offset).toBe('number');
      expect(typeof detail.length).toBe('number');
    }
  });
});
