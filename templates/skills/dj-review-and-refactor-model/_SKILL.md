---
name: dj-review-and-refactor-model
description: >-
  Review a DJ `.model.json` file (or folder, dependency tree, or whole
  workspace) and refactor it to use newer DJ extension capabilities --
  materialization shorthand, `lightdash.*` over `meta.*`, `from.rollup`,
  `exclude_framework_artifacts`, `"dims"` shorthand, inline subqueries, and
  more. Use when the user wants to review, audit, modernize, refactor, clean
  up legacy patterns, adopt newer DJ capabilities, or upgrade `.model.json`
  files -- even if they don't explicitly say "modernize" or "refactor".
compatibility: DJ (Data JSON) Framework extension workspace with `.dj/schemas/`, `.agents/dj/AGENTS.md`, and a populated dbt `target/manifest.json` (only required when scope = dependency tree)
metadata:
  dj-skill: '1.0'
---

# Review and refactor DJ models

**Goal:** audit `.model.json` files against the latest DJ capabilities, render **all** findings upfront in two buckets (**Recommended** / **Needs your decision**), then apply **only** what the user confirms. Mutate the JSON sources of truth -- the framework regenerates `.sql` / `.yml` artifacts.

**Reading order:** `.agents/dj/AGENTS.md` (Advanced section, Materialization & Incremental Strategies, Custom Meta, Lightdash) → `.dj/schemas/` (`model.materialization.schema.json`, `model.from.rollup.schema.json`, `model.subquery.schema.json`, `model.cte.schema.json`, `lightdash.*.schema.json`) → this skill's `references/refactor-catalog.md` once the apply phase begins.

## When this skill applies

- The user mentions reviewing, auditing, modernizing, refactoring, cleaning up, or upgrading `.model.json` files.
- The user wants to "use the latest DJ capabilities", "adopt newer features", or "remove legacy patterns".
- The user references a specific `.model.json` (or folder / project) and wants it brought up to date with the current framework.

## Coordination with sibling skills

- **Ephemeral → CTE inlining is out of scope here.** If a finding would dissolve an ephemeral `.model.json` into its consumer's `ctes[]`, defer to `dj-migrate-ephemerals-to-ctes` -- do **not** produce a finding for it. Mention the sibling skill once at the end of the review if any in-scope models look like inlining candidates.
- **`int_rollup_model` → `int_select_model` + `from.rollup`** stays in this skill's catalog (Group 2). If the rollup model is itself ephemeral, recommend `dj-migrate-ephemerals-to-ctes` first; it will inline the rollup as a CTE with `from.rollup`.

## Workflow

- [ ] **1. Resolve scope.** Default to the open `.model.json` in the editor if any. Otherwise ask whether the user wants a single named file, all `.model.json` under a folder, the dependency tree of a base model (resolved from `target/manifest.json` via `child_map` / `parent_map`), or the entire workspace. Confirm before proceeding for folder / tree / workspace scope.
- [ ] **2. Detect.** Read each in-scope `.model.json` and apply the catalog below. **Do not edit anything.** Capture each finding as `{ file, pattern, group, before, after, why? }`. Skip ephemeral inlining candidates entirely (they belong to `dj-migrate-ephemerals-to-ctes`).
- [ ] **3. Render the review.** Print a single numbered report using the template below. Recommended items get numeric labels `[1]` `[2]` ...; Needs-your-decision items get letter labels `[A]` `[B]` .... If there are zero findings, say so plainly and exit -- do not invent work.
- [ ] **4. Wait for confirmation.** Ask the user which items to apply (see "Confirmation prompt" below). **No edits until the user replies.** Treat any non-matching reply as "stop and ask again", not "apply all".
- [ ] **5. Apply.** For each picked item, perform a JSONC-aware edit (`jsonc-parser` modify ops or a targeted string edit) on the target `.model.json`. Preserve comments, trailing commas, and key ordering wherever possible. Print a per-item `applied / skipped (reason)` line as you go.
- [ ] **6. Per-file verify.** After saving each file, sleep ~2-3 seconds to let the framework's file watcher debounce (`dj.syncDebounceMs`, default 1500ms) and regenerate the `.sql` / `.yml`. Then re-read the VS Code diagnostics for that file. If a **new** error or warning appears that wasn't present before the edit, surface it and offer to revert that specific item. Do not batch failures -- fix or revert before moving to the next file.
- [ ] **7. Full sync at end of batch.** Once every approved edit is applied, ask the user to run `DJ: Sync to SQL and YML` (command id `dj.command.jsonSync`) from the command palette. The agent cannot invoke VS Code commands directly. The full sync catches cross-file effects the per-file watcher may not (e.g. a downstream consumer that needs to re-validate its bulk select against the updated upstream).
- [ ] **8. Optional regression follow-up.** If any of the edited files declares `data_tests`, mention `DJ: Run DBT Test` (`dj.command.modelTest`) as a manual regression check before committing. **Do not auto-invoke** -- it requires a Trino connection and is not a "review" responsibility. Skip this step entirely for files without tests.

## Refactor catalog

