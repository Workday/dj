---
name: dj-migrate-ephemerals-to-ctes
description: >-
  Detect legacy ephemeral DJ `.model.json` files and inline them as Common
  Table Expressions (CTEs) inside their downstream consumer models. Use when
  the user wants to migrate, inline, refactor, flatten, consolidate, collapse,
  or remove ephemeral dbt models, dissolve redundant intermediate layers, or
  standardize trivial transformations into inline CTEs -- even if they don't
  explicitly say "ephemeral" or "CTE".
compatibility: DJ (Data JSON) Framework extension workspace with `.dj/schemas/`, `.agents/dj/AGENTS.md`, and a populated dbt `target/manifest.json`
metadata:
  dj-skill: '1.0'
---

# Migrate ephemeral DJ models to inline CTEs

**Goal:** dissolve qualifying ephemeral `.model.json` files into the `ctes[]` array of their downstream consumer, then remove the now-redundant file. Mutate **only** the JSON sources of truth — the framework's sync engine regenerates the `.sql` / `.yml` artifacts.

**Reading order:** `.agents/dj/AGENTS.md` (Model Types, Inline CTEs, Important Conventions) → `.dj/schemas/model.cte.schema.json` + `model.materialization.schema.json` → this skill's `references/transformation-matrix.md` for per-type recipes.

## When this skill applies

- The user mentions migrating, inlining, refactoring, flattening, consolidating, collapsing, or removing ephemeral models.
- The user wants to "clean up redundant intermediate layers" or "standardize trivial transformations into CTEs".
- The user references a specific ephemeral `.model.json` and wants it absorbed by its downstream consumer.

## Workflow

- [ ] **1. Inventory ephemerals.** Use ripgrep to find candidates -- never iterate-and-parse every `.model.json` (context-budget poison). Search for **all four** forms:
  1. `rg -l '"materialization"\s*:\s*"ephemeral"' models/`
  2. `rg -l '"materialization"\s*:\s*\{\s*"type"\s*:\s*"ephemeral"' models/`
  3. `rg -l '"materialized"\s*:\s*"ephemeral"' models/`
  4. `stg_*` and `int_*` models with **no** `materialization` / `materialized` field at all -- staging and intermediate layers default to `ephemeral` in DJ.
