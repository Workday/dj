# DJ refactor catalog

Per-pattern detection heuristics, before/after JSONC, and edge-case notes for the `dj-review-and-refactor-model` skill. Load this file on demand once the skill enters its **Apply** phase.

| Pattern                                                         | Group          | Section |
| --------------------------------------------------------------- | -------------- | ------- |
| legacy `materialized` + siblings → structured `materialization` | Recommended    | §R1     |
| `meta.<lightdash key>` → `lightdash.*`                          | Recommended    | §R2     |
| `[{ "type": "dims" }]` → `"dims"`                               | Recommended    | §R3     |
| three exclude booleans → `exclude_framework_artifacts`          | Recommended    | §R4     |
| `where: { and: [{ expr: "..." }] }` → `where: "..."`            | Recommended    | §R5     |
| `int_rollup_model` → `int_select_model` + `from.rollup`         | Needs decision | §D1     |
| verbose `on: { and: [...] }` → `on: "dims"`                     | Needs decision | §D2     |
| pre-agg CTE used only by `IN` / `EXISTS` → inline `subquery`    | Needs decision | §D3     |
| `from: { cte }` chain without `exclude_framework_artifacts`     | Needs decision | §D4     |
| partition-strategy without partition column                     | Needs decision | §D5     |

For every pattern: preserve `ai_hint`, `lightdash.*`, `data_tests`, `tags`, `description`, free-form `meta.*` user keys (`owner`, `pii`, etc.) verbatim. JSONC formatting (comments, trailing commas) must survive every edit -- use `jsonc-parser` modify ops or targeted string edits, never `JSON.stringify`.

---

## R1. legacy `materialized` + `incremental_strategy` + `partitioned_by` → structured `materialization`

**When to flag:** the model has any of the top-level legacy keys (`materialized`, `incremental_strategy`, `partitioned_by`) **and** does **not** have a top-level `materialization` key. If both are present, prefer fixing it as a Needs-decision item -- the user must reconcile the two by hand.

**Detection heuristic:**

- `obj.materialized` is a string in `{"incremental", "ephemeral"}`, OR
- `obj.incremental_strategy` is an object, OR
- `obj.partitioned_by` is an array of strings.
- AND `obj.materialization` is undefined.

**Before:**

```jsonc
{
  "type": "int_select_model",
  "group": "sales",
  "topic": "orders",
  "name": "hourly",
  "materialized": "incremental",
  "incremental_strategy": { "type": "delete+insert" },
  "partitioned_by": ["portal_partition_daily"],
  "from": { "model": "stg__sales__orders__standardized" },
}
```

**After:**

```jsonc
{
  "type": "int_select_model",
  "group": "sales",
  "topic": "orders",
  "name": "hourly",
  "materialization": {
    "type": "incremental",
    "strategy": { "type": "delete+insert" },
    "partitions": ["portal_partition_daily"],
  },
  "from": { "model": "stg__sales__orders__standardized" },
}
```

**Edge cases:**

- **String shorthand wins when there's nothing else.** If only `materialized: "incremental"` is set (no `incremental_strategy`, no `partitioned_by`), the After should be `"materialization": "incremental"` -- not the structured form. Same for `"ephemeral"`.
- **Remove all three legacy keys in the same edit.** Leaving any of them is dead weight; `materialization` takes precedence at runtime, so the legacy key never re-appears in generated SQL but it does keep showing up in IntelliSense as deprecated.
- **`format`** (`delta_lake` / `hive` / `iceberg`) is **not** carried over by R1. The framework defaults to the project's `storage_type`. If the user wants to pin it, surface as a Needs-decision item.
- **`merge` strategy requires Iceberg in dbt-trino.** If `incremental_strategy.type === "merge"`, add `"format": "iceberg"` in the structured form **only if** the project's `storage_type` var is not already `iceberg` -- otherwise skip the `format` field.
- See `model.materialization.schema.json` for the full structured shape.

---

## R2. `meta.dimension` / `meta.metrics` / `meta.case_sensitive` → `lightdash.*`

**When to flag:** any `select[i].meta` object contains a framework-reserved Lightdash key (`dimension`, `metrics`, `metrics_merge`, `case_sensitive`). The framework already raises a Warning diagnostic in the Problems tab pointing to the canonical field; rewriting clears the diagnostic.

