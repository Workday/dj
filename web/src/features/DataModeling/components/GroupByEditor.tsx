import type { SchemaModelGroupBy } from '@shared/schema/types/model.schema';
import { Checkbox, EditableList, TagInput } from '@web/elements';
import React, { useMemo } from 'react';

interface GroupByEditorProps {
  value: SchemaModelGroupBy | null | undefined;
  onChange: (next: SchemaModelGroupBy | null | undefined) => void;
  disabled?: boolean;
  disabledMessage?: string;
}

type GroupByItem = string | { expr: string } | { type: 'dims' };

interface DecomposedGroupBy {
  dims: boolean;
  columns: string[];
  expressions: string[];
}

function decompose(
  value: SchemaModelGroupBy | null | undefined,
): DecomposedGroupBy {
  if (!value) {
    return { dims: false, columns: [], expressions: [] };
  }
  if (value === 'dims') {
    return { dims: true, columns: [], expressions: [] };
  }
  // Array form
  const items = value as ReadonlyArray<GroupByItem>;
  const columns: string[] = [];
  const expressions: string[] = [];
  let dims = false;
  for (const item of items) {
    if (typeof item === 'string') {
      columns.push(item);
    } else if (item && typeof item === 'object') {
      if ('expr' in item && typeof item.expr === 'string') {
        expressions.push(item.expr);
      } else if ('type' in item && item.type === 'dims') {
        dims = true;
      }
    }
  }
  return { dims, columns, expressions };
}

/**
 * Compose the decomposed UI state back into a SchemaModelGroupBy. Returns
 * the `'dims'` shorthand only when dims is the only signal, the array form
 * otherwise, and `undefined` (omit field) when nothing is set.
 */
function compose(next: DecomposedGroupBy): SchemaModelGroupBy | undefined {
  const empty =
    !next.dims && next.columns.length === 0 && next.expressions.length === 0;
  if (empty) return undefined;

  if (next.dims && next.columns.length === 0 && next.expressions.length === 0) {
    return 'dims';
  }

  const items: GroupByItem[] = [];
  if (next.dims) items.push({ type: 'dims' });
  items.push(...next.columns);
  items.push(...next.expressions.map((expr) => ({ expr })));
  return items as unknown as SchemaModelGroupBy;
}

/**
 * Controlled GROUP BY editor matching the schema-defined shape:
 *   - `'dims'` string (group by all dimensions)
 *   - tuple `[item, ...]` where each item is a column name string,
 *     `{ expr: string }`, or `{ type: 'dims' }`.
 *
 * Decomposes/composes between the schema array form and a tabular UI of
 * `{ dims, columns, expressions }` for editing convenience.
 */
export const GroupByEditor: React.FC<GroupByEditorProps> = ({
  value,
  onChange,
  disabled = false,
  disabledMessage,
}) => {
  const decomposed = useMemo(() => decompose(value), [value]);

  const emit = (next: DecomposedGroupBy) => {
    onChange(compose(next));
  };

  if (disabled) {
    return (
      <div className="border border-dashed border-neutral rounded p-3 text-sm text-muted-foreground">
        {disabledMessage ?? 'GROUP BY editor is disabled.'}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2">
        <Checkbox
          checked={decomposed.dims}
          onChange={(checked) => {
            const isChecked =
              typeof checked === 'boolean' ? checked : checked.target.checked;
            emit({ ...decomposed, dims: isChecked });
          }}
        />
        <span className="text-sm text-foreground">Group by all dimensions</span>
      </label>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1">
          Column names
        </label>
        <TagInput
          value={decomposed.columns}
          onChange={(tags: string[]) => emit({ ...decomposed, columns: tags })}
          placeholder="column_name"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1">
          Expressions
        </label>
        <EditableList
          items={decomposed.expressions}
          onChange={(items: string[]) =>
            emit({ ...decomposed, expressions: items })
          }
          placeholder="Enter expression"
          emptyText="No expressions added"
          addButtonLabel="Add"
          iconSize="w-5 h-5"
        />
      </div>
    </div>
  );
};
