import {
  frameworkBuildCteColumnRegistry,
  frameworkGetModelId,
  frameworkGetPartitionColumnNames,
} from '@services/framework/utils';
import {
  validateCteColumnReferences,
  validateCteGroupBy,
  validateCteLightdashMetrics,
  validateCteRollupRequiresSelect,
  validateCteRollupSource,
  validateCtes,
  validateDeadOuterLayer,
  validateExcludeDatetimeRollupConflict,
  validateMainModelAggregation,
  validateSubqueries,
} from '@services/modelValidation';
import { requireProject } from '@services/types';
import type { ApiPayload, ApiResponse } from '@shared/api/types';
import { apiResponse } from '@shared/api/utils';
import type { FrameworkColumn, FrameworkModel } from '@shared/framework/types';
import * as fs from 'fs';

import type { FrameworkContext } from '../context';

type AnalysisDiagnostic = {
  severity: 'error' | 'warning';
  cteIndex?: number;
  path?: string;
  message: string;
};

/**
 * Read-only handler for `framework-model-cte-analysis`.
 *
 * Wraps `frameworkBuildCteColumnRegistry` and the CTE-specific validators in
 * `modelValidation.ts`. Side-effect-free: never writes to the Problems tab,
 * never mutates shared state, never triggers sync. The Problems tab is owned
 * by the existing sync-time validators in `ModelProcessor` per the
 * "Diagnostics Lifecycle" rule in AGENTS.md; this API exists purely to power
 * the wizard's live column preview and inline validation chips.
 *
 * The full `buildModelJson()` draft is required as input -- the cross-cutting
 * validators (`validateMainModelAggregation`, `validateDeadOuterLayer`,
 * `validateExcludeDatetimeRollupConflict`, `validateSubqueries`) walk the
 * whole model, so a partial CTE slice would silently miss conflicts with
 * main-model `select` / `exclude_datetime` / `rollup`.
 */
export class CteAnalysisHandlers {
  constructor(private readonly ctx: FrameworkContext) {}

