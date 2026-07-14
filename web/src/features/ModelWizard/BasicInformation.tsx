import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import type { DbtProject } from '@shared/dbt/types';
import { useApp } from '@web/context';
import { ButtonGroup, Spinner } from '@web/elements';
import { FieldInputText, FieldSelectSingle } from '@web/forms';
import { useModelStore } from '@web/stores/useModelStore';
import { deriveSourceFromType } from '@web/utils/formOptions';
import { modelValidationRules } from '@web/utils/formValidation';
import { stateSync } from '@web/utils/stateSync';
import {
  MODEL_FIELD_MAX_LENGTH,
  MODEL_NAME_PATTERN,
  MODEL_TOPIC_GROUP_PATTERN,
  VALIDATION_MESSAGES,
} from '@web/utils/validationPatterns';
import { useState } from 'react';
import type { Control, FieldErrors } from 'react-hook-form';
import { Controller } from 'react-hook-form';

import { FileNamePreview } from './FileNamePreview';
import type { ModelWizardFormValues } from './types';

interface BasicInformationProps {
  control: Control<ModelWizardFormValues>;
  errors: FieldErrors<ModelWizardFormValues>;
  projects: DbtProject[] | null;
  projectOptions: Array<{ label: string; value: string }>;
  sourceOptions: Array<{ label: string; value: string }>;
  typeOptions: Array<{ label: string; value: string }>;
  groupOptions: Array<{ label: string; value: string }>;
  materializedOptions: Array<{ label: string; value: string }>;
  project: DbtProject | null;
  setProject: (project: DbtProject | null) => void;
  source: string;
  isLoading: boolean;
  models: Array<{ label: string; value: string }>;
  setValue: (
    name: keyof ModelWizardFormValues,
    value: string | undefined,
  ) => void;
  mode: 'create' | 'edit';
  onFieldChange?: (field: keyof ModelWizardFormValues, value: string) => void;
}

