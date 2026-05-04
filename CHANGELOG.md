# Change Log

## 1.3.3

### Incremental strategies

- **All four dbt-trino strategies are now settable per model** — `append`, `delete+insert`, `merge`, and `overwrite_existing_partitions` via `materialization.strategy.type` and the Model Wizard. Previously only `delete+insert` and `merge` were expressible per model.
- **Hover-time warnings on strategies with prerequisites** — `merge` flags that it requires Iceberg format on the target table, and `overwrite_existing_partitions` flags that it requires a custom dbt macro in your project; both direct you to `delete+insert` when the prerequisite isn't met.
- **`unique_key` auto-derived from partition columns for `overwrite_existing_partitions`** — matches the existing `delete+insert` behavior, so partitioned incremental models no longer need to spell out their partition column as `unique_key` by hand.
- **`dj.materialization.defaultIncrementalStrategy` now accepts `append`** — alongside the existing values. The factory default is still `overwrite_existing_partitions` and is planned to move to `delete+insert` in a future release.

### CTE fixes

- **CTE aggregation fixes** — `agg: hll` / `tdigest` / `count` now emit valid kernels (`hll()` was previously a nonexistent function), `{name:"datetime", interval}` actually truncates to the requested grain, `group_by: "dims"` groups by the derived expression instead of the alias, and downstream re-aggregations reference the CTE output alias (e.g. `sum(thread_gb_hours_sum)`) instead of leaking the original `expr`. `agg` over an already-suffixed column (like `{ name: "portal_source_count", agg: "count" }` or `{ name: "x_hll", agg: "hll" }`) keeps the bare name and uses the merge kernel; set `override_suffix_agg: true` to force a fresh aggregation.
- **Correct CTE YAML and audit columns** — `data_type`, `description`, `meta.dimension` (including `hidden`), `exclude_from_group_by`, `override_suffix_agg`, and `lightdash.case_sensitive` now flow through CTEs into downstream `dims_from_cte` / `fcts_from_cte` consumers. `datetime`, `portal_partition_*`, and `portal_source_count` auto-inject in CTEs whose `from` is a model, mirroring the main-model behavior (previously dropped by narrow `dims_from_model.include` lists). Columns are sorted alphabetically with partitions pushed to the bottom, matching main-model output.

### Incremental materialization

- **`unique_key` only defaults to columns the model actually produces** — monthly rollups correctly fall back to `portal_partition_monthly`; unpartitioned incremental models omit `unique_key` entirely.

### CTE authoring diagnostics

- **Stricter validation in the Problems tab** — rejects `lightdash.metrics` / `metrics_merge` on CTE selects (only main-model selects feed Lightdash), un-aggregated `fct` columns with a main-model `group_by` (would produce invalid Trino SQL), and warns on no-op outer layers. Errors now pin to the specific `select[]` item instead of line 1, and a broad set of Trino aggregate kernels (`sum`, `avg`, `any_value`, `arbitrary`, `merge(cast(... as hyperloglog|tdigest))`, `approx_*`, and any `*_agg` UDAF) is recognized inside `expr`.
- **New [CTE Patterns](docs/models/CTE_PATTERNS.md) guide** documents inline CTEs, aggregation boundaries, and auto-injection rules.

## 1.3.2

### Airflow ETL Improvements

- **Automatic dbt retry for transient failures** — `dbt_build` now performs an immediate `dbt retry` when model failures are not known to be permanent (compilation errors, missing columns, permission denied, etc.), reducing flaky DAG failures from transient Trino errors
- **Multi-model test tracking** — tests that reference multiple models (e.g. relationships tests) now record separate entries per dependent model in `dbt_test_dates`, with the MERGE key expanded to `(test_id, model_id, event_date)` for accurate per-model test tracking
- **Robust test result parsing** — `parse_dbt_results` now gracefully falls back to `depends_on.nodes` when `attached_node` is unavailable, and skips tests with no model association instead of writing null model IDs

