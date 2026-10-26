export interface PreviewColumnRow {
  name: string;
  modelName: string;
}

export interface DuplicateColumnResult {
  duplicateNames: string[];
  sourcesByName: Record<string, string[]>;
}

/** Output column names that appear more than once in the preview list. */
export function findDuplicateOutputColumns(
  columns: PreviewColumnRow[],
): DuplicateColumnResult {
  const sourcesByName: Record<string, string[]> = {};

  for (const col of columns) {
    const source = col.modelName || 'unknown';
    if (!sourcesByName[col.name]) {
      sourcesByName[col.name] = [];
    }
    sourcesByName[col.name].push(source);
  }

  const duplicateNames = Object.keys(sourcesByName)
    .filter((name) => sourcesByName[name].length > 1)
    .sort();

  return { duplicateNames, sourcesByName };
}

export function isSelectItemDraggable(selectItem: unknown): boolean {
  if (
    typeof selectItem === 'object' &&
    selectItem !== null &&
    'fragment' in selectItem
  ) {
    return false;
  }
  if (typeof selectItem === 'string') {
    return true;
  }
  if (
    typeof selectItem === 'object' &&
    selectItem !== null &&
    'expr' in selectItem
  ) {
    return true;
  }
  if (
    typeof selectItem === 'object' &&
    selectItem !== null &&
    ('model' in selectItem || 'source' in selectItem)
  ) {
    return false;
  }
  return false;
}

export function formatDuplicateColumnMessage(duplicateNames: string[]): string {
  if (duplicateNames.length === 0) {
    return '';
  }
  return `Duplicate output column names: ${duplicateNames.join(', ')}. Remove one source before continuing.`;
}

const BULK_MODEL_TYPES = new Set([
  'all_from_model',
  'dims_from_model',
  'fcts_from_model',
  'all_from_source',
  'dims_from_source',
  'fcts_from_source',
  'all_from_cte',
  'dims_from_cte',
  'fcts_from_cte',
  'all_from_fragment',
  'dims_from_fragment',
  'fcts_from_fragment',
]);

/**
 * Maps a preview table row back to its underlying `select` entry for actions
 * (drag, delete, configure). Fragment-expanded rows bind to the bulk fragment
 * object, not a same-named manual entry.
 */
export function resolveColumnSelectBinding(
  column: PreviewColumnRow,
  select: unknown[],
  isDraggableFn: (item: unknown) => boolean,
): {
  actualSelectItem: unknown;
  selectIndex: number;
  canDrag: boolean;
} {
  if (column.modelName.startsWith('fragment:')) {
    const fragmentName = column.modelName.slice('fragment:'.length);
    const selectIndex = select.findIndex(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        'fragment' in item &&
        (item as { fragment?: string }).fragment === fragmentName,
    );
    const actualSelectItem = selectIndex >= 0 ? select[selectIndex] : undefined;
    return {
      actualSelectItem,
      selectIndex,
      canDrag: false,
    };
  }

  if (column.modelName === '') {
    const selectIndex = select.findIndex(
      (item) => typeof item === 'string' && item === column.name,
    );
    const actualSelectItem = selectIndex >= 0 ? select[selectIndex] : undefined;
    return {
      actualSelectItem,
      selectIndex,
      canDrag: actualSelectItem ? isDraggableFn(actualSelectItem) : false,
    };
  }

  if (column.modelName === 'Derived Column') {
    let selectIndex = -1;
    let actualSelectItem: unknown;
    let exprIndex = -1;
    let exprItem: unknown;

    for (let i = 0; i < select.length; i++) {
      const item = select[i];
      if (typeof item !== 'object' || item === null || !('name' in item)) {
        continue;
      }
      const name = (item as { name?: string }).name;
      if (name !== column.name) {
        continue;
      }
      if ('fragment' in item) {
        continue;
      }
      const type =
        'type' in item ? (item as { type?: string }).type : undefined;
      if (type && BULK_MODEL_TYPES.has(type)) {
        continue;
      }
      if ('model' in item && !('expr' in item)) {
        const t =
          'type' in item ? (item as { type?: string }).type : undefined;
        if (t && BULK_MODEL_TYPES.has(t)) {
          continue;
        }
      }
      if ('expr' in item) {
        exprIndex = i;
        exprItem = item;
        break;
      }
      if (selectIndex < 0) {
        selectIndex = i;
        actualSelectItem = item;
      }
    }

    if (exprIndex >= 0) {
      return {
        actualSelectItem: exprItem,
        selectIndex: exprIndex,
        canDrag: isDraggableFn(exprItem),
      };
    }

    return {
      actualSelectItem,
      selectIndex,
      canDrag: actualSelectItem ? isDraggableFn(actualSelectItem) : false,
    };
  }

  return {
    actualSelectItem: undefined,
    selectIndex: -1,
    canDrag: false,
  };
}
