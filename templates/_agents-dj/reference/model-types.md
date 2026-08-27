# Model Types & Column Selection

Load this when shaping a model. Covers the 11 model types with worked examples, the Advanced map (CTEs, rollup, shorthands, subqueries), the select-column vocabulary, and common optional fields. **Exact shapes and required keys live in `.dj/schemas/model.type.<type>.schema.json`** (follow `$ref`s) — read the type schema before writing JSON.

## Model Types

### 1. `stg_select_source` — Staging: Select from a Source

Selects columns from a raw data source table.

```jsonc
{
  "type": "stg_select_source",
  "group": "my_group",
  "topic": "my_topic",
  "name": "raw_data_conformed",
  "materialized": "incremental", // optional: "incremental" or "ephemeral"
  "from": {
    "source": "my_database__my_schema.my_table", // format: <database>__<schema>.<table>
  },
  "select": [
    "account_id", // simple column reference (string)
    "region",
    {
      "name": "cost", // column with additional config
      "type": "fct", // "dim" (dimension) or "fct" (fact/measure)
      "expr": "CAST(cost AS double)", // optional SQL expression override
    },
    {
      "name": "event_date",
      "type": "dim",
      "data_type": "date", // optional Trino data type
    },
  ],
  "where": {
    // optional filter
    "and": [{ "expr": "cost > 0" }],
  },
}
```

**Required fields**: `type`, `group`, `topic`, `name`, `from.source`, `select`

### 2. `stg_select_model` — Staging: Select from Another Model

Selects from another model (commonly used for seeds).

```jsonc
{
  "type": "stg_select_model",
  "group": "my_group",
  "topic": "my_topic",
  "name": "lookup_mapping",
  "from": {
    "model": "seed__my_topic__lookup_mapping",
  },
  "select": ["key_column", "value_column"],
}
```

**Required fields**: `type`, `group`, `topic`, `name`, `from.model`, `select`

### 3. `stg_union_sources` — Staging: Union Multiple Sources

Unions multiple source tables.

```jsonc
{
  "type": "stg_union_sources",
  "group": "my_group",
  "topic": "my_topic",
  "name": "combined_accounts",
  "from": {
    "source": "my_database__my_schema.accounts_us",
    "union": {
      "sources": [
        "my_database__my_schema.accounts_eu",
        "my_database__my_schema.accounts_apac",
      ],
    },
  },
  "select": ["account_id", "account_name"],
}
```

**Required fields**: `type`, `group`, `topic`, `name`, `from.source`, `from.union.sources`

### 4. `int_select_model` — Intermediate: Select from a Model

Transforms data from a single upstream model. Supports optional `from.rollup` for time-grain re-aggregation (provides `int_rollup_model` functionality with more control over columns).

```jsonc
{
  "type": "int_select_model",
  "group": "my_group",
  "topic": "my_topic",
  "name": "daily_summary",
  "materialized": "incremental",
  "from": {
    "model": "stg__my_group__my_topic__raw_data_conformed",
    // optional: re-aggregate to coarser time grain
    "rollup": {
      "interval": "day", // "day", "hour", "month", "year"
    },
  },
  "select": [
    "account_id",
    {
      "name": "cost",
      "type": "fct",
      "agg": "sum", // auto-creates aggregation columns: sum, count, min, max, hll, tdigest
    },
    {
      "name": "datetime",
      "interval": "day", // interval column: "day", "hour", "month", "year"
    },
  ],
  "group_by": [
    { "type": "dims" }, // group by all dimension columns
  ],
  "where": "cost > 0", // simple string where clause
}
```

**Required fields**: `type`, `group`, `topic`, `name`, `from.model`, `select`

### 5. `int_join_models` — Intermediate: Join Multiple Models

Joins a primary model with one or more additional models. Supports optional `from.rollup` for time-grain re-aggregation alongside joins.