**Detection heuristic:** for each `select[i]` (or `ctes[j].select[i]`):

- `select[i].meta.dimension` is an object, OR
- `select[i].meta.metrics` is an array, OR
- `select[i].meta.metrics_merge` is an object, OR
- `select[i].meta.case_sensitive` is a boolean.

The reserved-keys list comes from the `Framework-reserved keys under meta` table in `templates/_AGENTS.md`.

**Before:**

```jsonc
{
  "name": "amount",
  "type": "fct",
  "meta": {
    "dimension": { "label": "Order Amount", "hidden": false },
    "metrics": [{ "name": "total_amount", "type": "sum" }],
    "case_sensitive": true,
    "owner": "sales-platform",
    "pii": false,
  },
}
```

**After:**

```jsonc
{
  "name": "amount",
  "type": "fct",
  "lightdash": {
    "dimension": { "label": "Order Amount", "hidden": false },
    "metrics": [{ "name": "total_amount", "type": "sum" }],
    "case_sensitive": true,
  },
  "meta": {
    "owner": "sales-platform",
    "pii": false,
  },
}
```

**Edge cases:**

- **Free-form user keys stay under `meta`.** Only the reserved keys move; `owner`, `pii`, `compliance`, `freshness_sla`, etc. round-trip verbatim.
- **Empty `meta` after the move.** If the only keys under `meta` were reserved Lightdash keys, drop the `meta` block entirely (don't leave `"meta": {}`).
- **CTE-level selects only support `lightdash.dimension` and `lightdash.case_sensitive`.** `validateCtes` rejects `lightdash.metrics` / `lightdash.metrics_merge` on a CTE select. If a `meta.metrics` / `meta.metrics_merge` block is found inside a `ctes[i].select[j]`, do **not** apply R2 there -- surface as a Needs-decision item asking the user to move the metric definition to the consumer's main `select` instead. Inside CTEs, only the dimension/case_sensitive halves of R2 are auto-applicable.
- **Existing `lightdash` block.** If the column already has a `lightdash` block, **merge** the moved keys into it (don't overwrite). On key collision (e.g. both `meta.dimension` and `lightdash.dimension` exist), the existing `lightdash.dimension` wins -- skip moving that one and surface as a Needs-decision item.
- **Model-level reserved keys.** Same rule applies at model scope: `meta.metrics` → `lightdash.metrics`, `meta.case_sensitive` → `lightdash.case_sensitive`, anything on `meta.lightdash.table.*` → `lightdash.table.*`. `meta.local_tags` → `tags: [{ "type": "local", "tag": "..." }]` is a **Needs-decision** item, not Recommended (the structural reshape is non-trivial).

---

## R3. `group_by: [{ "type": "dims" }]` → `"dims"` shorthand

**When to flag:** `obj.group_by` is exactly `[{ "type": "dims" }]` -- a single-element array, single-key object, value `"dims"`. Same SQL.

**Before:**

```jsonc
"group_by": [{ "type": "dims" }],
```

**After:**

```jsonc
"group_by": "dims",
```

**Edge cases:**

- **Multi-element arrays don't qualify.** `[{ "type": "dims" }, "extra_col"]` or `[{ "type": "dims" }, { "expr": "..." }]` cannot use the shorthand; leave them alone.
- **Plain `["col1", "col2"]` arrays don't qualify.** The shorthand only collapses the `{ "type": "dims" }` object form.
- **Inside CTEs, the same rule applies** -- `ctes[i].group_by: [{ "type": "dims" }]` → `"dims"`. Same SQL.

---

## R4. collapse three `exclude_*` booleans into `exclude_framework_artifacts`

**When to flag:** at the same scope (model OR a single CTE entry), all three booleans are explicitly `true`:

- `exclude_datetime: true`, AND
- `exclude_portal_partition_columns: true`, AND
- `exclude_portal_source_count: true`.

If `exclude_date_filter: true` is also set at the same scope, the After is `"exclude_framework_artifacts": "all"`. Otherwise it's `"columns"`.

**Detection heuristic:** at each scope, check the four flags. **Skip entirely** if `from.rollup` is set at the same scope -- the validator rejects that combo.

**Before (`columns` case):**

```jsonc
{
  "type": "int_select_model",
  "from": { "model": "stg__sales__lookups__regions" },
  "exclude_datetime": true,
  "exclude_portal_partition_columns": true,
  "exclude_portal_source_count": true,
  "select": ["region_code", "region_name"],
}
```

**After:**

```jsonc
{
  "type": "int_select_model",
  "from": { "model": "stg__sales__lookups__regions" },
  "exclude_framework_artifacts": "columns",
  "select": ["region_code", "region_name"],
}
```

**Before (`all` case adds `exclude_date_filter`):**

```jsonc
{
  "exclude_date_filter": true,
  "exclude_datetime": true,
  "exclude_portal_partition_columns": true,
  "exclude_portal_source_count": true,
}
```

**After:**

```jsonc
{
  "exclude_framework_artifacts": "all",
}
```

**Edge cases:**

- **Skip when `from.rollup` is at the same scope.** `exclude_framework_artifacts` (when its resolved value implies excluding `datetime`) is mutually exclusive with `from.rollup`. The validator already errors on the combo. Don't propose the rewrite there.
- **Mixed `true` / `false` doesn't qualify.** If any of the three booleans is `false` (explicitly opting back in), don't collapse -- the user is opting into a partial set.
- **CTE-scope vs model-scope.** Apply the rewrite at whichever scope all three are set. Do **not** hoist a CTE's three-flag set up to the model level (different semantics).
- **Remove all three (or four) legacy keys in the same edit.** Leaving any of them mixed with the new combined flag is confusing and (per AGENTS.md) lets the individual flag override per-column anyway.
- **`exclude_daily_filter`** is **not** part of `exclude_framework_artifacts`; it stays as its own boolean.

---

## R5. single-`expr` `where` / `having` → string shorthand

**When to flag:** `where` (or `having`) is `{ "and": [{ "expr": "<single literal SQL>" }] }` -- exactly one element, exactly one key on the inner object (`expr`), and the expression is a literal string.

**Before:**

```jsonc
"where": { "and": [{ "expr": "status = 'COMPLETED'" }] },
```

**After:**

```jsonc
"where": "status = 'COMPLETED'",
```

**Edge cases:**

- **Multiple conditions don't qualify.** `{ "and": [{ "expr": "a" }, { "expr": "b" }] }` is two conditions -- leave it.
- **`or` clauses don't qualify** even with a single element. `{ "or": [...] }` keeps its structured form to make the intent (a disjunction with future siblings) explicit.
- **Subquery elements never collapse.** `{ "and": [{ "subquery": { ... } }] }` does not have an `expr` key on the inner object -- skip.
- **`having` follows the same rule** -- same shape, same shorthand.

---

## D1. `int_rollup_model` → `int_select_model` + `from.rollup`

**Why decide:** the legacy `int_rollup_model` synthesizes its `select` from the upstream model -- the JSON has no `select` field. The modern `int_select_model` + `from.rollup` requires an **explicit** `select`. Behavior is equivalent only if the explicit `select` matches the implicit rollup output exactly. The user must confirm the intended dim / fct list.

**Cross-skill referral:** if the rollup model is itself ephemeral (no `materialization` / `materialized`, or `materialization: "ephemeral"`), recommend `dj-migrate-ephemerals-to-ctes` first -- that skill will inline the rollup as a CTE with `from.rollup`, which is usually preferable to keeping a standalone rollup model.

**Before:**

```jsonc
{
  "type": "int_rollup_model",
  "group": "sales",
  "topic": "orders",
  "name": "daily",
  "materialization": "incremental",
  "from": {
    "model": "int__sales__orders__hourly",
    "rollup": { "interval": "day" },
  },
}
```

**Suggested shape (After):**

```jsonc
{
  "type": "int_select_model",
  "group": "sales",
  "topic": "orders",
  "name": "daily",
  "materialization": "incremental",
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

**Edge cases:**

- **`interval` values are exactly `hour` / `day` / `month` / `year`.** Not `weekly`, not `quarterly`. There is no `datetime_expr` field -- the upstream's `datetime` column with an `interval` drives the rollup.
- **`exclude_datetime` / `exclude_framework_artifacts` are mutually exclusive with `from.rollup` at the same scope.** If the rollup model has either, the conversion errors at validation -- surface this in the Why-decide note.
- **Joins.** If the rollup is consumed alongside joins, suggest `int_join_models` instead of `int_select_model`. Either type accepts `from.rollup`.
- See `model.from.rollup.schema.json` and `templates/_AGENTS.md` (Advanced section) for the full shape.

---

## D2. verbose join `on` with all-string entries → `on: "dims"`

**Why decide:** `on: "dims"` auto-joins on **all** shared dimension columns between the two models. The skill cannot reliably verify that the explicit list equals the shared-dims set without walking `target/manifest.json` (and even then, the dims set can shift over time as upstream models change). The user should confirm the intent: "join on every shared dim, even ones added later" vs "join on exactly these columns".

**Detection heuristic:** a `from.join[i].on` of shape `{ "and": ["col_a", "col_b", ...] }` -- all entries are plain strings, no `expr` objects, no `subquery` objects.

**Before:**

```jsonc
{
  "from": {
    "model": "stg__sales__orders__standardized",
    "join": [
      {
        "model": "stg__customers__profiles__clean",
        "type": "left",
        "on": { "and": ["customer_id", "tenant_id", "region_code"] },
      },
    ],
  },
}
```

**Suggested shape (After):**

```jsonc
{
  "from": {
    "model": "stg__sales__orders__standardized",
    "join": [
      {
        "model": "stg__customers__profiles__clean",
        "type": "left",
        "on": "dims",
      },
    ],
  },
}
```

**Edge cases:**

- **Mixed `expr` / `subquery` entries don't qualify.** Only all-string `and` arrays are candidates.
- **`on: "dims"` is permissive.** It joins on every shared dim, so adding a new dim upstream silently changes the join semantics. If the user is explicit about "exactly these three columns", keep the verbose form.
- **Cross joins** (`type: "cross"`) have no `on` -- never propose `on: "dims"` for them.

---

## D3. pre-aggregation CTE consumed only by `IN`/`EXISTS` → inline `subquery`

**Why decide:** SQL plan changes. A CTE materializes once and is referenced by name; an inline subquery may be re-planned per call by Trino. Performance can go either way. User should verify and that the CTE has no other consumers in the model.

**Detection heuristic:** a `ctes[i]` entry whose `name` appears in the consumer's `where` / `having` / join `on` only inside a `subquery` block with operator `in` / `not_in` / `exists` / `not_exists`, AND nowhere else in the model (not in `from`, `select`, or another CTE).

**Before:**

```jsonc
{
  "ctes": [
    {
      "name": "active_accounts",
      "from": { "model": "int__sales__accounts__daily" },
      "where": "is_active = true",
      "select": ["account_id"],
    },
  ],
  "from": { "model": "int__sales__orders__hourly" },
  "where": {
    "and": [
      {
        "subquery": {
          "operator": "in",
          "column": "account_id",
          "from": { "cte": "active_accounts" },
        },
      },
    ],
  },
  "select": [
    { "type": "all_from_model", "model": "int__sales__orders__hourly" },
  ],
}
```

**Suggested shape (After):**

```jsonc
{
  "from": { "model": "int__sales__orders__hourly" },
  "where": {
    "and": [
      {
        "subquery": {
          "operator": "in",
          "column": "account_id",
          "from": { "model": "int__sales__accounts__daily" },
          "where": "is_active = true",
        },
      },
    ],
  },
  "select": [
    { "type": "all_from_model", "model": "int__sales__orders__hourly" },
  ],
}
```

**Edge cases:**

- **Multi-consumer CTEs don't qualify.** If the CTE is referenced anywhere else in the model, leave it -- inlining would duplicate the logic.
- **Subquery `column` is required for everything except `exists` / `not_exists`.** Surface as the Why-decide reason if the legacy CTE selects multiple columns.
- **Subquery `from` accepts model / source / cte.** When inlining, you typically swap the CTE's source straight into the subquery's `from`.
- See `model.subquery.schema.json` for the full shape.

---

## D4. `from: { cte }` chain with no `exclude_framework_artifacts` (heads-up only)

**Why decide:** the framework cascades framework columns (`datetime`, `portal_partition_*`, `portal_source_count`) through every `from: { cte }` hop and into a main model with `from: { cte }`, inheriting from the upstream CTE registry. A model with a scalar `select` on top of a CTE chain and no exclude flag will emit those extra columns in its generated SQL / YML. This is the framework default and usually correct -- the alternative is to set an explicit `exclude_*` flag to keep the chain's projection narrower. The user should confirm which shape they want.

**Detection heuristic:** the model has `from: { cte }` (top-level OR nested via `ctes[i].from: { cte }`), AND **no** `exclude_framework_artifacts` / `exclude_datetime` / `exclude_portal_partition_columns` / `exclude_portal_source_count` set at any relevant scope.

**Heads-up output (no edit suggested):**

```text
Model uses a from.cte chain. The framework auto-injects datetime,
portal_partition_*, and portal_source_count columns along the chain from
the upstream registry. Action options:
  - Keep the default (likely the intended shape; audit the diff on next sync).
  - To narrow the projection, set exclude_framework_artifacts: "columns" on
    the relevant scope (model or specific CTE).
  - For pure-dim / lookup chains (no datetime upstream), set
    exclude_framework_artifacts: "all" or pair exclude_datetime +
    exclude_portal_partition_columns explicitly.
```

**Edge cases:**

- **No edit applied.** D4 is informational. The skill prints the heads-up and exits the finding without producing a Before/After.
- **Skip if `from.rollup` is present at the same scope.** Rollup already exposes the partition columns deliberately; auto-injection is the intended behavior.
- **Skip when `exclude_*` flags are already set.** No drift to warn about.

---

## D5. `overwrite_existing_partitions` / `dj_iceberg_partition_overwrite` without a partition column

**Why decide:** both strategies silently no-op (or fail at `dbt run` time) when the model emits no partition column. Three remediations exist; each has trade-offs; the user picks.

**Detection heuristic:** the model's resolved incremental strategy is `overwrite_existing_partitions` or `dj_iceberg_partition_overwrite` (via `materialization.strategy.type`, top-level `incremental_strategy.type`, or the workspace default `dj.materialization.defaultIncrementalStrategy`), AND the model emits no `portal_partition_*` column AND no `materialization.partitions` / `partitioned_by` listing a column that exists in the `select`. The framework already raises a Warning in the Problems tab; D5 mirrors that warning with three remediations.

**Suggested remediations (skill prints all three; user picks):**

**(a) Switch to `delete+insert`** (works on Delta Lake, Hive, and Iceberg; auto-derives `unique_key` from partitions):

```jsonc
"materialization": {
  "type": "incremental",
  "strategy": { "type": "delete+insert" },
}
```

**(b) Expose a partition column** (e.g. add `{ "name": "datetime", "interval": "day" }` to `select`, or add `materialization.partitions: ["portal_partition_daily"]` if the column is already in `select`):

```jsonc
"select": [
  // ... existing columns ...
  { "name": "datetime", "interval": "day" },
],
```

**(c) Move to `materialization: "ephemeral"`** (no incremental at all -- works for small models the framework can re-materialize cheaply):

```jsonc
"materialization": "ephemeral",
```

**Edge cases:**

- **`dj_iceberg_partition_overwrite` requires Iceberg format.** If the project's `storage_type` var is not `iceberg`, remediation (a) `delete+insert` is the recommended swap; (b) requires also setting `materialization.format: "iceberg"`.
- **Don't auto-pick.** All three are valid trade-offs. The skill must surface all three and let the user choose.
- **Rollup models are unaffected.** `from.rollup` carries the partition through; D5 should not fire on `int_rollup_model` / `int_select_model` + `from.rollup` / `int_join_models` + `from.rollup`.

---

## Sanity-check checklist (before printing the report)

Run these mental checks against every finding before adding it to the review:

- [ ] Does the After preserve every `ai_hint`, `lightdash.*`, `data_tests`, `tags`, `description`, and free-form `meta.*` user key from the Before?
- [ ] Does the After remove every legacy / redundant key the new shape replaces (so no key drift)?
- [ ] Does the After respect the gotchas in the SKILL body (no `exclude_framework_artifacts` + `from.rollup`; no `lightdash.metrics` on a CTE select; no `datetime_expr` on rollup; etc.)?
- [ ] Is the Before/After diff small enough for the user to read in the report? If not, the finding belongs in Group 2 (Needs decision), not Group 1 (Recommended).
