# DJ CLI — Phase 1 Plan

## Context

DJ's authoring features (create model, create source, compile, preview, query, lineage) are today
reachable only through the VS Code webview UI. The goal of this work is to let a **terminal or an AI
agent** drive those same features by forwarding to the extension's existing `Api.handleApi(...)` —
the single entry point the webview already uses. Nothing is reimplemented; each CLI command is a
thin passthrough to one `handleApi` operation.

Phase 1 extends the CLI's **operation allowlist** to cover every `handleApi` operation that is
meaningful without an interactive UI, so an agent can introspect the warehouse, author models and
sources, compile/parse, and read data — all from the command line.

**Inclusion rule.** An operation qualifies when it is *payload-driven* and *returns a value or writes
a file*, with **no dependence on an active editor, an open webview panel, or interactive UI.**
Excluded: panel/open/ready messages, form-state persistence, active-editor-bound reads
(`dbt-get-model-info`, `data-explorer-detect-active-model`), and credential/profile mutations
(deferred on security grounds).

## Design principles

- **Thin passthrough.** Each op handler calls *only* `ctx.api.handleApi(...)` — never sockets, never
  raw `dj.command.*`. Business logic, validation, and file placement stay in the extension.
- **Flat payloads (no `request` wrapper).** The user passes the entity definition directly
  (e.g. the model fields). The CLI wraps it into `{ request: <payload> }` internally before calling
  `handleApi`. Escape hatch: if the payload already has a top-level `request` key, it is treated as
  pre-wrapped. No-argument ops receive `{ request: null }`.
- **`projectName` inference.** Reuse `resolveProjectName()` — infer the sole dbt project when
  omitted; error listing names when more than one exists. Applies to every op that carries
  `projectName`.
- **`sideEffect` labeling.** Each op is `read` or `mutate`; this drives `system.capabilities` (and a
  future mutation-confirm policy / MCP `tools/list`).
- **Error normalization.** Errors thrown by `handleApi` map to `{ error: { message, details? } }`,
  surfaced as CLI exit code `1`.
- **Input.** `--file <path>` · `--json '<str>'` · piped stdin. `--file` is recommended for agents
  (no shell-quoting). See `command-reference.md` for the quoting rationale.

## Operations (Phase 1)

Full command list with descriptions and examples lives in **`command-reference.md`**. Summary by
category:

### Authoring
| CLI op | API | Side effect |
|---|---|---|
| `model.create` | `framework-model-create` | mutate |
| `source.create` | `framework-source-create` | mutate |
| `model.update` | `framework-model-update` | mutate |
| `model.preview` | `framework-model-preview` | read (dry-run) |
| `model.exists` | `framework-check-model-exists` | read |
| `model.cte-analysis` | `framework-model-cte-analysis` | read |

### Read
| CLI op | API | Side effect |
|---|---|---|
| `trino.catalogs` | `trino-fetch-catalogs` | read |
| `trino.schemas` | `trino-fetch-schemas` | read |
| `trino.tables` | `trino-fetch-tables` | read |
| `trino.columns` | `trino-fetch-columns` | read |
| `dbt.projects` | `dbt-fetch-projects` | read |
| `dbt.sources` | `dbt-fetch-sources` | read |
| `dbt.models` | `dbt-fetch-available-models` | read |
| `dbt.compiled-status` | `dbt-check-compiled-status` | read |
| `dbt.model-outdated` | `dbt-check-model-outdated` | read |

### Mutate
| CLI op | API | Side effect |
|---|---|---|
| `dbt.compile` | `dbt-model-compile` | mutate |
| `dbt.compile-logs` | `dbt-compile-with-logs` | mutate |
| `dbt.parse` | `dbt-parse-project` | mutate |
| `dbt.run` | `dbt-run-model` | mutate |

### Query & data read
| CLI op | API | Side effect |
|---|---|---|
| `model.compiled-sql` | `data-explorer-get-compiled-sql` | read |
| `model.query` | `data-explorer-execute-query` | read |
| `query.execute` | `query-draft-execute` | read (`SELECT` only) |
| `model.lineage` | `data-explorer-get-model-lineage` | read |
| `model.reverse-lineage` | `data-explorer-get-reverse-lineage` | read |

## Cross-cutting adaptations (do once, reuse across ops)

1. **`projectName` inference** — reuse `resolveProjectName()`; apply to every op carrying `projectName`.
2. **Flat-payload auto-wrap** — the input reader wraps a bare payload into `{ request }` (and passes
   `{ request: null }` for no-arg ops such as `trino.catalogs` / `dbt.projects`).
3. **`dbt.parse` request rewrite** — the API expects a full `DbtProject` object plus a `logger` with
   function callbacks (not JSON-serializable). The CLI wrapper accepts `{ projectName }`, resolves the
   `DbtProject` from the bridge context, and injects a server-side logger. Requires exposing the dbt
   project map on `OperationContext` (today it exposes only `projectNames()`).
4. **`dbt.run` output caveat** — output streams to a VS Code terminal (returns `null`), not stdout.
   Ship as fire-and-forget for Phase 1; stdout redirect is deferred.
5. **`column.lineage` (stretch)** — `framework-column-lineage` is an action multiplexer; only the data
   actions (`get-columns`, `compute`, `validate`, `export-lineage`, `get-source-columns`) are CLI-
   meaningful. Expose a filtered action allowlist or defer.

## Implementation steps

1. Extend `src/services/cliBridge/operationRegistry.ts` with one entry per operation above.
2. Add a dbt-projects accessor to `OperationContext` (needed by `dbt.parse` / `dbt.run`).
3. Implement the `dbt.parse` wrapper adaptation (resolve `DbtProject`, inject logger).
4. Update the input reader to auto-wrap flat payloads into `{ request }`.
5. Ensure `system.capabilities` reports every new op with its `sideEffect`.
6. Docs: `command-reference.md` (done) and update `README.md`; keep this plan current.
7. Tests + package (see verification).

## Verification

Run against the live `opus` workspace (`projectName: "opus"`):

- `.dj/bin/dj system.capabilities` lists every new op with the correct `sideEffect`.
- **Read round-trips:** `trino.catalogs`, `trino.schemas`, `trino.columns` for a known table,
  `dbt.projects`, `dbt.models`, `dbt.compiled-status`.
- **Author:** `source.create` for a real Trino table → `.source.json` written; `model.preview` on a
  `stg_select_source` → SQL/YAML returned; `model.exists` before/after a `model.create`.
- **Mutate:** `dbt.compile` a known model → `{ success: true }`; `dbt.parse` refreshes the manifest.
- **Query:** `model.compiled-sql` and `model.query` for a compiled model; `query.execute` a `SELECT`.
- **Negative:** each op with a bad payload → exit `1` with the downstream error message.
- **CI:** registry allowlist + dispatch + `projectName` inference + flat-payload auto-wrap +
  `dbt.parse` rewrite unit tests; then `npm run lint:all && npm run compile && npm test && npm run package`.

## Deferred (post Phase 1)

`dbt.run` stdout redirect · `column.lineage` action allowlist · Lightdash YAML CRUD
(`lightdash-yaml-*`) · credential / profile ops · MCP stdio adapter over the same registry ·
schema-level input validation reusing `.dj/schemas/` · Windows named-pipe transport.