```jsonc
{
  "type": "int_join_models",
  "group": "my_group",
  "topic": "my_topic",
  "name": "enriched_daily",
  "materialized": "incremental",
  "from": {
    "model": "int__my_group__my_topic__daily_summary",
    // optional: re-aggregate to coarser time grain
    "rollup": {
      "interval": "day", // "day", "hour", "month", "year"
    },
    "join": [
      {
        "model": "int__my_group__other_topic__dimension_table",
        "type": "inner", // "left", "inner", "right", "full", "cross"
        "on": {
          "and": [
            "account_id", // shorthand: join on same column name
            "event_date",
            { "expr": "a.region = b.region" }, // or explicit SQL expression
          ],
        },
      },
    ],
  },
  "select": [
    {
      "model": "int__my_group__my_topic__daily_summary",
      "type": "dims_from_model", // "all_from_model", "dims_from_model", "fcts_from_model"
      "include": ["account_id", "region"], // optional: filter which columns
    },
    {
      "model": "int__my_group__other_topic__dimension_table",
      "type": "dims_from_model",
    },
    {
      "name": "allocated_cost",
      "type": "fct",
      "expr": "sum(a.cost * b.ratio)",
    },
  ],
  "group_by": [{ "type": "dims" }],
}
```

**Required fields**: `type`, `group`, `name`, `from.model`, `from.join`, `select`

### 6. `int_union_models` — Intermediate: Union Multiple Models

```jsonc
{
  "type": "int_union_models",
  "group": "my_group",
  "topic": "my_topic",
  "name": "all_providers_daily",
  "from": {
    "model": "int__my_group__provider_a__daily",
    "union": {
      "models": [
        "int__my_group__provider_b__daily",
        "int__my_group__provider_c__daily",
      ],
    },
  },
}
```

**Required fields**: `type`, `group`, `topic`, `name`, `from.model`, `from.union.models`

### 7. `int_rollup_model` — Intermediate: Time-based Rollup

Aggregates data to a coarser time interval.

```jsonc
{
  "type": "int_rollup_model",
  "group": "my_group",
  "topic": "my_topic",
  "name": "daily_from_hourly",
  "materialized": "incremental",
  "from": {
    "model": "int__my_group__my_topic__hourly_summary",
    "rollup": {
      "interval": "day", // "day", "hour", "month", "year"
    },
  },
}
```

**Required fields**: `type`, `group`, `topic`, `name`, `from.model`, `from.rollup.interval`

### 8. `int_lookback_model` — Intermediate: Trailing Window Aggregation

Aggregates over a trailing number of days.

```jsonc
{
  "type": "int_lookback_model",
  "group": "my_group",
  "topic": "my_topic",
  "name": "trailing_30d",
  "materialized": "incremental",
  "from": {
    "model": "int__my_group__my_topic__daily_summary",
    "lookback": {
      "days": 30,
      "exclude_event_date": false, // optional
    },
  },
  "select": ["account_id", { "name": "cost", "type": "fct", "agg": "sum" }],
  "group_by": [{ "type": "dims" }],
}
```

**Required fields**: `type`, `group`, `topic`, `name`, `from.model`, `from.lookback.days`, `select`

### 9. `int_join_column` — Intermediate: Cross Join on Unnested Column

Cross joins a model with an unnested array column.

**Required fields**: `type`, `group`, `topic`, `name`, `from.model`, `from.join.column`, `select`

### 10. `mart_select_model` — Mart: Select from a Model

Final business-ready model selecting from an intermediate model.

```jsonc
{
  "type": "mart_select_model",
  "group": "my_group",
  "topic": "my_topic",
  "name": "accounts_daily",
  "from": {
    "model": "int__my_group__my_topic__daily_summary",
  },
  "select": ["account_id", "cost_sum"],
}
```

**Required fields**: `type`, `group`, `topic`, `name`, `from.model`, `select`

### 11. `mart_join_models` — Mart: Join Multiple Models

Final business-ready model that joins multiple intermediate models. Same join syntax as `int_join_models`.

**Required fields**: `type`, `group`, `topic`, `name`, `from.model`, `from.join`, `select`

### Advanced: CTEs, rollup, shorthands, subqueries

