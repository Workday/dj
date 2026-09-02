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

**Precedence rule:** When `.dj/bin/dj system.ping` succeeds, prefer `.dj/bin/dj <op>` over hand-authoring JSON, loading `.dj/schemas/`, grepping for columns, or raw `trino-cli` — then load the task skill for workflow decisions only.

## Prerequisites

1. **VS Code running** with the DJ extension active on the workspace.
2. **`.dj/bin/dj` exists** — the extension deploys it on activation (macOS/Linux only; Windows transport is deferred).
3. **Bootstrap:** run `.dj/bin/dj system.ping` before any other op. Exit `3` means no live endpoint — fall back to the task skill's file-based workflow.

## Invocation

```bash
.dj/bin/dj system.ping
.dj/bin/dj <operation> --file <payload.json>
.dj/bin/dj <operation> --json '{"field":"value"}'
cat payload.json | .dj/bin/dj <operation>
```

| Flag | Purpose |
|------|---------|
| `--file <path>` | **Preferred for agents** — no shell-quoting pitfalls |
| `--json '<inline>'` | Quick one-liners only |
| `--workspace <dir>` | Walk up from this dir to find `.dj/state/cli-endpoints/` |
| `--timeout <ms>` | Max wait for a reply (default varies) |

Stdin redirect (`< payload.json`) and pipes also work.

## Payload shape

Pass the **entity definition directly** as flat JSON — no `{ "request": {…} }` wrapper required (that envelope is accepted for back-compat only).

- `projectName` is optional when the workspace has exactly one dbt project (inferred automatically).
- With multiple projects and no `projectName`, the CLI errors and lists available names.

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
- **`dbt.run`** — warehouse write; requires explicit per-command user confirmation and must never target production.

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
