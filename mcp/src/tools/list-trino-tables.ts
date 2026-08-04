import { failure, success } from '../response';
import { executeTrinoQuery, quoteIdent } from '../trino/client';
import {
  assertTrinoEnabled,
  publicTrinoInfo,
  resolveTrinoConnection,
} from '../trino/resolve';

/**
 * Browse Trino catalogs / schemas / tables / columns for source discovery.
 *
 * Drill-down:
 * - (none) → catalogs
 * - catalog → schemas
 * - catalog + schema → tables
 * - catalog + schema + table → columns
 */
export async function listTrinoTables(
  args: {
    projectId?: string;
    catalog?: string;
    schema?: string;
    table?: string;
  } = {},
) {
  try {
    const conn = resolveTrinoConnection(args.projectId);
    assertTrinoEnabled(conn);
    const catalog = args.catalog?.trim();
    const schema = args.schema?.trim();
    const table = args.table?.trim();

    if (table) {
      const cat = catalog || conn.catalog;
      const sch = schema || conn.schema;
      const result = await executeTrinoQuery(
        conn,
        `SHOW COLUMNS FROM ${quoteIdent(cat)}.${quoteIdent(sch)}.${quoteIdent(table)}`,
        { skipLimit: true },
      );
      const columns = result.rows.map((r) => ({
        column: String(r[0] ?? ''),
        type: String(r[1] ?? ''),
        extra: r[2] != null ? String(r[2]) : '',
        comment: r[3] != null ? String(r[3]) : '',
      }));
      return success({
        trino: publicTrinoInfo(conn),
        catalog: cat,
        schema: sch,
        table,
        columns,
      });
    }

    if (schema) {
      const cat = catalog || conn.catalog;
      const result = await executeTrinoQuery(
        conn,
        `SHOW TABLES FROM ${quoteIdent(cat)}.${quoteIdent(schema)}`,
        { skipLimit: true },
      );
      return success({
        trino: publicTrinoInfo(conn),
        catalog: cat,
        schema,
        tables: result.rows.map((r) => String(r[0] ?? '')),
        hint: 'Pass table to list columns, or dj_preview_source to sample rows.',
      });
    }

    if (catalog) {
      const result = await executeTrinoQuery(
        conn,
        `SHOW SCHEMAS FROM ${quoteIdent(catalog)}`,
        { skipLimit: true },
      );
      return success({
        trino: publicTrinoInfo(conn),
        catalog,
        schemas: result.rows.map((r) => String(r[0] ?? '')),
        hint: 'Pass schema to list tables.',
      });
    }

    const result = await executeTrinoQuery(conn, 'SHOW CATALOGS', {
      skipLimit: true,
    });
    return success({
      trino: publicTrinoInfo(conn),
      catalogs: result.rows.map((r) => String(r[0] ?? '')),
      defaults: { catalog: conn.catalog, schema: conn.schema },
      hint: 'Pass catalog (then schema, then table) to drill down. Or pass schema only to list tables in the default catalog.',
    });
  } catch (error) {
    return failure([(error as Error).message]);
  }
}
