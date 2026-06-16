---
name: dj-create-new-model
description: >-
  Create a DJ .model.json file for a new dbt model. Use when the user wants to
  create, add, or scaffold a dbt model -- staging, intermediate, or mart --
  including joins, CTEs, rollup, subqueries, or aggregations.
compatibility: DJ (Data JSON) Framework extension workspace with .dj/schemas/ and .agents/dj/AGENTS.md
metadata:
  dj-skill: '1.0'
---

# Create DJ model

**Create** new **`.model.json`** files (and **`.source.json`** when adding sources). **Never** hand-edit auto-generated **`.sql`** / **`.yml`** — only the JSON sources of truth.

**Reading order:** **`.dj/schemas/`** (type schema + **`$ref`s**) for exact shapes → **`.agents/dj/AGENTS.md`** **Model Types** (examples) → **Advanced** (short map: CTEs, rollup, shorthands, subqueries, materialization, `"dims"` — still defer to schemas) → **Important Conventions** **#6**–**#15**.

## Model `type` (infer — do not ask the user)

| Layer    | Intent → `type`                                                                                                                                    |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **stg**  | raw source → `stg_select_source`; seed/model → `stg_select_model`; union sources → `stg_union_sources`                                             |
| **int**  | one model → `int_select_model`; joins → `int_join_models`; unnest → `int_join_column`; lookback → `int_lookback_model`; union → `int_union_models` |
| **mart** | one model → `mart_select_model`; joins → `mart_join_models`                                                                                        |

