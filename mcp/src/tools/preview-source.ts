import { failure, success } from '../response';
import { executeTrinoQuery, quoteIdent } from '../trino/client';
import {
  assertTrinoEnabled,
  publicTrinoInfo,
  resolveTrinoConnection,
} from '../trino/resolve';

/**
 * Sample rows from a Trino source table before modeling.
 */
export async function previewSource(
  args: {
    projectId?: string;
    catalog?: string;
    schema?: string;
    table: string;
    limit?: number;
    columns?: string[];
  },
) {
  try {
    if (!args.table?.trim()) {
      return failure(['table is required']);
    }
    const conn = resolveTrinoConnection(args.projectId);
    assertTrinoEnabled(conn);
    const catalog = args.catalog?.trim() || conn.catalog;
    const schema = args.schema?.trim() || conn.schema;
    const table = args.table.trim();
    const limit = args.limit ?? conn.defaultLimit;

    const selectList =
      args.columns?.length && args.columns.every((c) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(c))
        ? args.columns.map(quoteIdent).join(', ')
        : '*';

    const sql = `SELECT ${selectList} FROM ${quoteIdent(catalog)}.${quoteIdent(schema)}.${quoteIdent(table)}`;
    const result = await executeTrinoQuery(conn, sql, { limit });

    return success({
      trino: publicTrinoInfo(conn),
      catalog,
      schema,
      table,
      sql: `${sql}\nLIMIT ${limit}`,
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      limit,
      hint: 'Use these columns when building a DJ .source.json or model from/select.',
    });
  } catch (error) {
    return failure([(error as Error).message]);
  }
}
