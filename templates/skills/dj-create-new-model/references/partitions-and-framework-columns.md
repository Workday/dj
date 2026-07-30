# Partitions and framework columns

Load on demand when a model or CTE deals with `datetime`,
`portal_partition_*`, `portal_source_count`, the `exclude_*` flags, or
`from.rollup`. These framework columns and their partition semantics are the
highest-regression area in model authoring.

## Auto-injection

- **`portal_source_count` auto-injects in CTEs whose `from` is a model or another CTE** — don't duplicate it in the CTE `select`; it's appended automatically from the upstream (aggregated with `count` when the CTE has a `group_by`). Set `override_suffix_agg: true` only when you need a differently-aggregated variant alongside the audit column.
- **`datetime` and `portal_partition_*` auto-inject in CTEs whose `from` is a model or another CTE** — mirrors the main-model behavior. If the upstream (manifest schema for `{ model }`, the in-memory registry for `{ cte }`) has them and the CTE's select (or `dims_from_model.include`) did not list them, they're appended automatically. An explicit `{ "name": "datetime", "interval": X }` drives partition exclusion: `day` drops hourly, `month` drops hourly+daily, `year` drops all three. Auto-inject is still skipped for source and union shapes.
- **Framework columns flow through CTE chains by default** — `datetime`, `portal_partition_*`, and `portal_source_count` propagate through every `from: { cte }` hop (and into a main model with `from: { cte }`) by inheriting from the upstream registry. List them in `select` only for a transformed alias, or opt out per CTE / per model with the standard exclude flags. When the main model uses an `incremental` partition-overwrite strategy, the auto-flowed `portal_partition_*` typically satisfies the partition-column requirement; if you intentionally exclude them through a chain, set `materialization.partitions: ["datetime"]` on the main model. Wrapper SELECTs that reference an already-rolled-up `datetime` do not redundantly re-emit `date_trunc(<same interval>, datetime)`.

## Exclude flags

- **CTE exclude/include flags mirror the main-model flags and inherit from the model** — a CTE accepts `exclude_date_filter`, `exclude_daily_filter`, `exclude_datetime`, `exclude_framework_artifacts`, `exclude_portal_partition_columns`, `exclude_portal_source_count`, and `include_full_month` with the same semantics as their main-model counterparts. Resolution is uniform: **CTE override > model value > false**. Set a flag on the model to apply it to every CTE, on a single CTE to override only that CTE, or set `false` on a CTE to opt back in when the model excluded. `exclude_datetime` and `exclude_portal_partition_columns` are orthogonal — set both for pure-dim/lookup shapes; `exclude_datetime` is mutually exclusive with `from.rollup` at the same scope (model OR CTE) and the validator errors when both are set together.
- **`exclude_framework_artifacts` is the combined-flag shortcut** — a single string-enum (`"all"` | `"columns"`) on the model or CTE that bundles `exclude_datetime` + `exclude_portal_partition_columns` + `exclude_portal_source_count` (`"columns"`), with `"all"` additionally implying `exclude_date_filter`. Individual flags at the same scope override per-column (e.g. `"exclude_framework_artifacts": "all"` + `"exclude_portal_source_count": false` keeps that one column). Resolution chain: CTE individual > CTE combined > model individual > model combined > false. Mutually exclusive with `from.rollup` when the resolved value implies excluding `datetime`.

## Rollup

- **`from.rollup` requires the upstream model to have a select column with an `"interval"` field** (e.g., `{ "name": "datetime", "interval": "day" }`).
- Inside a CTE, `from.rollup` is supported on `from.model` and `from.cte` (not `from.source`, not `from.union`). The framework rewrites the CTE's `datetime`, drops finer-grain partitions, wraps fct columns with their suffix-agg, and synthesizes `GROUP BY <dims>`. See `model.from.rollup.schema.json`.
- **Rolling up a CTE that sources from another CTE that excludes datetime is rejected** — the upstream must produce a datetime column for the rollup to truncate. Either drop `exclude_datetime` on the upstream CTE, or have the upstream itself declare `from.rollup`.