export function BasicInformation({
  control,
  errors,
  projectOptions,
  sourceOptions,
  typeOptions,
  groupOptions,
  materializedOptions,
  project,
  setProject: _setProject, // Available for updating project state when needed
  source,
  isLoading,
  setValue,
  onFieldChange,
  models,
  mode,
}: BasicInformationProps) {
  const saveField = useModelStore((s) => s.saveField); // Direct access to auto-save
  const loadInitialData = useModelStore((s) => s.loadInitialData);
  const { api } = useApp();

  // State for cloning loader
  const [isLoadingCloningModel, setIsLoadingCloningModel] = useState(false);

  // Ensure ModelStore is updated on every field change so validation using
  // the store (canProceedToNext) sees the latest values.
  const setBasicField = useModelStore((s) => s.setBasicField);
  const updateFromState = useModelStore((s) => s.updateFromState);
  const updateSelectState = useModelStore((s) => s.updateSelectState);
  const clearGroupByState = useModelStore((s) => s.clearGroupByState);

  // Handle field changes with auto-save and parent callback
  const handleFieldChange = async (
    field: keyof ModelWizardFormValues,
    value: string,
  ) => {
    // Call parent callback if provided
    if (onFieldChange) {
      onFieldChange(field, value);
    }

    // Auto-save the field using ModelStore's saveField
    await saveField(field, value);
  };

  // Clear modeling state when source or type changes
  const clearModelingState = () => {
    updateFromState({ model: '', source: '' });
    updateSelectState([]);
    // Clear group by state
    clearGroupByState();
  };

  // Handle cloning a model from the UI
  const handleCloneModel = async (selectedModelName: string) => {
    if (!selectedModelName || !project) return;

    setIsLoadingCloningModel(true);

    try {
      // Fetch the model JSON data using the existing API
      console.log('selectedModelName', selectedModelName);
      const modelJsonContent = await api.post({
        type: 'framework-get-model-data',
        request: {
          modelName: selectedModelName,
        },
      });

      if (!modelJsonContent) {
        console.error('Failed to fetch model data for cloning');
        setIsLoadingCloningModel(false);
        return;
      }

      console.log('modelJsonContent', modelJsonContent);

      // Prepare model data similar to modelClone command
      const modelData: Record<string, unknown> = {
        ...modelJsonContent,
        projectName: project.name,
        // Clear the name so user can provide a new one
        name: '',
        topic: '',
        materialized: undefined,
        // Flag to indicate this is a clone operation
        isCloningModel: true,
        // Store the source model name for display
        sourceModelName: selectedModelName,
      };

      // Derive source from type for UI compatibility
      if (typeof modelData.type === 'string') {
        const derivedSource = deriveSourceFromType(modelData.type);
        if (derivedSource) {
          modelData.source = derivedSource;
        }
      }

      // Ensure all commonly used fields are present
      if (typeof modelData.group === 'string') {
        modelData.group = modelData.group || '';
      }

      // Save to model-create temp file
      await stateSync.saveState('model-create', modelData);

      console.log('modelData', modelData);

      // Load data into ModelStore (this handles all transformations)

      loadInitialData(modelData);

      // Sync form values with loaded data from ModelStore
      setValue('name', ''); // Clear name for cloning
      setValue('topic', ''); // Clear topic for cloning
      if (typeof modelData.group === 'string')
        setValue('group', modelData.group);
      if (typeof modelData.type === 'string') setValue('type', modelData.type);
      if (typeof modelData.source === 'string')
        setValue('source', modelData.source);
      if (typeof modelData.projectName === 'string')
        setValue('projectName', modelData.projectName);

      console.log('Model cloned successfully from UI:', selectedModelName);
    } catch (error) {
      console.error('Error cloning model from UI:', error);
    } finally {
      setIsLoadingCloningModel(false);
    }
  };

  // Show loader while cloning model
  if (isLoadingCloningModel) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
        <Spinner size={48} label="Cloning Model..." />
        <p className="text-gray-600 mt-4 text-center">
          Fetching model data and preparing the form for cloning.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 1. Project */}
      <Controller
        control={control}
        name="projectName"
        rules={{ required: modelValidationRules.projectName.required }}
        render={({ field }) => (
          <div data-tutorial-id="project-select">
            <FieldSelectSingle
              {...field}
              error={errors.projectName}
              label="Select Project"
              options={projectOptions}
              disabled={isLoading}
              tooltipText="Select the project to create the model in."
              onChange={(val) => {
                // Keep react-hook-form, local setValue and ModelStore in sync
                field.onChange(val);
                setValue('projectName', val);
                setBasicField('projectName', val as string);
                void handleFieldChange('projectName', val as string);

                // Close the dropdown after selection by blurring the active element
                setTimeout(() => {
                  const activeElement = document.activeElement as HTMLElement;
                  if (activeElement && activeElement.blur) {
                    activeElement.blur();
                  }
                }, 50);
              }}
            />
          </div>
        )}
      />

      {/* Clone Model: Commenting Clone model in the UI for now */}
      {/* eslint-disable-next-line no-constant-binary-expression -- Feature flag for clone model feature */}
      {false && (
        <div className="flex flex-col gap-2">
          <Controller
            control={control}
            name="cloneModel"
            render={({ field }) => (
              <FieldSelectSingle
                {...field}
                error={errors.cloneModel}
                label="Clone an existing Model (Optional)"
                options={models}
                disabled={isLoading}
                tooltipText="Clone a model's configuration. Name and topic fields will be cleared."
                onChange={(val) => {
                  // Keep react-hook-form in sync
                  field.onChange(val);
                  // Trigger clone functionality
                  if (val && typeof val === 'string') {
                    void handleCloneModel(val);
                  }
                }}
              />
            )}
          />
          <p className="text-xs italic text-foreground flex items-center gap-1">
            <ExclamationTriangleIcon className="h-3 w-3" /> Selecting a model
            will override your current progress with the selected model's
            configuration.
          </p>
        </div>
      )}

      {/* 2. Source - Button group */}
      <Controller
        control={control}
        name="source"
        rules={{ required: modelValidationRules.source.required }}
        render={({ field }) => {
          const sourceLabel = field.value
            ? sourceOptions.find(
                (opt: { label: string; value: string }) =>
                  opt.value === field.value,
              )?.label || ''
            : '';

          return (
            <div data-tutorial-id="source-selection">
              <ButtonGroup
                label="Select your source"
                tooltipText="Select the data layer where your model will be created"
                initialValue={sourceLabel}
                options={sourceOptions.map(
                  (opt: { label: string; value: string }) => opt.label,
                )}
                disabled={mode === 'edit'}
                error={errors.source}
                onSelect={(value) => {
                  const selectedOption = sourceOptions.find(
                    (opt: { label: string; value: string }) =>
                      opt.label === value,
                  );
                  // Update the source field
                  const newVal = selectedOption?.value || '';
                  field.onChange(newVal);
                  setValue('source', newVal);
                  setBasicField('source', newVal);
                  void handleFieldChange('source', newVal);
                  // Reset type when source changes as the available types will change
                  setValue('type', ''); // Reset to empty so user has to select again
                  setBasicField('type', '');
                  // Clear materialized field if switching to marts or staging (where it's hidden)
                  if (newVal === 'marts' || newVal === 'staging') {
                    setValue('materialized', undefined);
                    setBasicField('materialized', '');
                    void handleFieldChange('materialized', '');
                  }
                  // Clear modeling state when source changes
                  clearModelingState();
                }}
              />
            </div>
          );
        }}
      />

      {/* 3. Type - Button group (varies based on source) */}
      {source && typeOptions.length > 0 && (
        <div className="flex flex-col gap-2">
          <Controller
            control={control}
            name="type"
            rules={{ required: modelValidationRules.type.required }}
            render={({ field }) => {
              const typeLabel = field.value
                ? typeOptions.find(
                    (opt: { label: string; value: string }) =>
                      opt.value === field.value,
                  )?.label || ''
                : '';
              return (
                <div data-tutorial-id="type-selection">
                  <ButtonGroup
                    label="Select Model Type"
                    tooltipText="Choose the type of dbt model to create. This determines the model's structure and behavior in your data pipeline."
                    initialValue={typeLabel}
                    options={typeOptions.map(
                      (opt: { label: string; value: string }) => opt.label,
                    )}
                    error={errors.type}
                    disabled={mode === 'edit'}
                    onSelect={(value) => {
                      const selectedOption = typeOptions.find(
                        (opt: { label: string; value: string }) =>
                          opt.label === value,
                      );
                      field.onChange(selectedOption?.value || '');
                      const newType = selectedOption?.value || '';
                      setValue('type', newType);
                      setBasicField('type', newType);
                      void handleFieldChange('type', newType);
                      // Clear modeling state (select and from) when type changes
                      clearModelingState();
                    }}
                  />
                </div>
              );
            }}
          />
          {mode === 'edit' && (
            <p className="text-xs text-red-500 italic">
              You cannot update the type or source in the edit mode.
            </p>
          )}
        </div>
      )}

      {/* 4. Group - Button group */}
      {project && groupOptions.length > 0 && (
        <Controller
          control={control}
          name="group"
          rules={{ required: modelValidationRules.group.required }}
          render={({ field }) => (
            <div data-tutorial-id="group-selection">
              <ButtonGroup
                label="Select Group"
                tooltipText="Organize related models together."
                initialValue={field.value || ''}
                options={groupOptions.map(
                  (opt: { label: string; value: string }) => opt.label,
                )}
                error={errors.group}
                onSelect={(value) => {
                  field.onChange(value);
                  setValue('group', value);
                  setBasicField('group', value);
                  void handleFieldChange('group', value);
                }}
              />
            </div>
          )}
        />
      )}

      {/* 5. Topic */}
      <Controller
        control={control}
        name="topic"
        rules={{
          required: modelValidationRules.topic.required,
          pattern: {
            value: MODEL_TOPIC_GROUP_PATTERN,
            message: VALIDATION_MESSAGES.topic,
          },
          maxLength: {
            value: MODEL_FIELD_MAX_LENGTH,
            message: VALIDATION_MESSAGES.maxLength('Topic'),
          },
        }}
        render={({ field }) => (
          <div data-tutorial-id="topic-input">
            <FieldInputText
              {...field}
              error={errors.topic}
              label="Enter Topic"
              disabled={isLoading}
              tooltipText="Subject area of your model. Use lowercase letters, numbers, and underscores."
              onChange={(evt) => {
                const v =
                  evt &&
                  (evt.target ? (evt.target as HTMLInputElement).value : evt);
                const val = typeof v === 'string' ? v : '';
                field.onChange(val);
                setValue('topic', val);
                setBasicField('topic', val);
                void handleFieldChange('topic', val);
              }}
            />
          </div>
        )}
      />

      {/* 6. Name */}
      <Controller
        control={control}
        name="name"
        rules={{
          required: modelValidationRules.name.required,
          pattern: {
            value: MODEL_NAME_PATTERN,
            message: VALIDATION_MESSAGES.name,
          },
          maxLength: {
            value: MODEL_FIELD_MAX_LENGTH,
            message: VALIDATION_MESSAGES.maxLength('Name'),
          },
        }}
        render={({ field }) => (
          <div data-tutorial-id="model-name-input">
            <FieldInputText
              {...field}
              onChange={(evt) => {
                const v =
                  evt &&
                  (evt.target ? (evt.target as HTMLInputElement).value : evt);
                const val = typeof v === 'string' ? v : '';
                field.onChange(val);
                setValue('name', val);
                setBasicField('name', val);
                void handleFieldChange('name', val);
              }}
              error={errors.name}
              label="Enter Name"
              disabled={isLoading}
              tooltipText="The specific name for your model. Use descriptive, lowercase names with underscores (e.g., 'monthly_revenue_summary')."
            />
          </div>
        )}
      />

      {/* File Name Preview */}
      {source && <FileNamePreview mode={mode} />}

      {/* 7. Materialized - dropdown - Hidden for marts and staging, optional for intermediate sources */}
      {source === 'intermediate' && (
        <Controller
          control={control}
          name="materialized"
          rules={{ required: false }}
          render={({ field }) => (
            <div data-tutorial-id="materialized-select">
              <FieldSelectSingle
                {...field}
                error={errors.materialized}
                label="Select Materialization"
                options={materializedOptions}
                disabled={isLoading}
                tooltipText="Incremental builds only new/changed records. Ephemeral creates a CTE (temporary)."
                onChange={(val) => {
                  field.onChange(val);
                  setValue('materialized', val);
                  setBasicField('materialized', val as string);
                  void handleFieldChange('materialized', val as string);
                }}
              />
            </div>
          )}
        />
      )}
    </div>
  );
}
