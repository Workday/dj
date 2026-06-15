import type {
  SchemaModelHaving,
  SchemaModelWhere,
} from '@shared/schema/types/model.schema';
import type { CteState } from '@web/stores/useModelStore';
import React from 'react';

import { WhereEditor } from './WhereEditor';

interface HavingEditorProps {
  value: SchemaModelHaving | undefined;
  onChange: (next: SchemaModelHaving | undefined) => void;
  modelOptions?: { label: string; value: string }[];
  sourceOptions?: { label: string; value: string }[];
  cteOptions?: { label: string; value: string }[];
  ctes?: CteState[];
  manifest?: Record<string, unknown> | null;
  disabled?: boolean;
  disabledMessage?: string;
  /** Forwarded to WhereEditor so WHERE + HAVING radios don't collide. */
  idPrefix?: string;
}

/**
 * Controlled HAVING editor. SchemaModelHaving and SchemaModelWhere share
 * the same structure (string or {and|or: [{expr|group|subquery}]}), so this
 * is a thin wrapper that re-uses WhereEditor's UI and conversion helpers.
 */
export const HavingEditor: React.FC<HavingEditorProps> = ({
  value,
  onChange,
  ...rest
}) => {
  return (
    <WhereEditor
      value={value as SchemaModelWhere | undefined}
      onChange={(next) => onChange(next as SchemaModelHaving | undefined)}
      {...rest}
    />
  );
};
