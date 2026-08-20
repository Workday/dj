# DJ CLI Bridge — Phase 1 operation plan

## Context

The DJ bridge (shipped) exposes exactly one mutation — `model.create` — over a local
Unix-socket JSON-RPC transport, deployed to `.dj/bin/dj`. Every op is a **thin handler that
forwards to the extension's existing `Api.handleApi(...)`** (the same entry point the webview
uses); no business logic is reimplemented. See `docs/cli_commands/README.md` for the transport.

Phase 1 extends the **operation allowlist** (`src/services/cliBridge/operationRegistry.ts`) to
cover the rest of `handleApi` that is meaningful without an interactive UI, so an agent/script can
introspect a warehouse, author models **and sources**, dry-run, compile, and read data — all from
the terminal.

**Inclusion test:** an API is CLI-able when it is *payload-driven* and *returns a value or writes a
file* — with **no dependency on an active editor, an open webview panel, or interactive UI**.
Excluded: `*-close-panel`, `*-open-*`, `*-ready`, `state-*` form-persistence, `dbt-get-model-info`
and `data-explorer-detect-active-model` (active-editor bound), and `trino-set-credentials` /
`trino-*-profile` (credential mutation — deferred on security grounds).

## Design rules (unchanged from the shipped pattern)

- One registry entry per op: `{ name, description, sideEffect: 'read'|'mutate', handler(input, ctx) }`.
- Handlers call **only** `ctx.api.handleApi(...)` — never sockets, never raw `dj.command.*`.
- `sideEffect` drives `system.capabilities` (and a future MCP `tools/list` + mutation-confirm policy).
- `projectName` resolution is shared: reuse `resolveProjectName()` (sole-project inference; error listing
  names when >1). Applies to every op whose request carries `projectName`.
- Errors thrown by `handleApi` normalize to `{ error:{ message, details? } }` → CLI exit 1.

---

## Phase 1 operations

Request shapes are the **exact** `handleApi` request objects (verified in `src/shared/*/types.ts`).
CLI input is always `{ "request": { … } }` on `--file` / `--json` / stdin, mirroring `model.create`.

### Tier A — Authoring (mutate / dry-run)

| CLI op | API type | request | response | notes |
|---|---|---|---|---|
| `source.create` | `framework-source-create` | `{ projectName?, trinoCatalog, trinoSchema, trinoTable }` | `string` | **Self-sufficient** — the handler calls `trino-fetch-columns` internally (`SHOW COLUMNS`) and writes the `.source.json`; caller supplies only catalog/schema/table. Same safe write pattern as `model.create`. |
| `model.update` | `framework-model-update` | `{ projectName?, modelJson, originalModelPath }` | `string` | Merges with existing JSON, validates, relocates on name/topic/group change, triggers sync. Needs `originalModelPath`. |
| `model.preview` | `framework-model-preview` | `{ projectName?, modelJson }` | `{ json, sql, yaml, columns[] }` | **Read / dry-run** — generate SQL+YAML+columns without writing. The "show me before I create" op. |
| `model.exists` | `framework-check-model-exists` | `{ projectName?, modelJson: {group,name,topic,type} }` | `{ exists, fileName, filePath }` | Cheap pre-flight guard. |
| `model.cte-analysis` | `framework-model-cte-analysis` | `{ projectName?, modelJson }` | `{ columns{}, diagnostics[] }` | Per-CTE inferred columns + diagnostics; validates CTE authoring headlessly. |

### Tier B — Introspection (read)

| CLI op | API type | request | response |
|---|---|---|---|
| `trino.catalogs` | `trino-fetch-catalogs` | `null` | `string[]` |
| `trino.schemas` | `trino-fetch-schemas` | `{ catalog }` | `string[]` |
| `trino.tables` | `trino-fetch-tables` | `{ catalog, schema }` | `string[]` |
| `trino.columns` | `trino-fetch-columns` | `{ catalog, schema, table }` | `TrinoTableColumn[]` (the `SHOW COLUMNS` an agent needs before `source.create`) |
| `dbt.projects` | `dbt-fetch-projects` | `null` | `DbtProject[]` |
| `dbt.sources` | `dbt-fetch-sources` | `null` | `string[]` (runs `dbt list --resource-type source` — slower) |
| `dbt.models` | `dbt-fetch-available-models` | `{ projectName }` | `string[]` |
| `dbt.compiled-status` | `dbt-check-compiled-status` | `{ modelName, projectName }` | `{ isCompiled, compiledPath?, lastCompiled? }` |
| `dbt.model-outdated` | `dbt-check-model-outdated` | `{ modelName, projectName }` | `{ isOutdated, hasCompiledFile, reason? }` |

### Tier C — dbt build (mutate; runs dbt in the container)