## 1.3.1

### CTE Partition Filters

- **Automatic partition filters for CTEs** — CTEs that reference upstream models via `from.model` now automatically receive `_ext_event_date_filter` partition predicates, and models that read from CTEs (`from.cte`) also get partition filters by resolving the CTE chain to its root model or source. This makes CTE-based models consistent with ephemeral model chains.
- **CTE-level `exclude_date_filter`** — individual CTEs can opt out of automatic partition filters by setting `"exclude_date_filter": true`, independent of the parent model's setting

## 1.3.0

### Catalog-Agnostic Storage Support

- **Iceberg and Glue/Polaris support** — new `storage_type`, `etl_schema`, and `project_catalog` variables in `dbt_project.yml` enable catalog-agnostic SQL generation across Delta Lake, Iceberg, Hive, and Glue/Polaris
- **Storage-type-aware partitioning** — incremental models automatically use the correct format (`partitioned_by` vs `partition_by`) based on storage type

### Materialization Shorthand

- Simplified syntax for materialization, use `"materialization": "incremental" | "ephemeral"` instead of the full object definition.
- New `dj.materialization.defaultIncrementalStrategy` setting to define global default for incremental materialization shorthand. Can be overridden per model via `materialization.strategy`.
- Enabled strategy field in Model Wizard for incremental models.

### CTE Bulk Select: Exclude/Include Filters and Type Inheritance

- **`exclude`/`include` support for CTE bulk selects** — `all_from_cte`, `dims_from_cte`, and `fcts_from_cte` directives now accept `exclude` and `include` arrays to filter which columns are selected from a CTE, matching the existing support for model-level bulk selects
- **Column type inheritance in CTEs** — when a CTE selects columns as plain strings (e.g. `"select": ["col_a", "col_b"]`), the dim/fct type is now inherited from the parent model or CTE instead of defaulting all columns to `dim`. This ensures `dims_from_cte` and `fcts_from_cte` correctly filter by column type in CTE-to-CTE chains
- **CTE column reference validation** — invalid column names in `exclude`/`include` arrays are now reported as errors in the VS Code Problems tab with the list of available columns, without blocking the sync workflow
- **Column lineage accuracy** — lineage tracing now respects dims/fcts type filters when resolving CTE bulk directives, preventing `fct` columns from appearing in `dims_from_cte` lineage traces (and vice versa)

### CTE group_by Validation for Computed Columns

- **Reject string aliases for computed columns in CTE `group_by`** — using bare string aliases like `["month"]` when `month` is defined with an `expr` (e.g. `DATE_TRUNC('MONTH', col)`) now produces a validation error in the Problems tab instead of silently generating invalid SQL that fails at Trino runtime
- **Recommended pattern documented** — `[{ "type": "dims" }]` is now documented as the recommended `group_by` pattern inside CTEs, automatically resolving computed expressions

### Enhancements

- Support `"dims"` as a top-level string value for `group_by`, equivalent to `[{ "type": "dims" }]`.
- Support `"dims"` as a string value for join `on`, automatically joining on all shared dimension columns.
- Update source and table freshness configuration:
  - Source-level freshness now accepts a config object or null (disables checks for the entire source).
  - Table-level optional freshness property (set to null to disable per-table).
  - Table-level optional `loaded_at_field` to allow overriding the timestamp field.

## 1.2.1

- AGENTS.md and skill files now written to `.agents/dj/` and `.agents/skills/` respectively, instead of `.dj/`

## 1.2.0

### Inline Subquery Support

- **Nested subqueries in WHERE, HAVING, and JOIN ON conditions** — define inline subqueries directly in model JSON with support for 10 operators: `IN`, `NOT IN`, `EXISTS`, `NOT EXISTS`, `=`, `!=`, `>`, `>=`, `<`, `<=`
- **Subquery data sources** — reference models, sources, or CTEs as the subquery's FROM clause, with optional inner WHERE filtering
- **Visual SubqueryEditor** — new reusable UI component with searchable dropdowns for model/source/CTE selection, operator picker, and collapsible layout
- **JOIN ON subqueries** — subquery conditions alongside column and expression conditions in join definitions
- **Schema validation** — new `model.subquery.schema.json` with `$ref` integration into WHERE, HAVING, and JOIN schemas

