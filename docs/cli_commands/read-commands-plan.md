# DJ CLI — Read Commands Implementation Plan (+ Authoring-support APIs)

Two plans:
- **Part 1** — implement the **Read** command tier now (introspection), including *pull available
  models* so an agent can populate `from` when creating a model.
- **Part 2** — analysis of which other DJ APIs should become CLI commands next to help agents author
  models and run related operations.

All commands stay thin passthroughs to `ctx.api.handleApi(...)`; no logic is reimplemented. Payloads
are flat (no `request` wrapper); the CLI wraps internally.

---

# Part 1 — Read commands (implement now)

## Why

An agent authoring a model needs to *discover* what it can reference — catalogs/schemas/tables/columns
in Trino, and the dbt project's models and sources. In the visual editor, `SelectNode.tsx` builds the
`from` dropdown by reading `project.manifest.nodes` (models) and `project.manifest.sources` (sources)
from `dbt-fetch-projects`; the dedicated list API is `dbt-fetch-available-models`. Exposing these as
read commands lets an agent ground its `from` / `select` choices instead of guessing.

## Prerequisite refactor (shared, small)

The registry's `readRequest` currently *requires* a `request` object and hardcodes a model.create
message. Generalize it so read ops can take a flat payload, an explicit `{ request }` envelope, or
nothing (nullable ops such as `trino.catalogs`).

```ts
/**
 * Normalize CLI input into the `request` handleApi expects. Accepts a flat
 * payload ({ ...fields }), an explicit envelope ({ request }), or nothing.
 * Nullable ops (e.g. trino.catalogs) resolve to null.
 */
function readRequest(
  input: unknown,
  opts: { nullable?: boolean } = {},
): Record<string, unknown> | null {
  if (input == null) {
    if (opts.nullable) return null;
    throw new Error('This operation requires a JSON payload');
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Payload must be a JSON object');
  }
  const obj = input as Record<string, unknown>;
  if ('request' in obj) {
    const r = obj.request; // explicit envelope wins (back-compat escape hatch)
    if (r == null) return opts.nullable ? null : throwErr("'request' may not be null");
    if (typeof r !== 'object' || Array.isArray(r)) throw new Error("'request' must be an object");
    return { ...(r as Record<string, unknown>) };
  }
  return { ...obj }; // flat payload: the object itself is the request
}
```

Add a `read` registration helper to keep each op a one-liner:

```ts
const registerRead = (
  name: string,
  apiType: string,
  description: string,
  opts: { nullable?: boolean; project?: boolean } = {},
): void =>
  register({
    name,
    description,
    sideEffect: 'read',
    handler: async (input, ctx) => {
      const request = readRequest(input, { nullable: opts.nullable });
      if (opts.project && request) resolveProjectName(request, ctx);
      return ctx.api.handleApi({ type: apiType, request });
    },
  });
```

## Read ops to register

| CLI op | API type | request | resolve projectName | notes |
|---|---|---|---|---|
| `dbt.projects` | `dbt-fetch-projects` | `null` | — | includes `manifest` (source of truth for models/sources) |
| `dbt.models` | `dbt-fetch-available-models` | `{ projectName? }` | yes | **pull available models for `from.model`** |
| `dbt.sources` | `dbt-fetch-sources` | `null` | — | source names for `from.source` |
| `dbt.modified-models` | `dbt-fetch-modified-models` | `null` | — | build/run scope (optional) |
| `dbt.compiled-status` | `dbt-check-compiled-status` | `{ modelName, projectName? }` | yes | |
| `dbt.model-outdated` | `dbt-check-model-outdated` | `{ modelName, projectName? }` | yes | |
| `trino.catalogs` | `trino-fetch-catalogs` | `null` | — | |
| `trino.schemas` | `trino-fetch-schemas` | `{ catalog }` | — | |
| `trino.tables` | `trino-fetch-tables` | `{ catalog, schema }` | — | |
| `trino.columns` | `trino-fetch-columns` | `{ catalog, schema, table }` | — | columns for `from.source` authoring |

Registration (all read ops become one line each):

```ts
registerRead('dbt.projects',        'dbt-fetch-projects',          'List dbt projects (incl. manifest).', { nullable: true });
registerRead('dbt.models',          'dbt-fetch-available-models',  'List available models in a project (for `from`).', { project: true });
registerRead('dbt.sources',         'dbt-fetch-sources',           'List declared dbt sources (for `from`).', { nullable: true });
registerRead('dbt.modified-models', 'dbt-fetch-modified-models',   'List models changed vs. the base ref.', { nullable: true });
registerRead('dbt.compiled-status', 'dbt-check-compiled-status',   'Whether a model is compiled (+ path/time).', { project: true });
registerRead('dbt.model-outdated',  'dbt-check-model-outdated',    'Whether a model’s compiled output is stale.', { project: true });
registerRead('trino.catalogs',      'trino-fetch-catalogs',        'List Trino catalogs.', { nullable: true });
registerRead('trino.schemas',       'trino-fetch-schemas',         'List schemas in a catalog.');
registerRead('trino.tables',        'trino-fetch-tables',          'List tables in a schema.');
registerRead('trino.columns',       'trino-fetch-columns',         'List a table’s columns (SHOW COLUMNS).');
```

