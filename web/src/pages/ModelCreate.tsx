import { InformationCircleIcon } from '@heroicons/react/20/solid';
import type { Api } from '@shared/api/types';
import type { DbtProject } from '@shared/dbt/types';
import { makeClassName } from '@web';
import { useApp } from '@web/context';
import { useEnvironment } from '@web/context';
import { Button, DialogBox, Spinner } from '@web/elements';
import { ActionType } from '@web/features/DataModeling/types';
import {
  AdditionalFields,
  BasicInformation,
  DataModeling,
  FinalPreview,
  ModelWizardHeader,
  ModelWizardNavigation,
} from '@web/features/ModelWizard';
import { ModelPreview } from '@web/features/ModelWizard/ModelPreview';
import type { ModelWizardFormValues } from '@web/features/ModelWizard/types';
import type { DemoData, TutorialMode } from '@web/features/Tutorial';
import {
  TutorialSelector,
  useAssistMode,
  useAssistModeEnabled,
  useAssistTutorial,
  useOnDemandGuide,
  usePlayTutorial,
} from '@web/features/Tutorial';
import { Form } from '@web/forms';
import {
  useError,
  useModelFileValidation,
  useMount,
  useStepValidation,
} from '@web/hooks';
import { useModelStore } from '@web/stores/useModelStore';
import { useTutorialStore } from '@web/stores/useTutorialStore';
import { getErrorMessage } from '@web/utils/errorMessages';
import {
  deriveSourceFromType,
  generateGroupOptions,
  generateMaterializedOptions,
  generateProjectOptions,
  generateSourceOptions,
  generateTypeOptions,
} from '@web/utils/formOptions';
import { STEP_VALIDATIONS } from '@web/utils/formValidation';
import { stateSync } from '@web/utils/stateSync';
import {
  checkFormHasData,
  isFirstStep,
  isLastStep,
  transformFormValuesToApi,
  wizardSteps,
} from '@web/utils/wizardHelpers';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';

interface ModelCreateProps {
  mode?: 'create' | 'edit';
}

