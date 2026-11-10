import { useApp } from '@web/context';
import { InputText, SelectSingle, Tooltip } from '@web/elements';
import { useModelStore } from '@web/stores/useModelStore';
import { deriveSourceFromType } from '@web/utils/formOptions';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface TemplateFieldsProps {
  mode: 'create' | 'edit';
}

/**
 * Optional template (`extends` / `with`) for create and edit. Edit loads the
 * merged model in the canvas but persists a diffed child on save.
 */
export function TemplateFields({ mode }: TemplateFieldsProps) {
  const { api } = useApp();
  const projectName = useModelStore((s) => s.basicFields.projectName);
  const templateAuthoring = useModelStore((s) => s.templateAuthoring);
  const setTemplateAuthoring = useModelStore((s) => s.setTemplateAuthoring);
  const setBasicField = useModelStore((s) => s.setBasicField);
  const updateFromState = useModelStore((s) => s.updateFromState);
  const updateSelectState = useModelStore((s) => s.updateSelectState);
  const clearGroupByState = useModelStore((s) => s.clearGroupByState);

  const [templateOptions, setTemplateOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const [paramDefs, setParamDefs] = useState<
    Record<string, { type: string; default?: string; description?: string }>
  >({});

  useEffect(() => {
    if (!projectName) {
      setTemplateOptions([]);
      return;
    }
    void api
      .post({ type: 'framework-template-list', request: { projectName } })
      .then((list) => {
        if (!list) {
          setTemplateOptions([]);
          return;
        }
        setTemplateOptions(
          list.map((t) => ({
            label: t.description ? `${t.name} — ${t.description}` : t.name,
            value: t.name,
          })),
        );
      });
  }, [api, projectName]);

  const loadTemplateParams = useCallback(
    async (name: string) => {
      if (!projectName || !name) {
        setParamDefs({});
        return;
      }
      const detail = await api.post({
        type: 'framework-template-get',
        request: { projectName, name },
      });
      if (!detail?.definition) {
        setParamDefs({});
        return;
      }
      const def = detail.definition as {
        params?: Record<
          string,
          { type: string; default?: string; description?: string }
        >;
        model?: { type?: string };
      };
      setParamDefs(def.params ?? {});
      const templateType = def.model?.type;
      if (templateType && mode === 'create') {
        setBasicField('type', templateType);
        const source = deriveSourceFromType(templateType);
        if (source) {
          setBasicField('source', source);
        }
      }
    },
    [api, mode, projectName, setBasicField],
  );

  useEffect(() => {
    if (templateAuthoring.extends) {
      void loadTemplateParams(templateAuthoring.extends);
    }
  }, [loadTemplateParams, templateAuthoring.extends]);

  const paramNames = useMemo(() => Object.keys(paramDefs).sort(), [paramDefs]);

  if (templateOptions.length === 0 && !templateAuthoring.extends) {
    return null;
  }

  const selectedOption =
    templateOptions.find((o) => o.value === templateAuthoring.extends) ?? null;

  return (
    <div className="flex flex-col gap-3 border border-neutral rounded-lg p-4">
      <div className="text-sm font-semibold text-foreground flex items-center gap-1">
        Template
        <Tooltip
          content={
            'Extend a *.template.json. Parameters map to `with`; the visual editor edits the merged model and saves a minimal child file.'
          }
        />
      </div>
      <SelectSingle
        label="Extends template"
        options={templateOptions}
        value={selectedOption}
        disabled={mode === 'edit' && !!templateAuthoring.extends}
        onChange={(opt) => {
          const name = opt?.value ?? '';
          if (!name) {
            setTemplateAuthoring({ extends: undefined, with: {} });
            return;
          }
          updateFromState({ model: '', source: '' });
          updateSelectState([]);
          clearGroupByState();
          setTemplateAuthoring({
            extends: name,
            with: {},
          });
          void loadTemplateParams(name);
        }}
        onBlur={() => {}}
        placeholder="None (standalone model)"
      />
      {paramNames.map((param) => (
        <InputText
          key={param}
          label={paramDefs[param]?.description ?? param}
          value={templateAuthoring.with?.[param] ?? ''}
          onChange={(e) => {
            const value = e.target.value;
            setTemplateAuthoring({
              with: {
                ...templateAuthoring.with,
                [param]: value,
              },
            });
          }}
          placeholder={
            paramDefs[param]?.type === 'model_ref'
              ? 'model name (e.g. stg__…)'
              : 'value'
          }
        />
      ))}
    </div>
  );
}