  async handleCteAnalysis(
    payload: Extract<
      ApiPayload<'framework'>,
      { type: 'framework-model-cte-analysis' }
    >,
  ): Promise<ApiResponse> {
    const { projectName, modelJson } = payload.request;

    let project;
    try {
      project = requireProject(
        this.ctx.dbt.projects.get(projectName),
        projectName,
        'cte-analysis',
      );
    } catch (err) {
      return apiResponse<typeof payload.type>({
        columns: {},
        diagnostics: [
          {
            severity: 'error',
            message: `Project "${projectName}" not found: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
        ],
        manifestTimestamp: null,
      });
    }

    const modelJsonTyped = modelJson as FrameworkModel;
    const ctes =
      'ctes' in modelJsonTyped && Array.isArray(modelJsonTyped.ctes)
        ? modelJsonTyped.ctes
        : [];

    // 1. Build the CTE column registry. Best-effort: if any CTE has malformed
    // `from` mid-edit, surface the failure as a diagnostic and return the
    // partial result so the panel keeps rendering.
    let registry: ReturnType<typeof frameworkBuildCteColumnRegistry> | null =
      null;
    let registryError: string | null = null;
    if (ctes.length > 0) {
      try {
        const modelId = frameworkGetModelId({
          modelJson: modelJsonTyped,
          project,
        });
        const partitionColumnNames = frameworkGetPartitionColumnNames({
          modelJson: modelJsonTyped,
          project,
        });
        registry = frameworkBuildCteColumnRegistry({
          ctes,
          modelId: modelId ?? undefined,
          modelJson: modelJsonTyped,
          partitionColumnNames,
          project,
        });
      } catch (err) {
        registryError =
          err instanceof Error ? err.message : 'CTE column inference failed';
      }
    }

    const columns: ApiResponse<'framework-model-cte-analysis'>['columns'] = {};
    if (registry) {
      for (const [name, cols] of registry.entries()) {
        columns[name] = cols.map((c: FrameworkColumn) => ({
          name: c.name,
          type: c.meta?.type === 'fct' ? ('fct' as const) : ('dim' as const),
          dataType: c.data_type,
          description: c.description,
        }));
      }
    }

    // 2. Run the CTE validators. Each accumulates into `diagnostics`. Both
    // string-returning legacy validators and `ValidationErrorDetail`-returning
    // structured validators are normalized through `pushString` / `pushDetail`.
    const diagnostics: AnalysisDiagnostic[] = [];
    if (registryError) {
      diagnostics.push({
        severity: 'error',
        message: `CTE column inference failed: ${registryError}`,
      });
    }

    /**
     * Best-effort cteIndex extractor. The legacy string-returning validators
     * embed the index as `ctes[N]` in the message; pull it out so the panel
     * can attach the diagnostic to the right CTE row.
     */
    const extractCteIndex = (
      message: string,
      explicitPath?: string,
    ): number | undefined => {
      if (explicitPath) {
        const m = explicitPath.match(/^\/?ctes\/(\d+)/);
        if (m) {
          return Number(m[1]);
        }
      }
      const m = message.match(/ctes\[(\d+)\]/);
      return m ? Number(m[1]) : undefined;
    };

    const pushString = (
      severity: 'error' | 'warning',
      messages: string[],
    ): void => {
      for (const message of messages) {
        diagnostics.push({
          severity,
          message,
          cteIndex: extractCteIndex(message),
        });
      }
    };

    type DetailLike = {
      message: string;
      instancePath: string;
      severity?: 'error' | 'warning';
    };
    const pushDetail = (
      defaultSeverity: 'error' | 'warning',
      details: DetailLike[],
    ): void => {
      for (const d of details) {
        const path = d.instancePath
          ? d.instancePath.replace(/^\//, '')
          : undefined;
        diagnostics.push({
          severity: d.severity ?? defaultSeverity,
          path,
          message: d.message,
          cteIndex: extractCteIndex(d.message, d.instancePath),
        });
      }
    };

    try {
      pushString('error', validateCtes(modelJsonTyped));
    } catch (err) {
      this.ctx.log.warn('validateCtes threw', err);
    }
    try {
      pushDetail('error', validateCteLightdashMetrics(modelJsonTyped));
    } catch (err) {
      this.ctx.log.warn('validateCteLightdashMetrics threw', err);
    }
    try {
      pushDetail(
        'error',
        validateExcludeDatetimeRollupConflict(modelJsonTyped),
      );
    } catch (err) {
      this.ctx.log.warn('validateExcludeDatetimeRollupConflict threw', err);
    }
    try {
      pushDetail('error', validateCteRollupSource(modelJsonTyped));
    } catch (err) {
      this.ctx.log.warn('validateCteRollupSource threw', err);
    }
    try {
      pushDetail('error', validateCteRollupRequiresSelect(modelJsonTyped));
    } catch (err) {
      this.ctx.log.warn('validateCteRollupRequiresSelect threw', err);
    }
    try {
      // validateCteGroupBy is per-CTE; run for every CTE.
      for (let i = 0; i < ctes.length; i++) {
        pushString('error', validateCteGroupBy(ctes[i], i));
      }
    } catch (err) {
      this.ctx.log.warn('validateCteGroupBy threw', err);
    }
    try {
      if (registry) {
        pushString(
          'error',
          validateCteColumnReferences(modelJsonTyped, registry),
        );
      }
    } catch (err) {
      this.ctx.log.warn('validateCteColumnReferences threw', err);
    }
    try {
      pushDetail(
        'error',
        validateMainModelAggregation(modelJsonTyped, registry ?? undefined),
      );
    } catch (err) {
      this.ctx.log.warn('validateMainModelAggregation threw', err);
    }
    try {
      pushDetail('warning', validateDeadOuterLayer(modelJsonTyped));
    } catch (err) {
      this.ctx.log.warn('validateDeadOuterLayer threw', err);
    }
    try {
      pushString('error', validateSubqueries(modelJsonTyped));
    } catch (err) {
      this.ctx.log.warn('validateSubqueries threw', err);
    }

    // 3. Manifest mtime. Surfaced as a "manifest from <ts>" hint in the
    // Validation tab when columns look stale; null when the project has not
    // been compiled yet.
    let manifestTimestamp: number | null = null;
    try {
      const manifestPath = `${project.pathSystem}/${project.targetPath}/manifest.json`;
      const stats = fs.statSync(manifestPath);
      manifestTimestamp = stats.mtimeMs;
    } catch {
      manifestTimestamp = null;
    }

    return apiResponse<typeof payload.type>({
      columns,
      diagnostics,
      manifestTimestamp,
    });
  }
}