Each row below is **one** finding type. Verbose before/after JSONC, detection heuristics, and edge-case notes live in `references/refactor-catalog.md` -- load it on demand when entering Step 5 (Apply).

### Group 1: Recommended (safe rewrites, behavior-preserving)

| #   | Pattern                                                                                                                                                                                                                          | Why it's safe                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| R1  | Top-level `materialized` + optional `incremental_strategy` + optional `partitioned_by` → single structured `materialization` block                                                                                               | Schema marks the legacy keys `deprecated: true`; `materialization` takes precedence |
| R2  | `meta.dimension` / `meta.metrics` / `meta.metrics_merge` / `meta.case_sensitive` on a `select` item → `lightdash.dimension` / `lightdash.metrics` / etc.                                                                         | Framework already raises a Warning diagnostic on these; rewrite clears it           |
| R3  | `"group_by": [{ "type": "dims" }]` → `"group_by": "dims"`                                                                                                                                                                        | Pure shorthand; same SQL                                                            |
| R4  | `exclude_datetime: true` + `exclude_portal_partition_columns: true` + `exclude_portal_source_count: true` (± `exclude_date_filter`) → `exclude_framework_artifacts: "columns"` (or `"all"` if `exclude_date_filter` is also set) | Combined-flag shortcut documented in `AGENTS.md`; same resolution                   |
| R5  | `where: { and: [{ expr: "x = 'y'" }] }` (single string expression, no other conditions) → `where: "x = 'y'"`                                                                                                                     | String shorthand; same SQL                                                          |

### Group 2: Needs your decision (context attached; user picks)

| #   | Pattern                                                                                                                                        | Why decide                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `type: "int_rollup_model"` → `int_select_model` (or `int_join_models`) with `from.rollup`                                                      | Requires authoring an explicit `select`. Behavior is equivalent **only if** `select` matches the implicit rollup output. If the rollup is ephemeral, defer to `dj-migrate-ephemerals-to-ctes` first. |
| D2  | Join `on: { and: ["col_a", "col_b", ...] }` with all-string entries → `on: "dims"`                                                             | The skill can't always confirm the column list equals the shared-dims set without walking the manifest. User should confirm the dims match.                                                          |
| D3  | Pre-aggregation CTE consumed only by a single `where` / `having` `IN` / `NOT IN` / `EXISTS` / `NOT EXISTS` → inline `subquery`                 | SQL plan changes. User should verify performance and that the CTE has no other consumers.                                                                                                            |
| D4  | Model uses `from: { cte }` chain with no `exclude_framework_artifacts` set                                                                     | Heads-up only: framework auto-injects `datetime` / `portal_partition_*` / `portal_source_count` along the chain. Likely the intended default; user audits the diff or opts out.                      |
| D5  | Incremental model whose resolved strategy is `overwrite_existing_partitions` or `dj_iceberg_partition_overwrite` but emits no partition column | Framework already raises a Warning. Remediations: (a) switch to `delete+insert`, (b) expose a partition column, (c) move to `materialization: "ephemeral"`. Each has trade-offs; user picks.         |

## Report template

Render this **upfront, before any edits**. Make every finding self-contained so the user can decide without opening the file.

```text
## Review for <scope>

### Recommended (safe rewrites, behavior-preserving)
[1] <relpath>: <one-line finding> -> <one-line refactor>
    Before:
    <jsonc snippet, 2-6 lines>
    After:
    <jsonc snippet, 2-6 lines>
[2] ...

### Needs your decision (context below; you pick)
[A] <relpath>: <one-line finding> -> <one-line refactor>
    Why decide: <one-line reason>
    Suggested shape:
    <jsonc snippet, 2-10 lines>
[B] ...
```

If a single file produces multiple findings, list each as its own numbered item -- don't bundle them. If the entire scope produces zero findings, print `No legacy patterns detected.` and exit.

## Confirmation prompt

After the report, ask **verbatim**:

> Apply changes? Reply with one of:
>
> - `recommended` -- apply every Recommended `[N]` item
> - `recommended + A,C` -- apply all Recommended plus the lettered items you list
> - `1,3,A` -- apply only the items you list
> - `none` -- skip everything

Wait for the user. Anything else (a question, a partial answer, a clarification) means "stop and ask again", not "apply all".

## Hard rules (DO NOT)

- **DO NOT** edit generated `.sql` or `.yml` files. They regenerate on sync.
- **DO NOT** rename `.model.json` files. DJ renames are JSON-field changes (`type` / `group` / `topic` / `name`), not filesystem moves.
- **DO NOT** drop, summarize, re-key, or re-format any of these during a refactor: `ai_hint`, `lightdash.*` blocks, `data_tests`, `tags`, `description`, free-form `meta.*` user keys (`owner`, `pii`, `compliance`, `freshness_sla`, `owner_slack`, …). Refactors must restructure the **surrounding container** only -- user-authored metadata copies through verbatim.
- **DO NOT** invent new columns, joins, filter clauses, or `select` items. Only restructure existing ones.
- **DO NOT** auto-apply any item from the **Needs your decision** bucket without an explicit user pick.
- **DO NOT** propose ephemeral → CTE inlining as a finding -- defer to `dj-migrate-ephemerals-to-ctes`.
- **DO NOT** use `JSON.stringify` (or any non-JSONC writer) to rewrite `.model.json`. It strips comments and trailing commas and is explicitly forbidden by `AGENTS.md`. Use `jsonc-parser` modify ops or targeted string edits.
- **DO NOT** invoke VS Code commands (`DJ: Sync to SQL and YML`, `DJ: Run DBT Test`, etc.) directly. Ask the user to run them.

