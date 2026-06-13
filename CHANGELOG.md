# Change Log

## 1.8.0

### Dashboards as Code

- **New `dj.lightdash.restrictedProjects` setting** — flag Lightdash project UUIDs as `block` (the Upload tab refuses with an inline error) or `warn` (upload proceeds only after a confirmation dialog).
- **`Add path to .gitignore` now defaults to on**, overridable via the new `dj.lightdash.defaultAddPathToGitignore` setting (`false` keeps it opt-in). The written entry is now root-anchored (e.g. `/lightdash/`) so a same-named directory nested elsewhere isn't ignored.

### Bug fixes

- **YAML reserved tokens round-trip safely.** Values like `OFF`, `ON`, `YES`, `NO` (and lowercase variants) are now quoted on emit and tolerated on load, so `time_intervals: OFF` no longer turns into `false` in the manifest and crashes sync. Per-column meta failures also name the offending column.
- **Sync errors surface the real cause.** SQL/YML generation failures now show the underlying message instead of always pointing at `expr` syntax.

## 1.7.1

### Iceberg write strategy update

- **Write strategy** — Iceberg incremental writes now use an event-date literal directly instead of creating and querying a temporary table, improving write performance

## 1.7.0

### Adhoc SQL Editor / Query Draft

- **Query Draft support** — Create ad-hoc SQL queries in `.dj/drafts/` for prototyping and testing without cluttering the project with temporary dbt models. Access via "Create New Query" in the Actions panel.
- **Query Results panel** — New dedicated panel in the Data Explorer view container for executing draft SQL queries directly against Trino and viewing results. Shows query results, execution time, and errors.
- **DJ: Run Query command** — Right-click on `.draft.sql` files and select "DJ: Run Query" to execute the SQL and view results in the Query Results panel. Only draft-specific commands (Run Query, Convert to DJ Model) appear in the context menu.
- **AI-assisted model conversion** — Right-click on `.draft.sql` files to convert them to DJ models using your preferred AI assistant (Copilot, Cursor, or Claude). The extension detects available assistants and shows relevant options.
- **New `convert-sql-to-model` skill** — AI skill file that guides assistants through the SQL-to-model conversion process, analyzing query patterns and creating properly structured `.model.json` files.

## 1.6.0

### Agent Skills

- **Migrate legacy ephemeral models into inline CTEs through your AI assistant.** When `dj.codingAgent` is enabled, a new skill at `.agents/skills/dj-migrate-ephemerals-to-ctes/SKILL.md` walks an IDE agent through finding ephemeral `.model.json` files, deciding which ones can safely fold into their downstream consumers, applying the rewrite, and prompting you before any deletion. Ephemerals carrying Lightdash metadata or staging models that read from sources are flagged as unsafe so nothing is silently lost. Lets you say "audit the ephemerals under the sales group and migrate the qualifying ones" to dissolve redundant intermediate layers in one pass.
- **Modernize legacy `.model.json` shapes through your AI assistant.** When `dj.codingAgent` is enabled, a new skill at `.agents/skills/dj-review-and-refactor-model/SKILL.md` audits a single model file (or a folder, dependency tree, or the whole workspace) and renders every finding upfront in two buckets — safe rewrites the agent can apply confidently, and judgment calls where it gives you the context and lets you pick. Nothing is edited until you confirm. Lets you say "review this model and modernize whatever's safe" and get a confirmation-driven cleanup pass that round-trips your existing Lightdash metadata, AI hints, tags, and free-form `meta` keys.
- **Agent skills can bundle nested subdirectories.** A skill template's `references/`, `scripts/`, and `assets/` subdirectories are copied to `.agents/skills/<skill>/` alongside its `SKILL.md`, matching the [agentskills.io](https://agentskills.io) progressive-disclosure layout.

### Data Explorer — Lightdash lineage

- **Lightdash dashboards now show as downstream nodes for `mart_*` models** in the Data Explorer lineage graph. Each dashboard node lists its embedded charts in a popover, and saved charts that aren't part of any dashboard are bundled into a single **Standalone Charts** node per mart so the canvas stays tidy. Both nodes expose **Open YAML** (jump to the source file) and **Open in Lightdash** (deep link to the dashboard or chart in the Lightdash UI, when `LIGHTDASH_URL` and `LIGHTDASH_PROJECT` are set). Lineage is built locally from Dashboards-as-Code YAML under `dj.lightdash.dashboardsAsCodePath` and refreshes when the files change — no API calls, no extra `dbt` work.
- **New setting `dj.dataExplorer.showLightdashLineage`** (default `false`) and a matching **header toggle in the Data Explorer panel** opt into the Lightdash lineage layer, so projects that don't use Lightdash incur zero cost.
- **Empty-state CTA on the lineage graph** — when the toggle is on but no local content is found, an inline banner offers one-click access to **`Open Dashboards as Code`** to download the YAML and **`Refresh`** to rebuild the lineage.

