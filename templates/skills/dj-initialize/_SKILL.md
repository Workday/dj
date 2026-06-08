---
name: dj-initialize
description: >-
  Initialize and configure a dbt project for the DJ (Data JSON) Framework.
  Use when the user wants to set up DJ in an existing dbt project, configure
  required settings, or diagnose why DJ is not working correctly.
compatibility: VS Code workspace with a dbt project (dbt_project.yml present)
metadata:
  dj-skill: '1.0'
---

# Initialize DJ in a dbt Project

Set up all required and recommended configurations for the **DJ (Data JSON) Framework** to work in an existing dbt project. This skill is **interactive** — ask the user clarifying questions at each stage before making changes.

## Agent Compatibility

This skill is designed to work uniformly across all AI coding agents (Cursor, GitHub Copilot, Claude Code, Cline, Windsurf, etc.). Questions must be asked as **plain text** in the conversation — do not rely on agent-specific UI elements like structured forms or multi-choice widgets. Present options as numbered lists or bullet points that the user can respond to conversationally.

**Question format:**
- Ask one question or a small related group (2-3 max) at a time
- Present options as a numbered list when choices are finite
- Always include a "skip" or "use default" option where applicable
- Wait for the user's response before proceeding to the next step

## Prerequisites the Agent Must Verify

Before starting, confirm the workspace has a `dbt_project.yml`. If not found, stop and tell the user this skill requires an existing dbt project.

## Interactive Workflow

Follow these steps **in order**. At each step, report findings to the user and ask for confirmation before making changes.

---

### Step 1: Discover and Report

1. Find `dbt_project.yml` in the workspace (search with `**/dbt_project.yml`, exclude `node_modules`, `dbt_packages`, `.venv`, `target`)
2. Read the file and extract: `name`, `vars`, `dispatch`, `model-paths`, `macro-paths`, `target-path`
3. Check if `models/groups.yml` exists (or groups defined in `dbt_project.yml`)
4. Check if `.gitignore` exists and whether it contains `.dj`
5. Check if `.vscode/settings.json` exists and has `dj.*` settings
6. Check if `target/manifest.json` exists
7. Check if a Python virtual environment directory exists (`.venv/`, `venv/`, or similar)

**Present a summary to the user:**

> Here's what I found in your dbt project:
> - Project name: `<name>`
> - Storage type: `<found or not configured>`
> - Dispatch: `<configured or missing>`
> - Groups: `<found or not configured>`
> - .gitignore: `<.dj included or missing>`
> - VS Code DJ settings: `<found or not configured>`
> - Manifest: `<present or missing>`
> - Python venv: `<found at X or not found>`

---

### Step 2: Ask Project Basics

Ask the user these questions (skip any already answered by the discovered config):

1. **Storage format**: "What storage format does your data lake use?"
   - Options: `delta_lake` (Delta Lake + Hive metastore) or `iceberg` (Iceberg + Glue/Polaris)
   - Default: `delta_lake`

2. **dbt adapter**: "Which dbt adapter do you use?"
   - Common: `dbt-trino`, `dbt-postgres`, `dbt-snowflake`, `dbt-bigquery`
   - This determines the pip package to install

3. **Trino usage** (optional): "Do you use Trino for querying? This is optional — DJ's core features (JSON sync, model creation, lineage) work without it. Trino adds catalog browsing and query execution."
   - If yes, will configure Trino env vars later
   - If no or skip, skip all Trino-related steps entirely

4. **ETL schema**: "What schema name do you use for ETL metadata?"
   - Default: `source_etl` for Delta Lake, `dj_etl` for Iceberg
   - Only ask if `etl_schema` is not already in `vars`

---

### Step 3: Check and Fix Prerequisites

#### 3a. Python Virtual Environment

- Check if `.venv/` (or `venv/`) directory exists
- If missing, ask: "Would you like me to create a Python virtual environment at `.venv`?"
- If yes, run:
  ```bash
  python -m venv .venv
  source .venv/bin/activate
  pip install <adapter-from-step-2>
  ```
