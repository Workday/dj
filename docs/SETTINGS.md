# DJ (Data JSON) Framework Settings Reference

Complete guide to configuring the DJ (Data JSON) Framework VS Code extension.

## Quick Reference

| Setting                                         | Purpose                                                          | Takes Effect    |
| ----------------------------------------------- | ---------------------------------------------------------------- | --------------- |
| `pythonVenvPath`                                | Python virtual environment path                                  | Next command ⚡ |
| `trinoPath`                                     | Trino CLI executable location                                    | Next query ⚡   |
| `dbtProjectNames`                               | Filter which dbt projects to load                                | Refresh 🔄      |
| `dbtMacroPath`                                  | Custom path for extension macros                                 | Refresh 🔄      |
| `dbtGenericTestsPath`                           | Custom path for generic test files                               | Refresh 🔄      |
| `airflowGenerateDags`                           | Enable Airflow DAG generation                                    | Refresh 🔄      |
| `airflowTargetVersion`                          | Target Airflow version                                           | Refresh 🔄      |
| `airflowDagsPath`                               | Custom path for Airflow DAGs                                     | Refresh 🔄      |
| `lightdashProjectPath`                          | Custom Lightdash project path                                    | Next preview ⚡ |
| `lightdashProfilesPath`                         | Custom Lightdash profiles path                                   | Next preview ⚡ |
| `lightdash.defaultSqlFilter`                    | Global default `sql_filter` for lightdash tables                 | Next sync 🔄    |
| `lightdash.defaultSqlFilterRequiredColumns`     | Required columns guard for the global filter                     | Next sync 🔄    |
| `lightdash.defaultPartitionColumnCaseSensitive` | Set default `case_sensitive` value for partition columns in YAML | Next sync 🔄    |
| `aiHintTag`                                     | Tag for AI-generated hints                                       | Next sync 🔄    |
| `codingAgent`                                   | Coding agent integration                                         | Refresh 🔄      |
| `autoGenerateTests`                             | Auto-generate row count tests                                    | Varies 🔄       |
| `columnLineage.autoRefresh`                     | Auto-refresh column lineage                                      | File switch ✅  |
| `dataExplorer.autoRefresh`                      | Auto-refresh data explorer                                       | File switch ✅  |
| `logLevel`                                      | Extension logging level                                          | Immediate ✅    |

**Legend:** ✅ Immediate | ⚡ Next command/action | 🔄 Requires `DJ: Refresh Projects` or sync

---

## Settings by Category

### Python & Environment

**`dj.pythonVenvPath`** - Path to Python virtual environment

```json
{ "dj.pythonVenvPath": ".venv" }
```

- Supports relative (`.venv`) or absolute paths (`/full/path/to/.venv`)
- Extension activates venv when running dbt and Python tools
- Validated: checks for `bin/activate` file

**`dj.trinoPath`** - Path to Trino CLI executable (default: `"trino-cli"`)

```json
{ "dj.trinoPath": "/usr/local/bin" }
```

- Supports: command names (`"trino"`), full paths (`"/usr/bin/trino"`), or directories (`"/usr/local/bin"`)
- For directories: automatically checks for `trino-cli` then `trino`
- Test with: `DJ: Test Trino Connection` command
- See [Trino Integration Guide](integrations/trino-integration.md)

---

### Project Configuration

**`dj.dbtProjectNames`** - Filter which dbt projects to load

```json
{ "dj.dbtProjectNames": ["analytics", "marketing"] }
```

- Useful for monorepos with multiple dbt projects
- Omit to load all projects
- Names must match `name:` field in `dbt_project.yml`

**`dj.dbtMacroPath`** - Extension macro folder (default: `"macros"`)

```json
{ "dj.dbtMacroPath": "macros/ext" }
```

- Relative to each dbt project root
- Where `_ext_.sql` and `_ext_.yml` files are written

**`dj.dbtGenericTestsPath`** - Generic test location (default: `"tests/generic"`)

```json
{ "dj.dbtGenericTestsPath": "tests/generic" }
```

---

### Airflow Integration

**`dj.airflowGenerateDags`** - Enable DAG generation (default: `false`)

```json
{
  "dj.airflowGenerateDags": true,
  "dj.airflowTargetVersion": "2.10",
  "dj.airflowDagsPath": "airflow/dags"
}
```

**`dj.airflowTargetVersion`** - Target version: `"2.7"` | `"2.8"` | `"2.9"` | `"2.10"`

