# DJ CLI — Command Scope & Reference

The DJ CLI (`.dj/bin/dj`) lets a terminal or an AI agent invoke DJ features by forwarding to the
extension's existing `Api.handleApi(...)` — the **same entry point the visual editor uses**. No
business logic is reimplemented; each command is a thin passthrough to a `handleApi` operation.

This document lists the full scope of operations that can be exposed as CLI commands, grouped by
purpose, with example usage.

**Inclusion rule.** An API qualifies as a CLI command when it is *payload-driven* and *returns a
value or writes a file*, with **no dependence on an active editor, an open webview panel, or
interactive UI**.

**Payload envelopes.** `model.create` and `source.create` take **flat** field objects (the same
shape the Create Model / Create Source forms post). `model.preview`, `model.exists`,
`model.cte-analysis`, and `model.update` require a **`modelJson`** object; **`model.preview`** also
accepts the same flat body as `model.create` (auto-wrapped). **`model.update`** requires **`modelJson`**
plus **`originalModelPath`** (absolute path) **or** **`modelName`** (resolved within `projectName`).
`projectName` may be omitted when the workspace has a single dbt project (it is inferred).

**JSON sync vs dbt compile.** `model.sync` (and auto-sync after `model.create`) writes workspace
`models/**/*.sql` and `*.yml` from `.model.json`. `dbt.compile` / `dbt.compile-logs` only update
`target/compiled` — they do not replace `model.sync`.

| CLI op | Payload pattern |
|--------|-----------------|
| `model.create` | Flat — `type`, `group`, `topic`, `name`, … (auto-sync after write) |
| `model.sync` | `{ "modelName": "…" }` or `{}` for full sync |
| `source.create` | Flat Trino identity fields |
| `model.preview`, `model.cte-analysis` | `{ "modelJson": { … } }` or flat create body |
| `model.exists` | `{ "modelJson": { "type", "group", "topic", "name" } }` |
| `model.update` | `{ "modelJson": { … } }` + `originalModelPath` **or** `modelName` |

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

## Categories at a glance

| Category | Side effect | Impact for an agent |
|---|---|---|
| **Authoring** | writes / reads model & source files | Create and refine DJ models and sources end-to-end from the terminal |
| **Read** | read-only | Discover the warehouse and project structure to ground decisions instead of guessing |
| **Mutate** | runs dbt in the container | Compile, parse, and run to validate authored models |
| **Query & data read** | read-only (`SELECT`) | Inspect compiled SQL, preview data, and trace lineage |

---

## Authoring

*Impact: an agent can author a model or source, dry-run it, and guard against duplicates — the same
flow as the visual editor, driven by JSON.*

| CLI op | API | What it does | Agent example |
|---|---|---|---|
| `model.create` | `framework-model-create` | Create a new model definition file (`.model.json`) and auto-sync SQL/YML; optional `validateOnly` | `.dj/bin/dj model.create --file examples/model-create.request.json --timeout 600000` *(flat file)* |
| `model.create-batch` | `framework-model-create-batch` | Create multiple models with one sync at the end | `.dj/bin/dj model.create-batch --file batch.json --timeout 600000` |
| `model.sync` | `framework-model-sync` | Generate/refresh workspace `.sql`/`.yml` from JSON (optional single model) | `.dj/bin/dj model.sync --modelName int__g__t__n --projectName opus` |
| `source.create` | `framework-source-create` | Create a source definition from a Trino table (columns auto-introspected) | `.dj/bin/dj source.create --file examples/source-create.request.json` *(flat file)* |
| `model.update` | `framework-model-update` | Update an existing model (merge, validate, relocate on rename) | `.dj/bin/dj model.update --file examples/model-update.request.json` |
| `model.preview` | `framework-model-preview` | Dry-run — return the generated SQL / YAML / columns **without writing** | `.dj/bin/dj model.preview --file examples/model-preview.request.json` *(modelJson or flat)* |
| `model.exists` | `framework-check-model-exists` | Check whether a model already exists (pre-flight guard) | `.dj/bin/dj model.exists --file examples/model-exists.request.json` |
| `model.cte-analysis` | `framework-model-cte-analysis` | Return per-CTE inferred columns + diagnostics | `.dj/bin/dj model.cte-analysis --file examples/model-preview.request.json` |