- [ ] **2. Find consumers.** For each candidate, look up `target/manifest.json` `child_map["model.${project}.${ephemeral_name}"]`. Each entry is a downstream consumer node ID. Resolve the consumer's `.model.json` path from the manifest's `original_file_path` (or by ripgrep on the model name). If `manifest.json` is missing or stale, ask the user to run `DJ: Refresh Projects` first.
- [ ] **3. Classify.** Apply the **Qualification matrix** below. Tag each ephemeral as `Safe`, `Needs review`, or `Skip` with a one-line reason.
- [ ] **4. Plan the run.** Print a compact table to the user: ephemeral → consumer(s) → classification → reason. Wait for the user to confirm scope (all `Safe`, all `Safe + reviewed`, or a hand-picked subset).
- [ ] **5. Mutate.** For each approved candidate, apply the transformation rules below + the per-type recipe in `references/transformation-matrix.md`. **Use a JSONC-aware editor** (or a targeted string edit) so comments and trailing commas survive -- `JSON.stringify` round-tripping silently strips both and is explicitly forbidden by `AGENTS.md`.
- [ ] **6. Verify the auto-sync (per file).** Saving a `.model.json` triggers the framework's file watcher, which debounces (`dj.syncDebounceMs`, default 1500ms) and then regenerates the consumer's `.sql` / `.yml`. **Wait ~2-3 seconds after each save**, then read the consumer's diagnostics (Problems tab / linter output) and spot-check the generated `.sql` for shape sanity. If a diagnostic appears, fix it before moving to the next ephemeral -- do not batch failures.
- [ ] **7. Full sync at the end of the batch.** Once every approved migration is applied, ask the user to run `DJ: Sync to SQL and YML` (command id `dj.command.jsonSync`) from the command palette. The agent cannot invoke VS Code commands directly, so this step requires a user action. The full sync catches cross-file dependencies the per-file watcher may not (e.g. a consumer whose own consumer hasn't re-synced since its select shape changed). Confirm the Problems tab is clean for **all** touched files before proceeding to cleanup.
- [ ] **8. Cleanup.** Only after the full sync runs cleanly **and** a final repo-wide ref sweep (`rg "<ephemeral_name>" --type json`) returns zero hits, **and** the user explicitly confirms: delete the ephemeral `.model.json` and its generated `.sql` / `.yml` siblings. The framework does **not** auto-delete the `.sql` / `.yml` siblings on a plain `.model.json` delete (that auto-cleanup only fires on renames), so the agent must remove them explicitly. If any consumer still refers to the ephemeral, leave the file in place and report which consumers remain.
- [ ] **9. Post-delete verification.** Deleting a `.model.json` does **not** re-run validation on every downstream model and does **not** refresh the dbt manifest. After the batch of deletions, ask the user to run **two** commands from the command palette: (a) `DJ: Sync to SQL and YML` -- re-validates every model and catches any stale ref to a deleted ephemeral that slipped past the ref sweep; (b) `DJ: Refresh Projects` (command id `dj.command.refreshProjects`) -- re-parses `target/manifest.json` so `child_map` no longer lists the deleted ephemerals. Skipping the refresh leaves a stale manifest, which causes any later run of this skill (or model / column lineage views) to see ghosts. The agent cannot invoke either command; both require a user action.

## Qualification matrix

| Outcome          | Conditions (all must hold)                                                                                                                                                                                                                                                                                                      | Action                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Safe**         | Exactly **one** consumer; consumer `type` ∈ {`int_select_model`, `int_join_models`, `int_union_models`, `mart_select_model`, `mart_join_models`}; ephemeral `type` ∈ {`int_select_model`, `int_join_models`, `int_union_models`}; **no** `lightdash` block anywhere on the ephemeral; not flagged as "heavy" (see below).       | Auto-inline using the per-type recipe.                                                                                                                                                                                 |
| **Needs review** | Multiple consumers (logic duplicates into each); OR ephemeral `type` is `int_rollup_model` (partial CTE mapping via `from.rollup`); OR ephemeral is "heavy" -- contains window functions, wide cross-joins, multi-CTE chains, or unpartitioned full-history scans that would recalculate per consumer call.                     | Preview the diff; for heavy candidates surface the **incremental materialization** escape hatch (see "Heavy ephemeral appendix" in `references/transformation-matrix.md`); only proceed on explicit user confirmation. |
| **Skip**         | Ephemeral `type` is `stg_select_source` or `stg_union_sources` (CTE `from` has **no** `source` shape); OR `int_join_column` (unnest semantics not in CTE schema); OR `int_lookback_model` (no CTE host); OR consumer `type` does **not** support `ctes`; OR ephemeral carries a `lightdash` block at the model or column level. | Do not migrate. Report with reason.                                                                                                                                                                                    |

> **Why Lightdash is a hard skip, not a fixup.** CTEs are transient in-memory query stages; they don't surface as Lightdash-explorable tables or views. If you inline an ephemeral that carries Lightdash metadata, that metadata is permanently destroyed -- there is no equivalent place to relocate it. The framework's `validateCtes` in `src/services/modelValidation.ts` separately rejects `metrics` / `metrics_merge` on any CTE select.

## Transformation rules

For each `Safe`/approved migration, edit the consumer's `.model.json`:

1. **Add the CTE.** Insert a new entry at the end of the consumer's `ctes` array (instantiate the array if absent). The entry's `name` is the **short `name` field from the ephemeral's `.model.json`** -- not the full `<layer>__<group>__<topic>__<name>` model name. So for `int__analytics__reports__reportstats_union.model.json` with `"name": "reportstats_union"`, the CTE is named `reportstats_union`. Concise CTE names keep the consumer readable and match the existing in-repo CTE naming convention (CTE schema validates against `^[a-z][a-z0-9_]*$`). Copy the ephemeral's `from`, `select`, `where`, `group_by`, `having`, and all `exclude_*` flags into this entry. **Drop** the ephemeral's identity fields (`type`, `group`, `topic`, `name`, `materialization` / `materialized`) and any model-level `lightdash` / `tags` / `meta` -- those have no analog on a CTE.
2. **Disambiguate name collisions.** Before adopting the short name, check the consumer's existing `ctes[].name` values and -- if you are inlining more than one ephemeral in the same pass -- the other inbound ephemerals' short names. On collision, fall back deterministically: try `<topic>_<name>` (e.g. `reports_reportstats_union`), then `<group>_<topic>_<name>`, then the full model name. Pick the shortest form that is unique within the consumer.
3. **Rewrite top-level `from`.** Change `"from": { "model": "<full_ephemeral_name>" }` → `"from": { "cte": "<short_cte_name>" }`. For `from.join[]` entries, change `"model"` → `"cte"` on the matching join target and swap in the short name. For `from.union.models`, move the entry into `from.union.ctes` using the short name.
4. **Rewrite bulk selects.** Anywhere the consumer's `select` has `{ "type": "all_from_model", "model": "<full_ephemeral_name>" }`, rewrite to `{ "type": "all_from_cte", "cte": "<short_cte_name>" }`. Same for `dims_from_model` → `dims_from_cte` and `fcts_from_model` → `fcts_from_cte`. Preserve any `include` / `exclude` arrays verbatim.
5. **Rewrite qualified expression references to the ephemeral.** If the consumer has any `expr` strings that reference the ephemeral by its full model name (e.g. `"int__sales__orders__enriched.amount * 100"`), rewrite the qualifier to the new short CTE name (`"enriched.amount * 100"`). Inner expressions that reference the ephemeral's **upstream models** (e.g. `"stg__sales__orders__standardized.col + 1"` inside the new CTE) stay untouched -- CTE join aliases mirror upstream model names exactly, so those continue to resolve.
6. **Preserve partition-filter behavior.** DJ auto-injects an `_ext_event_date_filter` predicate on CTEs that read from physical upstream models, and CTEs chained off other CTEs inherit the predicate recursively back to the root physical model. **If the ephemeral was intentionally running unpartitioned** (carried `exclude_date_filter: true`, or its source lacked the partition column), set `"exclude_date_filter": true` on the new CTE entry. Mirror any other `exclude_*` flags (`exclude_datetime`, `exclude_portal_partition_columns`, `exclude_framework_artifacts`, …) the ephemeral carried.
7. **Respect CTE ordering.** If you are inlining a chain of two or more ephemerals into a single consumer, list them in dependency order: a CTE can only reference CTEs that appear **before** it in the array. Walk the chain bottom-up (deepest ephemeral first).

See `references/transformation-matrix.md` for per-ephemeral-type recipes (`int_select_model`, `int_join_models`, `int_union_models`, and `int_rollup_model` as a "Needs review" case) plus the partition-filter checklist and the Heavy ephemeral appendix.

## Hard rules (DO NOT)

- **DO NOT** inline a `stg_select_source` or `stg_union_sources` ephemeral. The CTE `from` schema (`model.cte.schema.json`) has no `source` shape; the result will fail validation.
- **DO NOT** inline into a consumer whose `type` is **not** in the CTE-supporting set above.
- **DO NOT** inline any ephemeral that carries a `lightdash` block at the model or column level. Skip it and report; the Lightdash metadata cannot survive the transition.
- **DO NOT** move Lightdash `metrics` / `metrics_merge` onto a CTE select even on the consumer side -- those must live on the consumer's main `select`. `validateCtes` in `src/services/modelValidation.ts` enforces this.
- **DO NOT** drop the ephemeral's `exclude_*` partition flags during transformation -- carry them onto the new CTE entry.
- **DO NOT** delete the ephemeral `.model.json` until **every** entry in `child_map` is migrated **and** a final repo-wide ref scan returns zero hits **and** the user explicitly confirms.
- **DO NOT** use `JSON.stringify` (or any non-JSONC writer) to rewrite `.model.json` -- it strips comments and trailing commas. Use `jsonc-parser` modify ops, or perform targeted string edits that leave surrounding formatting intact.
- **DO NOT** hand-edit the generated `.sql` or `.yml` files -- they are framework outputs and regenerate on sync.

## Gotchas

- **Ephemeral chains (A → B → C all ephemeral)** absorbed into a single mart: inline bottom-up in dependency order (A first, then B referencing A, then C referencing B). The chain becomes a sequence in `ctes[]`. Watch for `from.cte` references inside the inlined CTEs -- those resolve correctly because the chain is now intra-model.
- **Multi-consumer migration is a one-way change** that duplicates the ephemeral's logic into each consumer's `ctes[]`. Surface this clearly to the user; future edits will need to touch every copy. Default to leaving multi-consumer ephemerals in place.
- **Generated `.sql` / `.yml` files are read-only and orphan on plain deletes.** The framework's post-sync cleanup only deletes generated artifacts when a `.model.json` is **renamed** -- on a plain delete (this skill's flow), the `.sql` and `.yml` siblings linger and must be removed by the agent. The watcher does fire on the JSON delete, but it only invalidates the cache; the corresponding sync becomes a no-op because there's no JSON to sync from.
- **Diagnostics in the Problems tab must clear after sync.** If a new diagnostic appears on the consumer (e.g. "CTE references an unknown column", "`fct` without `agg`"), the migration is incomplete -- revert or fix before deleting the ephemeral.
- **Don't race the sync debouncer.** Reading the consumer's `.sql` / `.yml` or diagnostics within ~1500ms of a save gives a stale snapshot -- you'll see the file's previous state and conclude the migration broke something that's actually fine. Always sleep 2-3 seconds after each save before reading downstream artifacts. The agent cannot invoke `DJ: Sync to SQL and YML` itself (no VS Code command access); the per-file watcher is what makes incremental verification possible.
- **Partition-predicate inheritance is recursive.** A CTE chained off another CTE resolves the predicate all the way back to the root physical model. Spot-check the generated SQL to confirm the resulting filters match the ephemeral's previous behavior, especially for any model that historically ran full-history scans.
- **Inlining a heavy ephemeral can regress query performance.** When a `mart_*` model is hit repeatedly (BI dashboards, downstream tests), the inlined logic recalculates per call instead of once per dbt run. When in doubt, prefer the `incremental` materialization escape hatch over inlining -- see `references/transformation-matrix.md`.
- **`portal_source_count`, `datetime`, and `portal_partition_*` auto-inject** into CTEs whose `from` is a `model` or `cte`. Do not duplicate these columns in the new CTE's `select`; the framework appends them automatically from the upstream registry.
- **CTE column type inheritance.** Plain string selects in a CTE inherit `dim` / `fct` type from the upstream model or CTE -- no need to redeclare types when copying selects from the ephemeral.

