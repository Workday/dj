import {
  BookmarkSquareIcon,
  QuestionMarkCircleIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type { Api } from '@shared/api/types';
import type { DbtProject } from '@shared/dbt/types';
import type { PythonModelGroup } from '@shared/framework/types';
import { EXTERNAL_LINKS } from '@shared/web/constants';
import { useApp } from '@web/context/useApp';
import { useEnvironment } from '@web/context/useEnvironment';
import {
  Alert,
  Button,
  DialogBox,
  Spinner,
  Switch,
  TagInput,
} from '@web/elements';
import {
  Controller,
  FieldInputText,
  FieldSelectSingle,
  Form,
} from '@web/forms';
import { useError, useMount } from '@web/hooks';
import _ from 'lodash';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { usePersistedForm } from '../hooks/usePersistedForm';
import { stateSync } from '../utils/stateSync';

type Values = Api<'framework-python-model-create'>['request'];

const DEFAULT_GROUPS: string[] = ['ml', 'etl', 'analytics', 'others'];

const PREDEFINED_TAGS = [
  'python-model',
  'api',
  'csv',
  's3',
  'trino',
  'snapshot',
  'iceberg',
];

export function PythonModelCreate() {
  const { api } = useApp();
  const { handleError, clearError } = useError();
  const { vscode } = useEnvironment();

  const {
    control,
    formState: { errors },
    handleSubmit,
    setValue,
    watch,
    reset,
    isLoading,
  } = usePersistedForm<Values>({
    formType: 'python-model-create',
    autoSave: true,
    debounceMs: 500,
  });

  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [projects, setProjects] = useState<DbtProject[] | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isProjectsLoading, setIsProjectsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [availableDags, setAvailableDags] = useState<string[]>([]);
  const [groupOptions, setGroupOptions] = useState<
    { label: string; value: PythonModelGroup }[]
  >(DEFAULT_GROUPS.map((g) => ({ label: g.charAt(0).toUpperCase() + g.slice(1), value: g })));

  const projectName = watch('projectName');
  const name = watch('name');
  const group = watch('group');
  const topic = watch('topic');
  const dags = watch('dags');
  const tags = watch('tags');

  const hasFormData = useMemo(() => {
    return !!(
      projectName ||
      name ||
      group ||
      topic ||
      (dags && dags.length > 0) ||
      (tags && tags.length > 0)
    );
  }, [projectName, name, group, topic, dags, tags]);

  const projectOptions = useMemo(
    () =>
      _.map(projects, (p) => {
        const value = p.name;
        return { label: value, value };
      }),
    [projects],
  );

  const disableSubmit = useMemo(() => {
    return (
      !projectName || !name || !group || !topic || !dags || dags.length === 0
    );
  }, [projectName, name, group, topic, dags]);

  const onClose = useCallback(async () => {
    try {
      await api.post({
        type: 'framework-close-panel',
        request: { panelType: 'python-model-create' },
      });
    } catch (err) {
      console.error('Error closing panel:', err);
    }
  }, [api]);

  const onSubmit = useCallback(
    async (values: Values) => {
      try {
        setIsSubmitting(true);
        setShowErrorDialog(false);
        setErrorMessage('');
        const resp = await api.post({
          type: 'framework-python-model-create',
          request: values,
        });
        setSuccess(resp);
        void onClose();
      } catch (err) {
        let message =
          'We encountered an issue while creating the Python Model. Please check your inputs and try again.';

        if (err instanceof Error) {
          message = err.message;
        } else if (typeof err === 'string') {
          message = err;
        } else if (err && typeof err === 'object' && 'message' in err) {
          message = String(err.message);
        }

        setErrorMessage(message);
        setShowErrorDialog(true);
        handleError(err, 'Error creating Python Model');
      } finally {
        setIsSubmitting(false);
      }
    },
    [api, handleError, onClose],
  );

  useMount(() => {
    const fetchProjects = async () => {
      try {
        setIsProjectsLoading(true);
        const _projects = await api.post({
          type: 'dbt-fetch-projects',
          request: null,
        });
        if (_projects.length === 1) {
          setValue('projectName', _projects[0].name);
        }
        setValue('model_type', 'python');
        setValue('description', '');
        setValue('namespace', '');
        setValue('table_name', '');
        setProjects(_projects);
      } catch (err) {
        console.error('ERROR FETCHING PROJECTS', err);
      } finally {
        setIsProjectsLoading(false);
      }
    };
    void fetchProjects();

    const fetchGroups = async () => {
      try {
        const response = await api.post({
          type: 'framework-get-python-model-groups',
          request: null,
        });
        if (response.groups.length > 0) {
          setGroupOptions(
            response.groups.map((g) => ({
              label: g.charAt(0).toUpperCase() + g.slice(1),
              value: g,
            })),
          );
        }
      } catch {
        // Fall back to defaults
      }
    };
    void fetchGroups();
  });

  // Fetch available DAGs when project changes
  useEffect(() => {
    const fetchAvailableDags = async () => {
      if (!projectName) {
        setAvailableDags([]);
        return;
      }
      try {
        const response = await api.post({
          type: 'framework-get-available-dags',
          request: { projectName },
        });
        setAvailableDags(response.dags);
      } catch (err) {
        console.error('Error fetching available DAGs:', err);
        setAvailableDags([]);
      }
    };
    void fetchAvailableDags();
  }, [projectName, api]);

  const discardReset = useCallback(() => {
    reset({
      projectName: '',
      name: '',
      group: undefined,
      topic: '',
      description: '',
      namespace: '',
      table_name: '',
      model_type: 'python',
      dags: [],
      enable_notebook: true,
      tags: undefined,
    });

    void stateSync.clearState('python-model-create');

    setShowDiscardConfirm(false);

    void onClose();
  }, [reset, onClose]);

  const onDiscard = () => {
    setShowDiscardConfirm(true);
  };

  const onSaveForLater = useCallback(() => {
    void onClose();
  }, [onClose]);

  const onHelp = useCallback(() => {
    if (vscode) {
      vscode.postMessage({
        type: 'open-external-url',
        url: EXTERNAL_LINKS.documentation,
      });
    } else {
      window.open(EXTERNAL_LINKS.documentation, '_blank');
    }
  }, [vscode]);

  const handleErrorRetry = useCallback(() => {
    setShowErrorDialog(false);
    setErrorMessage('');
    setIsSubmitting(false);
    clearError();
  }, [clearError]);

  if (isLoading || isProjectsLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
        <Spinner
          size={48}
          label={
            isProjectsLoading
              ? 'Loading Your Python Model Form...'
              : 'Loading form...'
          }
        />
        <p className="text-gray-600 mt-4 text-center">
          {isProjectsLoading
            ? 'Fetching your dbt projects and required configurations.'
            : 'Preparing the Python Model creation form with your saved data.'}
        </p>
      </div>
    );
  }

  if (success) {
    return (
      <Alert
        description={success}
        label="Python Model Created Successfully"
        variant="success"
      />
    );
  }

  return (
    <>
      <div className="px-4 py-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold">Create Python Model</h1>
        <div className="flex items-center">
          <Button
            label="Discard"
            variant="iconButton"
            onClick={onDiscard}
            type="button"
            disabled={isProjectsLoading || !hasFormData}
            icon={<TrashIcon className="h-5 w-5" />}
            className="ring-0 px-3 cursor-pointer"
          />
          <div className="h-4 w-px bg-gray-400 mx-2"></div>
          <Button
            label="Save draft"
            variant="iconButton"
            type="button"
            icon={<BookmarkSquareIcon className="h-5 w-5" />}
            onClick={onSaveForLater}
            disabled={isProjectsLoading || !hasFormData}
            className="ring-0 px-3 cursor-pointer"
          />
          <div className="h-4 w-px bg-gray-400 mx-2"></div>
          <Button
            label="Help"
            variant="iconButton"
            type="button"
            icon={<QuestionMarkCircleIcon className="h-5 w-5" />}
            onClick={onHelp}
            className="ring-0 px-3 cursor-pointer"
          />
        </div>
      </div>
      <Form<Values> handleSubmit={handleSubmit} hideSubmit onSubmit={onSubmit}>
        <Controller
          control={control}
          name="projectName"
          rules={{ required: 'Project is required' }}
          render={({ field }) => (
            <FieldSelectSingle
              {...field}
              error={errors.projectName}
              label="Select Project"
              options={projectOptions}
              tooltipText="Select the dbt project where you want to create the Python Model."
            />
          )}
        />

        <Controller
          control={control}
          name="name"
          rules={{
            required: 'Name is required',
            pattern: {
              value: /^[a-z][a-z0-9_]*$/,
              message:
                'Name must start with a letter and contain only lowercase letters, numbers, and underscores',
            },
          }}
          render={({ field }) => (
            <FieldInputText
              {...field}
              error={errors.name}
              label="Name"
              tooltipText="A unique identifier for this Python Model. Must be lowercase with underscores (e.g., backstage_catalogs)."
            />
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <Controller
            control={control}
            name="group"
            rules={{ required: 'Group is required' }}
            render={({ field }) => (
              <FieldSelectSingle
                {...field}
                error={errors.group}
                label="Group"
                options={groupOptions}
                tooltipText="The team or project group this Python Model belongs to."
              />
            )}
          />

          <Controller
            control={control}
            name="topic"
            rules={{
              required: 'Topic is required',
              pattern: {
                value: /^[a-z][a-z0-9_]*$/,
                message: 'Lowercase letters, numbers, and underscores only',
              },
            }}
            render={({ field }) => (
              <FieldInputText
                {...field}
                error={errors.topic}
                label="Topic"
                inputClassName="!mt-1"
                tooltipText="The subject area within the group (e.g., api_data, csv_data, snapshots)."
              />
            )}
          />
        </div>

        <Controller
          control={control}
          name="dags"
          rules={{ required: 'DAG is required' }}
          render={({ field }) => (
            <FieldSelectSingle
              {...field}
              value={field.value?.[0] ?? ''}
              onChange={(val: string) => field.onChange(val ? [val] : [])}
              error={errors.dags as any}
              label="Select DAG"
              options={availableDags.map((d) => ({ label: d, value: d }))}
              tooltipText="The DAG where this model will run. The model will execute as part of the run_python_models task in the selected DAG."
            />
          )}
        />

        <Controller
          control={control}
          name="enable_notebook"
          render={({ field: { value, onChange } }) => (
            <div className="rounded-md border border-surface-border px-3 py-3 mt-2 mb-1">
              <Switch
                checked={value ?? true}
                onChange={onChange}
                label="Generate Jupyter Notebook (.python.ipynb)"
                tooltipText="Generate a companion .python.ipynb notebook for interactive development and testing."
                size="sm"
              />
            </div>
          )}
        />

        <Controller
          control={control}
          name="tags"
          render={({ field: { value, onChange, onBlur } }) => (
            <TagInput
              value={value || []}
              onChange={onChange}
              onBlur={onBlur}
              label="Tags (Optional)"
              tooltipText="Tags to help organize and categorize the model."
              predefinedTags={PREDEFINED_TAGS}
              placeholder="Type and press Enter to add tags"
            />
          )}
        />

        <div className="flex gap-2 mt-4">
          <Button
            label={isSubmitting ? 'Creating...' : 'Create Python Model'}
            variant="primary"
            type="button"
            onClick={() => void handleSubmit(onSubmit)()}
            disabled={disableSubmit || isSubmitting}
            loading={isSubmitting}
          />
        </div>
      </Form>

      <DialogBox
        title="Python Model Creation Failed"
        open={showErrorDialog}
        description={errorMessage}
        confirmCTALabel="Try Again"
        onConfirm={handleErrorRetry}
      />

      <DialogBox
        title="Confirm Discard"
        open={showDiscardConfirm}
        description="Are you sure you want to discard this Python Model?"
        confirmCTALabel="Discard"
        discardCTALabel="Cancel"
        onConfirm={() => discardReset()}
        onDiscard={() => setShowDiscardConfirm(false)}
      />
    </>
  );
}
