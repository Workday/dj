import type { DbtProject } from '@shared/dbt/types';
import type {
  SchemaModelFromJoinModels,
  SchemaModelSubquery,
} from '@shared/schema/types/model.type.int_join_models.schema';
import { useApp } from '@web/context/useApp';
import { useModelStore } from '@web/stores/useModelStore';
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  filterAvailableModels,
  getUsedModelsForJoin,
} from '../../../utils/dataModeling';
import { JoinConditions } from '../components/JoinConditions';
import { JoinHeader } from '../components/JoinHeader';
import { ModelColumns } from '../components/ModelColumns';
import type { JoinConditionRow, SelectionType } from '../types';
import { supportsColumnName, supportsExprOnly } from '../types';
import { extractColumnsFromNode } from '../utils/manifestColumns';
import { buildUpdatedSelections } from '../utils/selectionUtils';
import type { AvailableModel, Column } from './SelectNode';

type JoinWithUUID = SchemaModelFromJoinModels[0] & {
  _uuid?: string;
};

/** Safely extract the model name from a join item (CTE joins have no model). */
const getJoinModel = (
  join: SchemaModelFromJoinModels[0] | null | undefined,
): string | undefined => (join && 'model' in join ? join.model : undefined);

// KNOWN GAP — CTE join targets are legal per `schemas/model.from.join.models.schema.json`
// (the `{ cte, on }` and `{ cte }` variants), but JoinNode is currently
// model-only: `getJoinModel` returns undefined for CTE joins, the
// manifest lookups in `handleModelChange` only resolve dbt models, and the
// column-directive default-value scan only matches `'model' in s`. The
// `sourceKind` plumbing from SelectNode could be threaded through here in
// a follow-up; until then, CTE joins authored via JSON are preserved by
// the sync engine but can't be edited from the canvas. Tracking in the
// CHANGELOG under "Known gaps".

interface JoinNodeData {
  joinId?: string;
}

