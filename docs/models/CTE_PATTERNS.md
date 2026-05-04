# Inline CTEs and Pre-Aggregation Patterns

## 1. Introduction

DJ supports inline **Common Table Expressions (CTEs)** via the `ctes` array on
intermediate and mart models (`int_select_model`, `int_join_models`,
`int_union_models`, `mart_select_model`, `mart_join_models`). A CTE lets you
stage work inside a single model — for example, pre-aggregating a large
upstream table before joining it, or normalizing shapes before unioning —
without creating a separate physical model.

This document covers the conventions the framework enforces for CTEs and the
recommended way to combine CTEs with Lightdash metrics.

**When to reach for a CTE:**

- Pre-aggregate an upstream model before a join so the join key space shrinks.
- Normalize column shapes (types, names, grouping) across multiple upstream
  models before a union.
- Factor a repeated sub-expression out of a complex `select` list.

**When _not_ to use a CTE:**

- You just want an additional aggregation on top of another model's output.
  Use a downstream `int_select_model` or `int_rollup_model` instead — that
  makes the intermediate result reusable by other downstream models.

---

## 2. CTE Basics

A minimal CTE definition has a `name`, a `from`, and a `select`:

```json
{
  "type": "int_select_model",
  "group": "sales",
  "topic": "orders",
  "name": "daily_summary",
  "ctes": [
    {
      "name": "pre_agg",
      "from": { "model": "int__sales__orders__enriched" },
      "select": [
        {
          "model": "int__sales__orders__enriched",
          "type": "dims_from_model"
        },
        { "name": "order_count", "type": "fct", "expr": "count(*)" },
        { "name": "revenue_sum", "type": "fct", "expr": "sum(order_total)" }
      ],
      "group_by": "dims"
    }
  ],
  "from": { "cte": "pre_agg" },
  "select": [
    { "cte": "pre_agg", "type": "all_from_cte" }
  ]
}
```

Rules of thumb:

- CTEs must appear before the main `from` that references them.
- `from: { "cte": "pre_agg" }` references the CTE; `from: { "model": "..." }`
  references an upstream dbt model.
- Bulk selects inside a CTE (`dims_from_model`, `all_from_model`,
  `fcts_from_model`) work the same way as in the main model.
- Bulk selects on the main-model `select` that pull _from the CTE_
  (`dims_from_cte`, `all_from_cte`, `fcts_from_cte`) inherit the CTE's
  inferred column metadata (type, description, origin, dimension meta, etc.).

---

## 3. Lightdash Metrics Live on the Main Model

This is the most common source of confusion when refactoring a model to use a
CTE, so it gets its own section.

**Rule:** `lightdash.metrics` and `lightdash.metrics_merge` are only
materialized on main-model `select` items. The framework silently ignores
them on CTE select items, and as of the validator introduced alongside this
document it will **reject** any `.model.json` that puts them there.

### 3.1. Why

The generated `.yml` is consumed by Lightdash, which only understands metrics
declared on the main model's columns. A CTE's columns are intermediate SQL
scaffolding — they never reach Lightdash. Keeping the declarations on the
main model also makes it easy to reason about what BI exposes without reading
through every CTE.

### 3.2. The Right Shape

When you pre-aggregate in a CTE and still want Lightdash metrics, re-declare
each fact in the main model's `select` with an aggregation (`agg`, `aggs`, or
an aggregate `expr`) and move the Lightdash declaration there:

```json
{
  "type": "int_select_model",
  "group": "sales",
  "topic": "orders",
  "name": "daily_summary",
  "ctes": [
    {
      "name": "pre_agg",
      "from": { "model": "int__sales__orders__enriched" },
      "select": [
        {
          "model": "int__sales__orders__enriched",
          "type": "dims_from_model"
        },
        { "name": "order_count", "type": "fct", "expr": "count(*)" },
        { "name": "revenue_sum", "type": "fct", "expr": "sum(order_total)" }
      ],
      "group_by": "dims"
    }
  ],
  "from": { "cte": "pre_agg" },
  "select": [
    { "cte": "pre_agg", "type": "dims_from_cte" },
    {
      "name": "order_count",
      "type": "fct",
      "expr": "sum(order_count)",
      "lightdash": {
        "metrics": ["sum"],
        "metrics_merge": { "group_label": "Order Volume" }
      }
    },
    {
      "name": "revenue_sum",
      "type": "fct",
      "expr": "sum(revenue_sum)",
      "lightdash": {
        "metrics": ["sum"],
        "metrics_merge": { "group_label": "Revenue" }
      }
    }
  ],
  "group_by": "dims"
}
```

### 3.3. Anti-Pattern