## Worked example

**Before** -- ephemeral `int_join_models` consumed by one mart:

`models/intermediate/sales/orders/int__sales__orders__enriched.model.json`:

```jsonc
{
  "type": "int_join_models",
  "group": "sales",
  "topic": "orders",
  "name": "enriched",
  // no materialization field -> defaults to ephemeral
  "from": {
    "model": "stg__sales__orders__standardized",
    "join": [
      {
        "model": "stg__customers__profiles__clean",
        "type": "left",
        "on": { "and": ["customer_id"] },
      },
      {
        "model": "stg__sales__stores__locations",
        "type": "left",
        "on": { "and": ["store_id"] },
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
    {
      "type": "all_from_model",
      "model": "stg__sales__stores__locations",
      "include": ["store_name"],
    },
  ],
}
```

`models/mart/sales/reporting/mart__sales__reporting__revenue.model.json`:

```jsonc
{
  "type": "mart_select_model",
  "group": "sales",
  "topic": "reporting",
  "name": "revenue",
  "from": { "model": "int__sales__orders__enriched" },
  "select": [
    { "type": "all_from_model", "model": "int__sales__orders__enriched" },
    {
      "name": "order_year",
      "expr": "EXTRACT(YEAR FROM order_date)",
      "type": "dim",
    },
  ],
}
```

