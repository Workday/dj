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
  "select": [{ "cte": "pre_agg", "type": "all_from_cte" }]
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
  "select": [{ "cte": "pre_agg", "type": "all_from_cte" }]
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
`from` is a plain model OR plain CTE reference, so a CTE that pre-aggregates
an upstream model — or any CTE that chains off such a CTE — does not
silently drop these columns:

- **`datetime` and `portal_partition_*`:** Appended when the upstream
  exposes them and the CTE did not already select them. The upstream is the
  manifest schema for `from: { model }` consumers and the in-memory CTE
  registry for `from: { cte }` consumers. The `datetime` column is emitted
  as a bare passthrough (no `date_trunc`) unless the CTE explicitly sets
  `{ "name": "datetime", "interval": "..." }`.
- **Interval-driven exclusions:** A CTE `datetime` interval of `day` drops
  `portal_partition_hourly`; `month` drops `_hourly` and `_daily`; `year`
  drops all three partitions. The effective interval defaults to the
  upstream column's own interval when the CTE does not override it.
- **`portal_source_count`:** Injected when the CTE does not already declare
  it. If the CTE has a `group_by`, the injected column is aggregated with
  `count` (producing `portal_source_count` via the suffix-collision rule);
  otherwise it is passed through as-is.

Main models with `from: { cte }` follow the same rule: the chosen CTE's
registry is the upstream, so framework columns flow through to the final
SELECT and YAML the same way they do for `from: { model }` consumers. The
exclude flags below are the opt-out at every layer.

Auto-injection is still skipped for CTEs whose `from` is a source or a
union — those shapes must carry the columns through explicitly.

This keeps the CTE's registered columns consistent with what `all_from_cte`
and `dims_from_cte` see on the main model, ensures downstream passthroughs
never silently drop audit or partition columns, and prevents materialization
errors where `partitioned_by` cannot find the partition columns.

### Opting out of auto-injection

CTE-level exclude/include flags mirror their main-model counterparts: they
take the same names and the same boolean semantics, and they **inherit**
from the model when omitted on the CTE. Resolution is uniform across the
set: **CTE override > model value > false**. Set a flag once on the model to
have every CTE honor it, or set it on a single CTE to override just that CTE
(including setting `false` on a CTE to opt back in when the model excluded).

The full set:

- `"exclude_framework_artifacts": "all" | "columns"` — combined-flag shortcut
  that bundles several individual excludes into one switch. `"columns"`
  implies `exclude_datetime` + `exclude_portal_partition_columns` +
  `exclude_portal_source_count` (the auto WHERE date filters still fire);
  `"all"` additionally implies `exclude_date_filter`. Individual flags at
  the **same scope** override the combined value (set
  `"exclude_portal_source_count": false` to keep that one column even when
  the combined flag is `"all"`). Resolution still follows the standard chain
  with combined-flag fallback at each scope:
  **CTE individual > CTE combined > model individual > model combined > false**.
  Mutually exclusive with `from.rollup` when the resolved value implies
  `exclude_datetime`.
- `"exclude_datetime": true` — drops `datetime` injection. Orthogonal to
  `exclude_portal_partition_columns`: setting only this flag yields a CTE
  with partition columns but no canonical time column (a snapshot shape).
  Mutually exclusive with `from.rollup` at the model level — rollup exists
  to produce a `datetime` column, so the validator errors when both are set
  on the same model.
- `"exclude_portal_partition_columns": true` — drops `portal_partition_*`
  injection. For pure-dimension or lookup models that need neither datetime
  nor partitions, set this together with `exclude_datetime` (or use
  `exclude_framework_artifacts: "columns"`).
- `"exclude_portal_source_count": true` — drops `portal_source_count`
  injection.
- `"exclude_date_filter": true` — drops the auto `_ext_event_date_filter`
  WHERE-clause macros entirely (model-level OR CTE-level: either side
  triggers suppression).
- `"exclude_daily_filter": true` — drops just the daily-grain
  `_ext_event_date_filter`; the monthly-grain filter is preserved.
- `"include_full_month": true` — same effect as `exclude_daily_filter` for
  partition pruning; emits the full-month range filter only.

The individual flags above are fine-grained alternatives to the combined
`exclude_framework_artifacts` enum, and double as per-column overrides when
the combined flag is set. These flags apply uniformly to CTEs whose `from`
is a plain model or plain CTE reference; they have no effect on CTEs whose
`from` is a source or a union, since those shapes never auto-inject in the
first place.

---

## 6. Rolling Up Inside a CTE

A CTE may declare `from.rollup` to re-aggregate its source to a coarser time
grain — the same shape the framework supports on `int_select_model` /
`int_join_models`, but scoped to a single CTE. Use this when only one stage of
a multi-step pipeline needs the rollup.

```json
{
  "type": "int_select_model",
  "group": "sales",
  "topic": "orders",
  "name": "monthly_summary",
  "ctes": [
    {
      "name": "monthly",
      "from": {
        "model": "int__sales__orders__daily",
        "rollup": { "interval": "month" }
      },
      "select": [
        { "name": "category", "type": "dim" },
        { "name": "revenue_sum", "type": "fct" }
      ]
    }
  ],
  "from": { "cte": "monthly" },
  "select": [{ "cte": "monthly", "type": "all_from_cte" }]
}
```

What the framework does for rollup CTEs:

- **`datetime` is rewritten** to `date_trunc('<interval>', datetime)` and
  registered with the new interval. Downstream consumers (other CTEs,
  `all_from_cte` on the main model) see the rolled-up grain.
