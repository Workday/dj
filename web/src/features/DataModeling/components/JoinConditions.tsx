import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Button, Tooltip } from '@web/elements';
import { SelectSingle } from '@web/elements/SelectSingle';
import type { CteState } from '@web/stores/useModelStore';
import React from 'react';

import type { AvailableModel } from '../nodes/SelectNode';
import type { JoinConditionRow } from '../types';
import type { SubqueryCondition } from './SubqueryEditor';
import { SubqueryEditor } from './SubqueryEditor';

const getModelName = (label: string): string => {
  const dotIndex = label.indexOf('.');
  return dotIndex > 0 ? label.substring(0, dotIndex) : '';
};

const getColumnName = (label: string): string => {
  const dotIndex = label.indexOf('.');
  return dotIndex > 0 ? label.substring(dotIndex + 1) : label;
};

const renderColumnOption = (
  option: { label: string; value: string },
  state: { focus: boolean; selected: boolean },
): React.ReactNode => {
  const modelName = getModelName(option.label);
  const columnName = getColumnName(option.label);

  return (
    <div
      className={`flex flex-col min-w-0 pr-2 ${state.selected ? 'font-semibold' : ''}`}
    >
      {modelName && (
        <span
          className={`text-[0.7em] truncate ${
            state.focus
              ? 'text-primary-contrast/70'
              : 'text-gray-400 dark:text-gray-500'
          }`}
          title={modelName}
        >
          {modelName}
        </span>
      )}
      <span className="text-[0.85em] truncate" title={columnName}>
        {columnName}
      </span>
    </div>
  );
};

const getOptionGroup = (option: { label: string; value: string }): string => {
  return getModelName(option.label);
};

function joinRowToSubqueryCondition(row: JoinConditionRow): SubqueryCondition {
  return {
    operator: (row.subqueryOperator || 'in') as SubqueryCondition['operator'],
    column: row.subqueryColumn || '',
    selectCols: row.subquerySelect || '',
    fromType: row.subqueryFromType || 'model',
    fromValue: row.subqueryFromValue || '',
    innerWhere: row.subqueryWhere || '',
  };
}

type DropdownOption = { label: string; value: string };

interface JoinConditionsProps {
  joinType: string;
  conditions: JoinConditionRow[];
  baseColumnOptions: AvailableModel[];
  conditionOptions: AvailableModel[];
  joinColumnOptions: AvailableModel[];
  isUnaryOperator: (operator?: string) => boolean;
  onUpdateCondition: (id: string, updates: Partial<JoinConditionRow>) => void;
  onRemoveCondition: (id: string) => void;
  onAddCondition: (type: 'column' | 'expression' | 'subquery') => void;
  subqueryModelOptions?: DropdownOption[];
  subquerySourceOptions?: DropdownOption[];
  subqueryCteOptions?: DropdownOption[];
  subqueryColumnOptions?: DropdownOption[];
  manifest?: Record<string, unknown> | null;
  ctes?: CteState[];
}