Do **not** place Lightdash declarations on the CTE and rely on
`all_from_cte` / `fcts_from_cte` to "carry them through" to the main model —
they will not propagate, and validation will fail:

```json
{
  "ctes": [
    {
      "name": "pre_agg",
      "select": [
        {
          "name": "revenue_sum",
          "type": "fct",
          "expr": "sum(order_total)",
          "lightdash": {
            "metrics": ["sum"]
          }
        }
      ]
    }
  ],
  "select": [
    { "cte": "pre_agg", "type": "all_from_cte" }
  ]
}
```

---

## 4. Aggregation Across the Boundary

### 4.1. Main-Model `group_by` Requires Aggregation

If the main model declares a `group_by`, every `fct` column in the main
`select` must be aggregated — either through `agg` / `aggs`, an aggregate
`expr` (`sum(...)`, `count(...)`, `avg(...)`, `min(...)`, `max(...)`,
`hll`, `tdigest`), or explicitly excluded via `exclude_from_group_by: true`.

The framework rejects `.model.json` files that violate this because the
emitted Trino SQL would list the fact column outside `GROUP BY`, and Trino
fails the query at plan time.

This applies to bulk `all_from_cte` / `fcts_from_cte` selects too: if the CTE
has `fct` columns and the main model has a `group_by`, either re-declare
each fact in the main `select` with an aggregation, or drop the main-model
`group_by`.

### 4.2. Re-Aggregating HLL / T-Digest Sketches

Sketch columns (`agg: "hll"` and `agg: "tdigest"`) can be merged downstream
without losing fidelity. A typical pattern is:

- CTE: `sum` / `hll` / `tdigest` raw values.
- Main model: `sum` / `hll` / `tdigest` the CTE's output (the framework emits
  a merge-style kernel — e.g. `merge(...)` for HLL and T-Digest — when the
  input is already a sketch).

The column suffix (`_sum`, `_hll`, `_tdigest`) is assigned by
`frameworkResolveAgg` based on the `agg` or `aggs` you declare; avoid
hand-writing the suffix into the column `name`.

---

## 5. Auto-Injected Framework Columns

Main models that source from another model automatically receive `datetime`,
`portal_partition_monthly` / `_daily` / `_hourly`, and `portal_source_count`
from the upstream. The framework applies the same rules inside CTEs whose
`from` is a plain model reference, so a CTE that pre-aggregates an upstream
model does not silently drop these columns:

- **`datetime` and `portal_partition_*`:** Appended when the upstream model
  has them and the CTE did not already select them. The `datetime` column is
  emitted as a bare passthrough (no `date_trunc`) unless the CTE explicitly
  sets `{ "name": "datetime", "interval": "..." }`.
- **Interval-driven exclusions:** A CTE `datetime` interval of `day` drops
  `portal_partition_hourly`; `month` drops `_hourly` and `_daily`; `year`
  drops all three partitions. The effective interval defaults to the
  upstream column's own interval when the CTE does not override it.
- **`portal_source_count`:** Injected when the CTE does not already declare
  it. If the CTE has a `group_by`, the injected column is aggregated with
  `count` (producing `portal_source_count` via the suffix-collision rule);
  otherwise it is passed through as-is.

Auto-injection is skipped for CTEs whose `from` is another CTE, a source, or
a union — those shapes must carry the columns through explicitly.

This keeps the CTE's registered columns consistent with what `all_from_cte`
and `dims_from_cte` see on the main model, ensures downstream passthroughs
never silently drop audit or partition columns, and prevents materialization
errors where `partitioned_by` cannot find the partition columns.

---

## 6. Dead Outer Layer Warning

If the main model's `select` is a single `all_from_cte` or `dims_from_cte`
passthrough of one CTE, with the **same** `group_by` as the CTE and no
additional `where` / `having` / `order_by` / `limit` / `distinct`, the outer
layer is a no-op — the framework emits the same query twice. The validator
warns in this case. Either:

- Move the CTE's `select` into the main model and drop the CTE, or
- Add a projection / filter / new aggregation on top to justify the outer
  layer.

---

## 7. Summary Checklist

- [ ] Lightdash metrics live only on main-model `select` items.
- [ ] Every main-model `fct` column is aggregated or opted out when a
      `group_by` is declared.
- [ ] `all_from_cte` / `fcts_from_cte` are only used when no main-model
      `group_by` exists, or when re-aggregation is handled by a downstream
      model.
- [ ] The outer layer adds projection, filtering, a new `group_by`, or a new
      aggregation beyond what the CTE produces.
- [ ] Let the framework handle `datetime`, `portal_partition_*`, and
      `portal_source_count` in CTEs whose `from` is a plain model; do not
      duplicate them manually unless you need a non-default aggregation or
      an explicit `datetime` interval.
