# DJ CLI — Command Scope & Reference

The DJ CLI (`.dj/bin/dj`) lets a terminal or an AI agent invoke DJ features by forwarding to the
extension's existing `Api.handleApi(...)` — the **same entry point the visual editor uses**. No
business logic is reimplemented; each command is a thin passthrough to a `handleApi` operation.

This document lists the full scope of operations that can be exposed as CLI commands, grouped by
purpose, with example usage.

**Inclusion rule.** An API qualifies as a CLI command when it is *payload-driven* and *returns a
value or writes a file*, with **no dependence on an active editor, an open webview panel, or
interactive UI**.

**Payloads are the entity definition directly** — you pass the model/source fields as-is; there is
no `request` wrapper to add. `projectName` may be omitted when the workspace has a single dbt
project (it is inferred).

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

| CLI op | API | What it does |
|---|---|---|
| `model.create` | `framework-model-create` | Create a new model definition file (`.model.json`) |
| `source.create` | `framework-source-create` | Create a source definition from a Trino table (columns auto-introspected) |
| `model.update` | `framework-model-update` | Update an existing model (merge, validate, relocate on rename) |
| `model.preview` | `framework-model-preview` | Dry-run — return the generated SQL / YAML / columns **without writing** |
| `model.exists` | `framework-check-model-exists` | Check whether a model already exists (pre-flight guard) |
| `model.cte-analysis` | `framework-model-cte-analysis` | Return per-CTE inferred columns + diagnostics |

## Read

*Impact: an agent discovers real catalogs, tables, columns, and models before authoring — no
hallucinated names.*

| CLI op | API | What it does |
|---|---|---|
| `trino.catalogs` | `trino-fetch-catalogs` | List Trino catalogs |
| `trino.schemas` | `trino-fetch-schemas` | List schemas in a catalog |
| `trino.tables` | `trino-fetch-tables` | List tables in a schema |
| `trino.columns` | `trino-fetch-columns` | List a table's columns (`SHOW COLUMNS`) |
| `dbt.projects` | `dbt-fetch-projects` | List dbt projects in the workspace |
| `dbt.sources` | `dbt-fetch-sources` | List declared dbt sources |
| `dbt.models` | `dbt-fetch-available-models` | List models in a project |
| `dbt.modified-models` | `dbt-fetch-modified-models` | List models changed vs. the base ref (build/run scope) |
| `dbt.compiled-status` | `dbt-check-compiled-status` | Whether a model is compiled (+ path / timestamp) |
| `dbt.model-outdated` | `dbt-check-model-outdated` | Whether a model's compiled output is stale |

## Mutate

*Impact: an agent validates authored models by compiling/parsing and can run them — real feedback,
not just static checks.*

| CLI op | API | What it does |
|---|---|---|
| `dbt.compile` | `dbt-model-compile` | Compile a single model |
| `dbt.compile-logs` | `dbt-compile-with-logs` | Compile a model (log-emitting variant) |
| `dbt.parse` | `dbt-parse-project` | Parse the project and refresh the manifest |
| `dbt.run` | `dbt-run-model` | Run a model via dbt (output streams to the VS Code terminal) |

## Query & data read

*Impact: an agent reads compiled SQL, previews data, and traces lineage to reason about impact —
all read-only.*

| CLI op | API | What it does |
|---|---|---|
| `model.compiled-sql` | `data-explorer-get-compiled-sql` | Read a model's compiled SQL |
| `model.query` | `data-explorer-execute-query` | Run a model's compiled query (data preview) |
| `query.execute` | `query-draft-execute` | Run an arbitrary read-only `SELECT` |
| `model.lineage` | `data-explorer-get-model-lineage` | Get a model's upstream / downstream lineage |
| `model.reverse-lineage` | `data-explorer-get-reverse-lineage` | Trace lineage from a dashboard / chart back to models |

---

## Example commands

```bash
# System
.dj/bin/dj system.ping
.dj/bin/dj system.capabilities

# Read / introspect
.dj/bin/dj trino.catalogs
.dj/bin/dj trino.schemas --json '{"catalog":"opus_raw_dl"}'
.dj/bin/dj dbt.models    --json '{"projectName":"opus"}'

# Authoring — the payload IS the model definition (see model.json below)
.dj/bin/dj model.preview --file model.json
.dj/bin/dj model.create  --file model.json
.dj/bin/dj source.create --json '{"projectName":"opus","trinoCatalog":"opus_raw_dl","trinoSchema":"pharos_metrics_views","trinoTable":"node_cpu_hourly_cost_view"}'

# Mutate (dbt build)
.dj/bin/dj dbt.compile --json '{"modelName":"stg__mlde__pharos__node_cpu_daily_cost","projectName":"opus"}'
.dj/bin/dj dbt.parse   --json '{"projectName":"opus"}'

# Query & data read
.dj/bin/dj model.compiled-sql --json '{"modelName":"stg__mlde__pharos__node_cpu_daily_cost","projectName":"opus"}'
.dj/bin/dj query.execute      --json '{"sql":"select 1","limit":10}'
```

Example `model.json` (flat payload — no `request` wrapper):

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

**Recommendation:** an AI agent should write the payload to a file and pass `--file` — no quoting
rules, easy to inspect, and it mirrors how the agent already produces model JSON. Reserve inline
`--json '…'` for quick manual one-liners.

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
