# Inline CTEs, Subqueries & Common SQL Patterns

Load this when a model needs CTEs (`ctes` array), inline subqueries in `where` / `having` / join `on`, or the recurring SQL patterns (renaming, where/having, join conditions, self-joins, seeds). CTE and subquery support is limited to `int_select_model`, `int_join_models`, `int_union_models`, `mart_select_model`, `mart_join_models`.

## Common Patterns

### Column Renaming

```jsonc
{ "name": "customer_id", "expr": "account_id", "type": "dim" }
```

### Exclude and Redefine

Use `"type": "all_from_model", "exclude": ["col1", "col2"]` then redefine those columns with new logic.

### Where/Having Clauses

```jsonc
"where": "cost > 0"                                                    // simple string
"where": { "and": [{ "expr": "cost > 0" }, { "expr": "status = 1" }] } // AND conditions
"where": { "or": [{ "expr": "region = 'us-east-1'" }] }                // OR conditions
"having": { "and": [{ "expr": "sum(cost) > 100" }] }                   // after aggregation
// subquery condition (see "Inline Subqueries" section for full details)
"where": { "and": [{ "subquery": { "operator": "in", "column": "account_id", "select": ["id"], "from": { "model": "..." } } }] }
```

### Join ON Conditions

```jsonc
"on": "dims"                                                            // shorthand: join on all shared dimension columns
"on": { "and": ["account_id", "portal_partition_daily"] }              // shorthand (same column names)
"on": { "and": [{ "expr": "base.account_id = joined.customer_id" }] }  // explicit expression
```

### Self-Joins

Use `"override_alias": "parent"` on the joined model to reference it by alias.

### Seed Models

Reference CSV seeds with `"from": { "model": "seed__<topic>__<name>" }` in `stg_select_model`.

---

## Inline CTEs

The following model types support a `ctes` array for inline Common Table Expressions: `int_select_model`, `int_join_models`, `int_union_models`, `mart_select_model`, `mart_join_models`.

CTEs generate SQL `WITH` clauses within the model. Each CTE has a `name` and a `from` source (model, earlier CTE, or union). Optional: `select`, `where`, `group_by`, `having`.

CTEs must be ordered — a CTE can only reference CTEs defined before it in the array. The parent model references a CTE via `"from": { "cte": "<cte_name>" }`.

```jsonc
{
  "type": "int_select_model",
  "group": "my_group",
  "topic": "my_topic",
  "name": "filtered_summary",
  "ctes": [
    {
      "name": "active_accounts",
      "from": { "model": "stg__my_group__my_topic__accounts" },
      "select": ["account_id", "region"],
      "where": { "and": [{ "expr": "status = 'active'" }] },
    },
    {
      "name": "enriched", // can reference earlier CTE
      "from": {
        "cte": "active_accounts",
        "join": [
          {
            "model": "int__my_group__my_topic__daily",
            "type": "inner",
            "on": { "and": ["account_id"] },
          },
        ],
      },
      "select": [
        { "cte": "active_accounts", "type": "all_from_cte" },
        {
          "model": "int__my_group__my_topic__daily",
          "type": "fcts_from_model",
        },
      ],
    },
  ],
  "from": { "cte": "enriched" }, // parent model reads from a CTE
  "select": ["account_id", "region", "cost_sum"],
}
```

### CTE Bulk Select with Exclude/Include

CTE bulk selects (`all_from_cte`, `dims_from_cte`, `fcts_from_cte`) support `exclude` and `include` filters:

```jsonc
{
  "cte": "active_accounts",
  "type": "dims_from_cte",
  "exclude": ["internal_id"], // remove specific columns
}
```

```jsonc
{
  "cte": "active_accounts",
  "type": "all_from_cte",
  "include": ["account_id", "region"], // select only these columns
}
```

### CTE Column Type Inheritance

When a CTE selects columns as plain strings (e.g., `"select": ["col_a", "col_b"]`), each column inherits its `dim`/`fct` type from the upstream model or CTE. This means `dims_from_cte` and `fcts_from_cte` will correctly filter by column type in CTE-to-CTE chains without needing to redeclare column types.

### CTE `group_by`

Use `"group_by": "dims"` or `"group_by": [{ "type": "dims" }]` inside CTEs. Avoid bare string aliases for computed columns — if a CTE select item has an `expr` (e.g., `{ "name": "month", "expr": "DATE_TRUNC('MONTH', event_date)" }`), using `"group_by": ["month"]` will fail at Trino runtime because the string alias is not a valid SQL GROUP BY target. Use `[{ "type": "dims" }]` instead, which automatically resolves computed expressions.

### CTE authoring rules

