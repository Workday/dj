import { useApp } from '@web/context';
import { Button, SelectSingle } from '@web/elements';
import type { SchemaSelect } from '@web/stores/useModelStore';
import { useModelStore } from '@web/stores/useModelStore';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { SelectionType } from '../types';
import { ModelColumns } from './ModelColumns';

interface FragmentSelectPickerProps {
  onClose: () => void;
}

/**
 * Adds a `{ all|dims|fcts }_from_fragment` entry to the model `select` array.
 */
export const FragmentSelectPicker: React.FC<FragmentSelectPickerProps> = ({
  onClose,
}) => {
  const { api } = useApp();
  const projectName = useModelStore((s) => s.basicFields.projectName);
  const modelingState = useModelStore((s) => s.modelingState);
  const updateSelectState = useModelStore((s) => s.updateSelectState);

  const [fragmentOptions, setFragmentOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const [selectedFragment, setSelectedFragment] = useState<string>('');
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
    return modelingState.select?.find(
      (item) =>
        typeof item !== 'string' &&
        'fragment' in item &&
        item.fragment === selectedFragment,
    );
  }, [modelingState.select, selectedFragment]);

  const defaultValue = useMemo(() => {
    if (!existingEntry || typeof existingEntry === 'string') {
      return { filterType: SelectionType.ALL_FROM_FRAGMENT };
    }
    const type =
      'type' in existingEntry && existingEntry.type
        ? (existingEntry.type as SelectionType)
        : SelectionType.ALL_FROM_FRAGMENT;
    return {
      filterType: type,
      include:
        'include' in existingEntry && existingEntry.include
          ? existingEntry.include
          : undefined,
      exclude:
        'exclude' in existingEntry && existingEntry.exclude
          ? existingEntry.exclude
          : undefined,
    };
  }, [existingEntry]);

  const handleSelectionChange = useCallback(
    (
      selectionType: SelectionType,
      result: { include?: string[]; exclude?: string[] },
      shouldClear?: boolean,
    ) => {
      if (!selectedFragment) return;
      const current = modelingState.select ?? [];
      const without = current.filter(
        (item) =>
          typeof item === 'string' ||
          !('fragment' in item) ||
          item.fragment !== selectedFragment,
      );
      if (shouldClear) {
        updateSelectState(without);
        return;
      }
      const entry = {
        fragment: selectedFragment,
        type: selectionType,
        ...(result.include?.length ? { include: result.include } : {}),
        ...(result.exclude?.length ? { exclude: result.exclude } : {}),
      } as unknown as SchemaSelect;
      updateSelectState([...without, entry]);
    },
    [modelingState.select, selectedFragment, updateSelectState],
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
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleApply} disabled={!selectedFragment}>
          Done
        </Button>
      </div>
    </div>
  );
};
