import * as path from 'path';
import { getRegistryConfig } from './projects/registry';
import { getSession } from './projects/session';

export interface McpConfig {
  workspaceRoot: string;
  productionMode: boolean;
  allowLocalProjectMode: boolean;
  exposeFilesystemPaths: boolean;
}

/**
 * Legacy helper — prefer resolveActiveProject for catalog/local modes.
 * Still used when callers pass an explicit workspaceRoot.
 */
export function getConfig(overrides: { workspaceRoot?: string } = {}): McpConfig {
  const file = getRegistryConfig();
  const session = getSession();
  const workspaceRoot = path.resolve(
    overrides.workspaceRoot ??
      session.activeLocalPath ??
      process.env.DJ_WORKSPACE_ROOT ??
      process.cwd(),
  );
  return {
    workspaceRoot,
    productionMode: file.productionMode ?? false,
    allowLocalProjectMode: file.allowLocalProjectMode ?? true,
    exposeFilesystemPaths:
      file.exposeFilesystemPaths ?? !(file.productionMode ?? false),
  };
}
