import { describe, expect, test } from '@jest/globals';

import { jsoncSyntaxProblems } from '../jsoncSyntax';

describe('jsoncSyntaxProblems', () => {
  test('returns no problems for valid JSON', () => {
    expect(jsoncSyntaxProblems('{ "name": "x", "select": [] }')).toEqual([]);
  });

  test('accepts trailing commas and comments', () => {
    const text = `{
      // a comment
      "name": "x",
      "select": ["a", ],
    }`;
    expect(jsoncSyntaxProblems(text)).toEqual([]);
  });

  test('reports bare keys left behind by a commented-out object in an array', () => {
    // Regression: braces commented out inside `select` parse leniently into
    // the strings "type" and "fragment", so sync must see this as an error.
    const text = `{
  "select": [
    //     {
    "type": "all_from_fragment",
    "fragment": "stg__ibp__focus__select"
    //     }
  ]
}`;
    const problems = jsoncSyntaxProblems(text);

    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) {
      expect(problem.message).toMatch(/^Invalid JSON: /);
      expect(problem.offset).toBeGreaterThanOrEqual(0);
      expect(problem.offset).toBeLessThanOrEqual(text.length);
    }
    // The first problem is at the bare `"type"` key inside the select block.
    const selectStart = text.indexOf('"type"');
    const selectEnd = text.indexOf(']');
    expect(problems[0].offset).toBeGreaterThanOrEqual(selectStart);
    expect(problems[0].offset).toBeLessThan(selectEnd);
  });

  test('reports an unterminated object', () => {
    const problems = jsoncSyntaxProblems('{ "name": "x"');
    expect(problems.length).toBeGreaterThan(0);
  });
});
