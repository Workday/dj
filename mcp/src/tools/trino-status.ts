import { failure, success } from '../response';
import { executeTrinoQuery } from '../trino/client';
import {
  assertTrinoEnabled,
  publicTrinoInfo,
  resolveTrinoConnection,
} from '../trino/resolve';

export async function trinoStatus(args: { projectId?: string } = {}) {
  try {
    const conn = resolveTrinoConnection(args.projectId);
    if (!conn.enabled || !conn.host) {
      return success({
        enabled: false,
        connected: false,
        hint: 'Set trino.enabled and trino.host in DJ_MCP_CONFIG (password via TRINO_PASSWORD / passwordEnv).',
      });
    }
    assertTrinoEnabled(conn);
    const result = await executeTrinoQuery(conn, 'SELECT 1 AS ok', {
      skipLimit: true,
    });
    return success({
      enabled: true,
      connected: true,
      trino: publicTrinoInfo(conn),
      sample: result,
    });
  } catch (error) {
    return failure([(error as Error).message], {
      data: {
        enabled: true,
        connected: false,
        trino: publicTrinoInfo(resolveTrinoConnection(args.projectId)),
      },
    });
  }
}
