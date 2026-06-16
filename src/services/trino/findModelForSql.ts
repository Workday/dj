/**
 * Map a Trino query's SQL text back to the DJ model that produced it.
 *
 * All three strategies operate purely on the SQL text returned by the
 * Trino coordinator — DJ never modifies generated SQL.
 *
 * 1. **`dbt` query_comment** — `dbt-trino` (and core dbt) prepend a JSON
 *    comment to every query they issue. Its `node_id` field looks like
 *    `model.<project>.<modelName>` and gives us an exact match. This is
 *    enabled by default in dbt; users only opt out by overriding
 *    `query-comment` in `dbt_project.yml`.
 *
 * 2. **Materialization FQN** — `dbt-trino` wraps every materialized
 *    model in `CREATE TABLE <catalog>.<schema>.<modelName> AS …`,
 *    `CREATE OR REPLACE VIEW …`, `CREATE MATERIALIZED VIEW …`, or
 *    `INSERT INTO …` (incremental). We pull the table name out of the
 *    wrapping clause and look it up in the manifest by name.
 *
 * 3. **Trailing CTE pattern** — dbt's compiled SQL form ends in
 *    `…), <modelName> AS (…) SELECT * FROM <modelName>`. Useful for
 *    `dbt compile` / `dbt show` outputs that aren't wrapped in a DDL.
 *
 * If none of the three resolves, callers get `null` and the UI shows a
 * disabled "Jump to Model" button with an explanatory tooltip.
 */

import type { DbtModel } from '@shared/dbt/types';
import type { DjModelMatch } from '@shared/trino/types';
import * as fs from 'fs';
import * as path from 'path';

// `/* {"app": "dbt", …, "node_id": "model.project.name", …} */`
// We tolerate single-quoted JSON (which dbt sometimes emits) and any
// whitespace around the colon. Stop at the first quote that follows the
// model name so we don't accidentally span into the next key.
const QUERY_COMMENT_NODE_ID_REGEX =
  /["']node_id["']\s*:\s*["']model\.([\w.-]+)\.([\w.-]+)["']/i;
const CREATE_TABLE_REGEX =
  /create\s+(?:or\s+replace\s+)?(?:table|view|materialized\s+view)\s+(?:if\s+not\s+exists\s+)?"?([\w_.-]+)"?\s*\.\s*"?([\w_.-]+)"?\s*\.\s*"?([\w_.-]+)"?/i;
const INSERT_INTO_REGEX =
  /insert\s+into\s+"?([\w_.-]+)"?\s*\.\s*"?([\w_.-]+)"?\s*\.\s*"?([\w_.-]+)"?/i;
// `…)…<modelName> AS ( … ) SELECT * FROM <modelName>` — the dbt-trino
// compiled-CTE shape. We anchor on the final `FROM <name>` near the end
// of the text to keep this cheap on huge SQL bodies.
const TRAILING_FROM_REGEX = /\bfrom\s+"?([a-z_][\w]*)"?\s*;?\s*$/i;

export function findModelForSql(
  sqlText: string,
  models: Map<string, DbtModel>,
): DjModelMatch | null {
  if (!sqlText) {
    return null;
  }

  // 1) dbt query_comment — preferred. Works for `dbt run`, `dbt build`,
  //    `dbt compile`, `dbt show`, and incremental materializations.
  const comment = sqlText.match(QUERY_COMMENT_NODE_ID_REGEX);
  if (comment) {
    const [, project, modelName] = comment;
    const modelJsonPath = resolveModelJsonPath(project, modelName, models);
    return {
      project,
      modelName,
      modelJsonPath,
      matchedBy: 'comment',
    };
  }

  // 2) Materialization FQN — extract from `CREATE TABLE/VIEW … AS` or
  //    `INSERT INTO …` and resolve by model name.
  const fqn =
    sqlText.match(CREATE_TABLE_REGEX) ?? sqlText.match(INSERT_INTO_REGEX);
  if (fqn) {
    const tableName = fqn[3];
    if (tableName) {
      const match = matchByModelName(tableName, models);
      if (match) {
        return { ...match, matchedBy: 'fqn' };
      }
    }
  }

  // 3) Trailing CTE fallback — for compiled SQL bodies that aren't
  //    wrapped in a DDL. We scan only the tail of the SQL to avoid
  //    matching on a `FROM <some_cte>` deep inside the body.
  const tail = sqlText.slice(-256).replace(/[\s;]+$/, '');
  const trailing = tail.match(TRAILING_FROM_REGEX);
  if (trailing) {
    const candidate = trailing[1];
    if (candidate) {
      const match = matchByModelName(candidate, models);
      if (match) {
        return { ...match, matchedBy: 'cte' };
      }
    }
  }

  return null;
}

/**
 * Resolve a model name against the manifest. Matches the first model
 * whose `name` equals the candidate; if multiple projects publish a
 * model with the same name we return the first one (the manifest's
 * insertion order is stable enough for the common single-project case).
 */
function matchByModelName(
  candidate: string,
  models: Map<string, DbtModel>,
): Omit<DjModelMatch, 'matchedBy'> | null {
  for (const model of models.values()) {
    if (model.name === candidate) {
      const project = inferProjectFromPath(model.pathSystemFile);
      if (!project) {
        continue;
      }
      return {
        project,
        modelName: model.name,
        modelJsonPath: deriveModelJsonPath(model.pathSystemFile),
      };
    }
  }
  return null;
}

/**
 * Given a `.sql` file path under `models/`, infer the sibling
 * `.model.json`. Returns `undefined` when the JSON file isn't on disk
 * so the caller can fall back to the .sql path instead of opening a
 * phantom file.
 */
function deriveModelJsonPath(sqlFile: string): string | undefined {
  if (!sqlFile) {
    return undefined;
  }
  const candidate = sqlFile.replace(/\.sql$/i, '.model.json');
  try {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function resolveModelJsonPath(
  projectName: string,
  modelName: string,
  models: Map<string, DbtModel>,
): string | undefined {
  const id = `model.${projectName}.${modelName}`;
  const model = models.get(id);
  if (!model?.pathSystemFile) {
    return undefined;
  }
  return deriveModelJsonPath(model.pathSystemFile);
}

/**
 * Best-effort project inference from a model SQL path. The DJ project
 * structure is `<workspace>/<project>/models/<…>/<model>.sql`; we pick
 * the directory immediately above the `models/` segment.
 */
function inferProjectFromPath(sqlFile: string): string | null {
  if (!sqlFile) {
    return null;
  }
  const parts = sqlFile.split(path.sep);
  const idx = parts.lastIndexOf('models');
  if (idx <= 0) {
    return null;
  }
  return parts[idx - 1] ?? null;
}
