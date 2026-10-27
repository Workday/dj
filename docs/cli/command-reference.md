# DJ CLI — Command Reference

The DJ CLI (`.dj/bin/dj`) lets a terminal or an AI agent invoke DJ features by forwarding to the
extension's existing `Api.handleApi(...)` — the **same entry point the visual editor uses**. No
business logic is reimplemented; each command is a thin passthrough to a `handleApi` operation.

This document lists the CLI operations, grouped by purpose, with example usage.

**Payload envelopes.** `model.create` and `source.create` take **flat** field objects (the same
shape the Create Model / Create Source forms post). `model.preview`, `model.exists`,
`model.cte-analysis`, and `model.update` require a **`modelJson`** object; **`model.preview`** also
accepts the same flat body as `model.create` (auto-wrapped). **`model.update`** requires **`modelJson`**
plus **`originalModelPath`** (absolute path) **or** **`modelName`** (resolved within `projectName`).
`projectName` may be omitted when the workspace has a single dbt project (it is inferred).

**JSON sync vs dbt compile.** `model.sync` (and auto-sync after `model.create`) writes workspace
`models/**/*.sql` and `*.yml` from `.model.json`. `dbt.compile` / `dbt.compile-logs` only update
`target/compiled` — they do not replace `model.sync`.

| CLI op                                | Payload pattern                                                    |
| ------------------------------------- | ------------------------------------------------------------------ |
| `model.create`                        | Flat — `type`, `group`, `topic`, `name`, … (auto-sync after write) |
| `model.sync`                          | `{ "modelName": "…" }` or `{}` for full sync                       |
| `source.create`                       | Flat Trino identity fields                                         |
| `model.preview`, `model.cte-analysis` | `{ "modelJson": { … } }` or flat create body                       |
| `model.exists`                        | `{ "modelJson": { "type", "group", "topic", "name" } }`            |
| `model.update`                        | `{ "modelJson": { … } }` + `originalModelPath` **or** `modelName`  |

Examples: `examples/model-create.request.json`, `examples/model-preview.request.json`,
`examples/model-exists.request.json`, `examples/model-update.request.json`, `examples/dbt-run.request.json`,
`examples/model-columns.request.json`, `examples/model-lineage.request.json`, `examples/query-execute.request.json`,
`examples/dbt-compile.request.json`, `examples/dbt-models-search.request.json`, `examples/dbt-project.request.json`,
`examples/trino-schemas.request.json`, `examples/trino-tables.request.json`, `examples/trino-columns.request.json`,
`examples/source-create.request.json`, `examples/lightdash-assets.request.json`, `examples/workflow-scaffold-explore.request.json`.

**Agent invocation preference.** For every operation except **`model.create`**, **`model.preview`**, and **`source.create`**, prefer **`--file examples/…`** plus CLI flags (`--modelName`, `--projectName`, `--select`, `--sql`, `--depth`) when they map to payload fields — flags override file fields. Avoid inline `--json` in shell scripts and agent commands.

**Authoring exceptions.** Those three ops still use **`--file`**, but the JSON body is the product: **flat** fields for create/source, **`modelJson`** (or flat auto-wrapped) for preview — not the flags-first shortcut pattern used elsewhere.

**Per-op syntax (offline).** Run `.dj/bin/dj <operation> --help` for agent-friendly JSON (`exampleCommand`, `allowedFlags`, `exampleFile`, `payloadNotes`). When the bridge is up, `system.help` with `{ "operation": "…" }` returns the same shape.

**CLI flags (merged into JSON after `--file` / `--json`; flags win):** `--modelName`, `--projectName`,
`--select` (`dbt.compile`), `--sql` (`query.execute`), `--depth` (`model.lineage`). Usage:
`dj <operation> [--help] [--file req.json] [--modelName X] [--projectName P] …`. Default timeout 120s;
`model.create`, `model.create-batch`, and `dbt.parse` default to 600000 ms unless `--timeout` is set.
Empty RPC results exit non-zero (no blank stdout on success).

---

## Authoring