## Gotchas

- **`from.rollup` shape.** `interval` is exactly one of `hour` / `day` / `month` / `year` -- not `weekly`, not `quarterly`, not `daily`. The interval is implicit from the upstream model's column with `interval`; there is **no `datetime_expr` field**.
- **`exclude_framework_artifacts` is mutually exclusive with `from.rollup` at the same scope** (model OR CTE). The validator already errors on this combo. R4 must skip a finding when `from.rollup` is present at the same scope.
- **Legacy + new materialization keys can't coexist.** When converting to the structured `materialization` form (R1), **remove** the top-level `materialized`, `incremental_strategy`, and `partitioned_by` keys in the same edit. When both are present, `materialization` takes precedence at runtime, but the legacy keys become dead weight that drift over time.
- **`lightdash.metrics` / `lightdash.metrics_merge` are not valid on a CTE-level `select`.** `validateCtes` rejects them. When R2 fires inside a `ctes[]` entry, only `lightdash.dimension` and `lightdash.case_sensitive` are allowed -- if the legacy `meta` block carries `metrics` / `metrics_merge`, surface it as a Needs-your-decision item asking the user to move them to the consumer's main `select` instead.
- **R4 deletes one combined flag, not three booleans.** When collapsing the three booleans into `exclude_framework_artifacts`, remove **all three** legacy keys in the same edit -- leaving any of them would be redundant with the combined flag and confuse readers.
- **Per-file verify (Step 6) reads stale snapshots if you don't sleep past the debouncer.** Always wait ~2-3s after each save before reading diagnostics or generated artifacts.
- **CTE column type inheritance.** When R2 rewrites `meta.dimension` inside a CTE select, do **not** re-declare the column's `type` (`dim` / `fct`) -- plain string selects in CTEs inherit type from upstream.
- **Free-form `meta` keys collide with framework-reserved keys.** A small set of `meta` keys are framework-owned (`metrics`, `local_tags`, `case_sensitive` at model scope; `type`, `dimension`, `metrics`, `case_sensitive`, `origin` at column scope). R2 only fires on these reserved keys -- never on free-form user keys (`owner`, `pii`, etc.). Those stay under `meta` verbatim.

## Worked example

**Before** -- `int__sales__orders__hourly.model.json` carries legacy materialization keys plus a column-level `meta.dimension`:

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
  "select": [
    {
      "name": "order_id",
      "type": "dim",
      // legacy: lightdash sub-keys placed under meta
      "meta": {
        "dimension": { "label": "Order ID", "hidden": false },
        "case_sensitive": true,
        "owner": "sales-platform", // free-form user key, must round-trip
      },
    },
    { "name": "datetime", "interval": "hour" },
    { "name": "amount", "type": "fct", "agg": "sum" },
  ],
  "group_by": [{ "type": "dims" }],
}
```

**Review report** (rendered upfront):

```text
## Review for models/intermediate/sales/orders/int__sales__orders__hourly.model.json

### Recommended (safe rewrites, behavior-preserving)
[1] int__sales__orders__hourly.model.json: legacy materialized + incremental_strategy + partitioned_by -> single materialization block
    Before:
      "materialized": "incremental",
      "incremental_strategy": { "type": "delete+insert" },
      "partitioned_by": ["portal_partition_daily"],
    After:
      "materialization": {
        "type": "incremental",
        "strategy": { "type": "delete+insert" },
        "partitions": ["portal_partition_daily"],
      },
[2] int__sales__orders__hourly.model.json: select[0].meta.dimension / meta.case_sensitive -> select[0].lightdash.*
    Before:
      "meta": {
        "dimension": { "label": "Order ID", "hidden": false },
        "case_sensitive": true,
        "owner": "sales-platform",
      },
    After:
      "lightdash": {
        "dimension": { "label": "Order ID", "hidden": false },
        "case_sensitive": true,
      },
      "meta": {
        "owner": "sales-platform",
      },
[3] int__sales__orders__hourly.model.json: group_by [{ "type": "dims" }] -> "dims" shorthand
    Before:  "group_by": [{ "type": "dims" }],
    After:   "group_by": "dims",

### Needs your decision (context below; you pick)
(none)
```

**Confirmation:**

> Apply changes? Reply with one of: `recommended`, `recommended + A,C`, `1,3,A`, `none`

User replies `recommended`. The skill applies all three edits, prints `applied / applied / applied`, waits ~3s for the watcher, confirms the Problems tab shows no new diagnostics, then asks the user to run `DJ: Sync to SQL and YML` for a project-wide pass. The free-form `meta.owner` key round-trips untouched.
