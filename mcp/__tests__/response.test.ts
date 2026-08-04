import { describe, expect, test } from '@jest/globals';

import { failure, success, toToolContent } from '../src/response';

describe('response helpers', () => {
  test('success wraps data', () => {
    const result = success({ foo: 'bar' });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ foo: 'bar' });
  });

  test('failure wraps errors', () => {
    const result = failure(['bad']);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['bad']);
  });

  test('toToolContent marks errors', () => {
    const content = toToolContent(failure(['x']));
    expect(content.isError).toBe(true);
    expect(content.content[0].text).toContain('"ok": false');
  });
});