- If venv exists but adapter is not installed, ask: "Would you like me to install `<adapter>` in the existing venv?"

#### 3b. dbt_project.yml `name` Field

- If `name` is missing, ask: "Your `dbt_project.yml` needs a `name` field. What should the project be called?"
- Add the `name` field

#### 3c. Manifest

- If `target/manifest.json` is missing, inform the user: "The manifest file is missing. DJ needs it for lineage and column resolution. We'll run `dbt parse` at the end of setup."

---

### Step 4: Configure dbt_project.yml vars

Check which DJ-relevant vars are missing and ask the user to confirm values:

```yaml
vars:
  storage_type: '<delta_lake or iceberg>'  # Drives partitioning SQL generation
  etl_schema: '<schema_name>'              # ETL metadata schema (default: source_etl)
  event_dates: '<date-range>'              # Date range for lookback models (format: YYYY-MM-DD~YYYY-MM-DD)
```

**Ask**: "I'd like to add these variables to your `dbt_project.yml`. Here are the recommended values based on your answers. Should I proceed?"

Present the proposed `vars:` block and wait for confirmation. If the user wants to change values, accept their input.

Only add vars that are genuinely missing — do not overwrite existing values without explicit confirmation.

---

### Step 5: Configure dispatch Block

If `dispatch:` is not present in `dbt_project.yml`:

**Explain**: "DJ ships helper macros to `macros/_ext_/`. A `dispatch` block ensures your project's macros take precedence over dbt's built-ins when DJ's macros override them."

**Ask**: "Would you like me to add this dispatch configuration?"

```yaml
dispatch:
  - macro_namespace: dbt
    search_order: [<project_name>, dbt]
```

Wait for confirmation before adding.

---

### Step 6: Configure Groups

If no groups are defined (neither in `dbt_project.yml` models config nor in `models/groups.yml`):

**Ask**: "DJ's model creation wizard uses dbt groups to organize models. What business domains or teams does your project serve?"

Examples: `analytics`, `sales`, `marketing`, `finance`, `engineering`, `supply_chain`, `customers`, `products`

**Ask**: "For each group, who is the owner? (team name and email, or I can use placeholders)"

Then create `models/groups.yml`:

```yaml
version: 2

groups:
  - name: <group_name>
    owner:
      name: <Team Name>
      email: <team@example.com>
    description: '<brief description>'
```

Confirm the file content before writing.

---

### Step 7: Update .gitignore

If `.dj/` is not in `.gitignore`:

**Ask**: "DJ stores local state (cache, drafts, schemas) in a `.dj/` folder. Should I add it to `.gitignore`?"

If yes, append:

```
# DJ (Data JSON) Framework local state
.dj/
```

If `.gitignore` doesn't exist, ask before creating one.

---

### Step 8: Configure VS Code Settings

Check `.vscode/settings.json` for DJ settings.

**Ask**: "I'll configure VS Code settings for DJ. Please confirm the Python venv path:"
- Default: `.venv` (relative to workspace root)

Create or update `.vscode/settings.json` with:

```json
{
  "dj.pythonVenvPath": ".venv"
}
```

**Additionally ask**:
- "Do you want to restrict DJ to specific project names?" (for monorepos with multiple `dbt_project.yml` files)
  - If yes: `"dj.dbtProjectNames": ["<name>"]`
- "What log level do you prefer?" (default: `info`)
  - Options: `debug`, `info`, `warn`, `error`

Only add settings the user confirms.

---

### Step 9: Trino Connection (optional — skip if user opted out)

This step is entirely optional. Skip it if the user said they don't use Trino in Step 2. DJ's core features (JSON sync, SQL/YAML generation, model creation, lineage graphs) work without Trino. Trino enables catalog browsing, source creation from live tables, and query execution/preview.

If the user indicated they use Trino:

**Ask**: "To configure Trino, I need your connection details. These will be set as environment variables. Please provide (or say 'skip' for any you want to set up later):"