**`dj.airflowDagsPath`** - Custom DAG output directory

---

### Lightdash Integration

**`dj.lightdashProjectPath`** - Custom dbt project path for Lightdash

**`dj.lightdashProfilesPath`** - Custom dbt profiles path

```json
{
  "dj.lightdashProjectPath": "dbt/analytics",
  "dj.lightdashProfilesPath": ".dbt"
}
```

- Both optional (extension auto-detects by default)
- See [Lightdash Configuration Guide](setup/lightdash-configuration.md)

**`dj.lightdash.defaultSqlFilter`** - Global default `sql_filter` for lightdash tables

**`dj.lightdash.defaultSqlFilterRequiredColumns`** - Columns required for the default to apply

```json
{
  "dj.lightdash.defaultSqlFilter": "account_project_id in (select id from finops.account_rollup_hierarchy where proj_level_1_cd in (${lightdash.attributes.opus_purpose_level2}))",
  "dj.lightdash.defaultSqlFilterRequiredColumns": ["account_project_id"]
}
```

Filtering rules:

- **Inheriting the default** — when a model's `lightdash` block omits `sql_filter`, DJ injects the global default (only if every column in `defaultSqlFilterRequiredColumns` is present on the model).
- **No `lightdash` block** — DJ never adds the filter; the model's YAML is unchanged.
- **Per-model override** — `lightdash.table.sql_filter: "<some other filter>"` wins over the global default.
- **Explicit disable** — `lightdash.table.sql_filter: null` turns the filter off for that model, even when the global default is set.
- **Missing required columns** — when `defaultSqlFilterRequiredColumns` lists columns the model doesn't produce, the filter is silently skipped for that model.

Takes effect on next `DJ: Sync to SQL and YML`.

**`dj.lightdash.defaultPartitionColumnCaseSensitive`** - Auto-emit `case_sensitive: true` on partition columns in generated YAML (default: `false`)

```json
{ "dj.lightdash.defaultPartitionColumnCaseSensitive": true }
```

- When `true`, every generated partition column in `.yml` files gets `meta.dimension.case_sensitive: true`. This stops Lightdash from wrapping the column in `UPPER()` in queries, preserving Trino predicate pushdown on partitioned tables.
- When `false` (the default), partition columns are emitted without the auto-injected `case_sensitive` flag. Per-model and per-column `lightdash.case_sensitive` overrides in `.model.json` continue to work in either mode.
- Takes effect on next `DJ: Sync to SQL and YML`.

**`dj.lightdash.defaultSqlFilter`** - Global default `sql_filter` for lightdash tables

**`dj.lightdash.defaultSqlFilterRequiredColumns`** - Columns required for the default to apply

```json
{
  "dj.lightdash.defaultSqlFilter": "account_project_id in (select id from finops.account_rollup_hierarchy where proj_level_1_cd in (${lightdash.attributes.opus_purpose_level2}))",
  "dj.lightdash.defaultSqlFilterRequiredColumns": ["account_project_id"]
}
```

Filtering rules:

- **Inheriting the default** — when a model's `lightdash` block omits `sql_filter`, DJ injects the global default (only if every column in `defaultSqlFilterRequiredColumns` is present on the model).
- **No `lightdash` block** — DJ never adds the filter; the model's YAML is unchanged.
- **Per-model override** — `lightdash.table.sql_filter: "<some other filter>"` wins over the global default.
- **Explicit disable** — `lightdash.table.sql_filter: null` turns the filter off for that model, even when the global default is set.
- **Missing required columns** — when `defaultSqlFilterRequiredColumns` lists columns the model doesn't produce, the filter is silently skipped for that model.

Takes effect on next `DJ: Sync to SQL and YML`.

---

### AI & Coding Agents

**`dj.aiHintTag`** - Automatically tag models with AI hints

```json
{ "dj.aiHintTag": "ai-hints" }
```

- Scans descriptions for AI hint markers
- Adds tag to models containing hints
- Takes effect on next `DJ: Sync to SQL and YML`

**`dj.codingAgent`** - Enable coding agent integration

```json
{ "dj.codingAgent": true }
```

- Set to `true` (recommended) to enable AI agent integration
- Writes `AGENTS.md` to `.agents/dj/` and skill files to `.agents/skills/` at the workspace root
- Legacy string values (`"github-copilot"`, `"claude-code"`, `"cline"`) still accepted but deprecated
- Skills are agent-agnostic markdown files usable by any AI coding tool