`system.capabilities` reflects them automatically (it enumerates the registry).

## Steps

1. Generalize `readRequest` (+ keep `model.create` working — it passes a flat/enveloped object).
2. Add `registerRead` helper.
3. Register the ten read ops above.
4. Unit tests: for each op, mock `ctx.api.handleApi` and assert the forwarded `{ type, request }`;
   cover flat vs. `{ request }` vs. null input, `projectName` inference (0/1/many projects), and the
   unknown-op error.
5. Update `command-reference.md` examples if any op name/shape changed (they match today).

## Verification (against live `opus`)

```bash
.dj/bin/dj system.capabilities          # lists the new read ops as sideEffect=read
.dj/bin/dj dbt.projects
.dj/bin/dj dbt.models  --json '{"projectName":"opus"}'   # <- available models for `from`
.dj/bin/dj dbt.sources
.dj/bin/dj trino.catalogs
.dj/bin/dj trino.schemas --json '{"catalog":"opus_raw_dl"}'
.dj/bin/dj trino.tables  --json '{"catalog":"opus_raw_dl","schema":"pharos_metrics_views"}'
.dj/bin/dj trino.columns --json '{"catalog":"opus_raw_dl","schema":"pharos_metrics_views","table":"node_cpu_hourly_cost_view"}'
```

Negative: bad/missing payload for a non-nullable op → exit 2/1 with a clear message.

---

# Part 2 — Authoring-support APIs to add next (analysis)

Derived from tracing the Create-Model flow (`SelectNode.tsx`, `JoinNode.tsx`, `ModelWizard/*`,
`column-lineage-handler.ts`). These are the APIs an agent needs to author a model end-to-end and to
run adjacent operations, ranked by value.

## A. Fill `select` with real upstream columns (highest value)

`from` lists come from Part 1 (`dbt.models` / `dbt.sources`). The missing piece is **columns of the
chosen upstream**:

- **Source columns** → `framework-column-lineage` exposes *data* actions in
  `column-lineage-handler.ts`: `get-source-columns`, `get-source-tables`, `get-seed-columns`,
  `compute-source-lineage`, `export-source-lineage`, `validate`. Expose these via an
  **action-allowlisted** CLI op (e.g. `columns.source`, `columns.seed`), mapping the CLI op to a fixed
  `action` — never the UI actions (`webview-ready`, `save-csv`, `switch-to-model-column`,
  `switch-to-source-column`).
- **Model columns** → the visual editor reads them from the parsed **manifest** node `columns`
  (`extractColumnsFromNode` / `manifestColumns`) and, for the model being authored, from
  `framework-model-cte-analysis`. Recommend a convenience op **`model.columns`** that resolves an
  upstream model’s columns from `dbt-fetch-projects` manifest (thin, read-only), so the agent doesn’t
  parse the whole manifest itself.

## B. Read an existing model (template / update)

| CLI op | API type | side effect | use |
|---|---|---|---|
| `model.get` | `framework-get-model-data` | read | read an existing model’s JSON as a starting point |
| `model.original-files` | `framework-get-original-model-files` | read | inputs the update flow needs (`originalModelPath`) |
| `model.settings.get` | `framework-get-model-settings` | read | model settings |

(Excluded: `framework-get-current-model-data` — active-editor bound.)

## C. Validate SQL before authoring/running

| CLI op | API type | side effect | use |
|---|---|---|---|
| `query.analyze` | `trino-analyze-query` | read | validate/EXPLAIN SQL without executing it |

(Plus the already-planned `model.preview`, `model.exists`, `model.cte-analysis`.)

## D. Model tests (a distinct “other operations” surface)

| CLI op | API type | side effect | use |
|---|---|---|---|
| `tests.list` | `dbt-fetch-models-with-tests` | read | which models have tests |
| `tests.add` | `dbt-add-model-tests` | mutate | add data tests to a model |
| `tests.remove` | `dbt-remove-model-tests` | mutate | remove tests |
| `tests.run` | `dbt-run-test` | mutate | run a model’s tests |

## E. Project context

| CLI op | API type | side effect | use |
|---|---|---|---|
| `project.overview` | `data-explorer-get-project-overview` | read | a map of the project for the agent |

## Excluded (unchanged rationale)

Active-editor-bound (`framework-get-current-model-data`, `data-explorer-detect-active-model`), pure UI
(`*-open-*`, `*-ready`, `switch-to-*`, `save-csv`), `state-*` form persistence, and credential/profile
ops (`trino-set-credentials`, `trino-*-profile`) — deferred on security grounds.

## Recommended next wave (after Part 1)

1. **`model.columns` + `columns.source`** — unblocks `select` authoring from real upstream columns.
2. **`model.get`** — read an existing model to template/update.
3. **`tests.*`** — let the agent add/verify data tests on models it creates.
4. **`query.analyze`** — cheap SQL validation.

Each is the same thin-passthrough pattern; `columns.source` additionally needs the action allowlist
(map one CLI op → one fixed `framework-column-lineage` action, reject the rest).