**Rollup:** optional **`from.model.rollup`** on **`int_select_model`** / **`int_join_models`** — coarser time **`interval`**, **`agg`/`aggs`** re-aggregated for the new grain (**`model.from.rollup.schema.json`**; **AGENTS** **Advanced**, **#9**–**#10**).

One clarifying question if source vs existing model is unclear.

## Inputs, path, workflow

**Fields:** `type`, `group`, `name`; `topic` on all types in schema **except** `int_join_models` is not in **`required`** (still set in practice). Ask for missing names; mirror project patterns.

**Path:** `models/<staging|intermediate|mart>/<group>/<topic>/<layer>__<group>__<topic>__<name>.model.json` (`stg_*`→`staging`, etc.).

**Checklist:**

- [ ] `type` from table; read **`.dj/schemas/model.type.<type>.schema.json`**; if CTE / subquery / **`from.model.rollup`** / hooks / **`agg`** / materialization, also **`model.cte`**, **`model.subquery`**, **`model.from.rollup`**, **`model.sql_hooks`**, **`model.materialization`**, **`model.select.*.with.agg`** as needed
- [ ] **`.agents/dj/AGENTS.md`**: **Model Types** example; **Advanced** if CTE / rollup / shorthand / subquery
- [ ] Upstream columns from **`.model.json`** / **`.source.json`** (trace **`ctes`** if any)
- [ ] Write **JSONC**; validate against schema

## Conventions & gotchas

- **type**: Type of the model - mart, staging, intermediate, source, etc. Determined from the decision tree above.
- **group**: Must be one of the groups defined in your project (e.g., `analytics`, `finops`, `marketing`, `engineering`, `sales`, `platform`).
- **topic**: Topic of the model - aws_cur, gcp_billing, salesforce, etc.
- **name**: Name of the model - accounts_billing_daily, opportunities_facts, etc.

If the user hasn't provided group/topic/name, ask for them. Look at existing models in the project for naming conventions.

## File Naming and Path

- **Model name**: `<layer>__<group>__<topic>__<name>` (e.g., `int__analytics__billing__daily_summary`)
- **File name**: `<model_name>.model.json`
- **Directory**: `models/<layer>/<group>/<topic>/` where layer is `staging`, `intermediate`, or `mart`

The layer directory is derived from the type prefix: `stg_*` -> `staging`, `int_*` -> `intermediate`, `mart_*` -> `mart`.

## Workflow

- [ ] Step 1: Determine the model type from the user's request
- [ ] Step 2: Gather required inputs (group, topic, name, type-specific fields)
- [ ] Step 3: Read the JSON schema at `.dj/schemas/model.type.<type>.schema.json` to understand required and optional fields. Follow `$ref` links to sub-schemas as needed
- [ ] Step 4: Refer to the AGENTS.md "Model Types" section for the example structure of the selected type
- [ ] Step 5: Read upstream model/source files to verify available columns before writing `select`
- [ ] Step 6: Create the `.model.json` file at the correct path using JSONC format (comments and trailing commas allowed)
- [ ] Step 7: Verify the file is valid against the schema

## Important Conventions

- Never edit generated `.sql` or `.yml` files -- only edit `.model.json`
- Use JSONC format: trailing commas are allowed, preserve any existing comments
- Source references use `<database>__<schema>.<table>` format (double underscore, then dot)
- Column types are `dim` (dimension) or `fct` (fact/measure), default is `dim`
- When using `agg`, always include `"group_by": "dims"` (or `[{ "type": "dims" }]`)
- `"dims"` shorthand: `group_by: "dims"` groups by all dimension columns; join `on: "dims"` auto-joins on all shared dimension columns
- For joins, verify upstream columns exist by reading the upstream model's `.model.json` or source `.source.json`
- Rename models by changing JSON fields (type/group/topic/name), never by renaming the file on disk
- Prefer `"materialization": "incremental"` over legacy `"materialized": "incremental"`. For full control, use the structured form: `{ "type": "incremental", "format"?: "iceberg"|"delta_lake"|"hive", "partitions"?: [...], "strategy"?: {...} }`. See `model.materialization.schema.json`
- **Incremental strategies** (`materialization.strategy.type`): `append` (insert-only, no dedup), `delete+insert` (partition-safe upsert; `unique_key` auto-derived from partitions), `merge` (row-level upsert on `unique_key` **requires Iceberg format in dbt-trino**), `overwrite_existing_partitions` (**requires a custom dbt macro in the consumer project**; if not available, use `delete+insert` instead), `dj_iceberg_partition_overwrite` (**shipped by DJ** via `macros/_ext_/strategies.sql`; **requires Iceberg format** on Delta Lake / Hive use `delete+insert` instead). If omitted, the extension default applies (`dj.materialization.defaultIncrementalStrategy`). See `model.incremental_strategy.schema.json`
- `int_select_model` and `int_join_models` support `from.rollup` for time-grain re-aggregation without needing a separate `int_rollup_model`. See AGENTS.md "Model Types" and `model.from.rollup.schema.json`
- Use the `ctes` array for inline CTEs on `int_select_model`, `int_join_models`, `int_union_models`, `mart_select_model`, `mart_join_models`. CTE bulk selects support `exclude`/`include` filters. See AGENTS.md "Inline CTEs" and `model.cte.schema.json`
- Inside a CTE, `from.rollup` is supported on `from.model` and `from.cte` (not `from.source`, not `from.union`). The framework rewrites the CTE's `datetime`, drops finer-grain partitions, wraps fct columns with their suffix-agg, and synthesizes `GROUP BY <dims>`. See `docs/models/CTE_PATTERNS.md` and `model.from.rollup.schema.json`
- WHERE, HAVING, and JOIN ON conditions support inline subqueries via the `subquery` key. See AGENTS.md "Inline Subqueries" and `model.subquery.schema.json`
- Source freshness can be disabled with `"freshness": null` at source or table level
- Free-form `meta` keys are allowed at both model and column level on `.model.json` (e.g., `owner`, `pii`, `compliance`). See AGENTS.md "Custom Meta" section, `model.meta.schema.json`, `column.meta.schema.json`
- For Lightdash column config, author `select[i].lightdash.dimension`, `.metrics`, `.metrics_merge`, `.case_sensitive` — not `meta.dimension` etc. The framework surfaces a Warning-severity diagnostic in the Problems tab if authored under `meta`

## Gotchas

- Subquery `column` is required for all operators except `exists`/`not_exists`
- CTEs must be ordered: a CTE can only reference CTEs defined **before** it in the `ctes` array
- **CTE `group_by` with computed columns**: bare string aliases (e.g., `["month"]`) for columns defined with `expr` (e.g., `DATE_TRUNC(...)`) pass schema validation but fail at Trino with `COLUMN_NOT_FOUND`. Use `"group_by": "dims"` or `[{ "expr": "..." }]` instead
- **CTE column type inheritance**: plain string selects in CTEs inherit `dim`/`fct` type from the upstream model or CTE -- no need to redeclare column types. This means `dims_from_cte` and `fcts_from_cte` correctly filter by type in CTE-to-CTE chains
- **CTE bulk select filtering**: `all_from_cte`, `dims_from_cte`, `fcts_from_cte` support `exclude` and `include` arrays to filter columns
- **`lightdash.metrics` / `lightdash.metrics_merge` on a CTE `select` item is an error** — declare those on the main-model `select` only. Keep the pre-aggregated column in the CTE and re-aggregate it in the main model (`agg` / `aggs` / aggregate `expr`). `lightdash.dimension` on CTE selects still propagates.
- **Un-aggregated `fct` + main-model `group_by` is an error** — every `fct` in the main `select` must set `agg` / `aggs`, wrap an aggregate in `expr` (`sum(x)`, `avg(x)`, `merge(cast(x as hyperloglog))`, `cast(tdigest_agg(x) as varbinary)`, `any_value(x)`, …), or `exclude_from_group_by: true`. Applies to scalar selects, CTE scalar refs, and bulk `all_from_cte` / `fcts_from_cte` carriers.
- **`portal_source_count` auto-injects in CTEs whose `from` is a model or another CTE** — don't duplicate it in the CTE `select`; it's appended automatically from the upstream (aggregated with `count` when the CTE has a `group_by`). Set `override_suffix_agg: true` only when you need a differently-aggregated variant alongside the audit column.
- **`datetime` and `portal_partition_*` auto-inject in CTEs whose `from` is a model or another CTE** — mirrors the main-model behavior. If the upstream (manifest schema for `{ model }`, the in-memory registry for `{ cte }`) has them and the CTE's select (or `dims_from_model.include`) did not list them, they're appended automatically. An explicit `{ "name": "datetime", "interval": X }` drives partition exclusion: `day` drops hourly, `month` drops hourly+daily, `year` drops all three. Auto-inject is still skipped for source and union shapes.
- **CTE exclude/include flags mirror the main-model flags and inherit from the model** — a CTE accepts `exclude_date_filter`, `exclude_daily_filter`, `exclude_datetime`, `exclude_framework_artifacts`, `exclude_portal_partition_columns`, `exclude_portal_source_count`, and `include_full_month` with the same semantics as their main-model counterparts. Resolution is uniform: **CTE override > model value > false**. Set a flag on the model to apply it to every CTE, on a single CTE to override only that CTE, or set `false` on a CTE to opt back in when the model excluded. `exclude_datetime` and `exclude_portal_partition_columns` are orthogonal — set both for pure-dim/lookup shapes; `exclude_datetime` is mutually exclusive with `from.rollup` at the same scope (model OR CTE) and the validator errors when both are set together.
- **Rolling up a CTE that sources from another CTE that excludes datetime is rejected** — the upstream must produce a datetime column for the rollup to truncate. Either drop `exclude_datetime` on the upstream CTE, or have the upstream itself declare `from.rollup`.
- **Framework columns flow through CTE chains by default** — `datetime`, `portal_partition_*`, and `portal_source_count` propagate through every `from: { cte }` hop (and into a main model with `from: { cte }`) by inheriting from the upstream registry. List them in `select` only for a transformed alias, or opt out per CTE / per model with the standard exclude flags. When the main model uses an `incremental` partition-overwrite strategy, the auto-flowed `portal_partition_*` typically satisfies the partition-column requirement; if you intentionally exclude them through a chain, set `materialization.partitions: ["datetime"]` on the main model. Wrapper SELECTs that reference an already-rolled-up `datetime` do not redundantly re-emit `date_trunc(<same interval>, datetime)`.
- **`exclude_framework_artifacts` is the combined-flag shortcut** — a single string-enum (`"all"` | `"columns"`) on the model or CTE that bundles `exclude_datetime` + `exclude_portal_partition_columns` + `exclude_portal_source_count` (`"columns"`), with `"all"` additionally implying `exclude_date_filter`. Individual flags at the same scope override per-column (e.g. `"exclude_framework_artifacts": "all"` + `"exclude_portal_source_count": false` keeps that one column). Resolution chain: CTE individual > CTE combined > model individual > model combined > false. Mutually exclusive with `from.rollup` when the resolved value implies excluding `datetime`.
- **Dead outer-layer warning** — if the main `select` is a single `all_from_cte` / `dims_from_cte` passthrough of one CTE with identical `group_by` and no extra filter / limit / projection, drop the wrapper or add new work to it. See `docs/models/CTE_PATTERNS.md`.
- `from.rollup` requires the upstream model to have a select column with an `"interval"` field (e.g., `{ "name": "datetime", "interval": "day" }`)
- Cross joins have no `on` property -- do not include `on: {}` or `on: null`
- Subquery `from` can reference a model, source, or CTE -- use `{ "cte": "name" }` for CTEs defined in the same model
- `topic` is not in `required` for `int_join_models` (it is for all other types) -- still set it in practice
- `mart_select_model` and `int_union_models` do not support `agg`/`aggs` in select items -- use only passthrough or expression columns
- `materialization` structured form allows `"format": "iceberg"` for Iceberg storage -- partitioning keyword changes automatically based on format
- Both `materialized` (legacy) and `materialization` (preferred) are accepted; when both are present, `materialization` takes precedence
- **`meta` is free-form but has a few reserved keys**. Column `type`, `dimension`, `metrics`, `case_sensitive`, `origin` and model `metrics`, `local_tags`, `case_sensitive`, and any key on `lightdash.table` are framework-owned — author via the structured sibling field (`type`, `lightdash.*`, `tags: [{ type: "local", tag }]`, etc.). Collisions trigger Warning diagnostics in the Problems tab