| CLI op               | API                            | What it does                                                                                      | Agent example                                                                                      |
| -------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `model.create`       | `framework-model-create`       | Create a new model definition file (`.model.json`) and auto-sync SQL/YML; optional `validateOnly` | `.dj/bin/dj model.create --file examples/model-create.request.json --timeout 600000` _(flat file)_ |
| `model.create-batch` | `framework-model-create-batch` | Create multiple models with one sync at the end                                                   | `.dj/bin/dj model.create-batch --file batch.json --timeout 600000`                                 |
| `model.sync`         | `framework-model-sync`         | Generate/refresh workspace `.sql`/`.yml` from JSON (optional single model)                        | `.dj/bin/dj model.sync --modelName int__g__t__n --projectName my_project`                          |
| `source.create`      | `framework-source-create`      | Create a source definition from a Trino table (columns auto-introspected)                         | `.dj/bin/dj source.create --file examples/source-create.request.json` _(flat file)_                |
| `model.update`       | `framework-model-update`       | Update an existing model (merge, validate, relocate on rename)                                    | `.dj/bin/dj model.update --file examples/model-update.request.json`                                |
| `model.preview`      | `framework-model-preview`      | Dry-run — return the generated SQL / YAML / columns **without writing**                           | `.dj/bin/dj model.preview --file examples/model-preview.request.json` _(modelJson or flat)_        |
| `model.exists`       | `framework-check-model-exists` | Check whether a model already exists (pre-flight guard)                                           | `.dj/bin/dj model.exists --file examples/model-exists.request.json`                                |
| `model.cte-analysis` | `framework-model-cte-analysis` | Return per-CTE inferred columns + diagnostics                                                     | `.dj/bin/dj model.cte-analysis --file examples/model-preview.request.json`                         |

## Read

| CLI op                      | API                                   | What it does                                                          | Agent example                                                                                 |
| --------------------------- | ------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `trino.catalogs`            | `trino-fetch-catalogs`                | List Trino catalogs                                                   | `.dj/bin/dj trino.catalogs`                                                                   |
| `trino.schemas`             | `trino-fetch-schemas`                 | List schemas in a catalog                                             | `.dj/bin/dj trino.schemas --file examples/trino-schemas.request.json`                         |
| `trino.tables`              | `trino-fetch-tables`                  | List tables in a schema                                               | `.dj/bin/dj trino.tables --file examples/trino-tables.request.json`                           |
| `trino.columns`             | `trino-fetch-columns`                 | List a table's columns (`SHOW COLUMNS`)                               | `.dj/bin/dj trino.columns --file examples/trino-columns.request.json`                         |
| `dbt.projects`              | `dbt-fetch-projects`                  | List dbt projects in the workspace                                    | `.dj/bin/dj dbt.projects --file examples/dbt-project.request.json`                            |
| `dbt.sources`               | `dbt-fetch-sources`                   | List declared dbt sources                                             | `.dj/bin/dj dbt.sources`                                                                      |
| `dbt.models`                | `dbt-fetch-available-models`          | List model names in a project                                         | `.dj/bin/dj dbt.models --file examples/dbt-project.request.json`                              |
| `dbt.models.search`         | `dbt-search-models`                   | Search models with filters (pattern, topic, tags, Lightdash label, …) | `.dj/bin/dj dbt.models.search --file examples/dbt-models-search.request.json`                 |
| `model.get`                 | `framework-get-model-data`            | Read an existing `.model.json`                                        | `.dj/bin/dj model.get --modelName int__g__t__n --projectName my_project`                      |
| `model.columns`             | `framework-model-columns`             | Column list from manifest (dim/fct, types)                            | `.dj/bin/dj model.columns --file examples/model-columns.request.json`                         |
| `model.similar`             | `framework-model-similar`             | Peer models (same upstream, group, topic)                             | `.dj/bin/dj model.similar --modelName int__g__t__n --projectName my_project`                  |
| `lightdash.assets`          | `data-explorer-list-lightdash-assets` | Dashboard/chart list with optional `query` filter                     | `.dj/bin/dj lightdash.assets --file examples/lightdash-assets.request.json`                   |
| `workflow.scaffold-explore` | `framework-workflow-scaffold-explore` | Suggested int/mart names for a new explore                            | `.dj/bin/dj workflow.scaffold-explore --file examples/workflow-scaffold-explore.request.json` |
| `dbt.modified-models`       | `dbt-fetch-modified-models`           | List models changed vs. the base ref (build/run scope)                | `.dj/bin/dj dbt.modified-models --file examples/dbt-modified-models.request.json`             |
| `dbt.compiled-status`       | `dbt-check-compiled-status`           | Whether a model is compiled (+ path / timestamp)                      | `.dj/bin/dj dbt.compiled-status --modelName int__g__t__n --projectName my_project`            |
| `dbt.model-outdated`        | `dbt-check-model-outdated`            | Whether a model's compiled output is stale                            | `.dj/bin/dj dbt.model-outdated --modelName int__g__t__n --projectName my_project`             |

