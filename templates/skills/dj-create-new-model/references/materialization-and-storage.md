# Materialization and storage

Load on demand when a model sets `materialization` / `materialized`, an
incremental strategy, or a storage `format`. See
`model.materialization.schema.json` and `model.incremental_strategy.schema.json`
for the exact shapes.

## Materialization field

- Prefer `"materialization": "incremental"` over legacy `"materialized": "incremental"`. For full control, use the structured form: `{ "type": "incremental", "format"?: "iceberg" | "delta_lake" | "hive", "partitions"?: [...], "strategy"?: {...} }`.
- Both `materialized` (legacy) and `materialization` (preferred) are accepted; when both are present, `materialization` takes precedence.
- Staging and intermediate layers default to `ephemeral` (a CTE, no table). Set `"materialization": "incremental"` for large sources or aggregations that should materialize.

## Incremental strategies

`materialization.strategy.type`:

- `append` — insert-only, no dedup.
- `delete+insert` — partition-safe upsert; `unique_key` auto-derived from partitions. Works on Delta Lake, Hive, and Iceberg.
- `merge` — row-level upsert on `unique_key`; **requires Iceberg format** in dbt-trino.
- `overwrite_existing_partitions` — drop & rewrite only the partitions present in the new slice; **requires a custom dbt macro in the consumer project**. If unavailable, use `delete+insert` instead.
- `dj_iceberg_partition_overwrite` — partition overwrite on Iceberg tables; **shipped by DJ** via `macros/_ext_/strategies.sql`; **requires Iceberg format** (on Delta Lake / Hive use `delete+insert`).

If omitted, the extension default applies (`dj.materialization.defaultIncrementalStrategy`).

## Storage format

- The structured `materialization` form allows `"format": "iceberg"` (or `"delta_lake"` / `"hive"`). The partitioning keyword changes automatically based on format — Iceberg emits `partitioning: ARRAY[...]`, Delta Lake / Hive emit `partitioned_by: ARRAY[...]`.
- Project-level `dbt_project.yml` vars (`storage_type`, `etl_schema`, `project_catalog`) drive storage-specific SQL generation when a per-model `format` is not set.