### Enhancements

- Improved JOIN node headers with `override_alias` support and cleaner layout
- Added a `from.rollup` property to `int_select_model` and `int_join_models`, enabling time-grain re-aggregation alongside explicit column selection and joins. This provides the functionality of `int_rollup_model` with greater control over dimensions and custom expressions.
- Added selective model execution for deferred runs. Users can now choose which modified models to include when running with `--defer`, instead of running all changed models.
- Refactored AI agent integration to use agent-agnostic skill files (Agent Skills open standard) instead of agent-specific prompts
- Removed unnecessary activation events for faster extension startup
- `dj.codingAgent` setting now accepts `boolean` (recommended) with legacy string values deprecated
- Updated AGENTS.md template and skill files with documentation for inline CTEs, subqueries, and `from.rollup`

### Fixes

- Fixed crash in JOIN ON processing when `on` is undefined (cross joins)
- Fixed schema compliance by omitting `on` property for cross joins in `buildJoinUpdate`
- Resolved an issue where column metadata (descriptions, tags, and partition configs) failed to propagate through CTEs
- Fix Data Explorer showing stale results when changing the selected model in Data Modeling; now auto-refreshes columns and clears previous query results on model change

## 1.1.0

- Added an optional case_sensitive field at the model and field levels for explicit overrides; global default is managed via Lightdash config
- Fixed: Filter out inherited Lightdash metrics that reference unavailable columns during YAML generation

## 1.0.1 (March 19, 2026)

- Added a confirmation dialog when creating a model to resume a saved draft or start fresh

## 1.0.0 (March 2026)

### Visual Data Modeling

- **Interactive Model Builder** - Node-based visual canvas for creating and editing models
  - 10+ node types: Select, Join, Union, Rollup, Lookback, GroupBy, Where, Column Selection, Column Configuration, Lightdash
  - Configure joins, select columns, add filters, and group data directly in the UI
  - Add custom columns with expressions, formulas, and SQL
  - Real-time validation and SQL preview
  - Instant preview of generated JSON, SQL, and YAML outputs with syntax highlighting
  - Final preview with side-by-side or unified diff comparison
  - Model cloning to duplicate existing models
  - Identical output to JSON configuration
  - Seamless switching between visual and JSON editing
  - Source Model reference for aggregated columns in `int_select_model` and `int_lookback_model`
  - Aggregation support (`agg`, `aggs`) in join model types (`int_join_models`, `mart_join_models`) with `HAVING` clause for `mart_join_models`
  - Inline CTEs (Common Table Expressions) for `int_select_model`, `int_join_models`, `int_union_models`, `mart_select_model`, and `mart_join_models` — define lightweight SQL `WITH` clauses within model JSON, with CTE chaining, CTE joins, CTE unions, and lineage tracing
  - Seed CSV column reading when columns are not defined in the dbt manifest

### Interactive Learning

- **Tutorial System** - Two interactive modes accessible from Model Create wizard
  - "Play Tutorial" button - Guided walkthroughs with pre-filled data for Select, Join, Union, Rollup, and Lookback models
  - "Assist Me" button - Toggle contextual help and on-demand guidance while working
  - Accessed via help icon (?) in Model Create wizard header
  - Automatic navigation through wizard steps with highlighted UI elements

### Data Explorer & Lineage

- **Model Lineage Graph** - Improved visualization for large projects

  - Progressive node expansion to explore upstream/downstream dependencies
  - Visual indicators for model types with color-coded badges
  - Query and preview model data with configurable row limits
  - Sortable query results with data and SQL view modes
  - Compile model with real-time log streaming in dedicated panel
  - Auto-sync toggle - automatically updates when switching model files (toggle in toolbar)

