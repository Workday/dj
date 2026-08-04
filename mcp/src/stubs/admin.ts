/** Stub for admin module to avoid VS Code dependency in headless MCP bundle. */
export const WORKSPACE_ROOT = process.env.DJ_WORKSPACE_ROOT ?? process.cwd();
export const DJ_SCHEMAS_PATH = '';
export const DJ_STATE_PATH = '';
export const DJ_SQL_PATH = '';
export const DJ_PYTHON_TEMP_PATH = '';

export class TreeDataInstance {
  constructor(public items: unknown[]) {}
}

export type TreeData = unknown;
export type TreeItem = unknown;

export function getTrinoConfig() {
  return {
    path:
      process.env.DJ_TRINO_PATH?.trim() ||
      process.env.TRINO_CLI_PATH?.trim() ||
      'trino-cli',
  };
}

export function djSqlPath({ name }: { name: string }) {
  return name;
}

export function djSqlWrite(_args: { name: string; sql: string }) {
  /* no-op in MCP */
}