export const JoinConditions: React.FC<JoinConditionsProps> = ({
  joinType,
  conditions,
  baseColumnOptions,
  conditionOptions,
  joinColumnOptions,
  isUnaryOperator,
  onUpdateCondition,
  onRemoveCondition,
  onAddCondition,
  subqueryModelOptions = [],
  subquerySourceOptions = [],
  subqueryCteOptions = [],
  subqueryColumnOptions = [],
  manifest = null,
  ctes = [],
}) => {
  const shouldSwapColumnOrder = joinType === 'left' || joinType === 'right';

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-medium text-surface-contrast">
          Join Operations
        </span>
        <Tooltip
          content="Define how tables are matched. Use column conditions for simple field matching, expression conditions for complex logic, or subquery conditions for nested queries."
          variant="outline"
        />
      </div>

      {joinType === 'cross' ? (
        <div className="border border-surface rounded-lg p-4 bg-card">
          <div className="text-sm text-surface-contrast">
            Cross joins don't require conditions - all rows from both tables
            will be combined.
          </div>
        </div>
      ) : (
        <div
          className="border border-surface rounded-lg p-4 bg-card"
          data-tutorial-id="join-conditions"
        >
          <div className="grid grid-cols-12 gap-6 mb-3 text-sm font-medium text-surface-contrast">
            <div className="col-span-4">
              {shouldSwapColumnOrder ? 'Join Column' : 'Base Column'}
            </div>
            <div className="col-span-3">Condition</div>
            <div className="col-span-4">
              {shouldSwapColumnOrder ? 'Base Column' : 'Join Column'}
            </div>
          </div>

          {conditions.map((condition, index: number) => (
            <div
              key={condition.id}
              className="grid grid-cols-12 gap-6 mb-2 items-center"
            >
              {condition.type === 'subquery' ? (
                <div className="col-span-12">
                  <SubqueryEditor
                    subquery={joinRowToSubqueryCondition(condition)}
                    onChange={(s) =>
                      onUpdateCondition(condition.id, {
                        subqueryOperator: s.operator,
                        subqueryColumn: s.column,
                        subquerySelect: s.selectCols,
                        subqueryFromType: s.fromType,
                        subqueryFromValue: s.fromValue,
                        subqueryWhere: s.innerWhere,
                      })
                    }
                    onRemove={() => onRemoveCondition(condition.id)}
                    modelOptions={subqueryModelOptions}
                    sourceOptions={subquerySourceOptions}
                    cteOptions={subqueryCteOptions}
                    columnOptions={subqueryColumnOptions}
                    manifest={manifest}
                    ctes={ctes}
                  />
                </div>
              ) : condition.type === 'expression' ? (
                <>
                  <div className="col-span-11">
                    <input
                      type="text"
                      value={condition.expression || ''}
                      onChange={(e) =>
                        onUpdateCondition(condition.id, {
                          expression: e.target.value,
                        })
                      }
                      placeholder="Enter custom expression (e.g., {{ macro_name() }} or UPPER(col1) = LOWER(col2))"
                      className="w-full px-3 py-2 text-xs rounded bg-transparent border border-surface focus:ring-2 focus:ring-primary focus:border-transparent"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onFocus={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="col-span-1 flex justify-center">
                    {index > 0 && (
                      <Button
                        onClick={() => onRemoveCondition(condition.id)}
                        className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                        title="Remove condition"
                        variant="iconButton"
                        label=""
                        icon={<XMarkIcon className="w-4 h-4" />}
                      ></Button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {(() => {
                    const isUnary = isUnaryOperator(condition.condition);

                    const firstColumnDropdown = (
                      <div
                        className={isUnary ? 'col-span-7' : 'col-span-4'}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <SelectSingle
                          label=""
                          options={
                            shouldSwapColumnOrder
                              ? joinColumnOptions
                              : baseColumnOptions
                          }
                          value={
                            shouldSwapColumnOrder
                              ? joinColumnOptions.find(
                                  (opt) => opt.value === condition.joinColumn,
                                ) || null
                              : baseColumnOptions.find(
                                  (opt) => opt.value === condition.baseColumn,
                                ) || null
                          }
                          onChange={(option) =>
                            onUpdateCondition(condition.id, {
                              [shouldSwapColumnOrder
                                ? 'joinColumn'
                                : 'baseColumn']: option?.value || '',
                            })
                          }
                          placeholder={
                            shouldSwapColumnOrder
                              ? 'Select join column'
                              : 'Select base column'
                          }
                          onBlur={() => {}}
                          className="w-full text-xs h-8 rounded bg-transparent"
                          selectedDisplayValue={(opt) => {
                            if (!opt?.label) {
                              return '';
                            }
                            return getColumnName(opt.label);
                          }}
                          title={
                            shouldSwapColumnOrder
                              ? condition.joinColumn || undefined
                              : condition.baseColumn || undefined
                          }
                          renderOptionLabel={renderColumnOption}
                          getOptionGroup={getOptionGroup}
                        />
                      </div>
                    );

                    const secondColumnDropdown = !isUnary && (
                      <div
                        className="col-span-4"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <SelectSingle
                          label=""
                          options={
                            shouldSwapColumnOrder
                              ? baseColumnOptions
                              : joinColumnOptions
                          }
                          value={
                            shouldSwapColumnOrder
                              ? baseColumnOptions.find(
                                  (opt) => opt.value === condition.baseColumn,
                                ) || null
                              : joinColumnOptions.find(
                                  (opt) => opt.value === condition.joinColumn,
                                ) || null
                          }
                          onChange={(option) =>
                            onUpdateCondition(condition.id, {
                              [shouldSwapColumnOrder
                                ? 'baseColumn'
                                : 'joinColumn']: option?.value || '',
                            })
                          }
                          placeholder={
                            shouldSwapColumnOrder
                              ? 'Select base column'
                              : 'Select join column'
                          }
                          onBlur={() => {}}
                          className="w-full text-xs h-8 rounded bg-transparent"
                          selectedDisplayValue={(opt) => {
                            if (!opt?.label) {
                              return '';
                            }
                            return getColumnName(opt.label);
                          }}
                          title={
                            shouldSwapColumnOrder
                              ? condition.baseColumn || undefined
                              : condition.joinColumn || undefined
                          }
                          renderOptionLabel={renderColumnOption}
                          getOptionGroup={getOptionGroup}
                        />
                      </div>
                    );

                    return (
                      <>
                        {firstColumnDropdown}

                        <div
                          className={isUnary ? 'col-span-4' : 'col-span-3'}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <SelectSingle
                            label=""
                            options={conditionOptions}
                            value={
                              conditionOptions.find(
                                (opt) => opt.value === condition.condition,
                              ) || null
                            }
                            onChange={(option) =>
                              onUpdateCondition(condition.id, {
                                condition: option?.value || '=',
                              })
                            }
                            placeholder="="
                            onBlur={() => {}}
                            className="w-full text-xs h-8 rounded bg-transparent"
                          />
                        </div>

                        {secondColumnDropdown}
                      </>
                    );
                  })()}
                  <div className="col-span-1 flex justify-center">
                    {index > 0 && (
                      <Button
                        onClick={() => onRemoveCondition(condition.id)}
                        className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                        title="Remove condition"
                        variant="iconButton"
                        label=""
                        icon={<XMarkIcon className="w-4 h-4" />}
                      ></Button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}

          <div
            className="flex gap-2 mt-4 justify-between"
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <Button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onAddCondition('column');
              }}
              variant="outlineIconButton"
              label="Column"
              icon={<PlusIcon className="w-4 h-4" />}
              className="w-full flex items-center justify-center gap-1 px-3 py-2 bg-primary text-white text-xs rounded hover:bg-blue-600 transition-colors"
              data-tutorial-id="add-join-condition-button"
            ></Button>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onAddCondition('expression');
              }}
              variant="outlineIconButton"
              label="Expression"
              icon={<PlusIcon className="w-4 h-4" />}
              className="w-full flex items-center justify-center gap-1 px-3 py-2 bg-primary text-white text-xs rounded hover:bg-blue-600 transition-colors"
            ></Button>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onAddCondition('subquery');
              }}
              variant="outlineIconButton"
              label="Subquery"
              icon={<PlusIcon className="w-4 h-4" />}
              className="w-full flex items-center justify-center gap-1 px-3 py-2 bg-primary text-white text-xs rounded hover:bg-blue-600 transition-colors"
            ></Button>
          </div>
        </div>
      )}
    </div>
  );
};
