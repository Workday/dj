import {
  BookmarkSquareIcon,
  QuestionMarkCircleIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type { Api } from '@shared/api/types';
import type { DbtProject } from '@shared/dbt/types';
import { EXTERNAL_LINKS } from '@shared/web/constants';
import { useChange } from '@web';
import { useApp } from '@web/context';
import { useEnvironment } from '@web/context';
import { Alert, Button, DialogBox, Spinner } from '@web/elements';
import { Controller, FieldSelectSingle, Form } from '@web/forms';
import { useError, useMount } from '@web/hooks';
import _ from 'lodash';
import { useCallback, useMemo, useState } from 'react';

import { usePersistedForm } from '../hooks/usePersistedForm';
import { stateSync } from '../utils/stateSync';

type Values = Api<'framework-source-create'>['request'];

export function SourceCreate() {
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
    formType: 'source-create', // Unique identifier for source creation
    autoSave: true,
    debounceMs: 500,
  });

  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [projects, setProjects] = useState<DbtProject[] | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [trinoCatalogs, setTrinoCatalogs] = useState<string[] | null>(null);
  const [trinoSchemas, setTrinoSchemas] = useState<string[] | null>(null);
  const [trinoTables, setTrinoTables] = useState<string[] | null>(null);
  const [isProjectsLoading, setIsProjectsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const projectName = watch('projectName');
  const trinoCatalog = watch('trinoCatalog');
  const trinoSchema = watch('trinoSchema');
  const trinoTable = watch('trinoTable');

  // Check if form has any values to determine if discard should be enabled
  const hasFormData = useMemo(() => {
    return !!(projectName || trinoCatalog || trinoSchema || trinoTable);
  }, [projectName, trinoCatalog, trinoSchema, trinoTable]);

  const projectOptions = useMemo(
    () =>
      _.map(projects, (p) => {
        const value = p.name;
        return { label: value, value };
      }),
    [projects],
  );
  const trinoCatalogOptions = useMemo(
    () => _.map(trinoCatalogs, (value) => ({ label: value, value })),
    [trinoCatalogs],
  );
  const isTrinoCatalogsLoading = useMemo(() => !trinoCatalogs, [trinoCatalogs]);
  const trinoSchemaOptions = useMemo(
    () => _.map(trinoSchemas, (value) => ({ label: value, value })),
    [trinoSchemas],
  );
  const isTrinoSchemasLoading = useMemo(
    () => trinoCatalog && !trinoSchemas,
    [trinoCatalog, trinoSchemas],
  );
  const trinoTableOptions = useMemo(
    () => _.map(trinoTables, (value) => ({ label: value, value })),
    [trinoTables],
  );
  const isTrinoTablesLoading = useMemo(
    () => trinoCatalog && trinoSchema && !trinoTables,
    [trinoCatalog, trinoSchema, trinoTables],
  );

  const disableSubmit = useMemo(() => {
    // Disable if any data is loading
    if (
      isTrinoCatalogsLoading ||
      isTrinoSchemasLoading ||
      isTrinoTablesLoading
    ) {
      return true;
    }

    // Disable if any required field is empty
    if (!projectName || !trinoCatalog || !trinoSchema || !trinoTable) {
      return true;
    }

    return false;
  }, [
    isTrinoCatalogsLoading,
    isTrinoSchemasLoading,
    isTrinoTablesLoading,
    projectName,
    trinoCatalog,
    trinoSchema,
    trinoTable,
  ]);

  const onSubmit = useCallback(
    async (values: Values) => {
      try {
        setIsSubmitting(true);
        setShowErrorDialog(false);
        setErrorMessage('');
        const resp = await api.post({
          type: 'framework-source-create',
          request: values,
        });
        setSuccess(resp);
      } catch (err) {
        // Extract error message from the error object
        let message =
          'We encountered an issue while creating the source. Please check your selections and try again.';

        if (err instanceof Error) {
          message = err.message;
        } else if (typeof err === 'string') {
          message = err;
        } else if (err && typeof err === 'object' && 'message' in err) {
          message = String(err.message);
        }

        setErrorMessage(message);
        setShowErrorDialog(true);
        handleError(err, 'Error creating source');
      } finally {
        setIsSubmitting(false);
      }
    },
    [api, handleError],
  );

  useMount(() => {
    const loadProjects = async () => {
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

    void loadProjects();
  });

  useChange(projectName, () => {
    const fetchCatalogs = async () => {
      try {
        setTrinoCatalogs(null);
        const _trinoCatalogs = await api.post({
          type: 'trino-fetch-catalogs',
          request: null,
        });
        setTrinoCatalogs(_trinoCatalogs);
      } catch (err) {
        console.error('ERROR FETCHING CATALOGS', err);
      }
    };

    void fetchCatalogs();
  });
  useChange(trinoCatalog, () => {
    const fetchSchemas = async () => {
      try {
        setTrinoSchemas(null);
        const _trinoSchemas = await api.post({
          type: 'trino-fetch-schemas',
          request: { catalog: trinoCatalog },
        });
        setTrinoSchemas(_trinoSchemas);
      } catch (err) {
        console.error('ERROR FETCHING SCHEMAS', err);
      }
    };

    void fetchSchemas();
  });

  useChange(trinoSchema, () => {
    const fetchTables = async () => {
      try {
        setTrinoTables(null);
        const _trinoTables = await api.post({
          type: 'trino-fetch-tables',
          request: { catalog: trinoCatalog, schema: trinoSchema },
        });
        setTrinoTables(_trinoTables);
      } catch (err) {
        console.error('ERROR FETCHING TABLES', err);
      }
    };

    void fetchTables();
  });

  const onClose = useCallback(() => {
    if (vscode) {
      // Send a message to the extension with a special close type
      vscode.postMessage({
        type: 'close-panel',
        panelType: 'source-create',
      });
    } else {
      window.parent.postMessage(
        {
          type: 'close-panel',
          panelType: 'source-create',
        },
        '*',
      );
    }
  }, [vscode]);

  const discardReset = useCallback(() => {
    reset({
      projectName: '',
      trinoCatalog: undefined,
      trinoSchema: undefined,
      trinoTable: '',
    });

    void stateSync.clearState('source-create');

    setShowDiscardConfirm(false);

    onClose();
  }, [reset, onClose]);

  const onDiscard = () => {
    setShowDiscardConfirm(true);
  };

  const onSaveForLater = useCallback(() => {
    onClose();
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
    // Clear the error and allow user to retry
    setShowErrorDialog(false);
    setErrorMessage('');
    setIsSubmitting(false); // Reset loading state
    clearError();
  }, [clearError]);

  if (isLoading || isProjectsLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
        <Spinner
          size={48}
          label={
            isProjectsLoading
              ? 'Loading Your Source Form...'
              : 'Loading form...'
          }
        />
        <p className="text-gray-600 mt-4 text-center">
          {isProjectsLoading
            ? 'Fetching your dbt projects and required configurations.'
            : 'Preparing the source creation form with your saved data.'}
        </p>
      </div>
    );
  }

  if (success) {
    return (
      <Alert
        description={success}
        label="Source Created Successfully"
        variant="success"
      />
    );
  }

  return (
    <>
      {/* 
          Title: Header 
          TODO: Move this to common component when working on New UI
      */}
      <div className="px-4 py-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold">Create Source</h1>
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
          rules={{ required: 'Type is required' }}
          render={({ field }) => (
            <FieldSelectSingle
              {...field}
              error={errors.projectName}
              label="Select Project"
              options={projectOptions}
              tooltipText="Select the dbt project where you want to create the source. If you have only one project, it will be selected automatically."
            />
          )}
        />
        {!projectName ? null : isTrinoCatalogsLoading ? (
          <Spinner label="Loading Trino Catalogs" />
        ) : (
          <Controller
            control={control}
            name="trinoCatalog"
            rules={{ required: 'Trino catalog is required' }}
            render={({ field }) => (
              <FieldSelectSingle
                {...field}
                error={errors.trinoCatalog}
                label="Select Trino Catalog"
                options={trinoCatalogOptions}
                tooltipText="Choose the Trino catalog that contains your data. A catalog in Trino represents a data source or connector (e.g., 'production', 'development', 'staging')."
              />
            )}
          />
        )}
        {!trinoCatalog ? null : isTrinoSchemasLoading ? (
          <Spinner label="Loading Trino Schemas" />
        ) : (
          <Controller
            control={control}
            name="trinoSchema"
            rules={{ required: 'Trino schema is required' }}
            render={({ field }) => (
              <FieldSelectSingle
                {...field}
                error={errors.trinoSchema}
                label="Select Trino Schema"
                options={trinoSchemaOptions}
                tooltipText="Select the schema (database) within the catalog. Schemas organize related tables and views together in a logical grouping."
              />
            )}
          />
        )}
        {!trinoSchema ? null : isTrinoTablesLoading ? (
          <Spinner label="Loading Trino Tables" />
        ) : (
          <Controller
            control={control}
            name="trinoTable"
            rules={{ required: 'Trino table is required' }}
            render={({ field }) => (
              <FieldSelectSingle
                {...field}
                error={errors.trinoTable}
                label="Select Trino Table"
                options={trinoTableOptions}
                tooltipText="Choose the specific table you want to create as a dbt source. This table will be referenced in your dbt models and should contain the raw data you want to transform."
              />
            )}
          />
        )}

        {/* Custom Submit Button */}
        <div className="flex gap-2 mt-4">
          <Button
            label={isSubmitting ? 'Creating...' : 'Create Source'}
            variant="primary"
            type="button"
            onClick={() => void handleSubmit(onSubmit)()}
            disabled={disableSubmit || isSubmitting}
            loading={isSubmitting}
          />
        </div>
      </Form>

      {/* Error Dialog */}
      <DialogBox
        title="Source Creation Failed"
        open={showErrorDialog}
        description={errorMessage}
        confirmCTALabel="Try Again"
        onConfirm={handleErrorRetry}
      />

      <DialogBox
        title="Confirm Discard"
        open={showDiscardConfirm}
        description="Are you sure you want to discard this source?"
        confirmCTALabel="Discard"
        discardCTALabel="Cancel"
        onConfirm={() => discardReset()}
        onDiscard={() => setShowDiscardConfirm(false)}
      />
    </>
  );
}