export const JoinNode: React.FC<NodeProps> = ({ data, id }) => {
  const nodeData = data as unknown as JoinNodeData;
  const { api } = useApp();

  const { modelingState, updateJoinState, updateSelectState } = useModelStore();

  const currentJoin = useMemo(() => {
    if (!Array.isArray(modelingState.join)) return null;
    if (!nodeData.joinId) return null;
    return (
      modelingState.join.find(
        (j) => (j as JoinWithUUID)._uuid === nodeData.joinId,
      ) || null
    );
  }, [modelingState.join, nodeData.joinId]);

  const updateSpecificJoin = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (joinUpdate: Record<string, any>) => {
      const existingJoins = Array.isArray(modelingState.join)
        ? modelingState.join
        : [];

      // Find join by UUID (primary) or model name (fallback)

      const joinIndex = existingJoins.findIndex((join: any) => {
        const joinWithUUID = join as JoinWithUUID;
        return joinWithUUID._uuid === nodeData.joinId;
      });

      const updatedJoins = [...existingJoins];

      if (joinIndex >= 0 && joinIndex < updatedJoins.length) {
        const existingJoin = updatedJoins[joinIndex] as JoinWithUUID;
        const updatedJoin = {
          ...joinUpdate,
          _uuid: existingJoin._uuid,
        } as unknown as SchemaModelFromJoinModels[0];
        updatedJoins[joinIndex] = updatedJoin;
      } else {
        const newJoin = {
          ...joinUpdate,
          _uuid: nodeData.joinId,
        } as unknown as SchemaModelFromJoinModels[0];
        updatedJoins.push(newJoin);
      }
      updateJoinState(updatedJoins as SchemaModelFromJoinModels);
    },
    [modelingState.join, nodeData.joinId, updateJoinState],
  );

  const [selectedModel, setSelectedModel] = useState<AvailableModel | null>(
    () => {
      const model = getJoinModel(currentJoin);
      if (model) {
        return { label: model, value: model };
      }
      return null;
    },
  );

  const [models, setModels] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState<boolean>(false);

  const [error, setError] = useState<string | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [baseColumns, setBaseColumns] = useState<Column[]>([]);
  const [currentProject, setCurrentProject] = useState<DbtProject | null>(null);
  // Store columns from other join models (excluding current join model)
  const [otherJoinModelColumns, setOtherJoinModelColumns] = useState<
    Map<string, Column[]>
  >(new Map());

  const [joinType, setJoinType] = useState<string>(
    currentJoin?.type || 'inner',
  );

  const [overrideAlias, setOverrideAlias] = useState<string>(
    ((currentJoin as Record<string, unknown>)?.override_alias as string) || '',
  );
  const overrideAliasRef = useRef(overrideAlias);
  overrideAliasRef.current = overrideAlias;

  const [isJoinOnDims, setIsJoinOnDims] = useState<boolean>(() => {
    return (
      currentJoin !== null && 'on' in currentJoin && currentJoin.on === 'dims'
    );
  });
  const isJoinOnDimsRef = useRef(isJoinOnDims);
  isJoinOnDimsRef.current = isJoinOnDims;

  const [conditions, setConditions] = useState<JoinConditionRow[]>(() => {
    return [
      {
        id: '1',
        type: 'column',
        baseColumn: '',
        condition: '=',
        joinColumn: '',
      },
    ];
  });

  const initializedJoinUuidRef = useRef<string | null>(null);

  useEffect(() => {
    const joinUuid = nodeData.joinId;
    // CTE-based models use the CTE name as the base for join conditions
    const baseModelName = (modelingState.from.model ||
      modelingState.from.cte) as string;

    // Wait for both currentJoin and baseModelName to be available before prefilling
    if (
      currentJoin &&
      joinUuid &&
      baseModelName &&
      initializedJoinUuidRef.current !== joinUuid
    ) {
      const currentModel = getJoinModel(currentJoin);
      if (currentModel) {
        setSelectedModel({
          label: currentModel,
          value: currentModel,
        });
      }

      // Update join type
      const currentJoinType = currentJoin.type || 'inner';
      setJoinType(currentJoinType);

      setOverrideAlias(
        ((currentJoin as Record<string, unknown>)?.override_alias as string) ||
          '',
      );

      if ('on' in currentJoin && currentJoin.on === 'dims') {
        setIsJoinOnDims(true);
        setConditions([
          {
            id: '1',
            type: 'column',
            baseColumn: '',
            condition: '=',
            joinColumn: '',
          },
        ]);
        initializedJoinUuidRef.current = joinUuid;
        return;
      }

      setIsJoinOnDims(false);

      const onValue = 'on' in currentJoin ? currentJoin.on : undefined;
      if (
        onValue &&
        typeof onValue === 'object' &&
        onValue.and &&
        onValue.and.length > 0
      ) {
        // Use override_alias when available so alias-qualified column
        // references (e.g. old_gen_1.col) are matched to the join side.
        const joinAlias =
          ((currentJoin as Record<string, unknown>)
            ?.override_alias as string) || '';
        const joinModelName = joinAlias || currentModel;

        const updatedConditions = onValue.and.map(
          (condition: (typeof onValue.and)[number], index: number) => {
            // Simple column name string - means same column exists in both tables
            if (typeof condition === 'string') {
              // Add model prefixes for proper matching with dropdown options
              const baseColumn = baseModelName
                ? `${baseModelName}.${condition}`
                : condition;
              const joinColumn = joinModelName
                ? `${joinModelName}.${condition}`
                : condition;

              return {
                id: (index + 1).toString(),
                type: 'column' as const,
                baseColumn,
                condition: '=',
                joinColumn,
              };
            }

            if (
              typeof condition === 'object' &&
              condition !== null &&
              'expr' in condition &&
              typeof (condition as { expr?: string }).expr === 'string'
            ) {
              const expr = (condition as { expr: string }).expr;

              // Trim whitespace from expression
              const trimmedExpr = expr.trim();

              // Pattern to match optional model prefix (with underscores) and column name with IS NULL/IS NOT NULL
              const unaryPattern =
                /^([a-zA-Z_][a-zA-Z0-9_]*\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s+(IS NULL|IS NOT NULL)$/i;
              const unaryMatch = trimmedExpr.match(unaryPattern);

              if (unaryMatch) {
                // Preserve full modelname.column format if present
                const modelPrefix = unaryMatch[1]
                  ? unaryMatch[1].slice(0, -1)
                  : null; // Remove trailing dot
                const columnName = unaryMatch[2];
                const operator = unaryMatch[3].toUpperCase();

                // If no model prefix, default to base model
                const baseColumn = modelPrefix
                  ? `${modelPrefix}.${columnName}`
                  : baseModelName
                    ? `${baseModelName}.${columnName}`
                    : columnName;

                return {
                  id: (index + 1).toString(),
                  type: 'column' as const,
                  baseColumn,
                  condition: operator,
                  joinColumn: '',
                };
              }

              // Helper function to parse a column reference (handles function wrapping like lower())
              const parseColumnRef = (
                str: string,
              ): { model: string | null; column: string } | null => {
                // Remove surrounding whitespace
                const s = str.trim();

                // Check for function wrapper like lower(), upper(), trim()
                const funcMatch = s.match(
                  /^(\w+)\s*\(\s*(?:([a-zA-Z_][a-zA-Z0-9_]*)\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\)$/i,
                );
                if (funcMatch) {
                  return {
                    model: funcMatch[2] || null,
                    column: funcMatch[3],
                  };
                }

                // Check for direct model.column or just column
                const directMatch = s.match(
                  /^(?:([a-zA-Z_][a-zA-Z0-9_]*)\.)?([a-zA-Z_][a-zA-Z0-9_]*)$/,
                );
                if (directMatch) {
                  return {
                    model: directMatch[1] || null,
                    column: directMatch[2],
                  };
                }

                return null;
              };

              // Split expression by operator
              const operatorMatch = trimmedExpr.match(
                /^(.+?)\s*(=|!=|<>|>=|<=|>|<)\s*(.+)$/,
              );

              if (operatorMatch) {
                const leftStr = operatorMatch[1];
                const operator = operatorMatch[2];
                const rightStr = operatorMatch[3];

                const leftParsed = parseColumnRef(leftStr);
                const rightParsed = parseColumnRef(rightStr);

                if (leftParsed && rightParsed) {
                  const leftModelPrefix = leftParsed.model;
                  const leftColumnName = leftParsed.column;
                  const rightModelPrefix = rightParsed.model;
                  const rightColumnName = rightParsed.column;

                  // Build full column references
                  const leftColumn = leftModelPrefix
                    ? `${leftModelPrefix}.${leftColumnName}`
                    : leftColumnName;
                  const rightColumn = rightModelPrefix
                    ? `${rightModelPrefix}.${rightColumnName}`
                    : rightColumnName;

                  let baseColumn: string;
                  let joinColumn: string;

                  // Detect which side belongs to base vs join by comparing
                  // model prefixes.  Check against both the alias and the raw
                  // model name so alias-qualified expressions are recognised.
                  const leftBelongsToJoin =
                    leftModelPrefix === joinModelName ||
                    (!!joinAlias && leftModelPrefix === currentModel);
                  const rightBelongsToJoin =
                    rightModelPrefix === joinModelName ||
                    (!!joinAlias && rightModelPrefix === currentModel);
                  const leftBelongsToBase = leftModelPrefix === baseModelName;
                  const rightBelongsToBase = rightModelPrefix === baseModelName;

                  if (leftBelongsToJoin || rightBelongsToBase) {
                    joinColumn = leftModelPrefix
                      ? `${joinModelName}.${leftColumnName}`
                      : joinModelName
                        ? `${joinModelName}.${leftColumnName}`
                        : leftColumn;
                    baseColumn = rightModelPrefix
                      ? `${baseModelName ? baseModelName : rightModelPrefix}.${rightColumnName}`
                      : baseModelName
                        ? `${baseModelName}.${rightColumnName}`
                        : rightColumn;
                  } else if (leftBelongsToBase || rightBelongsToJoin) {
                    baseColumn = leftModelPrefix
                      ? `${baseModelName ? baseModelName : leftModelPrefix}.${leftColumnName}`
                      : baseModelName
                        ? `${baseModelName}.${leftColumnName}`
                        : leftColumn;
                    joinColumn = rightModelPrefix
                      ? `${joinModelName}.${rightColumnName}`
                      : joinModelName
                        ? `${joinModelName}.${rightColumnName}`
                        : rightColumn;
                  } else {
                    // Prefix detection inconclusive – fall back to left=base,
                    // right=join (most common for inner joins).
                    baseColumn = leftModelPrefix
                      ? leftColumn
                      : baseModelName
                        ? `${baseModelName}.${leftColumnName}`
                        : leftColumn;
                    joinColumn = rightModelPrefix
                      ? rightColumn
                      : joinModelName
                        ? `${joinModelName}.${rightColumnName}`
                        : rightColumn;
                  }

                  return {
                    id: (index + 1).toString(),
                    type: 'column' as const,
                    baseColumn,
                    condition: operator === '<>' ? '!=' : operator,
                    joinColumn,
                  };
                }
              }

              // Could not parse - fall back to expression type
              return {
                id: (index + 1).toString(),
                type: 'expression' as const,
                expression: expr,
              };
            }

            if (
              typeof condition === 'object' &&
              condition !== null &&
              'subquery' in condition
            ) {
              const sq = (condition as { subquery?: SchemaModelSubquery })
                .subquery;
              const fromObj = sq?.from as Record<string, string> | undefined;
              let fromType: 'model' | 'source' | 'cte' = 'model';
              let fromValue = '';
              if (fromObj) {
                if ('model' in fromObj) {
                  fromType = 'model';
                  fromValue = fromObj.model;
                } else if ('source' in fromObj) {
                  fromType = 'source';
                  fromValue = fromObj.source;
                } else if ('cte' in fromObj) {
                  fromType = 'cte';
                  fromValue = fromObj.cte;
                }
              }
              return {
                id: (index + 1).toString(),
                type: 'subquery' as const,
                subqueryOperator: (sq?.operator as string) || 'in',
                subqueryColumn: (sq?.column as string) || '',
                subquerySelect: Array.isArray(sq?.select)
                  ? (sq.select as string[]).join(', ')
                  : '',
                subqueryFromType: fromType,
                subqueryFromValue: fromValue,
                subqueryWhere: typeof sq?.where === 'string' ? sq.where : '',
              };
            }

            // Unknown format - fall back to expression type with stringified condition
            const conditionStr =
              typeof condition === 'object'
                ? JSON.stringify(condition)
                : String(condition);
            return {
              id: (index + 1).toString(),
              type: 'expression' as const,
              expression: conditionStr,
            };
          },
        );
        setConditions(updatedConditions);
      } else {
        setConditions([
          {
            id: '1',
            type: 'column',
            baseColumn: '',
            condition: '=',
            joinColumn: '',
          },
        ]);
      }

      initializedJoinUuidRef.current = joinUuid;
    }
  }, [
    currentJoin,
    nodeData.joinId,
    modelingState.from.model,
    modelingState.from.cte,
  ]);

  const usedModels = useMemo(
    () =>
      getUsedModelsForJoin(
        modelingState,
        currentJoin && 'model' in currentJoin
          ? (currentJoin as JoinWithUUID)
          : undefined,
      ),
    [modelingState, currentJoin],
  );

  const currentJoinModel = getJoinModel(currentJoin);

  const modelOptions = useMemo(() => {
    const currentSelectedModel = selectedModel?.value || currentJoinModel;
    const currentSelections = currentSelectedModel
      ? [currentSelectedModel]
      : [];

    return filterAvailableModels(models, usedModels, currentSelections);
  }, [models, usedModels, selectedModel, currentJoinModel]);

  // join[].cte target picker:
  // The JoinNode's main model picker still only lists manifest-resolved
  // models. Schema-level support for join[].cte exists -- a CTE join entry
  // emits `{ cte: 'name', type: '...', on: ... }` -- but the column
  // resolution + buildJoinUpdate path here writes `model: ...` and reads
  // base/join columns from the manifest. Surfacing CTE targets here would
  // require updating getJoinModel, buildJoinUpdate, and the column
  // fetchers to branch on a `cte` discriminator. Tracked as a follow-up;
  // CTE references inside join.on subqueries already work via
  // `subqueryCteOptions` below.

  const ctes = useModelStore((state) => state.ctes);

  const subqueryModelOptions = useMemo(
    () => models.map((m) => ({ label: m, value: m })),
    [models],
  );

  const subquerySourceOptions = useMemo(
    () => sources.map((s) => ({ label: s, value: s })),
    [sources],
  );

  const subqueryCteOptions = useMemo(
    () => ctes.map((c) => ({ label: c.name, value: c.name })),
    [ctes],
  );

  const joinTypeOptions = useMemo(
    () => [
      { label: 'Inner', value: 'inner' },
      { label: 'Left', value: 'left' },
      { label: 'Right', value: 'right' },
      { label: 'Full Outer', value: 'full_outer' },
      { label: 'Cross', value: 'cross' },
    ],
    [],
  );

  const conditionOptions = useMemo(
    () => [
      { label: '=', value: '=' },
      { label: '!=', value: '!=' },
      { label: '>', value: '>' },
      { label: '<', value: '<' },
      { label: '>=', value: '>=' },
      { label: '<=', value: '<=' },
      { label: 'IS NULL', value: 'IS NULL' },
      { label: 'IS NOT NULL', value: 'IS NOT NULL' },
    ],
    [],
  );

  const isUnaryOperator = useCallback((operator?: string) => {
    return operator === 'IS NULL' || operator === 'IS NOT NULL';
  }, []);

  // Include derived columns from modelingState.select in addition to manifest columns
  const allBaseColumns = useMemo(() => {
    const manifestColumnNames = new Set(baseColumns.map((c) => c.name));
    const derivedColumns: Column[] = [];

    // Add derived/expr-based columns from modelingState.select that aren't already in manifest
    for (const selectItem of modelingState.select) {
      // Handle string column names
      if (typeof selectItem === 'string') {
        if (!manifestColumnNames.has(selectItem)) {
          derivedColumns.push({
            name: selectItem,
            dataType: 'string',
            type: 'dimension',
            description: '',
          });
        }
      } else if (
        'name' in selectItem &&
        !('model' in selectItem) &&
        !('source' in selectItem)
      ) {
        const columnName = selectItem.name;
        if (!manifestColumnNames.has(columnName)) {
          derivedColumns.push({
            name: columnName,
            dataType:
              ('data_type' in selectItem
                ? (selectItem.data_type as string)
                : undefined) || 'string',
            type:
              'type' in selectItem && selectItem.type === 'fct'
                ? 'fact'
                : 'dimension',
            description:
              ('description' in selectItem
                ? (selectItem.description as string)
                : undefined) || '',
          });
        }
      }
    }

    return [...baseColumns, ...derivedColumns];
  }, [baseColumns, modelingState.select]);

  // Build base column options with modelname.column format
  // Includes: base model columns + other join model columns (excluding current join model)
  const baseColumnOptions = useMemo(() => {
    const options: AvailableModel[] = [];
    const baseModelName = (modelingState.from.model ||
      modelingState.from.cte) as string;

    if (baseModelName) {
      allBaseColumns.forEach((column) => {
        options.push({
          label: `${baseModelName}.${column.name}`,
          value: `${baseModelName}.${column.name}`,
        });
      });
    }

    const currentJoinKey = overrideAlias || selectedModel?.value;
    otherJoinModelColumns.forEach((columns, aliasOrModel) => {
      if (aliasOrModel !== currentJoinKey) {
        columns.forEach((column) => {
          options.push({
            label: `${aliasOrModel}.${column.name}`,
            value: `${aliasOrModel}.${column.name}`,
          });
        });
      }
    });

    return options;
  }, [
    allBaseColumns,
    otherJoinModelColumns,
    modelingState.from.model,
    modelingState.from.cte,
    selectedModel,
    overrideAlias,
  ]);

  // Join column options prefixed with override_alias (or model name as fallback)
  const joinColumnOptions = useMemo(() => {
    const prefix = overrideAlias || selectedModel?.value;
    if (!prefix) {
      return columns.map((column) => ({
        label: column.name,
        value: column.name,
      }));
    }
    return columns.map((column) => ({
      label: `${prefix}.${column.name}`,
      value: `${prefix}.${column.name}`,
    }));
  }, [columns, selectedModel, overrideAlias]);

  const subqueryColumnOptions = useMemo(() => {
    const combined = [
      ...baseColumnOptions.map((o) => ({ label: o.label, value: o.value })),
      ...joinColumnOptions.map((o) => ({ label: o.label, value: o.value })),
    ];
    const seen = new Set<string>();
    return combined.filter((o) => {
      if (seen.has(o.value)) return false;
      seen.add(o.value);
      return true;
    });
  }, [baseColumnOptions, joinColumnOptions]);

  // Validate conditions after column options are available
  // Convert column conditions to expression type if their values don't exist in options
  useEffect(() => {
    if (baseColumnOptions.length === 0 && joinColumnOptions.length === 0) {
      // Options not loaded yet
      return;
    }

    const baseColumnValues = new Set(baseColumnOptions.map((opt) => opt.value));
    const joinColumnValues = new Set(joinColumnOptions.map((opt) => opt.value));

    // For left/right joins, UI swaps the columns, so we need to check accordingly
    const shouldSwapColumnOrder = joinType === 'left' || joinType === 'right';

    let needsUpdate = false;
    const updatedConditions = conditions.map((condition) => {
      if (condition.type !== 'column') {
        return condition;
      }

      const isUnary = isUnaryOperator(condition.condition);

      // For unary operators, only check base column
      if (isUnary) {
        // Check if base column exists in base options OR join options (since UI might swap)
        const baseCol = condition.baseColumn || '';
        const baseExists =
          !baseCol ||
          baseColumnValues.has(baseCol) ||
          joinColumnValues.has(baseCol);
        if (baseCol && !baseExists) {
          needsUpdate = true;
          // Convert to expression
          const expr = `${condition.baseColumn} ${condition.condition}`;
          return {
            ...condition,
            type: 'expression' as const,
            expression: expr,
          };
        }
        return condition;
      }

      // For binary operators, check both columns
      // When swapped (left/right join): first dropdown shows joinColumnOptions, second shows baseColumnOptions
      // When not swapped: first dropdown shows baseColumnOptions, second shows joinColumnOptions
      const baseCol = condition.baseColumn || '';
      const joinCol = condition.joinColumn || '';
      let baseExists: boolean;
      let joinExists: boolean;

      if (shouldSwapColumnOrder) {
        // In swapped mode, joinColumn uses joinColumnOptions, baseColumn uses baseColumnOptions
        joinExists = !joinCol || joinColumnValues.has(joinCol);
        baseExists = !baseCol || baseColumnValues.has(baseCol);
      } else {
        // In normal mode, baseColumn uses baseColumnOptions, joinColumn uses joinColumnOptions
        baseExists = !baseCol || baseColumnValues.has(baseCol);
        joinExists = !joinCol || joinColumnValues.has(joinCol);
      }

      // If either column doesn't exist in its respective options, convert to expression
      if (!baseExists || !joinExists) {
        needsUpdate = true;
        // Build expression from the condition
        const leftCol = shouldSwapColumnOrder
          ? condition.joinColumn
          : condition.baseColumn;
        const rightCol = shouldSwapColumnOrder
          ? condition.baseColumn
          : condition.joinColumn;
        const expr =
          `${leftCol || ''} ${condition.condition || '='} ${rightCol || ''}`.trim();
        return {
          ...condition,
          type: 'expression' as const,
          expression: expr,
        };
      }

      return condition;
    });

    if (needsUpdate) {
      setConditions(updatedConditions);
    }
  }, [
    conditions,
    baseColumnOptions,
    joinColumnOptions,
    joinType,
    isUnaryOperator,
  ]);

  const buildAndExpressions = useCallback(
    (conds: JoinConditionRow[], joinTypeVal: string) => {
      if (joinTypeVal === 'cross') return [];
      return conds
        .filter((c) => {
          if (c.type === 'subquery') {
            return Boolean(
              c.subquerySelect?.trim() && c.subqueryFromValue?.trim(),
            );
          }
          if (c.type === 'expression') {
            return Boolean(c.expression?.trim());
          }
          const isUnary = isUnaryOperator(c.condition);
          if (isUnary) {
            return Boolean(c.baseColumn);
          }
          return Boolean(c.baseColumn && c.joinColumn);
        })
        .map((c) => {
          if (c.type === 'subquery') {
            const fromType = c.subqueryFromType || 'model';
            const fromValue = c.subqueryFromValue || '';
            const from: SchemaModelSubquery['from'] =
              fromType === 'model'
                ? { model: fromValue }
                : fromType === 'source'
                  ? { source: fromValue }
                  : { cte: fromValue };
            const subquery: SchemaModelSubquery = {
              operator: (c.subqueryOperator ||
                'in') as SchemaModelSubquery['operator'],
              select: (c.subquerySelect || '')
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean) as [string, ...string[]],
              from,
              ...(c.subqueryColumn ? { column: c.subqueryColumn } : {}),
              ...(c.subqueryWhere?.trim()
                ? { where: c.subqueryWhere.trim() }
                : {}),
            };
            return { subquery };
          }
          if (c.type === 'expression') {
            return { expr: c.expression! };
          }
          const isUnary = isUnaryOperator(c.condition);
          if (isUnary) {
            return { expr: `${c.baseColumn} ${c.condition}` };
          }
          return { expr: `${c.baseColumn} ${c.condition} ${c.joinColumn}` };
        });
    },
    [isUnaryOperator],
  );

  const buildJoinUpdate = useCallback(
    (
      model: string,
      type: string,
      conds: JoinConditionRow[],
      alias: string,
    ): Record<string, unknown> => {
      const base: Record<string, unknown> = {
        model,
        type: type as 'inner' | 'left' | 'right' | 'full' | 'cross',
      };
      if (alias.trim()) {
        base.override_alias = alias.trim();
      }
      if (type !== 'cross') {
        base.on = isJoinOnDimsRef.current
          ? 'dims'
          : { and: buildAndExpressions(conds, type) };
      }
      return base;
    },
    [buildAndExpressions],
  );

  const fetchBaseColumns = useCallback(
    (baseModelName: string) => {
      if (!baseModelName || !currentProject?.manifest?.nodes) {
        setBaseColumns([]);
        return;
      }
      const modelKey = Object.keys(currentProject.manifest.nodes).find(
        (key) => {
          const node = currentProject.manifest.nodes?.[key];
          return key.startsWith('model.') && node?.name === baseModelName;
        },
      );
      if (!modelKey) {
        setBaseColumns([]);
        return;
      }
      const modelNode = currentProject.manifest.nodes[modelKey];
      setBaseColumns(extractColumnsFromNode(modelNode));
    },
    [currentProject],
  );

  // Initialize projects and models once
  useEffect(() => {
    const initializeData = async () => {
      setModelsLoading(true);
      try {
        const projectsResponse = await api.post({
          type: 'dbt-fetch-projects',
          request: null,
        });
        const projects = projectsResponse || [];

        if (projects.length === 0) {
          setCurrentProject(null);
          setModels([]);
          return;
        }

        const project = projects[0];
        setCurrentProject(project);

        if (!project.manifest?.nodes) {
          setModels([]);
          return;
        }

        const modelNames = Object.keys(project.manifest.nodes)
          .filter(
            (key) =>
              key.startsWith('model.') ||
              key.startsWith('seed.') ||
              key.startsWith('source.'),
          )
          .map((key) => project.manifest.nodes[key]?.name)
          .filter((name): name is string => Boolean(name));

        setModels(modelNames);

        if (project.manifest.sources) {
          const sourceNames = Object.keys(project.manifest.sources)
            .filter((key) => key.startsWith('source.'))
            .map((key) => {
              const source = project.manifest.sources[key];
              return source?.source_name && source?.name
                ? `${source.source_name}.${source.name}`
                : null;
            })
            .filter((name): name is string => Boolean(name));
          setSources(sourceNames);
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to fetch data';
        setError(errorMessage);
        setModels([]);
        setCurrentProject(null);
      } finally {
        setModelsLoading(false);
      }
    };

    void initializeData();
  }, [api]);

  useEffect(() => {
    const model = (modelingState.from.model ||
      modelingState.from.cte) as string;
    if (model && currentProject) {
      fetchBaseColumns(model);
    }
  }, [
    modelingState.from.model,
    modelingState.from.cte,
    currentProject,
    fetchBaseColumns,
  ]);

  // Fetch columns from all other join models (excluding current join model)
  useEffect(() => {
    if (
      !currentProject?.manifest?.nodes ||
      !Array.isArray(modelingState.join)
    ) {
      setOtherJoinModelColumns(new Map());
      return;
    }

    const columnsMap = new Map<string, Column[]>();

    modelingState.join.forEach((join) => {
      const joinWithUUID = join as JoinWithUUID;
      // Skip current join model
      if (joinWithUUID._uuid === nodeData.joinId) {
        return;
      }

      const joinModelName = getJoinModel(join);
      if (!joinModelName) return;

      const joinAlias =
        ((join as Record<string, unknown>).override_alias as string) ||
        joinModelName;

      // Find the model in manifest
      const modelKey = Object.keys(currentProject.manifest.nodes).find(
        (key) => {
          const node = currentProject.manifest.nodes?.[key];
          return key.startsWith('model.') && node?.name === joinModelName;
        },
      );

      if (modelKey && currentProject.manifest.nodes[modelKey]) {
        const modelNode = currentProject.manifest.nodes[modelKey];
        const modelColumns = extractColumnsFromNode(modelNode);
        columnsMap.set(joinAlias, modelColumns);
      }
    });

    setOtherJoinModelColumns(columnsMap);
  }, [modelingState.join, currentProject, nodeData.joinId]);

  useEffect(() => {
    if (!selectedModel?.value || !currentProject?.manifest?.nodes) {
      setColumns([]);
      return;
    }

    const modelKey = Object.keys(currentProject.manifest.nodes).find((key) => {
      const node = currentProject.manifest.nodes?.[key];
      return key.startsWith('model.') && node?.name === selectedModel.value;
    });

    if (!modelKey || !currentProject.manifest.nodes[modelKey]) {
      setColumns([]);
      return;
    }

    const modelNode = currentProject.manifest.nodes[modelKey];
    const allColumns: Column[] = [];

    if (modelNode.columns) {
      Object.entries(modelNode.columns).forEach(([columnName, columnData]) => {
        const columnInfo = columnData as {
          data_type?: string;
          description?: string;
          meta?: { type?: string };
        };

        const columnType: 'dimension' | 'fact' =
          columnInfo.meta?.type === 'fct' ? 'fact' : 'dimension';

        allColumns.push({
          name: columnName,
          dataType: columnInfo.data_type || 'string',
          type: columnType,
          description: columnInfo.description,
        });
      });
    }

    setColumns(allColumns);
  }, [selectedModel, currentProject]);

  const columnDefaultValue = useMemo(() => {
    if (selectedModel && currentJoin) {
      const { basicFields, modelingState: currentModelingState } =
        useModelStore.getState();
      const modelType = basicFields.type;

      // For model types that support SchemaColumnName (plain strings),
      // check for individual column names first to keep in individual selection mode
      if (supportsColumnName(modelType)) {
        const modelColumnNames = columns.map((col) => col.name);
        const individualColumns = currentModelingState.select.filter(
          (s) => typeof s === 'string' && modelColumnNames.includes(s),
        ) as string[];

        if (individualColumns.length > 0) {
          return {
            filterType: '' as SelectionType, // Keep in individual mode
            include: individualColumns,
            exclude: undefined,
          };
        }
      }

      // For model types that support SchemaModelSelectExpr only,
      if (supportsExprOnly(modelType)) {
        const modelColumnNames = columns.map((col) => col.name);
        const exprColumns = currentModelingState.select.filter(
          (s) =>
            typeof s !== 'string' &&
            'name' in s &&
            'expr' in s &&
            modelColumnNames.includes(s.name) &&
            s.expr === s.name, // Only simple column references
        ) as { name: string; expr: string }[];

        if (exprColumns.length > 0) {
          return {
            filterType: '' as SelectionType, // Keep in individual mode
            include: exprColumns.map((c) => c.name),
            exclude: undefined,
          };
        }
      }

      // Get model-based selection (all_from_model, dims_from_model, etc.)
      const currentSelection = currentModelingState.select.find((s) => {
        if (typeof s === 'string') return false;
        return 'model' in s && s.model === selectedModel.value;
      });

      if (currentSelection && typeof currentSelection !== 'string') {
        return {
          filterType: currentSelection.type as SelectionType,
          include:
            'include' in currentSelection
              ? currentSelection.include
              : undefined,
          exclude:
            'exclude' in currentSelection
              ? currentSelection.exclude
              : undefined,
        };
      }
    }
    return undefined;
  }, [selectedModel, currentJoin, columns]);

  const handleModelChange = useCallback(
    (option: AvailableModel | null) => {
      setSelectedModel(option);

      if (!option?.value || !currentProject?.manifest?.nodes) {
        setColumns([]);
        return;
      }

      const modelKey = Object.keys(currentProject.manifest.nodes).find(
        (key) => {
          const node = currentProject.manifest.nodes?.[key];
          return key.startsWith('model.') && node?.name === option.value;
        },
      );
      if (!modelKey) {
        setColumns([]);
        return;
      }
      const modelNode = currentProject.manifest.nodes[modelKey];
      setColumns(extractColumnsFromNode(modelNode));

      if (option?.value) {
        const joinUpdate = buildJoinUpdate(
          option.value,
          joinType,
          conditions,
          overrideAliasRef.current,
        );
        updateSpecificJoin(joinUpdate);
      } else {
        const existingJoins = Array.isArray(modelingState.join)
          ? modelingState.join
          : [];

        const updatedJoins = existingJoins.filter((join: any) => {
          const joinWithUUID = join as JoinWithUUID;
          return !(
            joinWithUUID._uuid === nodeData.joinId ||
            join.model === nodeData.joinId
          );
        });
        updateJoinState(
          updatedJoins.length > 0
            ? (updatedJoins as SchemaModelFromJoinModels)
            : null,
        );
      }
    },
    [
      currentProject,
      updateSpecificJoin,
      conditions,
      joinType,
      modelingState.join,
      nodeData.joinId,
      updateJoinState,
      buildJoinUpdate,
    ],
  );

  const syncConditionsToModelStore = useCallback(
    (conditionsToSync: JoinConditionRow[]) => {
      if (selectedModel?.value) {
        updateSpecificJoin(
          buildJoinUpdate(
            selectedModel.value,
            joinType,
            conditionsToSync,
            overrideAliasRef.current,
          ),
        );
      }
    },
    [selectedModel, joinType, updateSpecificJoin, buildJoinUpdate],
  );

  const addCondition = useCallback(
    (conditionType: 'column' | 'expression' | 'subquery') => {
      const newCondition: JoinConditionRow = {
        id: Date.now().toString(),
        type: conditionType,
        ...(conditionType === 'column' && {
          baseColumn: '',
          condition: '=',
          joinColumn: '',
        }),
        ...(conditionType === 'expression' && {
          expression: '',
        }),
        ...(conditionType === 'subquery' && {
          subqueryOperator: 'in',
          subqueryColumn: '',
          subquerySelect: '',
          subqueryFromType: 'model' as const,
          subqueryFromValue: '',
          subqueryWhere: '',
        }),
      };

      setConditions((prev) => {
        const updatedConditions = [...prev, newCondition];

        return updatedConditions;
      });
    },
    [],
  );

  const removeCondition = useCallback((id: string) => {
    setConditions((prev) => {
      const updatedConditions = prev.filter((condition) => condition.id !== id);

      return updatedConditions;
    });
  }, []);

  const updateCondition = useCallback(
    (id: string, updates: Partial<JoinConditionRow>) => {
      setConditions((prev) => {
        const updatedConditions = prev.map((condition) =>
          condition.id === id ? { ...condition, ...updates } : condition,
        );

        return updatedConditions;
      });
    },
    [],
  );

  const prevConditionsRef = useRef<JoinConditionRow[] | null>(null);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced sync to model store to prevent focus loss when typing fast
  useLayoutEffect(() => {
    const hasChanged =
      !prevConditionsRef.current ||
      prevConditionsRef.current.length !== conditions.length ||
      prevConditionsRef.current.some(
        (prevCond, index) =>
          JSON.stringify(prevCond) !== JSON.stringify(conditions[index]),
      );

    if (hasChanged) {
      prevConditionsRef.current = conditions;

      // Clear any pending sync
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }

      // Debounce the sync to model store (300ms delay)
      syncTimeoutRef.current = setTimeout(() => {
        syncConditionsToModelStore(conditions);
      }, 300);
    }

    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [conditions, syncConditionsToModelStore]);

  const handleJoinTypeChange = useCallback(
    (option: AvailableModel | null) => {
      if (option) {
        setJoinType(option.value);

        if (selectedModel?.value) {
          updateSpecificJoin(
            buildJoinUpdate(
              selectedModel.value,
              option.value,
              conditions,
              overrideAliasRef.current,
            ),
          );
        }
      }
    },
    [conditions, selectedModel, updateSpecificJoin, buildJoinUpdate],
  );

  const handleAliasChange = useCallback(
    (value: string) => {
      const oldAlias = overrideAliasRef.current;
      setOverrideAlias(value);

      // Propagate the rename into existing condition values so that
      // column references stay consistent with the new alias.
      if (oldAlias && oldAlias !== value) {
        const newPrefix = value || selectedModel?.value || '';
        const swapPrefix = (
          v: string | undefined,
          from: string,
          to: string,
        ): string => {
          if (!v) return v || '';
          return v.startsWith(`${from}.`)
            ? `${to}.${v.slice(from.length + 1)}`
            : v;
        };

        setConditions((prev) =>
          prev.map((c) => {
            if (c.type === 'column') {
              return {
                ...c,
                baseColumn: swapPrefix(c.baseColumn, oldAlias, newPrefix),
                joinColumn: swapPrefix(c.joinColumn, oldAlias, newPrefix),
              };
            }
            if (c.type === 'expression' && c.expression) {
              return {
                ...c,
                expression: c.expression.replaceAll(
                  `${oldAlias}.`,
                  `${newPrefix}.`,
                ),
              };
            }
            return c;
          }),
        );
      }

      if (selectedModel?.value) {
        updateSpecificJoin(
          buildJoinUpdate(selectedModel.value, joinType, conditions, value),
        );
      }
    },
    [selectedModel, joinType, conditions, updateSpecificJoin, buildJoinUpdate],
  );

  const handleToggleJoinOnDims = useCallback(
    (checked: boolean) => {
      setIsJoinOnDims(checked);
      isJoinOnDimsRef.current = checked;
      if (selectedModel?.value) {
        const base: Record<string, unknown> = {
          model: selectedModel.value,
          type: joinType as 'inner' | 'left' | 'right' | 'full' | 'cross',
        };
        const alias = overrideAliasRef.current;
        if (alias.trim()) {
          base.override_alias = alias.trim();
        }
        if (joinType !== 'cross') {
          base.on = checked
            ? 'dims'
            : { and: buildAndExpressions(conditions, joinType) };
        }
        updateSpecificJoin(base);
      }
    },
    [
      selectedModel,
      joinType,
      conditions,
      updateSpecificJoin,
      buildAndExpressions,
    ],
  );

  const handleDelete = useCallback(() => {
    const existingJoins = Array.isArray(modelingState.join)
      ? modelingState.join
      : [];
    const identifierToDelete = nodeData.joinId;

    const updatedJoins = existingJoins.filter((join: any) => {
      const joinWithUUID = join as JoinWithUUID;
      const shouldKeep = !(
        joinWithUUID._uuid === identifierToDelete ||
        join.model === identifierToDelete
      );
      return shouldKeep;
    });

    updateJoinState(
      updatedJoins.length > 0
        ? (updatedJoins as SchemaModelFromJoinModels)
        : null,
    );
  }, [updateJoinState, modelingState.join, nodeData.joinId]);

  const canDelete = useMemo(() => {
    return (
      modelingState.join &&
      Array.isArray(modelingState.join) &&
      modelingState.join.length > 1
    );
  }, [modelingState.join]);

  const selectedJoinTypeOption = useMemo(
    () => joinTypeOptions.find((opt) => opt.value === joinType) || null,
    [joinTypeOptions, joinType],
  );

  const handleColumnSelectionChange = useCallback(
    (
      selectionType: SelectionType | '',
      selection: { include?: string[]; exclude?: string[] },
      shouldClear?: boolean,
    ) => {
      if (!selectedModel) return;

      const { basicFields, modelingState: ms } = useModelStore.getState();
      const updated = buildUpdatedSelections(ms.select, {
        qualifier: overrideAliasRef.current || selectedModel.value,
        modelColumnNames: new Set(columns.map((c) => c.name)),
        modelType: basicFields.type,
        selectionType,
        selection,
        shouldClear: shouldClear ?? false,
        selectedModelValue: selectedModel.value,
        columns,
      });
      updateSelectState(updated);
    },
    [selectedModel, updateSelectState, columns],
  );

  // Handler for opening Data Explorer with the selected model
  const handleOpenDataExplorer = useCallback(() => {
    if (!selectedModel || !currentProject) return;

    void api.post({
      type: 'data-explorer-open-with-model',
      request: {
        modelName: selectedModel.value,
        projectName: currentProject.name,
      },
    });
  }, [api, selectedModel, currentProject]);

  // Handler for opening Column Lineage with a specific column
  const handleColumnLineageClick = useCallback(
    (columnName: string) => {
      if (!selectedModel || !currentProject?.manifest) return;

      // Find the model in manifest to get file path
      const modelKey = Object.keys(currentProject.manifest.nodes || {}).find(
        (key) => {
          const node = currentProject.manifest.nodes?.[key];
          return (
            (key.startsWith('model.') || key.startsWith('seed.')) &&
            node?.name === selectedModel.value
          );
        },
      );

      if (!modelKey) {
        console.warn('Could not find model in manifest for column lineage');
        return;
      }

      const node = currentProject.manifest.nodes[modelKey];
      const filePath = node?.original_file_path;

      if (!filePath) {
        console.warn('Could not find file path for column lineage');
        return;
      }

      void api.post({
        type: 'framework-column-lineage',
        request: {
          action: 'switch-to-model-column',
          filePath,
          columnName,
          upstreamLevels: 2,
          downstreamLevels: 2,
          skipOpenFile: true, // Don't open file when triggered from UI
        },
      });
    },
    [api, selectedModel, currentProject],
  );

  return (
    <div
      key={nodeData.joinId}
      className={`px-4 py-4 shadow-lg rounded-lg bg-background border-2 border-neutral relative min-w-[576px] max-w-[640px]`}
      onClick={(e) => {
        e.stopPropagation();
      }}
      onWheel={(e) => {
        e.stopPropagation();
      }}
      data-tutorial-id="join-node"
    >
      <JoinHeader
        modelOptions={modelOptions}
        selectedModel={selectedModel}
        modelsLoading={modelsLoading}
        error={error}
        currentJoin={currentJoin}
        onModelChange={handleModelChange}
        joinTypeOptions={joinTypeOptions}
        selectedJoinType={selectedJoinTypeOption}
        onJoinTypeChange={handleJoinTypeChange}
        onOpenDataExplorer={handleOpenDataExplorer}
        overrideAlias={overrideAlias}
        onAliasChange={handleAliasChange}
        canDelete={canDelete ?? false}
        onDelete={handleDelete}
      />

      {joinType !== 'cross' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 12px',
            fontSize: '11px',
            color: 'var(--vscode-descriptionForeground)',
          }}
        >
          <input
            type="checkbox"
            checked={isJoinOnDims}
            onChange={(e) => handleToggleJoinOnDims(e.target.checked)}
            style={{ margin: 0 }}
          />
          <span>Join on all matching dimensions</span>
        </div>
      )}

      {isJoinOnDims ? (
        <div
          style={{
            padding: '8px 12px',
            fontSize: '11px',
            color: 'var(--vscode-descriptionForeground)',
            fontStyle: 'italic',
          }}
        >
          Joins on all dimension columns shared between both models.
        </div>
      ) : (
        <JoinConditions
          joinType={joinType}
          conditions={conditions}
          baseColumnOptions={baseColumnOptions}
          conditionOptions={conditionOptions}
          joinColumnOptions={joinColumnOptions}
          isUnaryOperator={isUnaryOperator}
          onUpdateCondition={updateCondition}
          onRemoveCondition={removeCondition}
          onAddCondition={addCondition}
          subqueryModelOptions={subqueryModelOptions}
          subquerySourceOptions={subquerySourceOptions}
          subqueryCteOptions={subqueryCteOptions}
          subqueryColumnOptions={subqueryColumnOptions}
          manifest={
            (currentProject?.manifest as Record<string, unknown>) ?? null
          }
          ctes={ctes}
        />
      )}

      {selectedModel && (
        <ModelColumns
          columns={columns}
          nodeId={id}
          defaultValue={columnDefaultValue}
          onSelectionChange={handleColumnSelectionChange}
          onColumnLineageClick={handleColumnLineageClick}
        />
      )}

      <Handle
        type="target"
        position={Position.Top}
        id="input"
        style={{
          background: '#757575',
          border: '1px solid #757575',
          width: '8px',
          height: '8px',
        }}
        className="bg-muted"
      />

      <Handle
        type="source"
        position={Position.Bottom}
        id="output"
        style={{
          background: '#757575',
          border: '1px solid #757575',
          width: '8px',
          height: '8px',
        }}
        className="bg-muted"
      />
    </div>
  );
};