- **Finer-grain `portal_partition_*` columns are dropped** —
  `rollup: { "interval": "month" }` removes `portal_partition_daily` and
  `portal_partition_hourly`; `year` removes all three. Coarser partitions
  stay so the materialized table's `partitioned_by` still resolves.
- **Fct columns are wrapped with their suffix-agg** — a `revenue_sum`
  reference becomes `sum(revenue_sum) as revenue_sum` automatically. Use the
  same name conventions as model-level rollup (`_sum`, `_count`, `_min`,
  `_max`, `_hll`, `_tdigest`).
- **`GROUP BY` is synthesized** from all dimension columns when the CTE
  does not author its own `group_by`. Authoring a `group_by` overrides the
  default.

Supported source shapes:

- `from: { "model": "<ref>", "rollup": { "interval": "..." } }` — rolls up
  a manifest-known dbt model directly.
- `from: { "cte": "<sibling>", "rollup": { "interval": "..." } }` — rolls
  up a sibling CTE. The upstream CTE must produce a `datetime` column, so
  it must either roll up itself or not opt out via `exclude_datetime` /
  `exclude_framework_artifacts`. The validator catches the conflict.

Not supported (schema-rejected):

- `from: { "source": "..." }` with `rollup` — sources do not always carry a
  canonical `datetime`. Stage them through a preceding `stg_*` model.
- `from: { ..., "union": { ... }, "rollup": { ... } }` — unions are not yet
  rollup-aware. Roll up each branch in its own CTE first, then union.

Combining with the exclude flags:

- `exclude_datetime` (and `exclude_framework_artifacts: "all" | "columns"`)
  is **mutually exclusive** with `from.rollup` at the same scope (model OR
  CTE). The validator surfaces the conflict before sync runs. Use
  `exclude_datetime: false` to opt back in if a model-level `"all"` is
  inherited but the CTE needs to roll up.
- `exclude_portal_partition_columns` is compatible with rollup but rare —
  rollup typically wants the coarser partition column for materialization.
- Chained rollups (CTE A → month, CTE B → year off A) work end-to-end. The
  `date_trunc` truncation in B is computed against A's already-rolled-up
  month-grain `datetime`, not against the raw upstream.

### 6.1. Chaining Plain CTEs Off a Rollup CTE

Rollup is only one of the things a CTE can do. A common pattern is to roll
up once and then chain plain (non-rollup) CTEs on top to reshape, filter,
or combine the rolled-up rows. Framework columns (`datetime`,
`portal_partition_*`, `portal_source_count`) flow through CTE chains by
default — every plain `from: { cte }` hop inherits them from the upstream
CTE's registry the same way a `from: { model }` consumer inherits from the
manifest. Use the standard exclude flags
(`exclude_datetime`, `exclude_portal_partition_columns`,
`exclude_portal_source_count`, or the combined `exclude_framework_artifacts`)
on the CTE — or on the main model — to opt out.

When the main model is materialized as `incremental` with a
partition-overwrite strategy (`overwrite_existing_partitions`,
`dj_iceberg_partition_overwrite`), the table needs at least one partition
column. The auto-flow above usually satisfies that requirement; if you
intentionally exclude partitions through a chain, set
`materialization.partitions: ["datetime"]` (or another concrete output
column) on the main model. The framework's
`partition-strategy-without-partitions` warning fires precisely when
neither is present. If neither applies because partitioning is wired
through a project-level dbt config, the warning is safe to ignore.

A complete chain that rolls up, applies a downstream calculation, and
materializes via the auto-flowed partitions:

```json
{
  "type": "int_select_model",
  "group": "finance",
  "topic": "savings",
  "name": "monthly_savings",
  "ctes": [
    {
      "name": "rolled",
      "from": {
        "model": "int__finance__billing__daily",
        "rollup": { "interval": "month" }
      },
      "select": [
        { "name": "category", "type": "dim" },
        { "name": "amount_sum", "type": "fct" }
      ]
    },
    {
      "name": "with_savings",
      "from": { "cte": "rolled" },
      "select": [
        { "name": "category", "type": "dim" },
        { "name": "amount_sum", "expr": "amount_sum", "type": "fct" },
        {
          "name": "savings",
          "expr": "amount_sum * 0.1",
          "type": "fct"
        }
      ]
    }
  ],
  "from": { "cte": "with_savings" },
  "select": [{ "cte": "with_savings", "type": "all_from_cte" }],
  "materialization": {
    "type": "incremental",
    "strategy": "overwrite_existing_partitions"
  }
}
```

`datetime` and `portal_partition_monthly` flow through the chain
automatically — the rollup CTE registers them at month grain, the
downstream CTE inherits them, and the main model picks them up via
`all_from_cte`. The wrapper SELECT references `datetime` directly; the
framework does not redundantly re-emit `date_trunc('month', datetime)` on
top of an already-rolled-up CTE column when the requested grain matches.

---

## 7. Dead Outer Layer Warning

If the main model's `select` is a single `all_from_cte` or `dims_from_cte`
passthrough of one CTE, with the **same** `group_by` as the CTE and no
additional `where` / `having` / `order_by` / `limit` / `distinct`, the outer
layer is a no-op — the framework emits the same query twice. The validator
warns in this case. Either:

- Move the CTE's `select` into the main model and drop the CTE, or
- Add a projection / filter / new aggregation on top to justify the outer
  layer.

---

## 8. Summary Checklist

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
