import type { ValidationErrorDetail } from '@services/sync/types';
import * as fs from 'fs';
import { findNodeAtLocation, parseTree } from 'jsonc-parser';
import * as vscode from 'vscode';

/**
 * Convert a JSON pointer (e.g. "/tables/0/freshness") to path segments
 * compatible with jsonc-parser's `findNodeAtLocation`.
 * Numeric segments become numbers so array indices resolve correctly.
 */
function instancePathToSegments(instancePath: string): (string | number)[] {
  if (!instancePath || instancePath === '/') {
    return [];
  }
  return instancePath
    .replace(/^\//, '')
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg));
}

/**
 * Convert a character offset in `text` to a zero-based { line, col } position.
 */
function offsetToPosition(
  text: string,
  offset: number,
): { line: number; col: number } {
  let line = 0;
  let col = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      col = 0;
    } else {
      col++;
    }
  }
  return { line, col };
}

/**
 * Range of the node at `instancePath` in `jsonContent`. A missing property
 * resolves to the start of its parent; anything unresolvable to the file start.
 */
export function rangeForInstancePath(
  jsonContent: string,
  instancePath: string,
): vscode.Range {
  const tree = parseTree(jsonContent, undefined, {
    allowTrailingComma: true,
  });
  if (!tree) {
    return new vscode.Range(0, 0, 0, 0);
  }
  const segments = instancePathToSegments(instancePath);
  const node = findNodeAtLocation(tree, segments);
  if (node) {
    const start = offsetToPosition(jsonContent, node.offset);
    const end = offsetToPosition(jsonContent, node.offset + node.length);
    return new vscode.Range(start.line, start.col, end.line, end.col);
  }
  if (segments.length > 0) {
    // Property doesn't exist (e.g. missing required field) — point to parent
    const parentNode = findNodeAtLocation(tree, segments.slice(0, -1));
    if (parentNode) {
      const start = offsetToPosition(jsonContent, parentNode.offset);
      return new vscode.Range(start.line, start.col, start.line, start.col);
    }
  }
  return new vscode.Range(0, 0, 0, 0);
}

/** Reads a related (fragment or template) file's text for positioning. */
export type RelatedTextReader = (filePath: string) => string | undefined;

const readFromDisk: RelatedTextReader = (filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
};

/**
 * Build per-error `vscode.Diagnostic[]` with positions resolved from JSON source.
 * Falls back to a single diagnostic at line 0 when structured errors are unavailable.
 */
export function resolveValidationDiagnostics(
  fallbackMessage: string,
  errors?: ValidationErrorDetail[],
  jsonContent?: string,
  severity: vscode.DiagnosticSeverity = vscode.DiagnosticSeverity.Error,
  readRelatedText?: RelatedTextReader,
): vscode.Diagnostic[] {
  if (!errors?.length || !jsonContent) {
    return [
      new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 0),
        fallbackMessage,
        severity,
      ),
    ];
  }
  // Pass the channel default through so warning-channel callers
  // (`onModelValidationWarning`) render details without an explicit
  // `severity` override as Warning rather than Error. Per-detail
  // `severity: 'error'` overrides still win inside
  // `buildPositionedDiagnostics` so a warning batch can carry a hard error
  // (e.g. `validateDjIcebergPartitionOverwrite`) on the same URI.
  return buildPositionedDiagnostics(
    errors,
    jsonContent,
    severity,
    readRelatedText,
  );
}

/**
 * Build `vscode.Diagnostic[]` from structured `ValidationErrorDetail[]` with
 * JSON-pointer positions resolved against the provided source text.
 *
 * Shared by the error path (`resolveValidationDiagnostics`) and the lint
 * warning path (`onModelValidationLintWarnings`) so positioning behaves
 * identically for both. Details with a `related` location (a fragment or
 * template file) get it attached as related information.
 */
export function buildPositionedDiagnostics(
  details: ValidationErrorDetail[],
  jsonContent: string,
  severity: vscode.DiagnosticSeverity,
  readRelatedText: RelatedTextReader = readFromDisk,
): vscode.Diagnostic[] {
  return details.map((detail) => {
    const range = rangeForInstancePath(jsonContent, detail.instancePath);

    // Per-detail severity wins so a single batched callback can carry a
    // mix of errors and warnings (e.g. validateDjIcebergPartitionOverwrite
    // emits an Error alongside other post-generation warnings).
    const resolvedSeverity =
      detail.severity === 'error'
        ? vscode.DiagnosticSeverity.Error
        : detail.severity === 'warning'
          ? vscode.DiagnosticSeverity.Warning
          : severity;
    const diagnostic = new vscode.Diagnostic(
      range,
      detail.message,
      resolvedSeverity,
    );
    if (detail.related) {
      const relatedText =
        readRelatedText(detail.related.filePath) ??
        readFromDisk(detail.related.filePath);
      diagnostic.relatedInformation = [
        new vscode.DiagnosticRelatedInformation(
          new vscode.Location(
            vscode.Uri.file(detail.related.filePath),
            relatedText
              ? rangeForInstancePath(relatedText, detail.related.instancePath)
              : new vscode.Range(0, 0, 0, 0),
          ),
          detail.related.message,
        ),
      ];
    }
    return diagnostic;
  });
}
