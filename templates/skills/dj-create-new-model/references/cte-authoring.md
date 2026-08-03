# CTE authoring

Load on demand when a model uses the `ctes` array (`int_select_model`,
`int_join_models`, `int_union_models`, `mart_select_model`, `mart_join_models`).
Covers the CTE-vs-new-model decision, the mechanics, and the CTE-specific
gotchas. Framework-column and partition behavior inside CTEs lives in
[partitions-and-framework-columns.md](partitions-and-framework-columns.md).

## CTE or a new model?

A CTE is **non-materialized** — it is a transient, in-memory query stage that
exists only inside the one model that declares it and is recomputed every time
that model runs. A new model is a **named, reusable** node in the DAG (a view or
an incremental/ephemeral table) that other downstream models can select from.

**Reach for a CTE when:**

- Pre-aggregating an upstream model before a join so the join key space shrinks.
- Normalizing column shapes (types, names, grouping) across several upstreams before a union.
- Factoring a repeated sub-expression out of a complex `select` list.

The work is local to this model and nothing else needs to reuse it.

**Prefer a new model when:**

- The intermediate result should be reusable by other downstream models — a CTE would force each consumer to recompute it.
- The work is heavy (window functions, wide cross-joins, multi-CTE chains, unpartitioned full-history scans) and should materialize once rather than per consumer query. Use an `int_select_model` / `int_rollup_model`, or an `incremental` materialization.
- You just want an additional aggregation on top of another model's output — that belongs in a downstream model, not an inline CTE.

## Mechanics

A minimal CTE has a `name`, a `from`, and a `select`; the model's top-level
`from` then reads `{ "cte": "<name>" }`. See `.agents/dj/reference/ctes-and-subqueries.md` and
`model.cte.schema.json` for the exact shape.

- **CTEs must be ordered** — a CTE can only reference CTEs defined **before** it in the `ctes` array.
- **CTE bulk selects** — `all_from_cte`, `dims_from_cte`, `fcts_from_cte` support `exclude` and `include` arrays to filter columns.
- **CTE column type inheritance** — plain string selects in CTEs inherit `dim` / `fct` type from the upstream model or CTE, so no need to redeclare column types. `dims_from_cte` / `fcts_from_cte` therefore filter correctly in CTE-to-CTE chains.

## Gotchas

- **CTE `group_by` with computed columns**: bare string aliases (e.g., `["month"]`) for columns defined with `expr` (e.g., `DATE_TRUNC(...)`) pass schema validation but fail at Trino with `COLUMN_NOT_FOUND`. Use `"group_by": "dims"` or `[{ "expr": "..." }]` instead.
- **`lightdash.metrics` / `lightdash.metrics_merge` on a CTE `select` item is an error** — declare those on the main-model `select` only. Keep the pre-aggregated column in the CTE and re-aggregate it in the main model (`agg` / `aggs` / aggregate `expr`). `lightdash.dimension` on CTE selects still propagates.
- **Dead outer-layer** — if the main `select` is a single `all_from_cte` / `dims_from_cte` passthrough of one CTE with identical `group_by` and no extra filter / limit / projection, drop the wrapper or add new work to it.