For **`int_select_model`**, **`int_join_models`**, **`int_union_models`**, **`mart_select_model`**, **`mart_join_models`** (not staging). **Shapes and required keys** live in **`.dj/schemas/model.type.<type>.schema.json`** and **`$ref`** targets — read those first; this section is a map, not a full spec.

- **CTEs**: Optional ordered **`ctes`**. **`model.ctes.schema.json`**, **`model.cte.schema.json`**. Authoring rules and gotchas: [ctes-and-subqueries.md](ctes-and-subqueries.md).
- **`from`**: Each type’s **`from`** **`anyOf`** lists legal combinations (**`model`**, **`cte`**, **`join`**, optional **`rollup`** on **`int_*` select/join only** — not on marts).
- **Rollup on select/join**: Optional **`rollup`** on **`from.model`** for **`int_select_model`** and **`int_join_models`** only (not marts). Requires the upstream to expose a select column with an **`interval`** field (e.g. **`{ "name": "datetime", "interval": "day" }`**). Keeps a normal **`select`** / join; coarser **`interval`** triggers **re-aggregation** of declarative **`agg`/`aggs`**. **`model.from.rollup.schema.json`**. For **`group_by` / `agg` / `expr`** rules see `.agents/dj/AGENTS.md` **Important Conventions** (#9–#10).
- **Rollup inside a CTE**: Optional **`rollup`** on a CTE's **`from.model`** or **`from.cte`** (not **`from.source`**, not **`from.union`**). Re-aggregates that CTE's source to a coarser grain — same DATE_TRUNC + suffix-agg + GROUP BY behavior as the model-level rollup, but scoped to one stage of the pipeline. Available on every CTE-supporting model type. **`exclude_datetime`** / **`exclude_framework_artifacts`** at the same scope is rejected as a conflict; chained rollups (e.g. month CTE feeding a year CTE) work end-to-end.
- **Shorthands & CTE columns**: **`dims_from_*`**, **`fcts_from_*`**, **`all_from_*`** and explicit CTE column objects — **`model.select.model.schema.json`**, **`model.select.cte.schema.json`**, related **`model.select.*`**. CTE bulk selects support **`exclude`/`include`** filters and **inherit dim/fct types** from upstream.
- **`where` / `having`**: Nested **`subquery`** — **`model.subquery.schema.json`**. See [ctes-and-subqueries.md](ctes-and-subqueries.md).
- **`"dims"` shorthand**: **`group_by: "dims"`** equivalent to **`[{ "type": "dims" }]`**; join **`on: "dims"`** auto-joins on all shared dimension columns — **`model.group_by.schema.json`**.
- **Materialization**: String **`"incremental"`** / **`"ephemeral"`** or structured object with **`type`**, **`format`**, **`partitions`**, **`strategy`**, **`database`** — **`model.materialization.schema.json`**. See [materialization.md](materialization.md).

---

## Select Column Types

### Simple String Reference

```jsonc
"column_name"
```

Selects a column by name with default dimension type.

### Named Column (`dim` or `fct`)

```jsonc
{
  "name": "column_name",
  "type": "dim", // "dim" (dimension) or "fct" (fact/measure) — default is "dim"
  "data_type": "varchar", // optional: Trino data type
  "description": "Description", // optional
  "expr": "CAST(col AS varchar)", // optional: SQL expression override
}
```

### Aggregated Column

```jsonc
{
  "name": "cost",
  "type": "fct",
  "agg": "sum", // "sum", "count", "min", "max", "hll", "tdigest"
}
```

This auto-creates an aggregation column named `<name>_<agg>` (e.g., `cost_sum`).

### Multi-Aggregations

```jsonc
{
  "name": "cost",
  "type": "fct",
  "aggs": ["sum", "count", "min", "max"],
}
```

### From Another Model (in join/union models)

```jsonc
{
  "model": "int__my_group__my_topic__daily_summary",
  "type": "dims_from_model", // "all_from_model", "dims_from_model", "fcts_from_model"
}
```

With optional include/exclude:

```jsonc
{
  "model": "int__my_group__my_topic__daily_summary",
  "type": "dims_from_model",
  "include": ["account_id", "region"],
  "exclude": ["internal_id"],
}
```

### Named Column from Specific Model

```jsonc
{
  "model": "int__my_group__my_topic__daily_summary",
  "name": "cost",
  "type": "fct",
}
```

### From Source (in staging models)

```jsonc
{
  "source": "my_database__my_schema.my_table",
  "type": "all_from_source",
}
```

### From CTE (in models with `ctes`)

```jsonc
{
  "cte": "my_cte_name",
  "type": "all_from_cte", // "all_from_cte", "dims_from_cte", "fcts_from_cte"
}
```

With optional include/exclude:

```jsonc
{
  "cte": "my_cte_name",
  "type": "dims_from_cte",
  "include": ["account_id", "region"],
}
```

Named column from a CTE:

```jsonc
{
  "cte": "my_cte_name",
  "name": "cost",
  "type": "fct",
}
```

### Interval (Datetime)

```jsonc
{
  "name": "datetime",
  "interval": "day", // "day", "hour", "month", "year"
}
```

---

## Common Optional Model Fields

| Field                              | Type          | Description                                                                                                                                                                                  |
| ---------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`                      | string        | Model description                                                                                                                                                                            |
| `tags`                             | array         | Tags for categorization, e.g. `["my_tag", "my_group"]`                                                                                                                                       |
| `depends_on`                       | array         | Extra model names to force as dbt DAG edges via `--depends_on: {{ ref('...') }}` SQL comments (for refs hidden from parse, e.g. inside `{% if execute %}`)                                   |
| `materialized`                     | string        | Legacy: `"incremental"` or `"ephemeral"` (default is view-like). Prefer `materialization` instead.                                                                                           |
| `materialization`                  | string/object | Preferred. String `"incremental"` or `"ephemeral"`, or object `{ "type": "incremental", "format"?, "partitions"?, "strategy"?, "database"? }`. See [materialization.md](materialization.md). |
| `incremental_strategy`             | object        | Legacy: `{ "type": "delete+insert" }` or `{ "type": "merge", "unique_key": "id" }`. Prefer `materialization.strategy`.                                                                       |
| `sql_hooks`                        | object        | `{ "pre": "SET ...", "post": "..." }` — SQL to run before/after (staging and intermediate only)                                                                                              |
| `partitioned_by`                   | array         | Legacy: Column(s) to partition by. Prefer `materialization.partitions`.                                                                                                                      |
| `group_by`                         | string/array  | `"dims"` or `[{ "type": "dims" }]` or `["col1", "col2"]` or `[{ "expr": "..." }]`                                                                                                            |
| `where`                            | string/object | Filter clause — simple string or `{ "and": [...], "or": [...] }`                                                                                                                             |
| `having`                           | object        | HAVING clause (same shape as `where`)                                                                                                                                                        |
| `order_by`                         | array         | ORDER BY columns                                                                                                                                                                             |
| `limit`                            | integer       | LIMIT clause                                                                                                                                                                                 |
| `offset`                           | integer       | OFFSET clause                                                                                                                                                                                |
| `exclude_date_filter`              | boolean       | Skip auto date filtering                                                                                                                                                                     |
| `exclude_daily_filter`             | boolean       | Skip daily partition filter                                                                                                                                                                  |
| `exclude_portal_partition_columns` | boolean/array | Drop portal partition columns. `true` drops all; an array (e.g. `["portal_partition_hourly"]`) drops only the named ones                                                                     |
| `exclude_portal_source_count`      | boolean       | Don't add portal source count                                                                                                                                                                |
| `data_tests`                       | array         | dbt test configurations                                                                                                                                                                      |
| `lightdash`                        | object        | Lightdash BI tool configuration                                                                                                                                                              |
| `meta`                             | object        | Free-form user-defined metadata (see [meta-and-governance.md](meta-and-governance.md))                                                                                                       |