1. `TRINO_HOST` — hostname (e.g., `localhost`, `trino.company.com`)
2. `TRINO_PORT` — port (e.g., `8080` for local, `443` for Starburst Galaxy)
3. `TRINO_USERNAME` — username
4. `TRINO_CATALOG` — default catalog
5. `TRINO_SCHEMA` — default schema
6. `TRINO_PASSWORD` — (optional) password

**Then ask**: "Where should I add these environment variables?"
- Options: `.env` file in project root, or suggest adding to shell profile (`~/.zshrc`, `~/.bashrc`)

If `.env`: create the file with the values.
If shell profile: provide the export commands for the user to add manually.

Also check Trino CLI availability:
- "Is `trino-cli` on your PATH? (run `which trino-cli` to check)"
- If not, suggest: `"dj.trinoPath": "/path/to/trino-cli"` in VS Code settings

---

### Step 10: Optional Integrations

These are all optional. Ask about each briefly — if the user says no or skip, move on immediately.

#### Lightdash

**Ask**: "Do you use Lightdash for BI dashboards?"

If yes:
- Ensure `npm install -g @lightdash/cli` is done (or suggest it)
- Ask for env vars: `LIGHTDASH_URL`, `LIGHTDASH_PREVIEW_NAME`, `LIGHTDASH_PROJECT`
- Add to `.env` or suggest shell profile additions

#### Airflow

**Ask**: "Do you want DJ to generate Airflow DAGs for your models?"

If yes, add to VS Code settings:
```json
{
  "dj.airflowGenerateDags": true,
  "dj.airflowTargetVersion": "<2.7|2.8|2.9|2.10>",
  "dj.airflowDagsPath": "dags/_ext_"
}
```

#### Coding Agent

**Ask**: "Would you like DJ to generate AI agent context files (`.agents/dj/AGENTS.md` and skill files)?"

If yes, add to VS Code settings:
```json
{
  "dj.codingAgent": true
}
```

---

### Step 11: Generate Manifest

If `target/manifest.json` is missing or the user wants to refresh it:

**Ask**: "Would you like me to run `dbt parse` now to generate the manifest? (Required for lineage and column features)"

If yes, run:
```bash
source .venv/bin/activate && dbt parse
```

If it fails, report the error and suggest troubleshooting steps (check profiles.yml, check connection, verify adapter installation).

---

### Step 12: Summary Report

Present a final summary of everything that was configured:

> **DJ Initialization Complete**
>
> **Configured:**
> - [x] Python venv at `.venv` with `<adapter>`
> - [x] `dbt_project.yml` vars: `storage_type`, `etl_schema`
> - [x] Dispatch block added
> - [x] Groups defined in `models/groups.yml`
> - [x] `.gitignore` updated with `.dj/`
> - [x] VS Code settings configured
> - [x] Manifest generated
>
> **Skipped:**
> - [ ] Trino (user opted out)
> - [ ] Lightdash (not needed)
>
> **Next steps:**
> - Open VS Code Command Palette → `DJ: Refresh Projects` to load the new configuration
> - Try creating your first model: Command Palette → `DJ: Create Model`
> - Test Trino connection: Command Palette → `DJ: Test Trino Connection`

---

## Important Notes

- **Never overwrite existing config without confirmation** — always show the user what will change
- **Preserve YAML formatting** — when editing `dbt_project.yml`, maintain existing indentation and comments
- **One section at a time** — don't batch all questions together; work through each step sequentially
- **Report errors clearly** — if a command fails or a file can't be read, explain what went wrong and suggest alternatives
- **Respect user choices** — if they skip something, don't bring it up again later
- **Agent-agnostic questions** — always ask questions as plain conversational text; do not use structured UI elements, tool-specific forms, or interactive widgets that may not be available in all agents
- **Trino is optional** — DJ works without Trino for its core workflow (JSON sync, SQL/YAML generation, model lineage); Trino adds catalog browsing and query execution but is not required