- **Lightdash metrics belong on the main-model `select`.** `lightdash.metrics` / `lightdash.metrics_merge` on a CTE `select` item is rejected (only the main-model select feeds Lightdash metric generation). Keep the pre-aggregated column in the CTE and re-declare it on the main-model `select` with the metric block. `lightdash.dimension` on CTE selects is still supported.
- **`portal_source_count` auto-injects in CTEs whose `from` is `{ model }` or `{ cte }`.** It's aggregated with `count` when the CTE has a `group_by`; otherwise it passes through. Don't add it manually. Set `override_suffix_agg: true` on the CTE select item only when you need a differently-aggregated variant alongside the audit column.
- **`datetime` and `portal_partition_*` auto-inject in CTEs whose `from` is `{ model }` or `{ cte }`.** Mirrors the main-model behavior: if the upstream (manifest schema for `{ model }`, the in-memory registry for `{ cte }`) has them and the CTE's select did not include them (even through a narrow `dims_from_model.include` list), they're appended automatically. `datetime` emits as a bare passthrough unless the CTE sets `{ "name": "datetime", "interval": "..." }`; in that case the interval drives partition exclusion (`day` drops hourly, `month` drops hourly+daily, `year` drops all three). Auto-inject is still skipped for source and union shapes. Opt out via `"exclude_portal_partition_columns": true` (drop all) or an array such as `["portal_partition_hourly"]` (drop only those) on the CTE or the model (see flag inheritance below).
- **CTE-level exclude/include flags mirror the main-model flags and inherit from the model.** A CTE accepts `exclude_date_filter`, `exclude_daily_filter`, `exclude_datetime`, `exclude_framework_artifacts`, `exclude_portal_partition_columns`, `exclude_portal_source_count`, and `include_full_month` with the same semantics as the corresponding main-model flags. Resolution is uniform: CTE override > model value > false. Set the flag on the model to apply it to every CTE, on a single CTE to override only that CTE, or set `false` on a CTE to opt back in when the model excluded. `exclude_portal_partition_columns` additionally accepts an array (e.g. `["portal_partition_hourly"]`) to drop only the named partition columns; a CTE-level array overrides an inherited `true` or `exclude_framework_artifacts`. `exclude_datetime` and `exclude_portal_partition_columns` are orthogonal — set both for pure-dimension/lookup shapes. `exclude_datetime` is mutually exclusive with `from.rollup` at the same scope (model OR CTE) and the validator errors when both are set together.
- **CTEs may declare `from.rollup` to re-aggregate their source to a coarser grain.** Supported on `from: { model }` and `from: { cte }` (not on `from: { source }` or `from: { union }`, both schema-rejected). The framework rewrites the CTE's `datetime` to `date_trunc(<interval>, datetime)`, drops finer-grain `portal_partition_*` columns, wraps fct columns with their suffix-agg (so `revenue_sum` becomes `sum(revenue_sum) as revenue_sum`), and synthesizes a `GROUP BY` from all dim columns when `group_by` is not authored. Chained rollups (CTE A → month, CTE B → year off A) work end-to-end. A rolled-up CTE that sources from another CTE which excludes datetime is rejected with a clear error.
- **Framework columns flow through CTE chains by default.** Once a CTE pulls `datetime` / `portal_partition_*` / `portal_source_count` from its upstream, every downstream `from: { cte }` hop (and a main model with `from: { cte }`) inherits them from the registry. List them in `select` only when you want a transformed alias; opt out with the standard exclude flags on the CTE or the model. When the main model materializes via `incremental` with a partition-overwrite strategy, the auto-flowed `portal_partition_*` typically satisfies the partition-column requirement; if you intentionally exclude them through a chain, set `materialization.partitions: ["datetime"]` on the main model (the partition-strategy warning fires when neither is present). Wrapper SELECTs that reference an already-rolled-up `datetime` do not redundantly re-emit `date_trunc(<same interval>, datetime)`.
- **`exclude_framework_artifacts` is the combined-flag shortcut.** A single string-enum (`"all"` | `"columns"`) on the model or CTE that bundles multiple individual excludes. `"columns"` implies `exclude_datetime` + `exclude_portal_partition_columns` + `exclude_portal_source_count` (auto WHERE date filters still fire); `"all"` additionally implies `exclude_date_filter`. Individual flags at the same scope override per-column (e.g. `"exclude_framework_artifacts": "all"` paired with `"exclude_portal_source_count": false` keeps that one column). Full resolution chain: CTE individual > CTE combined > model individual > model combined > false. Mutually exclusive with `from.rollup` when the resolved value implies excluding `datetime`.
- **Every `fct` column in the main-model `select` must be aggregated when the main model has a `group_by`.** Set `agg` / `aggs`, wrap an aggregate in `expr` (e.g. `sum(x)`, `avg(x)`, `any_value(x)`, `merge(cast(x as hyperloglog))`, `cast(tdigest_agg(x) as varbinary)`), or set `exclude_from_group_by: true`. This is enforced for scalar selects, CTE scalar refs, and bulk `all_from_cte` / `fcts_from_cte` carriers.
- **Avoid dead outer layers.** A main `select` that's a single `all_from_cte` / `dims_from_cte` passthrough of one CTE with identical `group_by` and no extra filter / limit / projection is flagged as a no-op warning — drop the wrapper (move the CTE's select into the main model) or add new work to the outer layer.

### CTE Unions

CTE unions use the same pattern as model unions:

```jsonc
{
  "name": "combined",
  "from": { "cte": "cte_a", "union": { "ctes": ["cte_b", "cte_c"] } },
}
```

---

## Inline Subqueries

Subqueries can appear in `where`, `having`, and join `on` conditions via the `subquery` key.

**Structure**: `operator`, `column` (required except for `exists`/`not_exists`), `select`, `from` (model, source, or CTE), optional inner `where`.

**Operators**: `in`, `not_in`, `exists`, `not_exists`, `eq`, `neq`, `gt`, `gte`, `lt`, `lte`

```jsonc
// WHERE with subquery
"where": {
  "and": [
    { "expr": "cost > 0" },
    {
      "subquery": {
        "operator": "in",
        "column": "account_id",
        "select": ["account_id"],
        "from": { "model": "int__my_group__my_topic__active_accounts" },
        "where": { "and": [{ "expr": "status = 'active'" }] },
      },
    },
  ],
}

// JOIN ON with subquery
"on": {
  "and": [
    "account_id",
    {
      "subquery": {
        "operator": "exists",
        "select": ["1"],
        "from": { "cte": "valid_records" },
        "where": { "and": [{ "expr": "a.id = valid_records.id" }] },
      },
    },
  ],
}
```
