---
name: dj-cli
description: >-
  Invoke the DJ CLI bridge (`.dj/bin/dj`) against the running VS Code extension.
  Use before hand-authoring model JSON, loading `.dj/schemas/`, grepping for
  columns, or running raw trino-cli/dbt when a DJ CLI operation exists. Covers
  system.ping, discovery (trino.*, dbt.*), authoring (model.*, source.create),
  compile/run (dbt.*), and query/lineage ops. Requires DJ extension active
  (macOS/Linux). For skill routing see dj-cli-registry.
compatibility: DJ (Data JSON) Framework extension workspace with VS Code running and dj.codingAgent enabled
metadata:
  dj-skill: '1.0'
---

# DJ CLI bridge

The DJ CLI (`.dj/bin/dj`) is a thin transport into the running extension's `Api.handleApi` — the same entry point the webview UI uses. No business logic is reimplemented in the CLI.

**Precedence rule:** When `.dj/bin/dj system.ping` succeeds:

- **Rule 0 — discovery:** do not grep the repo for models/explores until **`dbt.models.search`** and **`lightdash.assets`** return nothing useful (or the bridge is down). Use narrow `*.model.json` globs only as a last resort — not `**/*`.
- **Rule 1 — payload:** every op that needs fields → **`--file examples/…`** (copy and edit under `examples/`). Do not pass raw JSON as a shell argument.
- **Rule 2 — warehouse:** **`query.execute`** / **`model.query`** are reads; **`dbt.run`** is a write. Ask the user **Yes/No** before warehouse reads in preflight flows; **Yes/No** before any **`dbt.run`** (see `dj-pr-preflight`).

Prefer `.dj/bin/dj <op>` over hand-authoring JSON, loading `.dj/schemas/`, or raw `trino-cli` — then load the task skill for workflow decisions only.

## Prerequisites

1. **VS Code running** with the DJ extension active on the workspace.
2. **`.dj/bin/dj` exists** — the extension deploys it on activation (macOS/Linux only; Windows transport is deferred).
3. **Bootstrap:** run `.dj/bin/dj system.ping` before any other op. Exit `3` means no live endpoint — fall back to the task skill's file-based workflow.
4. **Syntax:** run `.dj/bin/dj <op> --help` **before the first use of an op** (works offline; JSON with `exampleCommand`, `allowedFlags`, `exampleFile`). When the bridge is up, `system.help` with `{ "operation": "…" }` returns the same shape.

## Invocation

```bash
.dj/bin/dj system.ping
.dj/bin/dj model.lineage --help
.dj/bin/dj model.lineage --file examples/model-lineage.request.json
.dj/bin/dj model.columns --modelName mart__g__t__name --file examples/model-columns.request.json
.dj/bin/dj query.execute --file examples/query-execute.request.json
.dj/bin/dj dbt.compile --file examples/dbt-compile.request.json
.dj/bin/dj model.create --file examples/model-create.request.json --timeout 600000
```

| Flag | Purpose |
|------|---------|
| `--file <path>` | **Required for agents** (except use flat/envelope JSON in file for create/preview/source.create) |
| `--help` | Per-op invoke JSON (no bridge required) |
| `--modelName`, `--projectName`, `--select`, `--sql`, `--depth` | Merged into JSON (override file fields) |
| `--json '<inline>'` | Avoid for agents — quoting errors |
| `--workspace <dir>` | Walk up from this dir to find `.dj/state/cli-endpoints/` |
| `--timeout <ms>` | Default 120s; **`model.create`**, **`model.create-batch`**, **`dbt.parse`** default **600000** unless overridden |

Stdin redirect (`< payload.json`) and pipes also work.

## Payload shape

Two patterns — pick the one that matches the operation (see [references/command-catalog.md](references/command-catalog.md)).

**Pattern A — flat model body** (Create Model form shape):

- **`model.create`** — pass `type`, `group`, `topic`, `name`, and the rest of the model fields at the top level.
- **`source.create`** — flat Trino table identity fields (+ optional `projectName`).