export function ModelCreate({ mode = 'create' }: ModelCreateProps) {
  const { api } = useApp();
  const { error, handleError, clearError } = useError();

  const isEditMode = mode === 'edit';

  // ModelStore integration (data only)
  const {
    isPreviewEnabled,
    basicFields,
    originalModelPath,
    setBasicField,
    reset: resetStore,
    buildModelJson,
    additionalFields,
    initializeFormContext,
    loadInitialData,
    isInitialized,
    modelingState,
    setModelingState,
    showColumnConfiguration,
    showAddColumnModal,
    editingColumn,
    isActionActive,
    ctes,
  } = useModelStore();

  // Simple local state
  const [currentStep, setCurrentStep] = useState(0);
  const [isLoading] = useState(false);

  // React Hook Form setup
  const {
    control,
    formState: { errors },
    handleSubmit,
    setValue,
    watch,
    trigger,
    getFieldState,
  } = useForm<ModelWizardFormValues>({
    defaultValues: {
      ...basicFields,
      ...additionalFields,
    } as ModelWizardFormValues,
    mode: 'onChange',
    shouldUnregister: false, // Keep validation rules registered when fields unmount
  });

  const [projects, setProjects] = useState<DbtProject[] | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [showValidationErrorDialog, setShowValidationErrorDialog] =
    useState(false);
  const [validationErrorMessages, setValidationErrorMessages] = useState<
    string[]
  >([]);
  const [isProjectsLoading, setIsProjectsLoading] = useState(true);
  const [formType, setFormType] = useState('');
  const [isModelLoading] = useState(false);
  const [isCloningModel, setIsCloningModel] = useState(false);
  const [showTutorialSelector, setShowTutorialSelector] = useState(false);
  const [project, setProject] = useState<DbtProject | null>(null);

  const { vscode } = useEnvironment();

  // Assist Mode hooks
  const { toggleAssist } = useAssistMode();
  const assistModeEnabledFromStore = useAssistModeEnabled();

  // Use step validation hook
  const { validateStep } = useStepValidation(trigger, getFieldState);

  // Use model file validation hook
  const {
    fileExists,
    isReady: fileValidationReady,
    isValidating: isValidatingFile,
  } = useModelFileValidation(mode);

  // Handler to prefill data progressively for Play Tutorial
  const handleDataPrefill = useCallback(
    (data: Partial<DemoData>) => {
      // Basic fields
      if (data.projectName !== undefined) {
        setBasicField('projectName', data.projectName);
        setValue('projectName', data.projectName);
      }
      if (data.name !== undefined) {
        setBasicField('name', data.name);
        setValue('name', data.name);
      }
      if (data.source !== undefined) {
        setBasicField('source', data.source);
        setValue('source', data.source);
      }
      if (data.type !== undefined) {
        setBasicField('type', data.type as any);
        setValue('type', data.type as any);
      }
      if (data.group !== undefined) {
        setBasicField('group', data.group);
        setValue('group', data.group);
      }
      if (data.topic !== undefined) {
        setBasicField('topic', data.topic);
        setValue('topic', data.topic);
      }
      if (data.materialized !== undefined) {
        setBasicField('materialized', data.materialized as any);
        setValue('materialized', data.materialized as any);
      }

      // Modeling state fields
      if (data.from !== undefined) {
        // Handle nested structures in from (lookback, rollup, etc.)
        const fromData = data.from;

        // Update the entire from object
        setModelingState({
          ...modelingState,
          from: data.from,
        });

        // If from contains lookback, also update the separate lookback state
        if (fromData.lookback) {
          useModelStore.getState().updateLookbackState(
            fromData.lookback as {
              days: number;
              exclude_event_date?: boolean;
            },
          );
        }

        // If from contains rollup, also update the separate rollup state
        if (fromData.rollup) {
          const rollupData = fromData.rollup as {
            interval: string;
            dateExpression: string;
          };
          useModelStore.getState().updateRollupState({
            interval: rollupData.interval as any,
            dateExpression: rollupData.dateExpression,
          });
        }
      }
      if (data.join !== undefined) {
        useModelStore.getState().updateJoinState(data.join);
      }
      if (data.select !== undefined) {
        useModelStore.getState().updateSelectState(data.select);
      }
      if (data.rollup !== undefined) {
        useModelStore.getState().updateRollupState(data.rollup);
      }
      if (data.lookback !== undefined) {
        useModelStore.getState().updateLookbackState(data.lookback);
      }
      if (data.union !== undefined) {
        useModelStore.getState().updateUnionState(data.union);
      }
      if (data.lightdash !== undefined) {
        useModelStore.getState().updateLightdashState(data.lightdash);
      }

      // Action fields (where, group_by) - these use separate handlers in the store
      if (data.where !== undefined) {
        useModelStore.getState().setWhereState(data.where);
      }
      if (data.group_by !== undefined) {
        useModelStore.getState().setGroupByState(data.group_by);
      }

      // Additional fields
      const additionalFieldKeys: (keyof typeof data)[] = [
        'description',
        'tags',
        'incremental_strategy',
        'sql_hooks',
        'partitioned_by',
        'exclude_daily_filter',
        'exclude_date_filter',
        'exclude_portal_partition_columns',
        'exclude_portal_source_count',
      ];

      additionalFieldKeys.forEach((key) => {
        if (data[key] !== undefined) {
          setValue(key as any, data[key]);
        }
      });
    },
    [setBasicField, setValue, setModelingState, modelingState],
  );

  // Handler to clear all data for Play Tutorial
  const handleDataClear = useCallback(() => {
    // Don't reset store in edit mode - preserve the loaded model data and mode
    if (isEditMode) {
      return;
    }

    resetStore();
    // Reset form values to undefined instead of empty string
    setValue('projectName', projects?.[0]?.name || '');
    setValue('name', '');
    setValue('source', '');
    setValue('type', undefined as any);
    setValue('group', '');
    setValue('topic', '');
    setValue('materialized', undefined);
  }, [isEditMode, resetStore, setValue, projects]);

  // Play Tutorial hook - demo walkthrough with prefilled data
  const { startPlayTutorial } = usePlayTutorial({
    currentWizardStep: currentStep,
    onWizardStepChange: setCurrentStep,
    onDataPrefill: handleDataPrefill,
    onDataClear: handleDataClear,
    setNavigationNodeType: useModelStore.getState().setNavigationNodeType,
    defaultProjectName: projects?.[0]?.name,
  });

  // Model state for tutorials (passed to assist and on-demand guides)
  const modelState = useMemo(() => {
    // Extract from.model and from.source, treating empty strings as undefined
    const fromModel = (modelingState.from?.model as string) || undefined;
    const fromSource = (modelingState.from?.source as string) || undefined;

    return {
      projectName: basicFields.projectName,
      name: basicFields.name,
      source: basicFields.source,
      type: basicFields.type,
      group: basicFields.group,
      topic: basicFields.topic,
      materialized: basicFields.materialized,
      fromModel,
      fromSource,
      hasJoins:
        !!modelingState.join &&
        Array.isArray(modelingState.join) &&
        modelingState.join.length > 0,
      hasSelect: !!modelingState.select && modelingState.select.length > 0,
      hasUnions:
        !!modelingState.union?.models && modelingState.union.models.length > 0,
      hasColumns: !!modelingState.select && modelingState.select.length > 0,
      // UI state flags for conditional steps
      isAddColumnModalOpen: showAddColumnModal,
      isColumnConfigOpen: !!showColumnConfiguration && !!editingColumn,
      isLightdashActive: isActionActive(ActionType.LIGHTDASH),
      isGroupByActive: isActionActive(ActionType.GROUPBY),
      isWhereActive: isActionActive(ActionType.WHERE),
    };
  }, [
    basicFields,
    modelingState,
    showColumnConfiguration,
    showAddColumnModal,
    editingColumn,
    isActionActive,
  ]);

  // Assist Tutorial hook - context-aware guidance for real data
  // The hook handles auto-start based on isFormReady and assistModeEnabled
  useAssistTutorial({
    currentWizardStep: currentStep,
    onWizardStepChange: setCurrentStep,
    modelState,
  });

  // Self-exploratory on-demand guide hook
  useOnDemandGuide({
    modelState,
  });

  // Handler for Play Tutorial button
  const handlePlayTutorial = useCallback(() => {
    setShowTutorialSelector(true);
  }, []);

  // Handler for Assist Me toggle
  const handleToggleAssistMode = useCallback(() => {
    toggleAssist();
  }, [toggleAssist]);

  // Handler for tutorial mode selection
  const handleSelectTutorial = useCallback(
    (mode: TutorialMode) => {
      setShowTutorialSelector(false);
      startPlayTutorial(mode);
    },
    [startPlayTutorial],
  );

  // Handler for canceling tutorial selection
  const handleCancelTutorialSelector = useCallback(() => {
    setShowTutorialSelector(false);
  }, []);

  const source = basicFields.source;
  const values = basicFields;

  const hasFormData = checkFormHasData(values);

  // Determine if user can proceed to next step
  const canProceed = useMemo(() => {
    if (currentStep === 0 && mode === 'create') {
      // On step 0 (Basic Information) in create mode:
      // - If validation is in progress, disable next button
      // - If file exists, disable next button
      if (isValidatingFile) return false;
      if (fileValidationReady && fileExists) return false;
    }
    return true;
  }, [currentStep, mode, isValidatingFile, fileValidationReady, fileExists]);

  const projectOptions = generateProjectOptions(projects);
  const groupOptions = generateGroupOptions(project);
  const sourceOptions = generateSourceOptions();
  const typeOptions = generateTypeOptions(source);
  const materializedOptions = generateMaterializedOptions();

  const getFormType = useCallback(async () => {
    if (mode === 'edit') {
      try {
        const resp = await api.post({
          type: 'framework-get-current-model-data',
          request: null,
        });
        setFormType(resp?.editFormType || 'framework-model-update');
      } catch {
        setFormType('framework-model-update');
      }
    }
    setFormType('model-create');
  }, [mode]);

  useEffect(() => {
    void getFormType();
  }, [getFormType, mode]);

  // Hide clone banner when model name is filled
  useEffect(() => {
    if (isCloningModel && basicFields.name && basicFields.name.trim() !== '') {
      setIsCloningModel(false);
    }
  }, [isCloningModel, basicFields.name]);

  // Initialize projects on mount
  useMount(() => {
    const initializeModelForm = async () => {
      try {
        setIsProjectsLoading(true);

        // Initialize ModelStore with mode and formType
        const formType = isEditMode ? 'framework-model-update' : 'model-create';
        initializeFormContext(mode, formType);

        // Fetch default incremental strategy from extension settings
        try {
          const prefResult = await api.post({
            type: 'framework-preferences',
            request: { action: 'get', context: 'default-incremental-strategy' },
          });
          if (prefResult.success && typeof prefResult.value === 'string') {
            useModelStore
              .getState()
              .setDefaultIncrementalStrategy(prefResult.value);
          }
        } catch {
          // Non-critical: falls back to DEFAULT_INCREMENTAL_STRATEGY in the store
        }

        // Load projects first
        const _projects = await api.post({
          type: 'dbt-fetch-projects',
          request: null,
        });
        setProjects(_projects);

        console.log(_projects);

        // Set default project
        if (_projects.length > 0) {
          console.log('Default project set:', _projects[0].name);
          setProject(_projects[0] || null);
          setValue('projectName', _projects[0].name);
          setBasicField('projectName', _projects[0].name);
        }

        // Load all data once - SINGLE SOURCE OF TRUTH
        let dataToLoad = null;

        if (isEditMode) {
          // Edit mode: Load from API
          try {
            const response = await api.post({
              type: 'framework-get-current-model-data',
              request: null,
            });

            if (response?.modelData) {
              dataToLoad = response.modelData;
              setFormType(response?.editFormType || 'framework-model-update');
            }
          } catch (apiError) {
            console.error('Failed to load model data from API:', apiError);
          }
        } else {
          // Create mode: Try to load from temp file
          try {
            const tempData = await stateSync.loadState(formType);
            if (tempData) {
              dataToLoad = tempData;
            }
          } catch {
            // No temp file is normal for first-time create
          }
        }

        // Load data into ModelStore if we have any
        if (dataToLoad) {
          // Derive source from type if source is missing (backward compatibility)
          if (!dataToLoad.source && dataToLoad.type) {
            const derivedSource = deriveSourceFromType(dataToLoad.type);
            if (derivedSource) {
              dataToLoad.source = derivedSource;
            }
          }

          // Ensure projectName is set if not in saved data
          if (!dataToLoad.projectName && _projects.length > 0) {
            dataToLoad.projectName = _projects[0].name;
          }

          // Load data into ModelStore (this handles all transformations)
          loadInitialData(dataToLoad);

          if (dataToLoad.isCloningModel) setIsCloningModel(true);

          // Sync specific form values with loaded data from ModelStore
          // Basic fields
          if (dataToLoad.name) setValue('name', dataToLoad.name);
          if (dataToLoad.group) setValue('group', dataToLoad.group);
          if (dataToLoad.topic) setValue('topic', dataToLoad.topic);
          if (dataToLoad.type) setValue('type', dataToLoad.type);
          if (dataToLoad.source) setValue('source', dataToLoad.source);
          if (dataToLoad.materialized)
            setValue('materialized', dataToLoad.materialized);
          if (dataToLoad.projectName) {
            setValue('projectName', dataToLoad.projectName);
          } else if (_projects.length > 0) {
            setValue('projectName', _projects[0].name);
            setBasicField('projectName', _projects[0].name);
          }

          // Additional fields
          if (dataToLoad.description)
            setValue('description', dataToLoad.description);
          if (dataToLoad.tags) setValue('tags', dataToLoad.tags);
          if (dataToLoad.incremental_strategy)
            setValue('incremental_strategy', dataToLoad.incremental_strategy);
          if (dataToLoad.sql_hooks) setValue('sql_hooks', dataToLoad.sql_hooks);
          if (dataToLoad.partitioned_by)
            setValue('partitioned_by', dataToLoad.partitioned_by);
          if (dataToLoad.exclude_daily_filter !== undefined)
            setValue('exclude_daily_filter', dataToLoad.exclude_daily_filter);
          if (dataToLoad.exclude_date_filter !== undefined)
            setValue('exclude_date_filter', dataToLoad.exclude_date_filter);
          if (dataToLoad.exclude_portal_partition_columns !== undefined)
            setValue(
              'exclude_portal_partition_columns',
              dataToLoad.exclude_portal_partition_columns,
            );
          if (dataToLoad.exclude_portal_source_count !== undefined)
            setValue(
              'exclude_portal_source_count',
              dataToLoad.exclude_portal_source_count,
            );

          // Mark as initialized after loading data
          useModelStore.getState().setIsInitialized(true);
        } else {
          // No data to load, ensure default project is set in ModelStore
          if (_projects.length > 0) {
            setValue('projectName', _projects[0].name);
            setBasicField('projectName', _projects[0].name);
          }
          // Mark as initialized
          useModelStore.getState().setIsInitialized(true);
        }
      } catch (err) {
        console.error('[ModelCreate] ERROR DURING INITIALIZATION', err);
        // Mark as initialized even on error to prevent infinite loading
        useModelStore.getState().setIsInitialized(true);
      } finally {
        setIsProjectsLoading(false);
      }
    };

    void initializeModelForm();
  });

  // Signal form ready for tutorial after loading completes
  useEffect(() => {
    if (!isProjectsLoading && isInitialized) {
      // Add delay for DOM to be fully ready with all elements
      const timer = setTimeout(() => {
        useTutorialStore.getState().setFormReady(true);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isProjectsLoading, isInitialized]);

  // Reset form ready state on unmount
  useEffect(() => {
    return () => {
      useTutorialStore.getState().setFormReady(false);
    };
  }, []);

  // Helper function to save state manually when needed
  const saveCurrentState = useCallback(async () => {
    try {
      // Load existing saved data first to preserve any data not in current buildModelJson
      let savedData = null;
      try {
        savedData = await stateSync.loadState(formType);
      } catch {
        // No existing saved data, which is fine for first save
      }

      const modelJson = buildModelJson();
      const apiModel = {
        ...basicFields,
        ...modelJson,
      };
      const transformedState = transformFormValuesToApi(apiModel);

      // Merge existing saved data with current state and step
      const stateWithStep = {
        ...(savedData || {}), // Preserve existing saved data if any
        ...transformedState, // Override with current transformed state
        currentStep,
      };

      await stateSync.saveState(formType, stateWithStep);

      return true;
    } catch (error) {
      console.error('Manual state save failed:', error);
      return false;
    }
  }, [buildModelJson, basicFields, currentStep, formType]);

  const getCurrentStepValidationErrors = useCallback(async () => {
    const errors: string[] = [];

    // Standard field validation
    if (STEP_VALIDATIONS[currentStep as keyof typeof STEP_VALIDATIONS]) {
      const fieldErrors = await validateStep(
        STEP_VALIDATIONS[currentStep as keyof typeof STEP_VALIDATIONS],
      );
      errors.push(...fieldErrors);
    }

    // Additional validation for step 0: check if model file exists (only in create mode)
    if (currentStep === 0 && mode === 'create' && fileValidationReady) {
      if (fileExists) {
        errors.push(
          'Model file already exists. Please choose a different name or topic.',
        );
      }
    }

    return errors;
  }, [currentStep, validateStep, mode, fileExists, fileValidationReady]);

  const handleNext = useCallback(async () => {
    // Validate current step if it has validation config

    const errors = await getCurrentStepValidationErrors();
    if (errors.length > 0) {
      setValidationErrorMessages(errors);
      setShowValidationErrorDialog(true);
      return;
    }

    // Move to next step
    setCurrentStep((prev) => prev + 1);
  }, [getCurrentStepValidationErrors]);

  const onClose = useCallback(() => {
    const panelType = isEditMode ? 'model-edit' : 'model-create';
    try {
      // Directly calling to coder
      vscode?.postMessage({
        type: 'close-panel',
        panelType,
      });
    } catch (err) {
      console.error('Failed to close panel:', err);
    }
  }, [vscode, isEditMode]);

  const handlePrevious = useCallback(() => {
    // Save current state before transitioning
    //await saveCurrentState();

    if (currentStep === 0) {
      // On Basic Information step, close the panel
      void onClose();
    } else if (!isFirstStep(currentStep)) {
      // On other steps, go to previous step
      setCurrentStep((prev) => prev - 1);
    }
  }, [currentStep, onClose]);

  const handleStepClick = useCallback(
    async (stepIndex: number) => {
      // Allow navigation to any step
      const errors = await getCurrentStepValidationErrors();

      if (errors.length > 0) {
        setValidationErrorMessages(errors);
        setShowValidationErrorDialog(true);
        return;
      }

      if (stepIndex >= 0 && stepIndex < wizardSteps.length) {
        setCurrentStep(stepIndex);
      }
    },
    [getCurrentStepValidationErrors],
  );

  const onSubmit = useCallback(
    async (_formData: ModelWizardFormValues) => {
      setShowErrorDialog(false);
      setShowValidationErrorDialog(false);

      // Get values from ModelStore and transform for API
      const modelJson = buildModelJson();
      const apiModel = {
        ...basicFields,
        ...modelJson,
      };

      let resp: string;
      try {
        if (isEditMode) {
          // Edit mode: Call framework-model-update
          const transformedFormValues = transformFormValuesToApi(apiModel);

          if (!originalModelPath) {
            throw new Error('No original model path available for update');
          }

          resp = await api.post({
            type: 'framework-model-update',
            request: {
              originalModelPath: originalModelPath,
              modelJson:
                transformedFormValues as unknown as Api<'framework-model-update'>['request']['modelJson'],
              projectName: basicFields.projectName,
            },
          });
        } else {
          // Create mode: Call framework-model-create
          const transformedValues = transformFormValuesToApi(apiModel);

          resp = await api.post({
            type: 'framework-model-create',
            request:
              transformedValues as Api<'framework-model-create'>['request'],
          });
        }

        // Clear saved state after successful operation
        await stateSync.clearState(formType);

        const successMessage = isEditMode
          ? resp || 'Model updated successfully'
          : resp || 'Model created successfully';

        await api.post({
          type: 'framework-show-message',
          request: {
            message: successMessage,
            type: 'success',
            closePanel: true,
          },
        });
        void onClose();
      } catch (apiError: unknown) {
        setShowErrorDialog(true);
        const errorMessage = isEditMode
          ? 'Error updating model'
          : 'Error creating model';
        handleError(apiError, errorMessage);
      }
    },
    [
      basicFields,
      buildModelJson,
      api,
      isEditMode,
      formType,
      originalModelPath,
      handleError,
      onClose,
    ],
  );

  const discardReset = useCallback(async () => {
    await stateSync.clearState(formType);

    resetStore();
    setCurrentStep(0);
    setShowDiscardConfirm(false);
    void onClose();
  }, [formType, resetStore, onClose]);

  const onDiscard = () => {
    setShowDiscardConfirm(true);
  };

  const onSaveForLater = useCallback(async () => {
    try {
      // Save current state using helper
      await saveCurrentState();

      await api.post({
        type: 'framework-show-message',
        request: { message: 'Draft saved successfully', type: 'success' },
      } as any);

      void onClose();
    } catch {
      try {
        await api.post({
          type: 'framework-show-message',
          request: { message: 'Error saving draft', type: 'error' },
        } as any);
      } catch (msgErr) {
        console.error('Failed to show error message:', msgErr);
      }
    }
  }, [api, saveCurrentState, onClose]);

  const handleErrorRetry = useCallback(() => {
    setShowErrorDialog(false);
    clearError();
  }, [clearError]);

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <BasicInformation
            mode={mode}
            control={control}
            errors={errors}
            projects={projects}
            projectOptions={projectOptions}
            project={project}
            setProject={setProject}
            models={[]}
            groupOptions={groupOptions}
            sourceOptions={sourceOptions}
            typeOptions={typeOptions}
            materializedOptions={materializedOptions}
            isLoading={isProjectsLoading}
            setValue={(name, value) => {
              setValue(name, value);
              // Update ModelStore
              setBasicField(name as keyof typeof basicFields, value as string);
            }}
            source={source || ''}
          />
        );
      case 1:
        return (
          <DataModeling
            config={{
              modelType: basicFields.type || '',
            }}
            mode={mode}
          />
        );
      case 2:
        return (
          <AdditionalFields
            control={control}
            errors={errors}
            setValue={setValue}
            watch={watch}
            mode={mode}
          />
        );
      case 3:
        return <FinalPreview />;
      default:
        return null;
    }
  };

  if (isLoading || isProjectsLoading || isModelLoading) {
    const loadingLabel = isModelLoading
      ? 'Loading Model Data...'
      : isProjectsLoading
        ? 'Loading Your Model Form...'
        : !isInitialized
          ? 'Initializing Model Store...'
          : 'Loading form...';

    const loadingDescription = isModelLoading
      ? 'Fetching current model information for editing.'
      : isProjectsLoading
        ? 'Fetching your dbt projects and required configurations.'
        : !isInitialized
          ? 'Loading your model data into the application state.'
          : 'Preparing the model creation form with your saved data.';

    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
        <Spinner size={48} label={loadingLabel} />
        <p className="text-gray-600 mt-4 text-center">{loadingDescription}</p>
      </div>
    );
  }

  if ((isEditMode || isCloningModel) && ctes.length > 0) {
    const handleCteClose = () => {
      if (!isEditMode) {
        void stateSync.clearState('model-create');
        resetStore();
      }
      onClose();
    };
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center">
        <div className="rounded-lg border border-surface bg-card p-8 max-w-lg">
          <InformationCircleIcon className="h-12 w-12 text-primary mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-2">
            Visual editing is not yet supported for CTE models
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            This model contains Common Table Expressions (CTEs). Visual editor
            support for CTEs is coming in a future release. In the meantime,
            please edit the{' '}
            <code className="font-mono bg-surface px-1 rounded text-foreground">
              .model.json
            </code>{' '}
            file directly.
          </p>
          <Button label="Close" variant="neutral" onClick={handleCteClose} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <ModelWizardHeader
        title={isEditMode ? 'Edit Model' : 'Create Model'}
        onDiscard={onDiscard}
        onSaveForLater={() => {
          void onSaveForLater();
        }}
        onStartTutorial={!isEditMode ? handlePlayTutorial : undefined}
        onToggleAssistMode={handleToggleAssistMode}
        assistModeEnabled={assistModeEnabledFromStore}
        hasFormData={hasFormData}
        isLoading={isProjectsLoading}
        showPreviewToggle={currentStep !== 3}
      />

      <ModelWizardNavigation
        steps={wizardSteps}
        currentStep={currentStep}
        completedSteps={[]}
        onPrevious={() => {
          void handlePrevious();
        }}
        onNext={() => {
          void handleNext();
        }}
        onSubmit={() => void handleSubmit(onSubmit)()}
        isFirstStep={isFirstStep(currentStep)}
        isLastStep={isLastStep(currentStep)}
        canProceed={canProceed}
        submitLabel={isEditMode ? 'Update Model' : 'Create Model'}
        onStepClick={(step) => {
          void handleStepClick(step);
        }}
      />

      {/* Clone Info Banner - Only show on step 0 (Basic Information) */}
      {isCloningModel && currentStep === 0 && (
        <div className="mx-4 mt-2 mb-0 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <InformationCircleIcon className="h-5 w-5 text-blue-700" />
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-blue-800">
                Cloning Model
              </h3>
              <div className="mt-2 text-sm text-blue-700">
                <p>
                  Please enter a unique <strong>Model Name</strong> to continue
                  and see the real-time preview; all other fields are
                  pre-populated from the source model.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Form Content */}
      <main
        className={makeClassName(
          'model-container p-4 grid grid-cols-1 grid-rows-2 md:grid-rows-1 md:grid-cols-3 gap-4',
        )}
        data-tutorial-id="wizard-container"
      >
        <section
          className={makeClassName(
            'p-4 bg-card rounded-lg col-span-full md:max-h-full overflow-y-scroll',
            isPreviewEnabled && currentStep !== 3 && 'md:col-span-2',
          )}
          data-tutorial-id={
            currentStep === 2 ? 'additional-fields-container' : undefined
          }
        >
          <Form<ModelWizardFormValues>
            handleSubmit={handleSubmit}
            hideSubmit
            onSubmit={onSubmit}
          >
            {renderCurrentStep()}
          </Form>
        </section>
        {isPreviewEnabled && currentStep !== 3 && (
          <section className="p-4 bg-card rounded-lg col-span-1 md:max-h-full">
            {/* TODO: Show File name same as which is generated in json  */}
            <ModelPreview />
          </section>
        )}
      </main>

      {/* Error Dialog */}
      {(() => {
        const errorData = getErrorMessage({
          type: isEditMode ? 'api_update' : 'api_create',
          mode,
          apiError: error,
          technicalDetails:
            error?.details && Array.isArray(error.details)
              ? error.details
              : error?.message
                ? [error.message]
                : [],
        });
        return (
          <DialogBox
            title={errorData.title}
            open={showErrorDialog}
            description={errorData.message}
            list={errorData.technicalDetails}
            confirmCTALabel="Try Again"
            onConfirm={handleErrorRetry}
            showDetails={true}
            detailsLabel="View technical details"
            variant="error"
          />
        );
      })()}

      {/* Validation Error Dialog */}
      {(() => {
        const errorData = getErrorMessage({
          type: 'validation',
          mode,
          technicalDetails: validationErrorMessages,
        });
        return (
          <DialogBox
            title={errorData.title}
            open={showValidationErrorDialog}
            description={errorData.message}
            list={errorData.technicalDetails}
            confirmCTALabel="Okay, Got it"
            onConfirm={() => setShowValidationErrorDialog(false)}
            showDetails={true}
            detailsLabel="View detailed errors"
            variant="error"
          />
        );
      })()}

      <DialogBox
        title="Confirm Discard"
        open={showDiscardConfirm}
        description="Are you sure you want to discard this model?"
        confirmCTALabel="Discard"
        discardCTALabel="Cancel"
        onConfirm={() => {
          void discardReset();
        }}
        onDiscard={() => setShowDiscardConfirm(false)}
      />

      {/* Tutorial Selector Modal */}
      {showTutorialSelector && (
        <TutorialSelector
          onSelectTutorial={handleSelectTutorial}
          onCancel={handleCancelTutorialSelector}
        />
      )}
    </div>
  );
}
