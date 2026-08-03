# Source Files & Scheduling

Load this when defining an external table (`.source.json`) or reasoning about how the ETL schedule flows to models.

## Source Files (`.source.json`)

Source files define external database tables that staging models read from. They are placed at:
`models/sources/<database>/<database>__<schema>.source.json`

### Source Structure

```jsonc
{
  "database": "my_database", // catalog/database name
  "schema": "my_schema", // schema name
  "tables": [
    {
      "name": "my_table", // table name
      "columns": [
        {
          "name": "account_id",
          "data_type": "varchar", // Trino data type
        },
        {
          "name": "cost",
          "data_type": "double",
          "description": "The raw cost amount", // optional
        },
      ],
    },
  ],
}
```

**Required fields**: `database`, `schema`, `tables`
**Required per table**: `name`, `columns`
**Required per column**: `name`, `data_type`

### Source Naming

The source name is derived as: `<database>__<schema>`

When referenced in a model's `from.source`, use: `<database>__<schema>.<table_name>`

### Source ETL Configuration

Sources can include ETL metadata in the `meta` field (at either schema or table level) to control scheduling:

```jsonc
{
    "database": "my_database",
    "schema": "my_schema",
    "meta": {
        "etl": {
            "active": true,                          // whether ETL monitors this source
            "backfill_start": "2024-01-01",          // date to start backfilling from (YYYY-MM-DD)
            "type": "event_count"                    // "event_count" (default) or "run_schedule"
        },
        "event_datetime": {
            "expr": "event_timestamp"                // expression to extract event datetime
        },
        "partition_date": {
            "expr": "dt",                            // partition date expression
            "interval": "day"                        // "day" or "month"
        }
    },
    "tables": [...]
}
```

#### ETL Types

- **`event_count`** (default): The scheduler queries this source to detect which event dates have new or changed data, then runs downstream models only for those dates. Requires `backfill_start`.
- **`run_schedule`**: The scheduler runs downstream models on a fixed schedule regardless of data changes. Does not require `backfill_start`.

### Source Partitions

Sources can define partition filters to enable efficient querying:

```jsonc
{
  "meta": {
    "partitions": [
      {
        "type": "event_dates", // filter by project event dates
        "expr": "dt", // partition column expression
      },
      {
        "type": "gte", // comparison: "eq", "gt", "gte", "lt", "lte", "neq"
        "expr": "created_date",
        "value": "2024-01-01",
      },
    ],
  },
}
```

### Optional Source Fields

- `description`: Description of the source
- `freshness`: dbt freshness configuration object, or `null` to disable freshness checks for the entire source
- `loaded_at_field`: Column indicating data freshness
- `meta.portal_partition_columns`: Custom partition columns for the framework
- `meta.portal_source_count`: Custom source count configuration
- `meta.table_function`: Table function configuration
- `meta.where`: Static where clause applied whenever the source is queried
- Per-table `meta`: Table-level overrides for the same meta fields above
- Per-table `freshness`: Table-level freshness config or `null` to disable for a specific table
- Per-table `loaded_at_field`: Table-level override for the timestamp field used in freshness checks

---

## Scheduling & ETL

The DJ (Data JSON) Framework uses an ETL scheduler (via Airflow) that determines **which event dates** need to be processed. This is driven by source configurations:

1. **Sources with `event_count` ETL type**: The scheduler queries source tables to detect which dates have new or changed rows, then runs only those dates through the downstream model DAG.
2. **Sources with `run_schedule` ETL type**: The scheduler triggers downstream models on a fixed cron schedule.
3. **Models inherit their schedule** from their upstream sources — you don't configure scheduling on individual models. The framework traces the DAG back to the source to determine when to run.

### How the Schedule Flows

```text
Source (etl config) → stg model → int model(s) → mart model
     ↑ schedule               ↓ inherits schedule from source
```

When creating a new model:

- If it reads from an **existing source**, the schedule is already handled.
- If it reads from a **new source**, you need to create a `.source.json` with the `meta.etl` configuration.
- The `backfill_start` date determines from when historical data will be processed.
