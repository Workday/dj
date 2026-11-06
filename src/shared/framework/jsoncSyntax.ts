import { parse, type ParseError, printParseErrorCode } from 'jsonc-parser';

/** A JSON syntax problem located by character offset in the source text. */
export interface JsoncSyntaxProblem {
  message: string;
  offset: number;
  length: number;
}

/**
 * Syntax problems in a framework JSON file (`.model.json`, `.fragment.json`,
 * `.template.json`). `jsonParse` is lenient and returns a best-effort value
 * instead of throwing, so code that must not act on malformed input uses this
 * to collect the errors. Trailing commas and comments are accepted, matching
 * the authoring format the schemas allow.
 */
export function jsoncSyntaxProblems(text: string): JsoncSyntaxProblem[] {
  const errors: ParseError[] = [];
  parse(text, errors, { allowTrailingComma: true });
  return errors.map((error) => ({
    message: `Invalid JSON: ${printParseErrorCode(error.error)}`,
    offset: error.offset,
    length: error.length,
  }));
}