**Pattern B — wrapped `modelJson`** (same shape the edit/preview APIs use):

- **`model.preview`**, **`model.exists`**, **`model.cte-analysis`** — `{ "modelJson": { … } }` (+ optional `projectName`).
- **`model.update`** — `{ "originalModelPath": "<absolute path to the .model.json on disk>", "modelJson": { …full model… } }` (+ optional `projectName`). Top-level **`modelName` is not valid** for this op.

Repo examples: `examples/model-create.request.json`, `examples/model-preview.request.json`, `examples/source-create.request.json`, `examples/model-columns.request.json`, `examples/model-lineage.request.json`, `examples/model-query.request.json`, `examples/query-execute.request.json`, `examples/dbt-compile.request.json`, `examples/dbt-models-search.request.json`, `examples/dbt-project.request.json`, `examples/trino-*.request.json`.

Common rules:

- `projectName` is optional when the workspace has exactly one dbt project (inferred automatically).
- With multiple projects and no `projectName`, the CLI errors and lists available names.
- A top-level `{ "request": {…} }` wrapper is accepted for back-compat only (inner object is the payload).

### Troubleshooting payload errors

If `dj:` mentions missing **`modelName`** or **`sql`**, use `--file examples/…` or the matching **`--modelName`** / **`--sql`** flag — never a bare shell string as the payload.

If `dj:` mentions missing **`modelJson`** or **`originalModelPath`**, the envelope is wrong — **do not** retry the same flat `.model.json` file or create-style payload on preview/exists/update. Wrap fields in `modelJson`, and for updates set `originalModelPath` to the file you are editing.

## Workflow

1. `.dj/bin/dj system.ping` — confirm the bridge is live.
2. Load `dj-cli-registry` when unsure which skill or op applies.
3. Load the task-specific skill for workflow decisions (type, group, upstream chain, etc.).
4. Write the payload to a temp file; run `.dj/bin/dj <op> --file <file>`.
5. Interpret the JSON result. On failure, check the exit code and error message before retrying.

Run `.dj/bin/dj system.capabilities` for the live operation list with `sideEffect` tags.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Operation error (e.g. model already exists, validation failure) |
| `2` | Usage / malformed input JSON |
| `3` | No live DJ endpoint (VS Code not running, DJ off, or Windows) |
| `4` | Timed out waiting for a reply |

## Safety

Follow **Command & Query Execution Safety** in `.agents/dj/AGENTS.md`:

- **Read ops** (`sideEffect: read`) — safe for discovery and inspection.
- **Authoring mutates** (`model.create`, `model.update`, `source.create`) — write `.model.json` / `.source.json` files; no warehouse writes.
- **dbt mutates** (`dbt.compile`, `dbt.parse`, `dbt.compile-logs`) — compile/parse only; no warehouse writes.
- **`dbt.run`** — warehouse write; ask **“Run dbt.run for [models] in dev? (Yes/No)”** and proceed only on **Yes**; must never target production.
- **`query.execute`** / **`model.query`** — warehouse reads; in preflight (`dj-pr-preflight`) ask **Yes/No** before executing generated SQL.

`query.execute` is restricted to read-only `SELECT` / `WITH` / `SHOW` / `DESCRIBE` / `EXPLAIN` statements.

## Fallback

| Condition | Action |
|-----------|--------|
| Exit `3`, `.dj/bin/dj` absent, or Windows | Follow the task skill's file-based / manual workflow |
| No bridge op for the task | Raw `trino-cli` or `dbt` CLI per `dj-run-trino` / `dj-run-dbt` (last resort) |
| Python models, Lightdash YAML, git | No CLI ops yet — use the matching task skill |

## References

- Full operation catalog: [references/command-catalog.md](references/command-catalog.md)
- Skill ↔ CLI routing: `dj-cli-registry` → [references/skills-index.md](../dj-cli-registry/references/skills-index.md)
- Extended reference (repo): `docs/cli_commands/command-reference.md`
