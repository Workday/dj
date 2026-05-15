import type { SchemaLightdashDimension } from '@shared/schema/types/lightdash.dimension.schema';
import type { SchemaLightdashMetric } from '@shared/schema/types/lightdash.metric.schema';
import type { SchemaLightdashTable } from '@shared/schema/types/lightdash.table.schema';

export type LightdashModel = {
  name: string;
  tags: string[];
  description?: string;
};

export type LightdashPreview = {
  name: string;
  url: string;
  createdAt: string;
  models: string[];
  status: 'active' | 'inactive';
};

export type LightdashPreviewLog = {
  level: 'info' | 'success' | 'error' | 'warning';
  message: string;
  timestamp: string;
  isProgress?: boolean;
  isPreviewSuccess?: boolean;
};

/**
 * A single entry in the Lightdash YAML directory tree shown in the
 * Dashboards-as-Code Explorer / Upload tabs.
 */
export type LightdashYamlNode = {
  /** File or directory name (no path). */
  name: string;
  /** 'dir' | 'file' (only `*.yml` / `*.yaml` files are emitted). */
  type: 'dir' | 'file';
  /** Workspace-relative POSIX path. */
  path: string;
  /** Children for directories. */
  children?: LightdashYamlNode[];
};

/**
 * Streaming log entry surfaced by the dashboards-as-code download/upload
 * workflows.
 */
export type LightdashYamlLog = {
  level: 'info' | 'success' | 'error' | 'warning';
  message: string;
  timestamp: string;
};

export type LightdashApi =
  | {
      type: 'lightdash-fetch-models';
      service: 'lightdash';
      request: null;
      response: LightdashModel[];
    }
  | {
      type: 'lightdash-start-preview';
      service: 'lightdash';
      request: {
        previewName: string;
        selectedModels: string[];
      };
      response: { success: boolean; url?: string; error?: string };
    }
  | {
      type: 'lightdash-stop-preview';
      service: 'lightdash';
      request: {
        previewName: string;
      };
      response: { success: boolean; error?: string };
    }
  | {
      type: 'lightdash-fetch-previews';
      service: 'lightdash';
      request: null;
      response: LightdashPreview[];
    }
  | {
      type: 'lightdash-get-preview-name';
      service: 'lightdash';
      request: null;
      response: string;
    }
  | {
      type: 'lightdash-add-log';
      service: 'lightdash';
      request: {
        log: LightdashPreviewLog;
      };
      response: { success: boolean };
    }
  | {
      type: 'lightdash-yaml-list-files';
      service: 'lightdash';
      request: { path?: string };
      response: {
        success: boolean;
        path?: string;
        absolutePath?: string;
        tree?: LightdashYamlNode[];
        error?: string;
      };
    }
  | {
      type: 'lightdash-yaml-read-file';
      service: 'lightdash';
      request: { path: string };
      response: {
        success: boolean;
        content?: string;
        absolutePath?: string;
        error?: string;
      };
    }
  | {
      type: 'lightdash-yaml-edit-file';
      service: 'lightdash';
      request: { path: string };
      response: { success: boolean; error?: string };
    }
  | {
      type: 'lightdash-yaml-download';
      service: 'lightdash';
      request: {
        path?: string;
        scope: 'all' | 'specific';
        dashboardIds?: string[];
        chartIds?: string[];
        /**
         * Required Lightdash project UUID. Accepts a production or
         * preview project UUID; the CLI is invoked with `--project
         * <uuid>` on every run so we never fall through to the
         * Lightdash CLI's ambient active-project default. UI guards
         * non-empty input via inline validation; backend defends
         * against direct callers that bypass the UI.
         */
        project: string;
      };
      response: {
        success: boolean;
        tree?: LightdashYamlNode[];
        absolutePath?: string;
        error?: string;
      };
    }
  | {
      type: 'lightdash-yaml-upload';
      service: 'lightdash';
      request: {
        path?: string;
        chartSlugs?: string[];
        dashboardSlugs?: string[];
        force?: boolean;
        includeCharts?: boolean;
        /** See `lightdash-yaml-download` `project`. Same rules apply. */
        project: string;
      };
      response: {
        success: boolean;
        uploadedFiles?: string[];
        error?: string;
      };
    }
  | {
      type: 'lightdash-yaml-delete-files';
      service: 'lightdash';
      request: { paths: string[] };
      response: { success: boolean; error?: string };
    }
  | {
      type: 'lightdash-yaml-get-default-path';
      service: 'lightdash';
      request: null;
      response: { path: string; absolutePath: string };
    }
  | {
      type: 'lightdash-yaml-set-default-path';
      service: 'lightdash';
      request: { path: string };
      response: { success: boolean; absolutePath?: string; error?: string };
    };

export type LightdashDimension = SchemaLightdashDimension & {};

export type LightdashMetric = Omit<SchemaLightdashMetric, 'name'>; // Name is on the schema because we're inputing as array
export type LightdashMetrics = Record<string, LightdashMetric>;

export type LightdashTable = SchemaLightdashTable & {
  // These properties are saved to the meta in a different format than the schema
  metrics?: Record<string, LightdashMetric>;
  required_attributes?: Record<string, string | string[]>;
  required_filters?: Record<string, string>[];
};
