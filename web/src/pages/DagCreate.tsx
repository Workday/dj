import { QuestionMarkCircleIcon, TrashIcon } from '@heroicons/react/24/outline';
import type { Api } from '@shared/api/types';
import type { DbtProject } from '@shared/dbt/types';
import { EXTERNAL_LINKS } from '@shared/web/constants';
import { useApp } from '@web/context/useApp';
import { useEnvironment } from '@web/context/useEnvironment';
import { Alert, Button, DialogBox, Spinner, TagInput } from '@web/elements';
import {
  Controller,
  FieldInputText,
  FieldSelectSingle,
  Form,
} from '@web/forms';
import { useError, useMount } from '@web/hooks';
import _ from 'lodash';
import { useCallback, useMemo, useState } from 'react';

import { usePersistedForm } from '../hooks/usePersistedForm';
import { stateSync } from '../utils/stateSync';

type Values = Api<'framework-dag-create'>['request'];

const PREDEFINED_TAGS = ['etl', 'python-model', 'python', 'source', 'ml'];

export function DagCreate() {
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
    formType: 'dag-create',
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

  const projectName = watch('projectName');
  const name = watch('name');

  const hasFormData = useMemo(() => {
    return !!(projectName || name);
  }, [projectName, name]);

  const projectOptions = useMemo(
    () =>
      _.map(projects, (p) => {
        const value = p.name;
        return { label: value, value };
      }),
    [projects],
  );

  const disableSubmit = useMemo(() => {
    return !projectName || !name;
  }, [projectName, name]);

  const onClose = useCallback(async () => {
    try {
      await api.post({
        type: 'framework-close-panel',
        request: { panelType: 'dag-create' },
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
          type: 'framework-dag-create',
          request: values,
        });
        setSuccess(resp);
        void onClose();
      } catch (err) {
        let message =
          'We encountered an issue while creating the DAG. Please check your inputs and try again.';

        if (err instanceof Error) {
          message = err.message;
        } else if (typeof err === 'string') {
          message = err;
        } else if (err && typeof err === 'object' && 'message' in err) {
          message = String(err.message);
        }

        setErrorMessage(message);
        setShowErrorDialog(true);
        handleError(err, 'Error creating DAG');
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
        setProjects(_projects);
      } catch (err) {
        console.error('ERROR FETCHING PROJECTS', err);
      } finally {
        setIsProjectsLoading(false);
      }
    };
    void fetchProjects();
  });

  const discardReset = useCallback(() => {
    reset({
      projectName: '',
      name: '',
      schedule: undefined,
      tags: undefined,
      description: undefined,
    });

    void stateSync.clearState('dag-create');
    setShowDiscardConfirm(false);
    void onClose();
  }, [reset, onClose]);

  const onDiscard = () => {
    setShowDiscardConfirm(true);
  };

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
      <div className="flex flex-col items-center justify-center min-h-[300px] p-8">
        <Spinner
          size={48}
          label={
            isProjectsLoading ? 'Loading Your DAG Form...' : 'Loading form...'
          }
        />
        <p className="text-gray-600 mt-4 text-center">
          {isProjectsLoading
            ? 'Fetching your dbt projects.'
            : 'Preparing the DAG creation form.'}
        </p>
      </div>
    );
  }

  if (success) {
    return (
      <Alert
        description={success}
        label="DAG Created Successfully"
        variant="success"
      />
    );
  }

  return (
    <>
      <div className="px-4 py-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold">Create DAG</h1>
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
              tooltipText="Select the dbt project associated with this DAG."
            />
          )}
        />

        <Controller
          control={control}
          name="name"
          rules={{
            required: 'DAG name is required',
            pattern: {
              value: /^[a-z][a-z0-9_]*$/,
              message:
                'Must start with a letter, lowercase letters, numbers, and underscores only',
            },
          }}
          render={({ field }) => (
            <FieldInputText
              {...field}
              error={errors.name}
              label="DAG Name"
              tooltipText="A unique name for the DAG. This will be used as the dag_id and file name (e.g., source_etl, ml_pipeline)."
            />
          )}
        />

        <Controller
          control={control}
          name="description"
          render={({ field }) => (
            <FieldInputText
              {...field}
              error={errors.description}
              label="Description (Optional)"
              tooltipText="A brief description of what this DAG does."
            />
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <Controller
            control={control}
            name="schedule"
            render={({ field }) => (
              <FieldInputText
                {...field}
                value={field.value || ''}
                label="Schedule (Optional)"
                inputClassName="!mt-1"
                tooltipText="Cron expression or Airflow preset (@daily, @hourly, @weekly). Defaults to @daily if left empty."
              />
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
                tooltipText="Tags to organize and categorize the DAG."
                predefinedTags={PREDEFINED_TAGS}
                placeholder="Add tags"
              />
            )}
          />
        </div>

        <div className="flex gap-2 mt-4">
          <Button
            label={isSubmitting ? 'Creating...' : 'Create DAG'}
            variant="primary"
            type="button"
            onClick={() => void handleSubmit(onSubmit)()}
            disabled={disableSubmit || isSubmitting}
            loading={isSubmitting}
          />
        </div>
      </Form>

      <DialogBox
        title="DAG Creation Failed"
        open={showErrorDialog}
        description={errorMessage}
        confirmCTALabel="Try Again"
        onConfirm={handleErrorRetry}
      />

      <DialogBox
        title="Confirm Discard"
        open={showDiscardConfirm}
        description="Are you sure you want to discard this DAG?"
        confirmCTALabel="Discard"
        discardCTALabel="Cancel"
        onConfirm={() => discardReset()}
        onDiscard={() => setShowDiscardConfirm(false)}
      />
    </>
  );
}