## Mutate

| CLI op               | API                     | What it does                                                 | Agent example                                                                      |
| -------------------- | ----------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `dbt.compile`        | `dbt-model-compile`     | Compile via `modelName` or `select` (unknown keys rejected)  | `.dj/bin/dj dbt.compile --file examples/dbt-compile.request.json`                  |
| `dbt.compile-select` | `dbt-model-compile`     | Same as compile with `{ "select": "…" }` only                | `.dj/bin/dj dbt.compile-select --select "mart__a int__b" --projectName my_project` |
| `dbt.compile-logs`   | `dbt-compile-with-logs` | Compile a model (log-emitting variant)                       | `.dj/bin/dj dbt.compile-logs --file examples/dbt-compile.request.json`             |
| `dbt.parse`          | `dbt-parse-project`     | Parse the project and refresh the manifest                   | `.dj/bin/dj dbt.parse --file examples/dbt-project.request.json --timeout 600000`   |
| `dbt.run`            | `dbt-run-model`         | Run a model via dbt (output streams to the VS Code terminal) | `.dj/bin/dj dbt.run --file examples/dbt-run.request.json`                          |

## Query & data read

| CLI op                  | API                                 | What it does                                                                                                                                                                                                                                                                                       | Agent example                                                                     |
| ----------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `model.compiled-sql`    | `data-explorer-get-compiled-sql`    | Read a model's compiled SQL                                                                                                                                                                                                                                                                        | `.dj/bin/dj model.compiled-sql --modelName int__g__t__n --projectName my_project` |
| `model.query`           | `data-explorer-execute-query`       | Run **compiled SQL** for a model via Trino (adds `LIMIT` if missing). Works for ephemeral, view, and table materializations — it does not scan the deployed warehouse relation. For fleet checks on a materialized table, use `query.execute` against the catalog relation or run `dbt.run` first. | `.dj/bin/dj model.query --file examples/model-query.request.json`                 |
| `query.execute`         | `query-draft-execute`               | Run an arbitrary read-only `SELECT`                                                                                                                                                                                                                                                                | `.dj/bin/dj query.execute --file examples/query-execute.request.json`             |
| `model.lineage`         | `data-explorer-get-model-lineage`   | Upstream/downstream lineage (CLI defaults to full upstream chain; optional `depth`, `maxNodes`)                                                                                                                                                                                                    | `.dj/bin/dj model.lineage --file examples/model-lineage.request.json`             |
| `model.data-check`      | `framework-model-data-check`        | Read-only sanity-check SQL from a named template                                                                                                                                                                                                                                                   | `.dj/bin/dj model.data-check --modelName mart__g__t__n --file payload.json`       |
| `model.reverse-lineage` | `data-explorer-get-reverse-lineage` | Trace lineage from a dashboard / chart back to models                                                                                                                                                                                                                                              | `.dj/bin/dj model.reverse-lineage --file payload.json`                            |

---

## Example commands

