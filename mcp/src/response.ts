import type { FrameworkModel } from '@shared/framework/types';

export interface McpToolResponse<T = unknown> {
  ok: boolean;
  data?: T;
  errors?: string[];
  warnings?: string[];
  paths?: Record<string, string>;
}

export function success<T>(data: T, extra?: Partial<McpToolResponse<T>>): McpToolResponse<T> {
  return { ok: true, data, ...extra };
}

export function failure(
  errors: string[],
  extra?: Partial<McpToolResponse>,
): McpToolResponse {
  return { ok: false, errors, ...extra };
}

export function toToolContent(result: McpToolResponse): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    isError: result.ok === false,
  };
}

export interface ProjectSelector {
  workspaceRoot?: string;
  projectPath?: string;
  projectName?: string;
  /** Catalog project id (production mode). */
  projectId?: string;
  /** Independent local dbt path. */
  localPath?: string;
  /** When true, write into an isolated change-set worktree (default true for mutating tools). */
  previewOnly?: boolean;
}

export interface ModelRef {
  modelPath?: string;
  modelJson?: FrameworkModel | Record<string, unknown>;
}
