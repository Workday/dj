# Ephemeral → CTE transformation matrix

Per-type recipes for the inlinable ephemeral model types, plus the partition-filter checklist that closes each one, plus the "Heavy ephemeral" escape hatch. Load this file on demand when the `dj-migrate-ephemerals-to-ctes` skill enters its mutation phase.

| Ephemeral `type`                                                            | Classification         | Recipe section                                 |
| --------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------- |
| `int_select_model`                                                          | Safe (single consumer) | [§1](#1-int_select_model)                      |
| `int_join_models`                                                           | Safe (single consumer) | [§2](#2-int_join_models)                       |
| `int_union_models`                                                          | Safe (single consumer) | [§3](#3-int_union_models)                      |
| `int_rollup_model`                                                          | Needs review           | [§4](#4-int_rollup_model-needs-review)         |
| Heavy / multi-consumer / `int_lookback_model` / `int_join_column` / `stg_*` | Skip or escape hatch   | [§5](#5-heavy-ephemeral-appendix-escape-hatch) |

For every recipe: drop the ephemeral's identity fields (`type`, `group`, `topic`, `name`, `materialization` / `materialized`) and any model-level `lightdash` / `tags` / `meta` -- those have no analog on a CTE. Carry **every** `exclude_*` flag (`exclude_date_filter`, `exclude_datetime`, `exclude_portal_partition_columns`, `exclude_portal_source_count`, `exclude_framework_artifacts`, `exclude_daily_filter`) from the ephemeral onto the new CTE entry verbatim.

## CTE naming convention

The new CTE's `name` is the **short `"name"` field from the ephemeral's `.model.json`** -- not the full `<layer>__<group>__<topic>__<name>` model name. So for `int__analytics__reports__reportstats_union.model.json` with `"name": "reportstats_union"`, the resulting CTE is named `reportstats_union`. The full model name is only used inside the consumer rewrites to find what to replace.

**Collision fallback:** before adopting the short name, check the consumer's existing `ctes[].name` and the other inbound ephemerals' short names in the same pass. On collision, try `<topic>_<name>` → `<group>_<topic>_<name>` → the full model name, picking the shortest form that is unique within the consumer. Names must match the CTE schema pattern `^[a-z][a-z0-9_]*$`.

The recipes below use short names throughout (`filtered`, `enriched`, `combined`, `daily`).

---

## 1. `int_select_model`

The most common case: a single `from.model` with a `select` and optional `where` / `group_by` / `having`.

**Ephemeral (before):**

```jsonc
{
  "type": "int_select_model",
  "group": "sales",
  "topic": "orders",
  "name": "filtered",
  "from": { "model": "stg__sales__orders__standardized" },
  "where": { "and": [{ "expr": "status = 'COMPLETED'" }] },
  "select": [
    { "type": "all_from_model", "model": "stg__sales__orders__standardized" },
  ],
}
```

**CTE entry inside the consumer (after):**

```jsonc
{
  "name": "filtered",
  "from": { "model": "stg__sales__orders__standardized" },
  "where": { "and": [{ "expr": "status = 'COMPLETED'" }] },
  "select": [
    { "type": "all_from_model", "model": "stg__sales__orders__standardized" },
  ],
}
```

**Consumer rewrites:**

- `"from": { "model": "int__sales__orders__filtered" }` → `"from": { "cte": "filtered" }`
- `{ "type": "all_from_model", "model": "int__sales__orders__filtered" }` → `{ "type": "all_from_cte", "cte": "filtered" }` (same for `dims_from_*` / `fcts_from_*`)
- Any `expr` that qualifies columns with the full ephemeral name (e.g. `"int__sales__orders__filtered.status"`) becomes `"filtered.status"`.

**Partition-filter checklist** (apply to the new CTE entry):

- [ ] Copied any `exclude_*` flag from the ephemeral?
- [ ] If the ephemeral relied on a source with **no** partition column, set `"exclude_date_filter": true` on the CTE (DJ would otherwise auto-inject `_ext_event_date_filter`).
- [ ] If the ephemeral set `exclude_datetime` / `exclude_portal_partition_columns`, set the same flag on the CTE -- otherwise the framework emits partition columns the consumer's select does not list.

---

## 2. `int_join_models`

A driving model plus one or more `join[]` entries.

**Ephemeral (before):**

```jsonc
{
  "type": "int_join_models",
  "group": "sales",
  "topic": "orders",
  "name": "enriched",
  "from": {
    "model": "stg__sales__orders__standardized",
    "join": [
      {
        "model": "stg__customers__profiles__clean",
        "type": "left",
        "on": { "and": ["customer_id"] },
      },
    ],
  },
  "select": [
    { "type": "all_from_model", "model": "stg__sales__orders__standardized" },
    {
      "type": "all_from_model",
      "model": "stg__customers__profiles__clean",
      "include": ["customer_name"],
    },
  ],
}
```

**CTE entry (after):**

```jsonc
{
  "name": "enriched",
  "from": {
    "model": "stg__sales__orders__standardized",
    "join": [
      {
        "model": "stg__customers__profiles__clean",
        "type": "left",
        "on": { "and": ["customer_id"] },
      },
    ],
  },
  "select": [
    { "type": "all_from_model", "model": "stg__sales__orders__standardized" },
    {
      "type": "all_from_model",
      "model": "stg__customers__profiles__clean",
      "include": ["customer_name"],
    },
  ],
}
```

**Alias preservation note:** CTE join aliases mirror the upstream model names exactly, so any `expr` **inside** the new CTE that references an upstream model (e.g. `"stg__sales__orders__standardized.amount * 100"`) continues to resolve after inlining. **Do not** rewrite those qualifiers. Only qualifiers in the consumer's main `select` that reference the ephemeral itself need to be swapped to the short CTE name.

**Consumer rewrites:** same as §1 -- `"from": { "model": "int__sales__orders__enriched" }` → `"from": { "cte": "enriched" }`, `all_from_model` → `all_from_cte`, plus any `expr` qualifier rewrites from the full model name to `enriched`.

**Partition-filter checklist:** same as §1, but also:

- [ ] If any of the joined models had different `exclude_date_filter` behavior, prefer setting the flag on the CTE itself (CTE-level wins over per-join). Cross-check against the ephemeral's generated `.sql` to confirm the resulting predicates match.

---

## 3. `int_union_models`

Two or more models unioned together. The CTE schema offers two equivalent shapes; the **normalizing-CTEs + union-CTE** pattern is preferred because it surfaces the per-arm column projection.

**Ephemeral (before):**

```jsonc
{
  "type": "int_union_models",
  "group": "sales",
  "topic": "orders",
  "name": "combined",
  "from": {
    "model": "stg__sales__orders__us",
    "union": { "type": "all", "models": ["stg__sales__orders__eu"] },
  },
  "select": [{ "type": "all_from_model", "model": "stg__sales__orders__us" }],
}
```

**Option A -- single union CTE (compact, mirrors the ephemeral):**

```jsonc
{
  "name": "combined",
  "from": {
    "model": "stg__sales__orders__us",
    "union": { "type": "all", "models": ["stg__sales__orders__eu"] },
  },
  "select": [{ "type": "all_from_model", "model": "stg__sales__orders__us" }],
}
```

**Option B -- normalizing CTEs + union CTE (recommended when each arm needs different column shaping). The normalizing CTEs use their own short names; the union CTE adopts the ephemeral's short name:**

```jsonc
"ctes": [
  {
    "name": "us_normalized",
    "from": { "model": "stg__sales__orders__us" },
    "select": [
      { "name": "id", "expr": "order_id" },
      { "name": "amount", "expr": "amount_usd" }
    ]
  },
  {
    "name": "eu_normalized",
    "from": { "model": "stg__sales__orders__eu" },
    "select": [
      { "name": "id", "expr": "order_id" },
      { "name": "amount", "expr": "amount_eur * 1.08" }
    ]
  },
  {
    "name": "combined",
    "from": { "cte": "us_normalized", "union": { "type": "all", "ctes": ["eu_normalized"] } },
    "select": [{ "type": "all_from_cte", "cte": "us_normalized" }]
  }
]
```

**Consumer rewrites:** `"from": { "model": "int__sales__orders__combined" }` → `"from": { "cte": "combined" }`, plus the matching `all_from_model` / bulk-select swaps.

**Validator note:** `where` is forbidden on union CTEs (`validateCtes` rejects it). If the ephemeral had a `where`, push it down into each normalizing CTE's `from` filter instead.

**Partition-filter checklist:** apply to **every** CTE in the chain, not just the union CTE. The union CTE inherits its date filter from whichever arm is the lexical first member, so set `exclude_date_filter` on the union CTE if the ephemeral disabled it.

---

## 4. `int_rollup_model` (Needs review)

Rollups have **no `select` in the JSON** -- the framework synthesizes the select from the upstream model and re-aggregates fact columns. When migrating to a CTE, you must materialize the synthesized select **explicitly**, because CTE entries require either a `select` or a bulk select.

**Ephemeral (before):**

```jsonc
{
  "type": "int_rollup_model",
  "group": "sales",
  "topic": "orders",
  "name": "daily",
  "from": {
    "model": "int__sales__orders__hourly",
    "rollup": { "interval": "day" },
  },
}
```

**CTE entry (after) -- explicit `select` required:**

```jsonc
{
  "name": "daily",
  "from": {
    "model": "int__sales__orders__hourly",
    "rollup": { "interval": "day" },
  },
  "select": [
    { "type": "dims_from_model", "model": "int__sales__orders__hourly" },
    { "type": "fcts_from_model", "model": "int__sales__orders__hourly" },
  ],
  "group_by": "dims",
}
```

**Consumer rewrites:** `"from": { "model": "int__sales__orders__daily" }` → `"from": { "cte": "daily" }`, plus the matching `all_from_model` / bulk-select swaps.

**Caveats that make this "Needs review":**

- The rollup machinery wraps `fct` columns with their suffix-agg (e.g. `revenue_sum` → `sum(revenue_sum) as revenue_sum`) and rewrites `datetime` with `date_trunc(<interval>, datetime)`. Ask the user to verify the generated SQL diff after sync -- the framework's auto-wrap should still kick in for CTE rollups, but the synthesized `select` is now visible (not hidden inside an `int_rollup_model`).
- `exclude_datetime` and `exclude_framework_artifacts: "all" | "columns"` are **mutually exclusive** with `from.rollup` at the same scope. The validator errors when both are set.
- A rollup CTE whose source is a sibling CTE that itself excludes datetime is rejected -- the upstream must produce a datetime column for the rollup to truncate.

**Partition-filter checklist:** the rollup synthesizes coarser-grain `portal_partition_*` columns automatically; do **not** also list them in `select`. If the ephemeral had `exclude_portal_partition_columns: true`, do **not** carry that flag onto the CTE -- the rollup needs the partition columns to drop finer-grain ones.

---

## 5. Heavy ephemeral appendix (escape hatch)

Some ephemerals shouldn't be inlined into a CTE at all -- inlining forces the logic to recalculate on **every** consumer query. Telltale signs that an ephemeral is "heavy":

- Window functions over wide ranges (e.g. `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)` across millions of rows).
- Large cross-joins or unrestricted `int_join_models` against fact tables.
- Multi-CTE chains _inside_ the ephemeral (e.g. its own `ctes[]` array with three or more entries).
- Unpartitioned full-history scans (`exclude_date_filter: true` on a source-backed driving model).
- Aggregations whose result is materially smaller than the input (the recompute cost dominates).
- Consumer is a `mart_*` model hit repeatedly by BI dashboards (Lightdash explores, scheduled queries).

**Escape hatch:** instead of inlining, convert the ephemeral to an **incremental** materialization so the heavy work runs once per `dbt run`:

```jsonc
{
  "type": "int_join_models",
  "group": "sales",
  "topic": "orders",
  "name": "enriched",
  "materialization": {
    "type": "incremental",
    "format": "iceberg",
    "partitions": ["datetime"],
    "strategy": { "type": "delete+insert" },
  },
  "from": {
    /* unchanged */
  },
  "select": [
    /* unchanged */
  ],
}
```

**Strategy guidance** (per `AGENTS.md` "Materialization shorthand" section):

- **Iceberg** projects: `dj_iceberg_partition_overwrite` is DJ-shipped and partition-safe; `merge` works for row-level upserts on `unique_key`.
- **Delta Lake / Hive** projects: prefer `delete+insert` (partition-safe, no custom macro required). Avoid `merge` (Iceberg-only in dbt-trino).
- If `dj.materialization.defaultIncrementalStrategy` is set in workspace settings, the user may want to omit `strategy` and inherit that default.

**When you trigger this branch:** present the user with both options (inline as CTE / convert to incremental) and let them decide. Do **not** auto-apply the incremental conversion -- it changes storage cost and run-time semantics; that's a Data-Architect-level decision.

---

## Final ref-sweep snippet

Before deleting any ephemeral `.model.json`, run from the dbt project root:

```bash
rg "<ephemeral_full_name>" --type json --type yml --type sql
```

If the output is empty, it's safe to delete the `.model.json` (and the orphaned `.sql` / `.yml` siblings under `target/` / project `models/` paths). If any consumer still refers to it, leave the ephemeral in place and report which files still reference it.
