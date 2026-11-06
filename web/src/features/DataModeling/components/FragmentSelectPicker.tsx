import { useApp } from '@web/context';
import { Button, SelectSingle } from '@web/elements';
import type { SchemaSelect } from '@web/stores/useModelStore';
import { useModelStore } from '@web/stores/useModelStore';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { SelectionType } from '../types';
import { upsertFragmentSelect } from '../utils/fragmentSelection';
import { ModelColumns } from './ModelColumns';

interface FragmentSelectPickerProps {
  onClose: () => void;
  /** Fragment to open with already selected, when editing an existing entry. */
  initialFragment?: string;
  /**
   * Select list to edit and the writer for it. Defaults to the model's
   * `modelingState.select`; CTE editors pass their own `select`.
   */
  select?: unknown[];
  onSelectChange?: (next: unknown[]) => void;
}

/**
 * Adds or edits a `{ all|dims|fcts }_from_fragment` entry in a `select` array.
 * Editing keeps the entry at its position and keeps its `overrides`.
 */
export const FragmentSelectPicker: React.FC<FragmentSelectPickerProps> = ({
  onClose,
  initialFragment,
  select: selectProp,
  onSelectChange,
}) => {
  const { api } = useApp();
  const projectName = useModelStore((s) => s.basicFields.projectName);
  const storeSelect = useModelStore((s) => s.modelingState.select);
  const updateSelectState = useModelStore((s) => s.updateSelectState);
  const select: unknown[] = selectProp ?? storeSelect ?? [];
  const writeSelect = useCallback(
    (next: unknown[]) => {
      if (onSelectChange) {
        onSelectChange(next);
      } else {
        updateSelectState(next as SchemaSelect[]);
      }
    },
    [onSelectChange, updateSelectState],
  );

  const [fragmentOptions, setFragmentOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const [selectedFragment, setSelectedFragment] = useState<string>(
    initialFragment ?? '',
  );
  const [columns, setColumns] = useState<
    {
      name: string;
      dataType: string;
      type: 'dimension' | 'fact';
      description?: string;
    }[]
  >([]);

  useEffect(() => {
    if (!projectName) {
      setFragmentOptions([]);
      return;
    }
    void api
      .post({
        type: 'framework-fragment-list',
        request: { projectName },
      })
      .then((list) => {
        if (!list) {
          setFragmentOptions([]);
          return;
        }
        const selectFragments = list.filter((f) => f.kind === 'select');
        setFragmentOptions(
          selectFragments.map((f) => ({ label: f.name, value: f.name })),
        );
        if (selectFragments.length === 1) {
          setSelectedFragment(selectFragments[0].name);
        }
      });
  }, [api, projectName]);

  useEffect(() => {
    if (!projectName || !selectedFragment) {
      setColumns([]);
      return;
    }
    void api
      .post({
        type: 'framework-fragment-columns',
        request: { projectName, name: selectedFragment },
      })
      .then((resp) => {
        if (!resp?.columns) {
          setColumns([]);
          return;
        }
        setColumns(
          resp.columns.map((c) => ({
            name: c.name,
            dataType: 'string',
            type: c.type === 'fct' ? 'fact' : 'dimension',
          })),
        );
      });
  }, [api, projectName, selectedFragment]);

  const existingEntry = useMemo(() => {
    return select.find(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' &&
        item !== null &&
        'fragment' in item &&
        (item as { fragment?: unknown }).fragment === selectedFragment,
    );
  }, [select, selectedFragment]);

  const defaultValue = useMemo(() => {
    if (!existingEntry) {
      return { filterType: SelectionType.ALL_FROM_FRAGMENT };
    }
    const type = existingEntry.type
      ? (existingEntry.type as SelectionType)
      : SelectionType.ALL_FROM_FRAGMENT;
    return {
      filterType: type,
      include: Array.isArray(existingEntry.include)
        ? (existingEntry.include as string[])
        : undefined,
      exclude: Array.isArray(existingEntry.exclude)
        ? (existingEntry.exclude as string[])
        : undefined,
    };
  }, [existingEntry]);

  const handleSelectionChange = useCallback(
    (
      selectionType: SelectionType,
      result: { include?: string[]; exclude?: string[] },
      shouldClear?: boolean,
    ) => {
      if (!selectedFragment) {
        return;
      }
      writeSelect(
        upsertFragmentSelect(
          select,
          selectedFragment,
          selectionType,
          result,
          shouldClear,
        ),
      );
    },
    [select, selectedFragment, writeSelect],
  );

  const handleApply = () => {
    onClose();
  };

  if (fragmentOptions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No select fragments in this project. Add a `*.fragment.json` with `kind:
        &quot;select&quot;` first.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SelectSingle
        label="Column fragment"
        options={fragmentOptions}
        value={
          fragmentOptions.find((o) => o.value === selectedFragment) ?? null
        }
        onChange={(option) => setSelectedFragment(option?.value ?? '')}
        onBlur={() => {}}
        placeholder="Choose a fragment"
      />
      {selectedFragment && columns.length > 0 && (
        <ModelColumns
          columns={columns}
          sourceKind="fragment"
          nodeId={`fragment-${selectedFragment}`}
          defaultValue={defaultValue}
          onSelectionChange={handleSelectionChange}
        />
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" label="Cancel" onClick={onClose} />
        <Button
          label="Done"
          onClick={handleApply}
          disabled={!selectedFragment}
        />
      </div>
    </div>
  );
};