## Read

*Impact: an agent discovers real catalogs, tables, columns, and models before authoring — no
hallucinated names.*

| CLI op | API | What it does | Agent example |
|---|---|---|---|
| `trino.catalogs` | `trino-fetch-catalogs` | List Trino catalogs | `.dj/bin/dj trino.catalogs` |
| `trino.schemas` | `trino-fetch-schemas` | List schemas in a catalog | `.dj/bin/dj trino.schemas --file examples/trino-schemas.request.json` |
| `trino.tables` | `trino-fetch-tables` | List tables in a schema | `.dj/bin/dj trino.tables --file examples/trino-tables.request.json` |
| `trino.columns` | `trino-fetch-columns` | List a table's columns (`SHOW COLUMNS`) | `.dj/bin/dj trino.columns --file examples/trino-columns.request.json` |
| `dbt.projects` | `dbt-fetch-projects` | List dbt projects in the workspace | `.dj/bin/dj dbt.projects --file examples/dbt-project.request.json` |
| `dbt.sources` | `dbt-fetch-sources` | List declared dbt sources | `.dj/bin/dj dbt.sources` |
| `dbt.models` | `dbt-fetch-available-models` | List model names in a project | `.dj/bin/dj dbt.models --file examples/dbt-project.request.json` |
| `dbt.models.search` | `dbt-search-models` | Search models with filters (pattern, topic, tags, Lightdash label, …) | `.dj/bin/dj dbt.models.search --file examples/dbt-models-search.request.json` |
| `model.get` | `framework-get-model-data` | Read an existing `.model.json` | `.dj/bin/dj model.get --modelName int__g__t__n --projectName opus` |
| `model.columns` | `framework-model-columns` | Column list from manifest (dim/fct, types) | `.dj/bin/dj model.columns --file examples/model-columns.request.json` |
| `model.similar` | `framework-model-similar` | Peer models (same upstream, group, topic) | `.dj/bin/dj model.similar --modelName int__g__t__n --projectName opus` |
| `lightdash.assets` | `data-explorer-list-lightdash-assets` | Dashboard/chart list with optional `query` filter | `.dj/bin/dj lightdash.assets --file examples/lightdash-assets.request.json` |
| `workflow.scaffold-explore` | `framework-workflow-scaffold-explore` | Suggested int/mart names for a new explore | `.dj/bin/dj workflow.scaffold-explore --file examples/workflow-scaffold-explore.request.json` |
| `dbt.modified-models` | `dbt-fetch-modified-models` | List models changed vs. the base ref (build/run scope) | `.dj/bin/dj dbt.modified-models --file examples/dbt-modified-models.request.json` |
| `dbt.compiled-status` | `dbt-check-compiled-status` | Whether a model is compiled (+ path / timestamp) | `.dj/bin/dj dbt.compiled-status --modelName int__g__t__n --projectName opus` |
| `dbt.model-outdated` | `dbt-check-model-outdated` | Whether a model's compiled output is stale | `.dj/bin/dj dbt.model-outdated --modelName int__g__t__n --projectName opus` |

## Mutate

*Impact: an agent validates authored models by compiling/parsing and can run them — real feedback,
not just static checks.*

| CLI op | API | What it does | Agent example |
|---|---|---|---|
| `dbt.compile` | `dbt-model-compile` | Compile via `modelName` or `select` (unknown keys rejected) | `.dj/bin/dj dbt.compile --file examples/dbt-compile.request.json` |
| `dbt.compile-select` | `dbt-model-compile` | Same as compile with `{ "select": "…" }` only | `.dj/bin/dj dbt.compile-select --select "mart__a int__b" --projectName opus` |
| `dbt.compile-logs` | `dbt-compile-with-logs` | Compile a model (log-emitting variant) | `.dj/bin/dj dbt.compile-logs --file examples/dbt-compile.request.json` |
| `dbt.parse` | `dbt-parse-project` | Parse the project and refresh the manifest | `.dj/bin/dj dbt.parse --file examples/dbt-project.request.json --timeout 600000` |
| `dbt.run` | `dbt-run-model` | Run a model via dbt (output streams to the VS Code terminal) | `.dj/bin/dj dbt.run --file examples/dbt-run.request.json` |

