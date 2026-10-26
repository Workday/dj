import { instancePathToJsonPath, jsonPathToInstancePath } from './json';
import { mapResolvedPath } from './resolve';
import type {
  CompositionDependencies,
  CompositionIssue,
  ProvenanceEntry,
  SharedLocation,
} from './types';

/**
 * A validation detail positioned in the model file, optionally pointing at
 * the fragment or template location it originates from. Structurally
 * compatible with the sync engine's `ValidationErrorDetail`.
 */
export interface CompositionDetail {
  message: string;
  instancePath: string;
  severity?: 'error' | 'warning';
  related?: {
    filePath: string;
    instancePath: string;
    message: string;
  };
}

function relatedFor(
  location: SharedLocation | undefined,
): CompositionDetail['related'] {
  if (!location?.filePath) {
    return undefined;
  }
  return {
    filePath: location.filePath,
    instancePath: jsonPathToInstancePath(location.path),
    message: `Defined in ${location.kind} "${location.name}"`,
  };
}

export function compositionIssuesToDetails(
  issues: CompositionIssue[],
): CompositionDetail[] {
  return issues.map((issue) => ({
    message: issue.message,
    instancePath: jsonPathToInstancePath(issue.path),
    severity: issue.severity,
    related: relatedFor(issue.related),
  }));
}

/**
 * Re-anchor details reported against the resolved model onto the model file.
 * Values that come from a fragment or template land on the line that pulled
 * them in (`extends` or the include item) and carry the shared location as
 * `related`.
 */
export function mapDetailsToModelFile<
  T extends { message: string; instancePath: string },
>(
  details: T[],
  provenance: ProvenanceEntry[],
): (T & Pick<CompositionDetail, 'related'>)[] {
  if (provenance.length === 0) {
    return details;
  }
  return details.map((detail) => {
    const mapped = mapResolvedPath(
      provenance,
      instancePathToJsonPath(detail.instancePath),
    );
    if (!mapped.shared) {
      return {
        ...detail,
        instancePath: jsonPathToInstancePath(mapped.modelPath),
      };
    }
    return {
      ...detail,
      instancePath: jsonPathToInstancePath(mapped.modelPath),
      message: `${detail.message} (from ${mapped.shared.kind} "${mapped.shared.name}")`,
      related: relatedFor(mapped.shared),
    };
  });
}

/**
 * Header comment for generated `.sql` / `.yml` files naming the shared
 * definitions the model was built from. Empty when the model uses none.
 */
export function compositionHeader(
  dependencies: CompositionDependencies,
  commentPrefix: '--' | '#',
): string {
  const parts: string[] = [];
  if (dependencies.templates.length > 0) {
    parts.push(`templates: ${dependencies.templates.join(', ')}`);
  }
  if (dependencies.fragments.length > 0) {
    parts.push(`fragments: ${dependencies.fragments.join(', ')}`);
  }
  if (parts.length === 0) {
    return '';
  }
  return `${commentPrefix} DJ composed from ${parts.join('; ')}\n`;
}