| CLI op | API type | request | response | notes |
|---|---|---|---|---|
| `dbt.compile` | `dbt-model-compile` | `{ modelName, projectName }` | `{ success, message? }` | Clean success/fail. |
| `dbt.compile-logs` | `dbt-compile-with-logs` | `{ modelName, projectName }` | `{ success }` | Same, log-emitting variant. |
| `dbt.parse` | `dbt-parse-project` | `{ project, logger? }` | `DbtProjectManifest` | **Adaptation needed** — request wants a full `DbtProject` object and a `logger` with function callbacks (not JSON-serializable). CLI wrapper should accept `{ projectName }`, resolve the `DbtProject` from `ctx`, and drop/replace `logger` with a server-side logger. |
| `dbt.run` | `dbt-run-model` | `{ config: DbtRunConfig }` | `null` | ⚠️ **Output-capture caveat** — runs via `executeDbtCommand` → output goes to a VS Code terminal, not stdout; returns `null`. Ship as fire-and-forget, or defer until output is redirectable. |

### Tier D — Query & data (read; read-only SELECT policy)

| CLI op | API type | request | response | notes |
|---|---|---|---|---|
| `model.compiled-sql` | `data-explorer-get-compiled-sql` | `{ modelName, projectName }` | `{ sql \| null, … }` | Read the compiled SQL for a model. |
| `model.query` | `data-explorer-execute-query` | `{ modelName, projectName, limit? }` | `{ columns, rows, rowCount, executionTime? }` | Runs the **model's** compiled query (data preview). |
| `query.execute` | `query-draft-execute` | `{ sql, limit? }` | `{ columns, rows }` | **Arbitrary SQL** — must be gated by the read-only SELECT policy in `.agents/dj/AGENTS.md` (confirm catalog/schema, never production). |
| `model.lineage` | `data-explorer-get-model-lineage` | `{ modelName, projectName }` | `LineageData` | |
| `model.reverse-lineage` | `data-explorer-get-reverse-lineage` | `{ kind: 'dashboard'\|'chart', slug }` | `ReverseLineageData` | |

### Stretch (needs an action-allowlist, not a plain passthrough)

- `column.lineage` (`framework-column-lineage`) is an **action multiplexer**; only the data actions
  (`get-columns`, `compute`, `validate`, `export-lineage`, `get-source-columns`) are CLI-meaningful —
  the `webview-ready` / `switch-to-*` / `save-csv` actions are UI. Expose a filtered subset or defer.

---

## Cross-cutting adaptations (do once, reuse across ops)

1. **`projectName` inference** — already implemented (`resolveProjectName`); apply to every Tier A/B/C
   op that carries `projectName`.
2. **`dbt.parse` request rewrite** — accept `{ projectName }`, look up the `DbtProject` from the bridge
   context's project map, inject a no-op/console `logger`. (Add `dbt` or a `projects` accessor to
   `OperationContext` — today it exposes `projectNames()`; parse/run need the full project object.)
3. **`dbt.run` output** — decide fire-and-forget vs redirect-to-stdout before shipping; document the
   caveat in `--help` either way.
4. **Read vs mutate labeling** — Tier B/D are `read`; Tier A (except `preview`/`exists`/`cte-analysis`)
   and Tier C are `mutate`. `preview`, `exists`, `cte-analysis` are `read` despite living in Tier A.

## Registry sketch

```ts
// operationRegistry.ts — add alongside the existing three
register({ name: 'source.create', sideEffect: 'mutate',
  handler: async (input, ctx) => {
    const request = readRequest(input); resolveProjectName(request, ctx);
    return { ok: true, response: await ctx.api.handleApi({ type:'framework-source-create', request }) };
  }});
register({ name: 'model.preview', sideEffect: 'read',
  handler: async (input, ctx) => {
    const request = readRequest(input); resolveProjectName(request, ctx);
    return await ctx.api.handleApi({ type:'framework-model-preview', request });
  }});
register({ name: 'trino.columns', sideEffect: 'read',
  handler: (input, ctx) => ctx.api.handleApi({ type:'trino-fetch-columns', request: readRequest(input) }) });
// …one entry per row above. Reads that take `null` request pass `request: null`.
```

## Testing (extends the shipped smoke suite)

Run against the live `opus` workspace (`projectName: "opus"`):
- `.dj/bin/dj system.capabilities` lists every new op with the right `sideEffect`.
- **Read round-trips:** `trino.catalogs`, `trino.schemas --json '{"request":{"catalog":"…"}}'`,
  `trino.columns` for a known table, `dbt.projects`, `dbt.models`, `dbt.compiled-status`.
- **Author-both:** `source.create` for a real Trino table → `.source.json` written; then
  `model.preview` on a `stg_select_source` reading it → SQL/YAML returned; `model.exists` before/after
  a `model.create`.
- **Build:** `dbt.compile` a known model → `{success:true}`; `dbt.parse` refreshes the manifest.
- **Query:** `model.compiled-sql` and `model.query` for a compiled model; `query.execute` a `SELECT`.
- **Negative:** each op with a bad request → exit 1 with the downstream error message.
- CI: extend the registry unit tests (allowlist + dispatch + `projectName` inference + `dbt.parse`
  request rewrite), then `npm run lint:all && npm run compile && npm test && npm run package`.

## Deferred (post phase 1)

`dbt.run` stdout redirect; `column.lineage` action-allowlist; Lightdash YAML CRUD
(`lightdash-yaml-*`); credential/profile ops; MCP stdio adapter over the same registry;
schema-level input validation reusing `.dj/schemas/`.
