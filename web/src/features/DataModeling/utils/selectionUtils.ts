import type { SchemaSelect } from '@web/stores/useModelStore';

import type {
  Column,
  SelectionSourceKind,
  SelectionTypeValues,
} from '../types';
import { SelectionType, supportsColumnName, supportsExprOnly } from '../types';

export interface UpdateSelectionsConfig {
  /** Qualifier prefix for entries owned by this node (model name or alias) */
  qualifier: string;
  /** Column names available from the current model/node */
  modelColumnNames: Set<string>;
  /** Current model type (e.g., 'int_join_models') */
  modelType: string;
  selectionType: SelectionType | '';
  selection: { include?: string[]; exclude?: string[] };
  shouldClear: boolean;
  /** The selected model/source identifier */
  selectedModelValue: string;
  /**
   * @deprecated Prefer `sourceKind`. Retained for back-compat with callers
   * (e.g. JoinNode) that haven't been migrated yet. When `sourceKind` is
   * provided it wins; otherwise this maps to `'source' | 'model'`.
   */
  isTypeSource?: boolean;
  /**
   * Discriminates the upstream the SELECT is reading from. Drives which
   * key (`model`, `source`, `cte`) is written on the new select entry and
   * which bulk variant (`_from_model` / `_from_source` / `_from_cte`) gets
   * emitted in the fallback path.
   */
  sourceKind?: SelectionSourceKind;
  /** Column metadata for type determination fallback */
  columns?: Column[];
}

/**
 * Resolves the effective source kind: explicit `sourceKind` wins, otherwise
 * falls back to the legacy `isTypeSource` boolean.
 */
function resolveSourceKind(
  sourceKind: SelectionSourceKind | undefined,
  isTypeSource: boolean,
): SelectionSourceKind {
  if (sourceKind) return sourceKind;
  return isTypeSource ? 'source' : 'model';
}

/**
 * Builds the per-kind base object emitted into the `select` array, picking
 * the appropriate key (`model` / `source` / `cte`) for the upstream value.
 */
function buildBaseSelection(
  kind: SelectionSourceKind,
  value: string,
  type: SelectionTypeValues,
): Record<string, unknown> {
  if (kind === 'source') return { source: value, type };
  if (kind === 'cte') return { cte: value, type };
  return { model: value, type };
}

/**
 * Returns true when the given `{name, expr}` entry was created by the node
 * identified by `qualifier`.  Unqualified legacy entries (`expr === name`) are
 * treated as owned by whoever has the column in their column list.
 */
function isOwnedByQualifier(
  expr: string,
  name: string,
  qualifier: string,
): boolean {
  if (expr === name) return true;
  if (expr.endsWith(`.${name}`)) {
    const entryQualifier = expr.substring(0, expr.lastIndexOf('.'));
    return entryQualifier === qualifier;
  }
  return false;
}

function isSimpleExprEntry(
  sel: Exclude<SchemaSelect, string>,
): sel is { name: string; expr?: string } {
  return (
    'name' in sel && 'expr' in sel && !('model' in sel) && !('source' in sel)
  );
}

function isSimpleColumnRef(sel: { name: string; expr?: string }): boolean {
  const { name, expr } = sel;
  if (!expr) return false;
  return expr === name || expr.endsWith(`.${name}`);
}

/**
 * Pure function that builds the next `select` array after a column selection
 * change from either SelectNode or JoinNode.
 *
 * Qualifier-aware: only removes entries whose `expr` prefix matches the
 * calling node's qualifier, preventing cross-model removal of shared column
 * names.
 *
 * Position-preserving: when an existing entry owned by this node is dropped
 * during the filter pass, the replacement is reinserted at the same index
 * rather than appended at the end, so bulk select directives keep their
 * authored position across re-emits.
 */
