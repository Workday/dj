import type { SchemaFragment } from '@shared/schema/types/fragment.schema';
import type { SchemaTemplate } from '@shared/schema/types/template.schema';

/** A JSON path as a list of object keys and array indices. */
export type JsonPath = (string | number)[];

export type SharedFileKind = 'fragment' | 'template';

export type CompositionSeverity = 'error' | 'warning';

/** A location inside a fragment or template file. */
export interface SharedLocation {
  kind: SharedFileKind;
  name: string;
  /** Absent when the shared file could not be found. */
  filePath?: string;
  path: JsonPath;
}

/**
 * A problem found while resolving a model. `path` always points into the
 * model file being resolved, so diagnostics land on a line the user owns;
 * `related` points at the shared file the problem comes from, when there is
 * one.
 */
export interface CompositionIssue {
  message: string;
  severity: CompositionSeverity;
  path: JsonPath;
  related?: SharedLocation;
}

/** Where a value in the resolved model came from. */
export type ProvenanceOrigin =
  | { kind: 'model'; path: JsonPath }
  | {
      kind: SharedFileKind;
      name: string;
      filePath?: string;
      /** Location inside the shared file. */
      path: JsonPath;
      /** Location in the model file that pulled the value in. */
      includePath: JsonPath;
    };

export interface ProvenanceEntry {
  /** Location inside the resolved model. */
  path: JsonPath;
  origin: ProvenanceOrigin;
}

/** Names of the fragments and templates a model uses, transitively. */
export interface CompositionDependencies {
  fragments: string[];
  templates: string[];
}

export interface SharedFileEntry {
  kind: SharedFileKind;
  name: string;
  filePath: string;
  /** Stable hash of the file text; feeds the model cache fingerprint. */
  hash: string;
  definition: SchemaFragment | SchemaTemplate;
}

export interface FragmentEntry extends SharedFileEntry {
  kind: 'fragment';
  definition: SchemaFragment;
}

export interface TemplateEntry extends SharedFileEntry {
  kind: 'template';
  definition: SchemaTemplate;
}

export type ResolveMode =
  /** Fully resolved model, ready for validation and generation. */
  | 'full'
  /**
   * Template and config fragments applied, but column fragment includes and
   * the authoring keys (`extends`, `with`, `fragments`) kept. Used by editors
   * that show a template child's full body and save it back through
   * `diffAgainstTemplate`.
   */
  | 'merged';

export interface ResolveOptions {
  mode?: ResolveMode;
  /** Used to validate `model_ref` template parameters when provided. */
  modelExists?: (modelName: string) => boolean;
  /** Maximum nesting of fragments and templates. Defaults to 5. */
  maxDepth?: number;
}

export interface ResolveResult<TModel = Record<string, unknown>> {
  resolved: TModel;
  /** False when the model uses no fragments or templates (resolved === input). */
  composed: boolean;
  provenance: ProvenanceEntry[];
  dependencies: CompositionDependencies;
  issues: CompositionIssue[];
  hasErrors: boolean;
}

export interface DiffAgainstTemplateResult {
  /** The minimal child file that resolves to the edited model. */
  child: Record<string, unknown>;
  /** True when re-resolving `child` reproduces the edited model exactly. */
  exact: boolean;
  /** Edits the child format cannot express (for example removing an inherited tag). */
  warnings: string[];
}