- **Column-Level Lineage** - Column-level dependency tracing
  - Interactive DAG visualization to trace upstream/downstream column dependencies
  - Expression analysis (raw, passthrough, renamed, derived transformations)
  - Transformation tooltips show SQL expressions for derived columns
  - CSV export for single column or all columns in a model
  - Auto-refresh toggle - automatically updates when switching files (toggle in toolbar)

### Integration Enhancements

- **dbt Command Integration** - Run dbt directly from VS Code

  - Compile with `Cmd+Shift+C`
  - Execute dbt commands with multiple options (build, defer, full refresh, clean, deps, seed)
  - Run single model, multi-model, full project, or modified models with lineage tracking
  - Preview and copy generated commands with syntax highlighting

- **Lightdash Preview** - One-click BI dashboard previews

  - Manage multiple active previews with custom suffixes
  - Progress tracking with status updates
  - Enhanced Lightdash metadata configuration
  - AI hint support for semantic layer
  - Open previews in browser or copy links to clipboard
  - Inherited metrics filtering based on downstream column availability

- **Trino Integration** - Database execution and monitoring
  - Executes dbt models using Trino as query engine
  - Query monitoring view shows running queries from DJ operations
  - System monitoring (node status and cluster health)
  - Source introspection for automatic column detection when creating sources
  - Test connection command to verify Trino connectivity

### Developer Experience

- **Edit Drafts** - Non-destructive model editing

  - Edit models without affecting generated SQL/YAML
  - Save/discard draft changes
  - Draft management in sidebar view
  - Persistent form state stored in `.dj/state` subdirectory for draft model preservation

- **Run DBT Test** - Interactive webview for running dbt data tests

  - Model selection with git-changed model detection and manual selection
  - Smart test auto-detection based on model structure (joins, aggregates)
  - Bulk test configuration and per-model lineage controls (upstream/downstream)
  - Real-time test execution with streaming console output
  - Test status tracking and analytics summary (success/failure rates)
  - Configurable tests: `equal_row_count`, `equal_or_lower_row_count`, `no_null_aggregates`

- **First Launch** - Background checks and .gitignore prompt

  - Silent background checks for prerequisites (Trino CLI, Python venv, dbt)
  - .gitignore configuration prompt for `.dj/` folder

- **Settings Validation** - Instant feedback when configuring the extension

  - Real-time validation of Python venv path, Trino path, and dbt projects
  - Clear error messages if paths are invalid or missing
  - Helpful prompts to refresh projects or test connections

- **Enhanced Error Messages** - Clear, actionable validation errors

  - Model-type-specific error messages explain exactly what's wrong
  - Contextual suggestions for fixing common mistakes
  - Friendly error formatting instead of technical schema errors

- **Incremental Model Defaults** - Pre-configured hook values for incremental models

### 🤖 AI & Agent Support

- **AI Hints** - Natural language descriptions for semantic layer
  - Column-level AI hints
  - Model-level AI hints
  - Bulk AI hint updates
  - Integration with coding agents (Copilot, Claude, Cline)
  - Auto-generated `AGENTS.md` providing LLM context for dbt projects

### 🎨 UI/UX

- **Dark Mode Support** - Full dark mode theming across all features and UI components

### ⚡ Performance

- **Faster Extension Startup** - Extension loads more quickly when opening workspaces
- **Smoother File Switching** - Intelligent debouncing prevents lag when rapidly switching between files
- **Faster Sync Operations** - Smart caching skips regenerating unchanged SQL/YAML files

### Documentation

- New comprehensive guides: Visual Editor, Lineage, Integrations
- Enhanced tutorial with interactive modes
- Setup guide improvements
- GIF demonstrations for key features

---

## 0.1.0 (Initial release)

- Initial version of DJ (dbt-json) Framework extension
