# DJ MCP Server

Agent-agnostic stdio MCP server for DJ (Data JSON) model workflows.

Two modes:

1. **Production catalog** — operator configures 2–3 dbt repos; users pick `project-a` / `project-b`, give requirements, review an isolated preview, then approve a PR.
2. **Independent local** — user selects their own local dbt path with `dj_use_local_project`.

No demo projects are bundled. Create/update runs in an isolated git worktree until `dj_publish_change`.

Optional **Trino** connection enables live source sampling and model data preview (`dbt compile` / `dbt run` + `SELECT … LIMIT`).

## Tools

| Tool | Purpose |
|------|---------|
| `dj_list_projects` | List catalog projects or discover under a local path |
| `dj_use_project` | Select catalog `projectId` (Mode A) |
| `dj_use_local_project` | Select local checkout path (Mode B) |
| `dj_describe_structure` | DJ folder rules + existing groups/topics |
| `dj_list_models` | List models |
| `dj_get_model` | Read model + sql/yml |
| `dj_validate_model` | Schema validate |
| `dj_preview_model` | Artifact SQL/YAML only (no warehouse) |
| `dj_trino_status` | Trino configured + reachable |
| `dj_list_trino_tables` | Browse catalogs → schemas → tables → columns |
| `dj_preview_source` | Sample source table rows via Trino |
| `dj_preview_data` | `dbt compile` or `dbt run`, then sample model rows via Trino |
| `dj_create_model` | Create model in isolated change set |
| `dj_update_model` | Update model (+ regenerate sql/yml) |
| `dj_create_source` | Create source in isolated change set |
| `dj_create_e2e` | Requirement → create + preview + lineage (+ optional live data) |
| `dj_get_lineage` | Upstream/downstream lineage |
| `dj_get_change` | Inspect change set |
| `dj_discard_change` | Discard change set |
| `dj_publish_change` | Approve → commit, push, open PR |

## Setup

```bash
cd dj
npm install
npm run mcp:build
```

Copy [`config.example.json`](config.example.json) to `~/.dj-mcp/config.json` (or set `DJ_MCP_CONFIG`).

### Production catalog config

```json
{
  "productionMode": true,
  "allowLocalProjectMode": true,
  "exposeFilesystemPaths": false,
  "trino": {
    "enabled": true,
    "host": "trino.example.com",
    "port": 443,
    "httpScheme": "https",
    "catalog": "hive",
    "schema": "default",
    "user": "mcp-bot",
    "passwordEnv": "TRINO_PASSWORD",
    "defaultLimit": 100,
    "previewMode": "compile"
  },
  "projects": [
    {
      "id": "project-a",
      "label": "AWS Billing",
      "type": "git",
      "url": "git@ghe.example.com/finance/dbt-billing.git",
      "ref": "main",
      "projectName": "billing",
      "pr": { "provider": "github", "baseBranch": "main" },
      "trino": { "catalog": "finance", "schema": "billing" }
    }
  ]
}
```

Never put passwords in JSON. Prefer `passwordEnv: "TRINO_PASSWORD"` and export the var in `~/.zshrc`. Use [`start.sh`](start.sh) as the MCP `command` so Cursor loads that shell env.

### Independent local (no catalog)

Omit `projects` (or leave empty) and call:

```json
{ "localPath": "/Users/me/my-dbt-project" }
```

via `dj_use_local_project`. Requires `allowLocalProjectMode: true`.

## Live data preview (Trino)

Requires:

- `trino.enabled` + `trino.host` in config (or `TRINO_HOST`)
- Password via `TRINO_PASSWORD` / `passwordEnv`
- `dbt` on PATH (and `DBT_PROFILES_DIR` / `DJ_DBT_PROFILES_DIR` for compile/run)
- Network access to the Trino coordinator

By default DJ uses the **HTTP** `/v1/statement` API. Set `trino.cliPath` (or `DJ_TRINO_PATH`) to use the Trino CLI instead.

### Full agent flow

1. `dj_use_project({ "projectId": "project-c" })`
2. `dj_trino_status` — confirm connectivity
3. `dj_list_trino_tables` → `dj_preview_source({ "table": "…", "limit": 20 })`
4. `dj_create_e2e({ "requirement": "…", "model": { … } })` — isolated change set
5. `dj_preview_data({ "changeSetId": "…", "modelName": "…", "mode": "compile" })`  
   - `compile` — `dbt compile` then run compiled SELECT with LIMIT  
   - `run` — `dbt run --select model` then `SELECT * FROM catalog.schema.model LIMIT N`  
   - `includeUpstream: true` with `run` uses `+model`
6. Approve → `dj_publish_change`

Or pass `includeData: true` on `dj_create_e2e` to chain step 5 automatically.

## Agent prompt recipe

**Mode A**

1. `dj_list_projects` → user picks `project-a`
2. `dj_use_project({ "projectId": "project-a" })`
3. `dj_describe_structure({ "suggestion": "aws billing" })`
4. Interpret requirement into DJ model JSON (`group` / `topic` / `type` / `select`)
5. `dj_create_e2e({ "requirement": "...", "model": { ... } })`
6. Optional: `dj_preview_data` for live rows
7. On approval: `dj_publish_change({ "changeSetId": "...", "approval": true, "commitMessage": "..." })`

**Mode B**

1. `dj_use_local_project({ "localPath": "/path/to/dbt" })`
2. Same describe → create_e2e → preview_data → publish flow

## Publish prerequisites

- Selected project must be a git repo (catalog git mirrors, or local checkout with `.git`)
- `git` on PATH
- Authenticated `gh` CLI for GitHub/GHE PRs

## Environment

| Variable | Description |
|----------|-------------|
| `DJ_MCP_CONFIG` | Path to config JSON (default `~/.dj-mcp/config.json`) |
| `DJ_WORKSPACE_ROOT` | Optional self-hosted local root when not using catalog |
| `TRINO_HOST` / `TRINO_PORT` / `TRINO_USER` / `TRINO_PASSWORD` / `TRINO_CATALOG` / `TRINO_SCHEMA` | Override Trino connection |
| `DJ_TRINO_PATH` | Optional Trino CLI binary (forces CLI mode) |
| `DBT_PROFILES_DIR` / `DJ_DBT_PROFILES_DIR` | dbt profiles for compile/run |
| `DJ_DBT_PATH` | Optional path to `dbt` binary |

## Cursor / Claude Desktop

See [`mcp.example.json`](mcp.example.json). Prefer `command: .../mcp/start.sh` so `TRINO_PASSWORD` from `~/.zshrc` is available. Set `DJ_MCP_CONFIG` (and optionally `DBT_PROFILES_DIR`) in `env`.

After rebuild, rename the MCP server entry or restart so the host refreshes tool schemas.
