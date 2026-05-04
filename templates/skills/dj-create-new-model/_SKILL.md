---
name: dj-create-new-model
description: >-
  Create a DJ .model.json file for a new dbt model. Use when the user wants to
  create, add, or scaffold a dbt model -- staging, intermediate, or mart --
  including joins, CTEs, rollup, subqueries, or aggregations.
compatibility: DJ extension workspace with .dj/schemas/ and .agents/dj/AGENTS.md
metadata:
  dj-framework-skill: '1.0'
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
- **group**: Group of the model - analytics, finops, sales, marketing, etc.
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
- **Incremental strategies** (`materialization.strategy.type`): `append` (insert-only, no dedup), `delete+insert` (partition-safe upsert; `unique_key` auto-derived from partitions), `merge` (row-level upsert on `unique_key` \u2014 **requires Iceberg format in dbt-trino**), `overwrite_existing_partitions` (**requires a custom dbt macro in the consumer project**; if not available, use `delete+insert` instead). If omitted, the extension default applies (`dj.materialization.defaultIncrementalStrategy`). See `model.incremental_strategy.schema.json`
- `int_select_model` and `int_join_models` support `from.rollup` for time-grain re-aggregation without needing a separate `int_rollup_model`. See AGENTS.md "Model Types" and `model.from.rollup.schema.json`
- Use the `ctes` array for inline CTEs on `int_select_model`, `int_join_models`, `int_union_models`, `mart_select_model`, `mart_join_models`. CTE bulk selects support `exclude`/`include` filters. See AGENTS.md "Inline CTEs" and `model.cte.schema.json`
- WHERE, HAVING, and JOIN ON conditions support inline subqueries via the `subquery` key. See AGENTS.md "Inline Subqueries" and `model.subquery.schema.json`
- Source freshness can be disabled with `"freshness": null` at source or table level

## Gotchas

- Subquery `column` is required for all operators except `exists`/`not_exists`
- CTEs must be ordered: a CTE can only reference CTEs defined **before** it in the `ctes` array
- **CTE `group_by` with computed columns**: bare string aliases (e.g., `["month"]`) for columns defined with `expr` (e.g., `DATE_TRUNC(...)`) pass schema validation but fail at Trino with `COLUMN_NOT_FOUND`. Use `"group_by": "dims"` or `[{ "expr": "..." }]` instead
- **CTE column type inheritance**: plain string selects in CTEs inherit `dim`/`fct` type from the upstream model or CTE -- no need to redeclare column types. This means `dims_from_cte` and `fcts_from_cte` correctly filter by type in CTE-to-CTE chains
- **CTE bulk select filtering**: `all_from_cte`, `dims_from_cte`, `fcts_from_cte` support `exclude` and `include` arrays to filter columns
- **`lightdash.metrics` / `lightdash.metrics_merge` on a CTE `select` item is an error** — declare those on the main-model `select` only. Keep the pre-aggregated column in the CTE and re-aggregate it in the main model (`agg` / `aggs` / aggregate `expr`). `lightdash.dimension` on CTE selects still propagates.
- **Un-aggregated `fct` + main-model `group_by` is an error** — every `fct` in the main `select` must set `agg` / `aggs`, wrap an aggregate in `expr` (`sum(x)`, `avg(x)`, `merge(cast(x as hyperloglog))`, `cast(tdigest_agg(x) as varbinary)`, `any_value(x)`, …), or `exclude_from_group_by: true`. Applies to scalar selects, CTE scalar refs, and bulk `all_from_cte` / `fcts_from_cte` carriers.
- **`portal_source_count` auto-injects in CTEs whose `from` is a model** — don't duplicate it in the CTE `select`; it's appended automatically (aggregated with `count` when the CTE has a `group_by`). Set `override_suffix_agg: true` only when you need a differently-aggregated variant alongside the audit column.
- **`datetime` and `portal_partition_*` auto-inject in CTEs whose `from` is a model** — mirrors the main-model behavior. If the upstream has them and the CTE's select (or `dims_from_model.include`) did not list them, they're appended automatically. An explicit `{ "name": "datetime", "interval": X }` drives partition exclusion: `day` drops hourly, `month` drops hourly+daily, `year` drops all three. Only fires for plain `from: { model }` — not `from: { cte }`, source, or union shapes.
- **Dead outer-layer warning** — if the main `select` is a single `all_from_cte` / `dims_from_cte` passthrough of one CTE with identical `group_by` and no extra filter / limit / projection, drop the wrapper or add new work to it. See `docs/models/CTE_PATTERNS.md`.
- `from.rollup` requires the upstream model to have a select column with an `"interval"` field (e.g., `{ "name": "datetime", "interval": "day" }`)
- Cross joins have no `on` property -- do not include `on: {}` or `on: null`
- Subquery `from` can reference a model, source, or CTE -- use `{ "cte": "name" }` for CTEs defined in the same model
- `topic` is not in `required` for `int_join_models` (it is for all other types) -- still set it in practice
- `mart_select_model` and `int_union_models` do not support `agg`/`aggs` in select items -- use only passthrough or expression columns
- `materialization` structured form allows `"format": "iceberg"` for Iceberg storage -- partitioning keyword changes automatically based on format
- Both `materialized` (legacy) and `materialization` (preferred) are accepted; when both are present, `materialization` takes precedence