## Query & data read

*Impact: an agent reads compiled SQL, previews data, and traces lineage to reason about impact —
all read-only.*

| CLI op | API | What it does | Agent example |
|---|---|---|---|
| `model.compiled-sql` | `data-explorer-get-compiled-sql` | Read a model's compiled SQL | `.dj/bin/dj model.compiled-sql --modelName int__g__t__n --projectName opus` |
| `model.query` | `data-explorer-execute-query` | Run **compiled SQL** for a model via Trino (adds `LIMIT` if missing). Works for ephemeral, view, and table materializations — it does not scan the deployed warehouse relation. For fleet checks on a materialized table, use `query.execute` against the catalog relation or run `dbt.run` first. | `.dj/bin/dj model.query --file examples/model-query.request.json` |
| `query.execute` | `query-draft-execute` | Run an arbitrary read-only `SELECT` | `.dj/bin/dj query.execute --file examples/query-execute.request.json` |
| `model.lineage` | `data-explorer-get-model-lineage` | Upstream/downstream lineage (CLI defaults to full upstream chain; optional `depth`, `maxNodes`) | `.dj/bin/dj model.lineage --file examples/model-lineage.request.json` |
| `model.data-check` | `framework-model-data-check` | Read-only sanity-check SQL from a named template | `.dj/bin/dj model.data-check --modelName mart__g__t__n --file payload.json` |
| `model.reverse-lineage` | `data-explorer-get-reverse-lineage` | Trace lineage from a dashboard / chart back to models | `.dj/bin/dj model.reverse-lineage --file payload.json` |

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
.dj/bin/dj model.compiled-sql --modelName stg__mlde__pharos__node_cpu_daily_cost --projectName opus
.dj/bin/dj query.execute --file examples/query-execute.request.json
```

Example **`model.create`** body (flat — see `examples/model-create.request.json`):

```json
{
  "type": "stg_select_source",
  "projectName": "opus",
  "group": "mlde",
  "topic": "pharos",
  "name": "node_cpu_daily_cost",
  "from": { "source": "opus_raw_dl__pharos_metrics_views.node_cpu_hourly_cost_view" },
  "select": [
    "node",
    { "name": "cost_date",  "expr": "date(hour)", "type": "date" },
    { "name": "daily_cost", "expr": "sum(cost)",  "type": "double" }
  ]
}
```

Example **`model.preview`** envelope:

```json
{
  "modelJson": {
    "type": "stg_select_source",
    "group": "mlde",
    "topic": "pharos",
    "name": "node_cpu_daily_cost",
    "from": { "source": "opus_raw_dl__pharos_metrics_views.node_cpu_hourly_cost_view" },
    "select": ["node", { "name": "daily_cost", "expr": "sum(cost)", "type": "double" }]
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

| Method | Example | Best for |
|---|---|---|
| File | `.dj/bin/dj model.create --file model.json` | Agents & larger payloads (**recommended**) |
| Stdin redirect | `.dj/bin/dj model.create < model.json` | Reading a saved payload |
| Pipe | `cat model.json \| .dj/bin/dj model.create` | Chaining from another command |
| Heredoc | `.dj/bin/dj model.create <<'JSON'` … `JSON` | Writing inline without escaping |

**Recommendation:** an AI agent should write payloads to **`examples/`** (or a temp copy) and pass **`--file`**. Reserve inline **`--json '…'`** for quick **manual** one-liners only. **Exceptions:** **`model.create`**, **`model.preview`**, and **`source.create`** always use **`--file`** with the full flat or envelope JSON — not flag shortcuts.

---

## Token & accuracy benefits (for AI agents)

For anything beyond a trivial model, invoking these commands uses **meaningfully fewer tokens** and
produces **more accurate** results than asking an agent to hand-author `model.json` against the
schema. The savings compound with model complexity and with every validation loop avoided.

### The two token flows

**Manual, schema-based authoring** pushes three kinds of tokens through the model:

- **Schema into context.** DJ ships **109 schema files (~55,000 tokens total)**. Authoring correctly
  needs the base `model.schema` plus the type schema and sub-schemas — e.g.
  `model.incremental_strategy` (~2,200 tok), `model.from.join.models` (~1,300 tok),
  `int_lookback_model` (~770), `select.col` / `select.expr` (~350 / 375). Realistically **3k–8k input
  tokens** per session, or ~55k if the whole `schemas/` dir is loaded defensively.
- **Generating the full artifact** (output) — the entire file, plus the SQL/YAML the agent tries to
  anticipate.
- **Validate → fail → regenerate loops** — no authoritative validator in context, so the agent
  compiles, reads errors back, regenerates, repeats; columns for `select` / `from` are guessed unless
  files are grep'd (hallucination risk).

**CLI commands** remove most of that:

- **No schema in context to author** — the extension owns the schema, templating, and validation;
  `system.capabilities` is pulled on demand, not carried in the prompt.
- **The agent generates only the input payload**, not the derived SQL/YAML/columns.
- **Authoritative, compact feedback** — `model.preview` (real SQL/YAML/columns), `model.exists`
  (dedup), `model.cte-analysis` (diagnostics), `trino.columns` (ground-truth columns) keep the
  correction loop short and grounded.

### Where the savings come from

- **No front-loading of definitions (progressive disclosure).** Anthropic's *Code execution with MCP*
  reports an illustrative **150,000 → 2,000 token (98.7%)** drop from executing tool calls and
  filtering results instead of loading all definitions and shuttling intermediate results through the
  model. Our schema surface (up to ~55k tokens) is exactly that kind of front-loaded cost the CLI keeps
  server-side.
- **Deterministic work offloaded to the tool.** *Writing effective tools for agents* — "offload
  agentic computation from the agent's context back into the tool calls," and return **high-signal,
  concise results**. Templating, validation, SQL/YAML generation, dedup, and file placement move out of
  the model.
- **Fewer iterations.** Each avoided validate/regenerate loop saves a full round-trip of
  (schema + error input) + (regenerated file output) — where most real-world savings land.

### Accuracy & API exposure

For actions that must be exact, a curated command is **authoritative** where the LLM is only
**probabilistic**: `trino.columns` → real columns (no hallucination), `model.exists` → deterministic
dedup, file placement / CTE column inference → done by the code that owns the contract. The op set is
small and namespaced (`model.*`, `trino.*`, `dbt.*`), and being a **CLI** (run a command) avoids the
per-turn context tax of many always-loaded tool schemas.

### Caveats

- The agent still writes the input payload — for a trivial, well-known model the delta is small.
- The command result still enters context (kept compact by design).
- One-time cost to learn the command surface; the extension must be running.

### Rough estimate (one realistic model — estimates, not a benchmark)

| Phase | Manual (schema-based) | CLI commands |
|---|---|---|
| Schema in context | ~3k–8k (up to ~55k if whole dir) | ~0 (server-side) |
| Column discovery | ~1k–3k (greps / guesses) | ~0.2k–0.6k (`trino.columns`) |
| Generate payload / file | ~0.4k–0.9k | ~0.3k–0.7k |
| Validate / fix loops | ~2k–5k (1–3 loops) | ~0.3k–0.8k (0–1, grounded) |
| **Ballpark total** | **~7k–20k+** | **~1.5k–3.5k** |

→ roughly a **3–6x reduction** in a typical case, larger for complex models and iterative authoring.

> **Benchmarking (planned).** These figures are analytical estimates. A follow-up will measure real
> token usage on representative models (simple staging vs. incremental / join marts), comparing manual
> schema-based authoring against the CLI flow, to replace these ranges with measured numbers.

**Sources**
- Anthropic — *Code execution with MCP* — https://www.anthropic.com/engineering/code-execution-with-mcp
- Anthropic — *Writing effective tools for agents* — https://www.anthropic.com/engineering/writing-tools-for-agents

## Constraints

- VS Code with the DJ extension must be running on the workspace; if multiple windows are open, the
  newest one answering `system.ping` serves the command.
- macOS / Linux only (Unix domain socket); Windows transport is deferred.
- `query.execute` (arbitrary SQL) is restricted to read-only `SELECT` per workspace policy — confirm
  catalog/schema, never target production.
- Exit codes: `0` ok · `1` operation error · `2` bad input · `3` no live endpoint · `4` timeout.