### Dashboards as Code

- **Optional `.gitignore` helper on the Download tab** — new `Add path to .gitignore` checkbox (default off) idempotently appends the configured `dj.lightdash.dashboardsAsCodePath` to the workspace `.gitignore` before the download starts, so generated YAML stays out of version control. Entries land inside a short managed block (`# dj` … `# /dj`) so future DJ-managed paths can share the same region. Skips the write when the entry is already present and streams a single status line into the download log panel.

### Sync engine

- **Sync coalesces during bulk file changes** — large `git checkout`, `git pull`, `git restore .`, and other mass file operations now batch into a single sync run instead of triggering many partial syncs, preventing inconsistent intermediate state. Sync also detects `git rebase`, `git reset`, and fast-forward operations the same way it already handles `checkout` and `pull`.

## 1.5.0

### Lightdash

#### Dashboards as Code

- **Edit Lightdash charts and dashboards as YAML files directly in VS Code.** The new `DJ: Lightdash — Dashboards as Code` command opens a panel that pulls your saved charts and dashboards from a Lightdash project as YAML, lets you edit them with full schema-aware autocomplete and validation, and pushes the changes back — all without leaving the editor. The local folder is configurable via `dj.lightdash.dashboardsAsCodePath` (default `lightdash`).
- **Three tabs that match the workflow:** **Download** pulls the entire project or specific dashboards / charts (by slug, UUID, or URL); **Explorer** browses the downloaded YAML with a searchable file tree and a theme-aware preview that opens straight into the editor on `Edit`; **Upload** picks which files to push (or the whole project), with a post-upload prompt to refresh the just-uploaded files, refresh everything, clear locally, or keep as-is.
- **Targeted Lightdash projects.** A required Project UUID (production or preview) at the top of each tab keeps every download/upload pointed at the right project — useful when iterating against a preview project before promoting to production.
- **Schema validation comes for free.** When the Red Hat YAML extension is installed, the official Lightdash chart and dashboard schemas are auto-bound to your `charts/*.yml` / `dashboards/*.yml` files so you get inline errors, completions, and hover docs. The YAML extension is optional — opening the panel without it shows a one-time `Install / Not now / Don't ask again` prompt.
- **New `dj-edit-lightdash-yaml` agent skill.** When `dj.codingAgent` is enabled, a skill ships at `.agents/skills/dj-edit-lightdash-yaml/SKILL.md` that teaches AI assistants how to safely edit the downloaded YAML between Download and Upload (preserve `slug` / `version`, cross-check references to dbt models and chart slugs, keep diffs minimal, never invoke the CLI directly). Lets users say "tweak the filters on this dashboard" and get a correct, schema-aware change.

#### Default `sql_filter` for Lightdash tables

- **Project-wide default `sql_filter` for Lightdash tables.** New `dj.lightdash.defaultSqlFilter` setting applies a default filter to every Lightdash-exposed model that doesn't already declare its own. Per-model values still win (and `"sql_filter": null` explicitly opts a model out), and `dj.lightdash.defaultSqlFilterRequiredColumns` skips the default on models that don't have the columns the filter references — useful when the filter targets, say, a `tenant_id` that some models don't carry.

### Data Explorer

- **New Project Overview landing page** — Data Explorer now opens with a project summary instead of an empty canvas.
- **Source node enhancements** — clicking a source opens its `.source.json` (previously errored with "Model JSON file not found"), the query results tab is hidden for sources, and column lineage now navigates correctly from a source.

### Settings UX

- **One-click resync when settings that affect generated SQL change** — toggling `dj.lightdash.defaultSqlFilter`, `dj.lightdash.defaultSqlFilterRequiredColumns`, `dj.materialization.defaultIncrementalStrategy`, or `dj.aiHintTag` now shows a `Sync now / Later` notification so it's obvious the change requires regenerating SQL.

### Webview design system

- **New `web/DESIGN.md` reference** — a single source of truth for the colors, typography, spacing, and component tokens used across all DJ webviews (Model Wizard, Data Explorer, Dashboards-as-Code, etc.) with the corresponding CSS variables for all four themes (coder-dark, coder-light, web-dark, web-light). AI assistants and contributors building or modifying webview UIs can read this to stay consistent with the existing look and feel.

## 1.4.0