**After** -- ephemeral file deleted, mart now hosts the CTE. Note the CTE name is the **short** `"name"` field from the ephemeral (`enriched`), not the full `int__sales__orders__enriched`:

```jsonc
{
  "type": "mart_select_model",
  "group": "sales",
  "topic": "reporting",
  "name": "revenue",
  "ctes": [
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
          {
            "model": "stg__sales__stores__locations",
            "type": "left",
            "on": { "and": ["store_id"] },
          },
        ],
      },
      "select": [
        {
          "type": "all_from_model",
          "model": "stg__sales__orders__standardized",
        },
        {
          "type": "all_from_model",
          "model": "stg__customers__profiles__clean",
          "include": ["customer_name"],
        },
        {
          "type": "all_from_model",
          "model": "stg__sales__stores__locations",
          "include": ["store_name"],
        },
      ],
    },
  ],
  "from": { "cte": "enriched" },
  "select": [
    { "type": "all_from_cte", "cte": "enriched" },
    {
      "name": "order_year",
      "expr": "EXTRACT(YEAR FROM order_date)",
      "type": "dim",
    },
  ],
}
```

After saving, the file watcher debounces (~1500ms) and regenerates the mart's `.sql` / `.yml` automatically -- wait a few seconds, then verify the mart's diagnostics are clean. Once the full batch is applied, ask the user to run `DJ: Sync to SQL and YML` from the command palette for a project-wide pass. Only then -- and only after `rg int__sales__orders__enriched models/` returns zero hits -- delete `int__sales__orders__enriched.model.json` and its generated `.sql` / `.yml` siblings. Close the loop by asking the user to run `DJ: Sync to SQL and YML` once more (re-validates consumers against the post-delete state) and `DJ: Refresh Projects` (clears the deleted model from the dbt manifest).
