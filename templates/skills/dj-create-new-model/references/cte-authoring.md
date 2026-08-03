# CTE authoring

Load on demand when a model uses the `ctes` array (`int_select_model`,
`int_join_models`, `int_union_models`, `mart_select_model`, `mart_join_models`)
and you need to decide whether a CTE is the right tool. For the CTE mechanics,
authoring rules, and gotchas — ordering, bulk selects, column-type inheritance,
`group_by` on computed columns, framework-column auto-injection, and `from.rollup`
inside CTEs — see `.agents/dj/reference/ctes-and-subqueries.md`.

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