- **`from.rollup` is now supported inside individual CTE entries** — re-aggregate a CTE's source to a coarser time grain (`hour` / `day` / `month` / `year`) the same way `int_select_model` and `int_join_models` already do at the model level, but scoped to one stage of a multi-CTE pipeline. Supported on `from.model` and `from.cte` (not on `from.source` or `from.union`, both schema-rejected). A rollup CTE must declare an explicit `select` listing the dimensions to keep — rollup auto-truncates `datetime` and auto-wraps fact columns with their suffix aggregate, so the select is usually shorter than the manual `DATE_TRUNC` + `sum()` shape it replaces. The framework rewrites the CTE's `datetime` to `date_trunc(<interval>, datetime)`, drops finer-grain `portal_partition_*` columns, wraps fct columns with their suffix-agg (`revenue_sum` → `sum(revenue_sum) as revenue_sum`), and synthesizes `GROUP BY <dims>` when not authored. Chained rollups (CTE A → month, CTE B → year off A) work end-to-end. Wrapper SELECTs and downstream passthrough CTEs that reference an already-rolled-up `datetime` reference it directly without re-emitting `date_trunc(<same interval>, datetime)` on top. New validators reject `exclude_datetime` / `exclude_framework_artifacts: "all" | "columns"` paired with `from.rollup` at the same scope, reject a rollup CTE whose source is a sibling CTE that itself excludes datetime, and reject a rollup CTE that omits `select`. See `docs/models/CTE_PATTERNS.md`.
- **Framework columns flow through CTE chains** — `datetime`, `portal_partition_*`, and `portal_source_count` cascade through every `from: { cte }` hop (and into a main model with `from: { cte }`) by inheriting from the upstream CTE's registry, the same way `from: { model }` consumers inherit from the manifest. The exclude flags (`exclude_datetime`, `exclude_portal_partition_columns`, `exclude_portal_source_count`, `exclude_framework_artifacts`) are the per-CTE / per-model opt-out and follow the standard precedence: CTE individual > CTE combined > model individual > model combined > false. **Upgrade note:** models with a scalar `select` on top of a CTE chain will start producing additional `portal_partition_*` / `datetime` / `portal_source_count` columns in their generated SQL and YML on first sync after upgrade — audit the diff or set the matching exclude flag to keep the prior shape.
- **New `exclude_framework_artifacts` combined flag (model + CTE)** — single string-enum switch (`"all"` | `"columns"`) that bundles the framework-injection opt-outs into one knob. `"columns"` drops `datetime`, `portal_partition_*`, and `portal_source_count`; `"all"` additionally drops the auto `_ext_event_date_filter` WHERE clauses. Individual exclude flags at the same scope override per-column (e.g. `"exclude_framework_artifacts": "all"` paired with `"exclude_portal_source_count": false` keeps that one column). Resolution chain: CTE individual > CTE combined > model individual > model combined > false. Mutually exclusive with `from.rollup` when the resolved value implies excluding `datetime`. Surfaced in the Model Wizard's Column Excludes section alongside an `exclude_datetime` checkbox.
- **New `exclude_datetime` flag (model + CTE)** — opts out of `datetime` auto-injection. Mirrors the other harmonized exclude/include flags: same name on models and CTEs, with `CTE override > model value > false` inheritance. Orthogonal to `exclude_portal_partition_columns` — set both for pure-dimension or lookup models. Mutually exclusive with `from.rollup` at the same scope (model OR CTE) — the validator errors when both are set together.
- **`exclude_*` column flags are origin-aware** — `exclude_datetime`, `exclude_portal_partition_columns`, and `exclude_portal_source_count` (and the values inside `exclude_framework_artifacts` that imply them) only strip framework-auto-injected columns. A column named explicitly in `select` (scalar `name` or bulk `include`) is preserved; a column kept by bulk default (a column the bulk picked up because it wasn't in `exclude`) is not — the model-level flag still wins. Enables manual-rollup shapes that surface a computed expression as `datetime` while disabling the upstream auto-inject.
- **New partition-strategy sanity warning** — incremental models that resolve to `overwrite_existing_partitions` or `dj_iceberg_partition_overwrite` but emit no partition column now surface a warning in the Problems tab; both strategies silently no-op or fail at `dbt run` time without one. Typical triggers are `from: { union }` with a non-partition `select`, or `exclude_portal_partition_columns` / `exclude_framework_artifacts: "all" | "columns"` paired with no manual partition select. The heuristic walks `from: { cte }` chains and stays quiet whenever the chain terminates at a model/source head with no opt-out along any link, matching the runtime chain auto-inject. Suggested fixes: switch to a non-partition strategy (`delete+insert`, `merge`, `append`), expose a partition column (scalar/bulk `portal_partition_*` or `materialization.partitions`), or set `materialization: "ephemeral"`. Ignore if this is what you intend (e.g. partitioning is wired through a project-level dbt config the framework can't observe). Also flags names listed in `materialization.partitions` that don't appear in the model's `select` output — those are silently dropped from the dbt config otherwise, leaving the table unpartitioned. Rollup models are unaffected — `from.rollup` carries the partition through, and the `exclude_*` combination that would otherwise mask it is already blocked by the rollup-conflict error.
- **Schema-level deprecation hints on legacy materialization fields** — top-level `materialized`, `partitioned_by`, and `incremental_strategy` now carry `deprecated: true` and a migration description pointing at the equivalent under `materialization` (which accepts the same string shorthand plus the structured object form for `format` / `partitions` / `strategy`). `incremental_strategy` uses a thin wrapper schema (`model.incremental_strategy.deprecated.schema.json`) so the hint applies only to the deprecated top-level position, not to `materialization.strategy` which reuses the same shape. Surfaces in IntelliSense / hover for any consumer that binds these schemas (including the regenerated TypeScript types). No runtime warning — the fields keep working at SQL emit time, so existing models stay quiet on sync.
- **More reliable sync after branch switches and on newly-added models** — `git checkout` and `git pull` are now correctly detected and trigger a full re-sync, and the sync engine automatically refreshes the dbt manifest when a model being synced isn't in it yet. Models that arrive via branch switch, scaffold, or file copy now generate against an up-to-date manifest on the first sync.
- **Custom `meta` Keys** - Add any user-defined keys to `meta` on models, columns, sources, and source tables (e.g. `owner`, `pii`, `freshness_sla`, `owner_slack`). They flow through to the generated YAML verbatim.
- **Column `meta` Inheritance** - Column `meta` is inherited downstream through clean passthrough selects; `expr`-based selects do not inherit. Model-level `meta` is not inherited — each model declares its own.
- **Framework-owned `meta` Keys** - A handful of key names are framework-owned (e.g. `type`, `dimension`, `metrics`, `case_sensitive`). Using these under `meta` now surfaces a **Warning in the Problems tab** pointing to the canonical field (such as `lightdash.dimension`), so you don't have to diff the generated YAML to figure out why a value got overwritten.
- **Source Column Lightdash Propagation** - `dimension` and `case_sensitive` declared on a source column now flow to downstream staging models for plain passthrough selects and `all_from_source`. Other Lightdash sub-keys (`metrics`, `metrics_merge`) remain model-local. Per-key overrides at the model level still win.

## 1.3.8

- Renamed VS Code Marketplace extension ID from `workday.dj-framework` to `workday.dj`.
- Added Visual Studio Marketplace badges and Marketplace install instructions to the README; Marketplace is now the recommended install path with the GitHub Releases VSIX as a fallback.

## 1.3.7

### Naming alignment

- Renamed framework to **DJ (Data JSON) Framework** to better reflect its JSON-first, schema-driven approach
- Updated repository URL from `Workday/vscode-dbt-json` to `Workday/dj`

## 1.3.6

- **CTE exclude/include flags now mirror their main-model counterparts and inherit from the model** — a CTE accepts `exclude_date_filter`, `exclude_daily_filter`, `exclude_portal_partition_columns`, `exclude_portal_source_count`, and `include_full_month` with the same semantics as the corresponding main-model flags. Resolution is uniform: CTE override > model value > false. Set `exclude_portal_partition_columns: true` on the model to skip partition auto-injection in every CTE without per-CTE repetition; set it on a single CTE to override only that CTE.
- **New `dj_iceberg_partition_overwrite` incremental strategy** — drops and rewrites only the partitions present in the new slice on Iceberg tables. Shipped by DJ (no consumer macro required) and selectable from the Model Wizard. Requires Iceberg format on the target table; DJ flags non-Iceberg use directly in the Problems tab and points you to `delete+insert` instead.

## 1.3.5

- **`unique_key` no longer emitted for `overwrite_existing_partitions`** — this strategy requires a custom dbt macro in your project (typically `get_incremental_overwrite_existing_partitions_sql`); the DJ extension does not ship it and dbt-trino does not provide it natively. If your project does not define the macro, switch to `{ "type": "delete+insert" }` — it auto-derives `unique_key` from partition columns.
- **`dj.lightdash.defaultPartitionColumnCaseSensitive`** (default: `false`) — when `true`, partition columns in generated YAML get `meta.dimension.case_sensitive: true`. This stops Lightdash from wrapping them in `UPPER()` in queries, preserving Trino predicate pushdown on partitioned tables. Per-model and per-column `lightdash.case_sensitive` overrides in `.model.json` continue to apply.
- **Aggregation Validator Enhancements** — Validation issues are now flagged as Warnings rather than errors, allowing you to generate SQL and iterate even if columns are un-aggregated. The validator now ignores constant values (e.g., 0, null, 'foo') and Jinja/dbt macros that it cannot introspect. Specific messages added to guide on partition-column alignment for window functions, replacing generic aggregation errors.

## 1.3.4

- Partition columns automatically emit `case_sensitive: true` in YAML meta so Lightdash does not wrap them in `UPPER()`, preserving predicate pushdown

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