```bash
# System (no payload)
.dj/bin/dj system.ping
.dj/bin/dj system.capabilities
.dj/bin/dj system.help
.dj/bin/dj model.lineage --help

# Read / introspect (--file preferred)
.dj/bin/dj trino.schemas --file examples/trino-schemas.request.json
.dj/bin/dj dbt.models --file examples/dbt-project.request.json
.dj/bin/dj dbt.models.search --file examples/dbt-models-search.request.json
.dj/bin/dj lightdash.assets --file examples/lightdash-assets.request.json

# Authoring — flat create / source; wrapped preview (see examples/)
.dj/bin/dj model.create --file examples/model-create.request.json --timeout 600000
.dj/bin/dj model.preview --file examples/model-preview.request.json
.dj/bin/dj model.exists --file examples/model-exists.request.json
.dj/bin/dj model.update --file examples/model-update.request.json
.dj/bin/dj source.create --file examples/source-create.request.json

# Mutate (dbt build)
.dj/bin/dj dbt.compile --file examples/dbt-compile.request.json
.dj/bin/dj dbt.parse --file examples/dbt-project.request.json --timeout 600000

# Query & data read
.dj/bin/dj model.lineage --file examples/model-lineage.request.json
.dj/bin/dj model.compiled-sql --modelName stg__mlde__metrics__node_cpu_daily_cost --projectName my_project
.dj/bin/dj query.execute --file examples/query-execute.request.json
```

Example **`model.create`** body (flat — see `examples/model-create.request.json`):

```json
{
  "type": "stg_select_source",
  "projectName": "my_project",
  "group": "mlde",
  "topic": "metrics",
  "name": "node_cpu_daily_cost",
  "from": { "source": "my_catalog__my_schema.node_cpu_hourly_cost_view" },
  "select": [
    "node",
    { "name": "cost_date", "expr": "date(hour)", "type": "date" },
    { "name": "daily_cost", "expr": "sum(cost)", "type": "double" }
  ]
}
```

Example **`model.preview`** envelope:

```json
{
  "modelJson": {
    "type": "stg_select_source",
    "group": "mlde",
    "topic": "metrics",
    "name": "node_cpu_daily_cost",
    "from": { "source": "my_catalog__my_schema.node_cpu_hourly_cost_view" },
    "select": [
      "node",
      { "name": "daily_cost", "expr": "sum(cost)", "type": "double" }
    ]
  }
}
```

---

## Passing JSON to a command (why the quotes?)

Inline JSON is wrapped in single quotes because of the **shell**, not the CLI. Before the CLI ever
runs, your shell parses the command line and treats several JSON characters specially: spaces split
arguments, `{ }` can trigger brace expansion, `"` is quoting syntax, and `$`, `*`, `<`, `>`, `;`,
`&` all have their own meanings. Passing JSON bare —

```bash
.dj/bin/dj model.create --json {"type":"stg_select_source","name":"x"}   # broken
```

— reaches the CLI as several mangled arguments, not one JSON value. Single quotes tell the shell
"take this literally as one argument":

```bash
.dj/bin/dj model.create --json '{"type":"stg_select_source","name":"x"}'
```

### Avoiding quotes entirely

The CLI accepts input three ways — `--file`, `--json`, or piped **stdin**. Every method below
passes the JSON verbatim with **no shell quoting**:

| Method         | Example                                     | Best for                                   |
| -------------- | ------------------------------------------- | ------------------------------------------ |
| File           | `.dj/bin/dj model.create --file model.json` | Agents & larger payloads (**recommended**) |
| Stdin redirect | `.dj/bin/dj model.create < model.json`      | Reading a saved payload                    |
| Pipe           | `cat model.json \| .dj/bin/dj model.create` | Chaining from another command              |
| Heredoc        | `.dj/bin/dj model.create <<'JSON'` … `JSON` | Writing inline without escaping            |

**Recommendation:** an AI agent should write payloads to **`examples/`** (or a temp copy) and pass **`--file`**. Reserve inline **`--json '…'`** for quick **manual** one-liners only. **Exceptions:** **`model.create`**, **`model.preview`**, and **`source.create`** always use **`--file`** with the full flat or envelope JSON — not flag shortcuts.

---

## Constraints

- VS Code with the DJ extension must be running on the workspace; if multiple windows are open, the
  newest one answering `system.ping` serves the command.
- macOS / Linux only (Unix domain socket); Windows transport is deferred.
- `query.execute` (arbitrary SQL) is restricted to read-only `SELECT` per workspace policy — confirm
  catalog/schema, never target production.
- Exit codes: `0` ok · `1` operation error · `2` bad input · `3` no live endpoint · `4` timeout.
