import {
  ChevronDownIcon,
  ChevronRightIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type { SchemaModelWhere } from '@shared/schema/types/model.schema';
import type { SchemaModelSubquery } from '@shared/schema/types/model.subquery.schema';
import type { RadioOption } from '@web/elements';
import { Button, InputText, RadioGroup } from '@web/elements';
import type { CteState } from '@web/stores/useModelStore';
import React, { useEffect, useState } from 'react';

import { type SubqueryCondition, SubqueryEditor } from './SubqueryEditor';

const whereTypeOptions: RadioOption[] = [
  { label: 'Basic', value: 'basic' },
  { label: 'Advanced', value: 'advanced' },
];

const conditionTypeOptions: RadioOption[] = [
  { label: 'AND', value: 'and' },
  { label: 'OR', value: 'or' },
];

const conditionItemOptions: RadioOption[] = [
  { label: 'Expression', value: 'expr' },
  { label: 'Group', value: 'group' },
  { label: 'Subquery', value: 'subquery' },
];

type GroupCondition = {
  conditionType: 'and' | 'or';
  expressions: string[];
};

type ConditionItem =
  | { type: 'expr'; value: string }
  | { type: 'group'; value: GroupCondition }
  | { type: 'subquery'; value: SubqueryCondition };

/**
 * Convert local UI state into the schema-shaped SchemaModelWhere object.
 * Mirrors the logic in WhereClauseNode but exported as a pure function so
 * the CTE panel and the main-model node share the same serialization.
 */
function conditionsToSchema(
  conditionType: string,
  conditions: ConditionItem[],
): SchemaModelWhere | null {
  const items = conditions
    .map((c) => {
      if (c.type === 'expr' && c.value) {
        return { expr: c.value };
      }
      if (c.type === 'group') {
        const g = c.value;
        const exprs = g.expressions.filter(Boolean);
        if (exprs.length === 0) return null;
        return {
          group: {
            [g.conditionType]: exprs.map((e) => ({ expr: e })),
          },
        };
      }
      if (c.type === 'subquery') {
        const s = c.value;
        if (!s.selectCols || !s.fromValue) return null;
        const from: SchemaModelSubquery['from'] =
          s.fromType === 'model'
            ? { model: s.fromValue }
            : s.fromType === 'source'
              ? { source: s.fromValue }
              : { cte: s.fromValue };
        const subquery: SchemaModelSubquery = {
          operator: s.operator,
          select: s.selectCols.split(',').map((col) => col.trim()) as [
            string,
            ...string[],
          ],
          from,
          ...(s.column ? { column: s.column } : {}),
          ...(s.innerWhere ? { where: s.innerWhere } : {}),
        };
        return { subquery };
      }
      return null;
    })
    .filter(Boolean) as Array<{
    expr?: string;
    group?: SchemaModelWhere;
    subquery?: SchemaModelSubquery;
  }>;

  if (items.length === 0) return null;
  return { [conditionType]: items };
}

function schemaToConditions(whereData: SchemaModelWhere | undefined): {
  conditionType: string;
  conditions: ConditionItem[];
} {
  if (!whereData || typeof whereData === 'string') {
    return { conditionType: 'and', conditions: [] };
  }

  const key = whereData.and ? 'and' : 'or';
  const items = whereData.and || whereData.or || [];
  const conditions: ConditionItem[] = items
    .map((item): ConditionItem | null => {
      if (item.subquery) {
        const s = item.subquery;
        const fromType: SubqueryCondition['fromType'] =
          'model' in s.from ? 'model' : 'source' in s.from ? 'source' : 'cte';
        const fromValue =
          'model' in s.from
            ? s.from.model
            : 'source' in s.from
              ? s.from.source
              : 'cte' in s.from
                ? s.from.cte
                : '';
        return {
          type: 'subquery',
          value: {
            operator: s.operator,
            column: s.column || '',
            selectCols: s.select.join(', '),
            fromType,
            fromValue,
            innerWhere: typeof s.where === 'string' ? s.where : '',
          },
        };
      }
      if (item.group) {
        const g =
          typeof item.group === 'string'
            ? { and: [{ expr: item.group }] }
            : item.group;
        const gKey = 'and' in g && g.and ? 'and' : 'or';
        const gItems = ('and' in g ? g.and : 'or' in g ? g.or : []) || [];
        return {
          type: 'group',
          value: {
            conditionType: gKey,
            expressions: gItems.map((gi) => gi.expr || '').filter(Boolean),
          },
        };
      }
      if (item.expr) {
        return { type: 'expr', value: item.expr };
      }
      return null;
    })
    .filter(Boolean) as ConditionItem[];

  return { conditionType: key, conditions };
}

function GroupRowEditor({
  group,
  onChange,
  onRemove,
  radioName,
}: {
  group: GroupCondition;
  onChange: (g: GroupCondition) => void;
  onRemove: () => void;
  // Scoped radio name so multiple GroupRowEditors (across WHERE/HAVING
  // editors rendered on the same screen) don't share a radio name.
  radioName: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [newExpr, setNewExpr] = useState('');

  return (
    <div className="border border-neutral rounded-md bg-card/50 p-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button
          onClick={() => setCollapsed(!collapsed)}
          variant="iconButton"
          label=""
          title={collapsed ? 'Expand group' : 'Collapse group'}
          icon={
            collapsed ? (
              <ChevronRightIcon className="w-4 h-4 text-foreground" />
            ) : (
              <ChevronDownIcon className="w-4 h-4 text-foreground" />
            )
          }
        />
        <span className="text-sm font-medium text-muted-foreground">Group</span>
        <RadioGroup
          name={radioName}
          options={conditionTypeOptions}
          value={group.conditionType}
          onChange={(v) =>
            onChange({ ...group, conditionType: v as 'and' | 'or' })
          }
          className="basis-[8rem]"
        />
        <div className="flex-1" />
        <Button
          onClick={onRemove}
          variant="iconButton"
          label=""
          title="Remove group"
          icon={<TrashIcon className="w-5 h-5 text-error" />}
        />
      </div>
      {!collapsed && (
        <div className="flex flex-col gap-1 pl-4">
          {group.expressions.map((expr, i) => (
            <div key={i} className="flex items-center gap-2">
              <InputText
                placeholder="Enter expression"
                value={expr}
                onChange={(e) => {
                  const newExprs = [...group.expressions];
                  newExprs[i] = e.target.value;
                  onChange({ ...group, expressions: newExprs });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.preventDefault();
                }}
              />
              <Button
                onClick={() =>
                  onChange({
                    ...group,
                    expressions: group.expressions.filter(
                      (_, idx) => idx !== i,
                    ),
                  })
                }
                variant="iconButton"
                label=""
                title="Remove expression"
                icon={<TrashIcon className="w-5 h-5 text-error" />}
              />
            </div>
          ))}
          <div className="flex items-center gap-2">
            <InputText
              placeholder="Enter expression"
              value={newExpr}
              onChange={(e) => setNewExpr(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (newExpr.trim()) {
                    onChange({
                      ...group,
                      expressions: [...group.expressions, newExpr.trim()],
                    });
                    setNewExpr('');
                  }
                }
              }}
            />
            <Button
              onClick={() => {
                if (newExpr.trim()) {
                  onChange({
                    ...group,
                    expressions: [...group.expressions, newExpr.trim()],
                  });
                  setNewExpr('');
                }
              }}
              label="Add"
              title="Add expression to group"
              variant="outlineIconButton"
              icon={<PlusIcon className="w-5 h-5" />}
            />
          </div>
        </div>
      )}
    </div>
  );
}

interface WhereEditorProps {
  value: SchemaModelWhere | undefined;
  onChange: (next: SchemaModelWhere | undefined) => void;
  modelOptions?: { label: string; value: string }[];
  sourceOptions?: { label: string; value: string }[];
  cteOptions?: { label: string; value: string }[];
  ctes?: CteState[];
  manifest?: Record<string, unknown> | null;
  disabled?: boolean;
  disabledMessage?: string;
  /**
   * Optional prefix for the internal radio group `name` attributes. Required
   * when multiple WhereEditor instances are rendered on the same screen
   * (e.g. CTE WHERE + HAVING in the same tab) -- otherwise the radio names
   * collide and clicking a radio in one editor hijacks the selection in the
   * other. When omitted, the bare radio names are used so older single-
   * instance call sites continue to behave identically.
   */
  idPrefix?: string;
}

/**
 * Controlled WHERE editor consumed by both the CTE panel and (eventually)
 * the main-model WhereClauseNode. Accepts the schema-shaped value as a prop
 * and emits schema-shaped values via `onChange` -- callers own persistence.
 *
 * Basic mode renders a single-string editor (the schema accepts a bare
 * string for `where`). Advanced mode renders the full conditions list with
 * support for expressions, groups, and subqueries (forwarded to
 * SubqueryEditor with `cteOptions` so subqueries inside CTE WHERE clauses
 * can reference earlier CTEs).
 */
export const WhereEditor: React.FC<WhereEditorProps> = ({
  value,
  onChange,
  modelOptions = [],
  sourceOptions = [],
  cteOptions = [],
  ctes = [],
  manifest = null,
  disabled = false,
  disabledMessage,
  idPrefix,
}) => {
  // Build a scoped radio `name` so multiple WhereEditors on the same screen
  // don't share state. Bare suffixes are kept when no prefix is provided so
  // existing single-instance call sites keep their original behaviour.
  const radioName = (suffix: string) =>
    idPrefix ? `${idPrefix}-${suffix}` : suffix;
  const [type, setType] = useState<string>(
    typeof value === 'string' || value === undefined ? 'basic' : 'advanced',
  );
  const [basicExpression, setBasicExpression] = useState<string>(
    typeof value === 'string' ? value : '',
  );

  const initial = schemaToConditions(value);
  const [conditionType, setConditionType] = useState<string>(
    initial.conditionType,
  );
  const [conditions, setConditions] = useState<ConditionItem[]>(
    initial.conditions,
  );
  const [addItemType, setAddItemType] = useState<string>(
    conditionItemOptions[0].value,
  );
  const [advancedInput, setAdvancedInput] = useState<string>('');

  // Reset internal state when the value prop swaps out under us (e.g. a
  // different CTE is opened in the panel).
  useEffect(() => {
    if (typeof value === 'string') {
      setType('basic');
      setBasicExpression(value);
    } else if (value) {
      setType('advanced');
      const parsed = schemaToConditions(value);
      setConditionType(parsed.conditionType);
      setConditions(parsed.conditions);
    } else {
      setBasicExpression('');
      setConditions([]);
    }
    // We intentionally re-init on every value identity change.
  }, [value]);

  const emitBasic = (expr: string) => {
    setBasicExpression(expr);
    onChange(expr ? expr : undefined);
  };

  const emitAdvanced = (
    nextConditionType: string,
    nextConditions: ConditionItem[],
  ) => {
    setConditionType(nextConditionType);
    setConditions(nextConditions);
    const schema = conditionsToSchema(nextConditionType, nextConditions);
    onChange(schema ?? undefined);
  };

  if (disabled) {
    return (
      <div className="border border-dashed border-neutral rounded p-3 text-sm text-muted-foreground">
        {disabledMessage ?? 'WHERE editor is disabled.'}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <RadioGroup
        name={radioName('where-type')}
        options={whereTypeOptions}
        value={type}
        onChange={(v) => {
          setType(v);
          // Switching modes drops the other mode's content.
          if (v === 'basic') {
            onChange(basicExpression || undefined);
          } else {
            onChange(
              conditionsToSchema(conditionType, conditions) ?? undefined,
            );
          }
        }}
        className="basis-[12rem]"
      />

      {type === 'basic' && (
        <InputText
          placeholder="Enter WHERE expression (e.g. status = 'active')"
          value={basicExpression}
          onChange={(e) => emitBasic(e.target.value)}
        />
      )}

      {type === 'advanced' && (
        <div className="space-y-2">
          <RadioGroup
            name={radioName('where-condition-type')}
            options={conditionTypeOptions}
            value={conditionType}
            onChange={(v) => emitAdvanced(v, conditions)}
            className="basis-[8rem]"
          />

          <div className="flex flex-col gap-2">
            {conditions.map((c, i) => {
              if (c.type === 'expr') {
                return (
                  <div key={i} className="flex items-center gap-2">
                    <InputText
                      placeholder="Enter expression"
                      value={c.value}
                      onChange={(e) => {
                        const next = [...conditions];
                        next[i] = { type: 'expr', value: e.target.value };
                        emitAdvanced(conditionType, next);
                      }}
                    />
                    <Button
                      onClick={() =>
                        emitAdvanced(
                          conditionType,
                          conditions.filter((_, idx) => idx !== i),
                        )
                      }
                      variant="iconButton"
                      label=""
                      title="Remove"
                      icon={<TrashIcon className="w-5 h-5 text-error" />}
                    />
                  </div>
                );
              }
              if (c.type === 'group') {
                return (
                  <GroupRowEditor
                    key={i}
                    group={c.value}
                    radioName={radioName(`group-condition-type-${i}`)}
                    onChange={(g) => {
                      const next = [...conditions];
                      next[i] = { type: 'group', value: g };
                      emitAdvanced(conditionType, next);
                    }}
                    onRemove={() =>
                      emitAdvanced(
                        conditionType,
                        conditions.filter((_, idx) => idx !== i),
                      )
                    }
                  />
                );
              }
              return (
                <SubqueryEditor
                  key={i}
                  subquery={c.value}
                  onChange={(s) => {
                    const next = [...conditions];
                    next[i] = { type: 'subquery', value: s };
                    emitAdvanced(conditionType, next);
                  }}
                  onRemove={() =>
                    emitAdvanced(
                      conditionType,
                      conditions.filter((_, idx) => idx !== i),
                    )
                  }
                  modelOptions={modelOptions}
                  sourceOptions={sourceOptions}
                  cteOptions={cteOptions}
                  ctes={ctes}
                  manifest={manifest}
                />
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <RadioGroup
              name={radioName('where-add-item-type')}
              options={conditionItemOptions}
              value={addItemType}
              onChange={(v) => setAddItemType(v)}
              className="basis-[14rem]"
            />
            {addItemType === 'expr' && (
              <>
                <InputText
                  placeholder="Enter expression"
                  value={advancedInput}
                  onChange={(e) => setAdvancedInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (advancedInput.trim()) {
                        emitAdvanced(conditionType, [
                          ...conditions,
                          { type: 'expr', value: advancedInput.trim() },
                        ]);
                        setAdvancedInput('');
                      }
                    }
                  }}
                />
                <Button
                  onClick={() => {
                    if (advancedInput.trim()) {
                      emitAdvanced(conditionType, [
                        ...conditions,
                        { type: 'expr', value: advancedInput.trim() },
                      ]);
                      setAdvancedInput('');
                    }
                  }}
                  label="Add"
                  variant="outlineIconButton"
                  icon={<PlusIcon className="w-5 h-5" />}
                />
              </>
            )}
            {addItemType === 'group' && (
              <Button
                onClick={() =>
                  emitAdvanced(conditionType, [
                    ...conditions,
                    {
                      type: 'group',
                      value: { conditionType: 'or', expressions: [] },
                    },
                  ])
                }
                label="Add group"
                variant="outlineIconButton"
                icon={<PlusIcon className="w-5 h-5" />}
              />
            )}
            {addItemType === 'subquery' && (
              <Button
                onClick={() =>
                  emitAdvanced(conditionType, [
                    ...conditions,
                    {
                      type: 'subquery',
                      value: {
                        operator: 'in',
                        column: '',
                        selectCols: '',
                        fromType: 'model',
                        fromValue: '',
                        innerWhere: '',
                      },
                    },
                  ])
                }
                label="Add subquery"
                variant="outlineIconButton"
                icon={<PlusIcon className="w-5 h-5" />}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};
