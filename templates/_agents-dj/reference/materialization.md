# Materialization, Incremental Strategies & Framework Columns

Load this when setting how a model is stored (view / ephemeral / incremental), choosing an incremental strategy or storage format, or working with the framework-injected partition and audit columns.

## Materialization & Incremental Strategies

| Layer  | Default   | Common Override                                           |
| ------ | --------- | --------------------------------------------------------- |
| `stg`  | ephemeral | `"materialization": "incremental"` for large sources      |
| `int`  | ephemeral | `"materialization": "incremental"` for large aggregations |
| `mart` | view      | Not configurable — marts are always views                 |

**Materialization types**: `ephemeral` (CTE, no table), `incremental` (processes new data only)

### Materialization (Preferred)

Use the `materialization` field instead of the legacy `materialized` + `incremental_strategy` + `partitioned_by` combination. It accepts a string shorthand or a structured object.

**String shorthand** (equivalent to legacy `materialized`):

```jsonc
{
  "materialization": "incremental", // or "ephemeral"
}
```

**Structured form** (full control):

```jsonc
{
  "materialization": {
    "type": "incremental",
    "format": "iceberg", // optional: "delta_lake", "hive", or "iceberg"
    "partitions": ["portal_partition_daily"], // optional: columns to partition by
    "bucket": { "column": "tenant_name", "count": 32 }, // optional: { column, count } or an array of them
    "sorted_by": ["tenant_name", "product_area"], // optional: columns to sort by within each file/bucket
    "strategy": { "type": "delete+insert" }, // optional: see "Incremental strategies" below
    "database": "custom_database", // optional: override target database
  },
}
```

- **`format`**: Controls storage format. Defaults to the project's `storage_type` variable in `dbt_project.yml`. Iceberg uses `partitioning` keyword; Delta Lake/Hive uses `partitioned_by`. When a per-model `format` is not set, the project-level `dbt_project.yml` vars `storage_type`, `etl_schema`, and `project_catalog` drive storage-specific SQL generation.
- **`bucket`**: Hash-bucket the table by one or more columns. On **Iceberg** each entry becomes a `bucket(column, count)` transform inside `partitioning` (per-column counts allowed). On **Hive/Glue** it emits `bucketed_by` + a single shared `bucket_count` (all entries must use the same `count`). **Not supported on Delta Lake.** The bucket column must be one of the model's `select` columns.
- **`sorted_by`**: Columns to sort data by within each written file. On **Iceberg** it is a standalone sort order; on **Hive/Glue** it sorts within buckets and **requires `bucket`**. **Not supported on Delta Lake.** Columns sort ascending.
- **`strategy`**: See "Incremental strategies" below. If omitted, the extension default applies (configurable via `dj.materialization.defaultIncrementalStrategy`, defaults to `overwrite_existing_partitions`).

#### Incremental strategies (dbt-trino)

| Strategy                         | Shape                                                                                                    | When to use                                                                   | Caveat                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `append`                         | `{ "type": "append" }`                                                                                   | Fast insert-only; no de-dup                                                   | Upstream must guarantee no duplicates in the new slice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `delete+insert`                  | `{ "type": "delete+insert", "unique_key": "..." }`                                                       | Partition-safe upsert (**safe default**)                                      | `unique_key` is auto-derived from partitions when omitted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `merge`                          | `{ "type": "merge", "unique_key": "id", "merge_update_columns": [...], "merge_exclude_columns": [...] }` | Row-level upsert on a primary key                                             | **dbt-trino requires Iceberg format.** Set `materialization.format: "iceberg"` or the project var `storage_type: iceberg`                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `overwrite_existing_partitions`  | `{ "type": "overwrite_existing_partitions" }`                                                            | Drop & rewrite only partitions present in the new slice                       | **Requires a custom dbt macro in your project** (e.g. `get_incremental_overwrite_existing_partitions_sql`). DJ does NOT ship this macro and dbt-trino does NOT provide it natively. `unique_key` is **not applicable** for this strategy the macro derives partitions from the new slice itself, and the schema rejects `unique_key`. If your project does not define the macro, use `{ "type": "delete+insert" }` instead, behavior is equivalent for partition-aligned daily/monthly incrementals when `unique_key` is the partition column.                |
| `dj_iceberg_partition_overwrite` | `{ "type": "dj_iceberg_partition_overwrite" }`                                                           | Drop & rewrite only partitions present in the new slice on **Iceberg** tables | **Shipped by DJ.** No consumer macro required, `macros/strategies.sql` is auto-copied to `<project>/macros/_ext_/strategies.sql` on **DJ: Refresh Projects**. The dispatch macro is `get_incremental_dj_iceberg_partition_overwrite_sql`. **Requires Iceberg format**: set `materialization.format: "iceberg"` or project var `storage_type: iceberg`; otherwise DJ flags it in the Problems tab. `unique_key` is **not applicable**, the macro derives partitions from the new slice itself. On Delta Lake / Hive use `{ "type": "delete+insert" }` instead. |

### Legacy Incremental Configuration

Still supported but prefer `materialization` above:

```jsonc
{
  "materialized": "incremental",
  "incremental_strategy": { "type": "delete+insert" }, // or "merge" with "unique_key"
  "partitioned_by": ["portal_partition_daily"],
}
```

**Date filter options**: `"exclude_date_filter": true` (skip all date filtering), `"exclude_daily_filter": true` (skip daily partition filter only)

---

## Portal-Specific Columns

DJ automatically adds these columns:

### `portal_source_count`

Auto-generated `count(*)` for row tracking. Exclude with `"exclude_portal_source_count": true`.

### Partition Columns

Created from `interval` on datetime columns:

| Interval  | Generated Column                 |
| --------- | -------------------------------- |
| `"day"`   | `portal_partition_daily`         |
| `"hour"`  | `portal_partition_hourly`        |
| `"month"` | `portal_partition_monthly`       |
| `"year"`  | (none — only truncates datetime) |

Drop all of them with `"exclude_portal_partition_columns": true`, or drop any
subset with an array, e.g. `"exclude_portal_partition_columns": ["portal_partition_hourly"]`
removes only the listed columns and keeps the rest. An array overrides
`exclude_framework_artifacts` at the same scope (narrowing its all-partitions
exclusion to just the listed columns).

### Source-Level Configuration

```jsonc
{
  "meta": {
    "portal_source_count": { "exclude": true },
    "portal_partition_columns": { "daily": "custom_date_column" },
  },
}
```