export function buildUpdatedSelections(
  currentSelections: SchemaSelect[],
  config: UpdateSelectionsConfig,
): SchemaSelect[] {
  const {
    qualifier,
    modelColumnNames,
    modelType,
    selectionType,
    selection,
    shouldClear,
    selectedModelValue,
    isTypeSource = false,
    sourceKind,
    columns = [],
  } = config;

  const effectiveKind = resolveSourceKind(sourceKind, isTypeSource);
  const isFilterMode = selectionType !== '';

  // --- Step 1: Filter out entries owned by the current node ---
  //
  // `ownedIndex` records the position of the first removed entry so step 3
  // can reinsert the replacement at that slot. Later duplicate-owned
  // entries collapse into the same insertion point.

  const filtered: SchemaSelect[] = [];
  let ownedIndex: number | null = null;

  const markOwned = () => {
    if (ownedIndex === null) ownedIndex = filtered.length;
  };

  for (const existingSelection of currentSelections) {
    if (typeof existingSelection === 'string') {
      if (modelColumnNames.has(existingSelection)) {
        markOwned();
        continue;
      }
      filtered.push(existingSelection);
      continue;
    }

    if (
      isSimpleExprEntry(existingSelection) &&
      isSimpleColumnRef(existingSelection)
    ) {
      const expr = existingSelection.expr!;
      const { name } = existingSelection;

      if (isFilterMode) {
        if (isOwnedByQualifier(expr, name, qualifier)) {
          markOwned();
          continue;
        }
        filtered.push(existingSelection);
        continue;
      }

      if (
        isOwnedByQualifier(expr, name, qualifier) &&
        modelColumnNames.has(name)
      ) {
        markOwned();
        continue;
      }
      filtered.push(existingSelection);
      continue;
    }

    if (
      'model' in existingSelection ||
      'source' in existingSelection ||
      'cte' in existingSelection
    ) {
      const existingValue =
        'model' in existingSelection
          ? existingSelection.model
          : 'source' in existingSelection
            ? existingSelection.source
            : 'cte' in existingSelection
              ? (existingSelection as { cte: string }).cte
              : undefined;
      if (existingValue === selectedModelValue) {
        markOwned();
        continue;
      }
      filtered.push(existingSelection);
      continue;
    }

    filtered.push(existingSelection);
  }

  // --- Step 2: Build new entries to insert ---

  if (shouldClear) return filtered;

  const newEntries: SchemaSelect[] = [];

  if (selectionType === '') {
    const columnNames = selection.include || [];

    const columnsToAdd = columnNames.filter((colName) => {
      return !filtered.some(
        (item) =>
          typeof item !== 'string' && 'name' in item && item.name === colName,
      );
    });

    if (columnsToAdd.length > 0) {
      if (supportsColumnName(modelType)) {
        columnsToAdd.forEach((colName) => {
          newEntries.push(colName as never);
        });
      } else if (supportsExprOnly(modelType)) {
        columnsToAdd.forEach((colName) => {
          newEntries.push({
            name: colName,
            expr: qualifier ? `${qualifier}.${colName}` : colName,
          } as never);
        });
      } else {
        addTypeDeterminedSelection(
          newEntries,
          columnsToAdd,
          columns,
          selectedModelValue,
          effectiveKind,
        );
      }
    }
  } else {
    const baseSelection = buildBaseSelection(
      effectiveKind,
      selectedModelValue,
      selectionType as SelectionTypeValues,
    );

    const newSelection = {
      ...baseSelection,
      ...(selection.include && selection.include.length > 0
        ? { include: selection.include }
        : {}),
      ...(selection.exclude && selection.exclude.length > 0
        ? { exclude: selection.exclude }
        : {}),
    };

    newEntries.push(newSelection as never);
  }

  // --- Step 3: Reinsert at the preserved index, or append if none ---

  if (newEntries.length === 0) {
    return filtered;
  }
  if (ownedIndex !== null) {
    filtered.splice(ownedIndex, 0, ...newEntries);
    return filtered;
  }
  filtered.push(...newEntries);
  return filtered;
}

/**
 * Fallback path: determines the selection type from column metadata and pushes
 * a typed `{ model/source/cte, type, include }` entry into `target`. Callers
 * decide where `target` lives (the filtered array or a separate
 * `newEntries` buffer the caller will later splice into the filtered array
 * to preserve position).
 */
function addTypeDeterminedSelection(
  target: SchemaSelect[],
  columnsToAdd: string[],
  columns: Column[],
  selectedModelValue: string,
  sourceKind: SelectionSourceKind,
): void {
  const withTypes = columnsToAdd.map((colName) => {
    const info = columns.find((c) => c.name === colName);
    return { name: colName, type: info?.type || 'dimension' };
  });

  const hasDimensions = withTypes.some((c) => c.type === 'dimension');
  const hasFacts = withTypes.some((c) => c.type === 'fact');

  let determinedType: SelectionTypeValues;
  if (sourceKind === 'source') {
    determinedType = SelectionType.ALL_FROM_SOURCE;
  } else if (sourceKind === 'cte') {
    if (hasDimensions && hasFacts) determinedType = SelectionType.ALL_FROM_CTE;
    else if (hasFacts) determinedType = SelectionType.FCTS_FROM_CTE;
    else determinedType = SelectionType.DIMS_FROM_CTE;
  } else if (hasDimensions && hasFacts) {
    determinedType = SelectionType.ALL_FROM_MODEL;
  } else if (hasFacts) {
    determinedType = SelectionType.FCTS_FROM_MODEL;
  } else {
    determinedType = SelectionType.DIMS_FROM_MODEL;
  }

  const baseSelection = buildBaseSelection(
    sourceKind,
    selectedModelValue,
    determinedType,
  );

  target.push({ ...baseSelection, include: columnsToAdd } as never);
}