---

### Auto-Generation & Tests

**`dj.autoGenerateTests`** - Auto-generate row count tests (⚠️ Experimental)

```json
{
  "dj.autoGenerateTests": {
    "enabled": true,
    "tests": {
      "equalRowCount": {
        "enabled": true,
        "applyTo": ["left"],
        "targetFolders": ["models/intermediate"]
      }
    }
  }
}
```

- `equalRowCount` - Assert same row count as parent
- `equalOrLowerRowCount` - Assert ≤ rows than parent
- `applyTo` - Which join types: `["left", "inner", "full", "cross"]`
- `targetFolders` - Which model folders to scan
- New models: tests added immediately
- Existing models: requires project reload

---

### Lineage Visualization

**`dj.columnLineage.autoRefresh`** - Auto-refresh lineage (default: `true`)

**`dj.dataExplorer.autoRefresh`** - Auto-refresh data preview (default: `false`)

```json
{
  "dj.columnLineage.autoRefresh": false,
  "dj.dataExplorer.autoRefresh": true
}
```

- Updates views when switching between model files
- Data explorer disabled by default (executes queries)
- See [Lineage Documentation](LINEAGE.md)

---

### Diagnostics

**`dj.logLevel`** - Logging verbosity (default: `"info"`)

```json
{ "dj.logLevel": "debug" }
```

- Options: `"debug"` | `"info"` | `"warn"` | `"error"`
- View logs: `View → Output → DJ`
- Use `debug` for troubleshooting

---

## When Settings Take Effect

### ✅ Immediate

- `logLevel`
- `columnLineage.autoRefresh` / `dataExplorer.autoRefresh` (next file switch)

### ⚡ Next Command/Action

- `pythonVenvPath` - Next dbt/Python command
- `trinoPath` - Next Trino query
- `lightdashProjectPath` / `lightdashProfilesPath` - Next Lightdash preview

### 🔄 Requires `DJ: Refresh Projects`

Run this command (`Cmd/Ctrl+Shift+P` → `DJ: Refresh Projects`) after changing:

- `dbtProjectNames`, `dbtMacroPath`, `dbtGenericTestsPath`
- `airflowGenerateDags`, `airflowTargetVersion`, `airflowDagsPath`
- `codingAgent`
- `autoGenerateTests` (for existing models only)

### 🔄 Requires `DJ: Sync to SQL and YML`

- `aiHintTag` - Recompiles models with updated tags
- `lightdash.defaultSqlFilter` / `lightdash.defaultSqlFilterRequiredColumns` - Re-emits lightdash table meta on existing models
- `lightdash.defaultPartitionColumnCaseSensitive` - Re-emits partition column YAML meta

---

## Troubleshooting

### Settings Not Working?

1. Check [When Settings Take Effect](#when-settings-take-effect) section
2. Run appropriate command (Refresh Projects or Sync)
3. Check Output panel (`View → Output → DJ`) for validation errors

### Path Validation Errors?

- Use relative paths from workspace root: `".venv"`, `"macros/ext"`
- Or use absolute paths: `"/full/path/to/folder"`
- Ensure directories exist before setting
- For `trinoPath`: Run `DJ: Test Trino Connection` to verify
- For `pythonVenvPath`: Check for `bin/activate` file

### Where Are Settings Stored?

**Workspace settings** (recommended for project-specific):

- `.vscode/settings.json` in workspace root

**User settings** (apply to all projects):

- Mac/Linux: `~/.config/Code/User/settings.json`
- Windows: `%APPDATA%\Code\User\settings.json`

Workspace settings override User settings.

### Reset a Setting

Settings UI: `Cmd/Ctrl+,` → Search setting → Gear icon → "Reset Setting"

Or edit `.vscode/settings.json` and remove the line.

---

## Additional Resources

- [Setup Guide](setup/setup.md) - Initial extension setup
- [Lightdash Configuration](setup/lightdash-configuration.md) - Detailed Lightdash setup
- [Trino Integration](integrations/trino-integration.md) - Trino CLI setup
- [dbt Integration](integrations/dbt-integration.md) - dbt configuration
- [Lineage Guide](LINEAGE.md) - Column lineage features

---

**Need help?** Check the [main documentation](../README.md) or open an issue on GitHub.
