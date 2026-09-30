---
name: dj-create-new-model
description: >-
  Create a DJ .model.json file for a new dbt model. Use when the user wants to
  create, add, or scaffold a dbt model -- staging, intermediate, or mart --
  including joins, CTEs, rollup, subqueries, or aggregations. Not for Python ETL
  (-> dj-create-python-model), converting existing SQL text (->
  dj-convert-sql-to-model), or registering a raw table as a source (->
  dj-create-source).
compatibility: DJ (Data JSON) Framework extension workspace with .dj/schemas/ and .agents/dj/AGENTS.md
metadata:
  dj-skill: '1.0'
---

# Create DJ model

**Create** new **`.model.json`** files. **Never** hand-edit auto-generated **`.sql`** / **`.yml`** — only the JSON sources of truth. (Registering a raw table as a **`.source.json`** → **`dj-create-source`**; this skill reads sources but delegates their creation.)

**Execution safety:** authoring mutates **`.model.json` only** — never warehouse writes from this skill. **`dbt.run`** and destructive SQL are out of scope (use **`dj-run-dbt`** only when the user explicitly asks to run). Read-only inspection via DJ CLI is allowed when the bridge is up: `query.execute` (bounded `SELECT` on upstream sources), `model.query` (preview), `model.compiled-sql`, `model.lineage`, and **`dbt.compile`** (compile only). Follow **Command & Query Execution Safety** in **`.agents/dj/AGENTS.md`**: confirm catalog/schema, never target production.

**Reading order:** **`.dj/schemas/`** (type schema + `$ref`s) for exact field shapes → **`.agents/dj/reference/model-types.md`**: the **Model Types** worked example for your type, then its **Advanced** map (CTEs, rollup, shorthands, subqueries, materialization, `"dims"`) → this skill's **Important Conventions** + **Gotchas** for the framework rules the schema can't express.

## When this skill applies

Author **SQL** `.model.json` files (staging / intermediate / mart) that read from existing models and sources.

**Out of scope** — delegate to a sibling skill:

- Python ETL / ingestion (`.python.json`, `.python.py`) → `dj-create-python-model`. **This skill never writes Python models.**
- Formalizing an existing SQL query into a model → `dj-convert-sql-to-model`.
- Registering a raw Trino table as a source (`.source.json`) → `dj-create-source`.
- Reviewing / modernizing / refactoring an existing `.model.json` → `dj-review-and-refactor-model`.
- Authoring or editing Lightdash chart/dashboard YAML → `dj-create-lightdash-yaml` / `dj-edit-lightdash-yaml`.

## Model `type` (infer — do not ask the user)

| Layer    | Intent → `type`                                                                                                                                    |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **stg**  | raw source → `stg_select_source`; seed/model → `stg_select_model`; union sources → `stg_union_sources`                                             |
| **int**  | one model → `int_select_model`; joins → `int_join_models`; unnest → `int_join_column`; lookback → `int_lookback_model`; union → `int_union_models` |
| **mart** | one model → `mart_select_model`; joins → `mart_join_models`                                                                                        |

**Rollup:** optional **`from.rollup`** (a sibling of `from.model` — not nested under it) on **`int_select_model`** / **`int_join_models`** — a coarser time **`interval`** with **`agg`/`aggs`** re-aggregated for the new grain. See `model.from.rollup.schema.json` and `.agents/dj/reference/model-types.md` (**Advanced**).

One clarifying question if source vs existing model is unclear.

**BI / dashboard intent → mart.** When the user wants a model for BI, a Lightdash explore/dashboard, metrics, or "something to chart", default to a **mart** (`mart_select_model` for one upstream, `mart_join_models` for several) and follow [references/mart-lightdash-recipes.md](references/mart-lightdash-recipes.md). Marts are the layer that surfaces to Lightdash — don't expose staging/intermediate directly. After create, **`model.lineage`** (DJ CLI) helps hand off to **`dj-create-lightdash-yaml`**.

## Inputs & placement

**Fields:** `type`, `group`, `topic`, `name`. All four are `required` in every type schema **except** `topic`, which `int_join_models` omits from `required` (still set it in practice). Ask for any the user didn't give; mirror the naming of existing models in the project.

- **`group`** must be a **registered** group. dbt registers groups in any `.yml` under a top-level `groups:` key (commonly `models/_groups.yml` or `models/groups.yml`, or per-folder `group_*.yml`) and assigns models via the `group` config or `dbt_project.yml` `+group:` — there is no single fixed path, so scan the project's `.yml` files for `groups:` definitions (and sibling models' `group` values) for the valid set. If the requested group isn't registered, ask the user to pick a registered one or register a new one (via `dj-initialize`); never invent a group or create an unregistered folder.
- **`topic`** and **`name`** are free identifiers (e.g. `topic: aws_cur`, `name: accounts_billing_daily`) — follow sibling models' conventions.

**Path (framework-derived — never chosen):** `models/<layer>/<group>/<topic>/<layer>__<group>__<topic>__<name>.model.json`, where `<layer>` comes from the `type` prefix (`stg_*`→`staging`, `int_*`→`intermediate`, `mart_*`→`mart`). DJ writes and relocates the file from `type` + `group` + `topic` + `name`; do not place files in arbitrary folders or rename on disk (AGENTS.md **Structural Governance**). Rename a model by editing those JSON fields, never the filename.

**Locate the project first:** the dbt project may be nested, not the workspace root — find its `dbt_project.yml` and treat `models/...` paths as relative to that directory (`.dj/schemas/` lives at the DJ/workspace root, which can differ). **If more than one dbt project exists, ask which to target — do not silently pick a default.** Prefer a project named in `dj.dbtProjectNames` only after confirming it is the one they mean.

## Workflow

1. **Determine `type`** from the decision table above (one clarifying question only if source-vs-model is ambiguous).
2. **Gather inputs** — `group`, `topic`, `name`, and type-specific fields.
3. **Read the schema** at `.dj/schemas/model.type.<type>.schema.json` for required/optional fields, following `$ref`s. For CTEs / subqueries / `from.rollup` / hooks / `agg` / materialization also read `model.cte`, `model.subquery`, `model.from.rollup`, `model.sql_hooks`, `model.materialization`, `model.select.*.with.agg` as needed.
4. **Read `.agents/dj/reference/model-types.md`** — the **Model Types** example for your `type`, plus its **Advanced** map if using CTEs / rollup / shorthands / subqueries.
5. **Verify upstream** (trace `ctes` too). When `.dj/bin/dj system.ping` succeeds, follow **DJ CLI → Phase 1** below first. If the bridge is down, read each `from` reference's `.model.json` / `.source.json`. If a reference doesn't exist yet, see **Missing upstream?** — do not invent columns.
6. **Write the model** — **`model.create`** via DJ CLI when the bridge is up; otherwise write **`.model.json`** at the derived path in **JSONC** (comments and trailing commas allowed; preserve existing comments).
7. **Verify** — DJ CLI **Phase 4** when available (`dbt.compile`, `model.compiled-sql`, `model.query`, `model.lineage`); otherwise the editor's bound schema and DJ on-save diagnostics (Problems tab). Do not assume standalone validators (`jsonschema`, `pyyaml`, `pip`) are installed (see [references/mart-lightdash-recipes.md](references/mart-lightdash-recipes.md) §4).

## DJ CLI (preferred when DJ is running)

Invocation patterns → **`dj-cli`**. Skill/op routing → **`dj-cli-registry`**. **`model.create`** uses a **flat** model body; **`model.preview`** and **`model.exists`** use a **wrapped** `{ "modelJson": { … } }` envelope (see **`dj-cli`**). Prefer `--file` for payloads. **`projectName`** is optional when the workspace has a single dbt project (inferred).

**Fallback:** If `.dj/bin/dj` is absent or exits `3`, use workflow steps 5–7 with file reads/writes and run **`model.sync`** once the bridge is available (or ask the user to run **`DJ: Sync to SQL and YML`**).

### Phase 0 — Bootstrap

Run `.dj/bin/dj system.ping` before any other op.

### Phase 1 — Discover (workflow step 5) — mandatory before grep

After **`system.ping`**, run **both** (even when you think you know the model name):

1. **`dbt.models.search`** — e.g. `--file examples/dbt-models-search.request.json` with `pattern`, `topic`, `group`, or `fromModel`.
2. **`lightdash.assets`** — e.g. `{ "query": "wpc" }` to avoid duplicate explore titles.

Only if both return nothing useful (or bridge down) may you use a narrow `*.model.json` glob — not repo-wide `grep` / `**/*`.

- **`dbt.projects`** — target project (infer when only one exists).
- **`dbt.sources`** / **`dbt.models`** — valid `from.source` / `from.model` names.
- **`dbt.models.search`** — filter by `pattern`, `topic`, `group`, `tags`, `fromModel`, `requireLightdashExploreTag` (returns path, materialization, Lightdash label). Prefer over repo grep.
- **`lightdash.assets`** — optional `{ "query": "wpc" }` to avoid duplicating explore titles.
- **`model.get`** / **`model.columns`** / **`model.similar`** — read an existing model, upstream column list, or peers with the same `from.model`.
- **`workflow.scaffold-explore`** — suggested int/mart names when adding a Lightdash explore from one upstream model.
- **Raw table not registered?** Chain **`trino.catalogs`** → **`trino.schemas`** → **`trino.tables`** → **`trino.columns`**, then delegate to **`dj-create-source`** (`source.create`). After source creation, user **`DJ: Sync to SQL and YML`** and/or **`dbt.parse`** via **`dj-run-dbt`** before the source appears in manifest.
- **Upstream is an existing model?** Prefer **`model.lineage`** (CLI defaults to full chain to sources) and **`model.compiled-sql`** over grepping generated `.sql`.
- **Optional (raw data spot-check):** **`query.execute`** with a bounded `SELECT` on the upstream source table only — AGENTS.md read-only rules.

### Phase 2 — Draft (before write)

1. Build a **flat** draft model object (`type`, `group`, `topic`, `name`, …).
2. **`model.preview --file <preview.json>`** — wrap the draft in `{ "modelJson": { … } }` or pass the same flat JSON as `model.create`; inspect SQL / YAML / columns and **`lightdash`** metric diagnostics; iterate. Validation errors fail the op (no placeholder SQL).
3. Alternatively **`model.create`** with **`"validateOnly": true`** (same checks, no write).
4. **`model.exists --file <exists.json>`** — identity-only wrap: `{ "modelJson": { "type", "group", "topic", "name" } }` (see `examples/model-exists.request.json`).

Example **flat** body for **`model.create`** (`create.json`):

```json
{
  "type": "stg_select_source",
  "group": "core",
  "topic": "sales",
  "name": "customers",
  "from": { "source": "raw__public.customers" },
  "select": [{ "name": "id", "type": "dim" }, { "name": "name" }]
}
```

Example **`model.exists`** envelope (`exists.json`):

```json
{
  "modelJson": {
    "type": "stg_select_source",
    "group": "core",
    "topic": "sales",
    "name": "customers"
  }
}
```

### Phase 3 — Create (workflow step 6)

**`model.create --file examples/model-create.request.json`** (flat body) — report path and `synced`. Large projects: **`--timeout 600000`**. For int + mart pairs prefer **`model.create-batch`** with `{ "models": [ … ] }` (one sync at the end; same timeout).

### Phase 4 — Post-create inspect (workflow step 7; recommended)

Use **`--file examples/…`** for each op. After sync (automatic on create, or **`model.sync`**):

1. **`dbt.modified-models`** — scope compile/data checks to branch changes (see **`dj-pr-preflight`**).
2. **`dbt.parse`** when the manifest must register a new node (large projects: `--timeout 600000`).
3. **`model.compiled-sql`** or disk `.sql` under `models/` after **`model.sync`** — not from `dbt.compile` alone.
4. **`dbt.compile`** with `{ "modelName": "…" }` or `{ "select": "mart__a int__b" }` — waits for dbt exit; populates `target/compiled` only.
5. **`model.query`** runs **compiled SQL** via Trino (works for ephemeral/view); use **`schemaColumns`** to compare to manifest. For deployed table fleet checks use **`query.execute`** or **`model.data-check`** templates after **`dbt.run`**.
6. **`model.lineage`** — CLI defaults to full upstream chain to sources; check `lightdashTableLabel` on the current node.

Do **not** call **`dbt.run`** from this skill unless the user explicitly requests a warehouse run — use **`dj-run-dbt`**.

## Missing upstream? Build the chain first

- **If an upstream layer is missing, do not invent its columns.** Offer to build the missing layers **upstream-first** — source → staging → intermediate → mart — and confirm scope with the user before creating anything. Build only the layers the requested model actually needs; skip a layer that adds no transformation (a mart can read a staging model directly when no intermediate logic is required). **A missing raw source (`.source.json`) is created via the `dj-create-source` skill** (or the `DJ: Create Source` webview / `source.create` on the CLI) — it introspects the exact Trino data types with `SHOW COLUMNS`; never hand-author a source's `data_type`s. After `source.create`, user **Sync** and optional **`dbt.parse`** (`dj-run-dbt`) before a downstream `from.source` resolves.
- **Refresh the manifest before building the downstream.** A newly created `.source.json` or upstream `.model.json` is not resolvable by a downstream model until the dbt manifest registers it. After creating an upstream, run **`model.sync`** (or rely on auto-sync after **`model.create`**) so disk `.sql`/`.yml` exist, then **`dbt.parse`** when the manifest still lacks the node (`dj dbt.parse --timeout 600000` on large projects). `DJ: Refresh Projects` only re-reads project config and reloads the on-disk manifest; it does not run `dbt parse`.

## Important Conventions

- Never edit generated `.sql` or `.yml` files -- only edit `.model.json`
- Use JSONC format: trailing commas are allowed, preserve any existing comments
- Source references use `<database>__<schema>.<table>` format (double underscore, then dot)
- Column types are `dim` (dimension) or `fct` (fact/measure), default is `dim`
- When using `agg`, always include `"group_by": "dims"` (or `[{ "type": "dims" }]`)
- `"dims"` shorthand: `group_by: "dims"` groups by all dimension columns; join `on: "dims"` auto-joins on all shared dimension columns
- **Materialization & incremental strategies** — string `"incremental"` / `"ephemeral"` or the structured form; five incremental strategies with storage-format constraints; the Iceberg-vs-Delta/Hive partitioning-keyword switch. See `.agents/dj/reference/materialization.md`, `model.materialization.schema.json`, and `model.incremental_strategy.schema.json`
- **Inline CTEs** — use the `ctes` array on `int_select_model`, `int_join_models`, `int_union_models`, `mart_select_model`, `mart_join_models` (bulk selects support `exclude`/`include`). For the CTE-vs-new-model decision see [references/cte-authoring.md](references/cte-authoring.md); for the mechanics, gotchas, and `datetime` / `portal_partition_*` / `portal_source_count` / `from.rollup` behavior inside CTEs see `.agents/dj/reference/ctes-and-subqueries.md` and `model.cte.schema.json`
- `int_select_model` and `int_join_models` support `from.rollup` for time-grain re-aggregation without a separate `int_rollup_model`. See `.agents/dj/reference/model-types.md` (**Advanced**) and `model.from.rollup.schema.json`
- WHERE, HAVING, and JOIN ON conditions support inline subqueries via the `subquery` key. See `.agents/dj/reference/ctes-and-subqueries.md` and `model.subquery.schema.json`
- Source freshness can be disabled with `"freshness": null` at source or table level
- Free-form `meta` keys are allowed at both model and column level on `.model.json` (e.g., `owner`, `pii`, `compliance`). See `.agents/dj/reference/meta-and-governance.md`, `model.meta.schema.json`, `column.meta.schema.json`
- **Governance metadata is optional — offer it, never require it.** After the model shape is settled, offer to tag governance keys (`owner`, `owner_slack`, `pii`, `classification`, `compliance`, `freshness_sla`) per `.agents/dj/reference/meta-and-governance.md` (**Governance metadata conventions**). First scan sibling models and offer the keys the project actually uses. If the user skips, write nothing (no placeholders) and do not re-ask. Teams that want these mandatory enforce it themselves.
- For Lightdash column config, author `select[i].lightdash.dimension`, `.metrics`, `.metrics_merge`, `.case_sensitive` — not `meta.dimension` etc. The framework surfaces a Warning-severity diagnostic in the Problems tab if authored under `meta`
- **Marts that back a Lightdash explore/dashboard** — for a default time window (`lightdash.table.required_filters`), a summable metric on a `mart_select_model` passthrough, the right framework-column exclude flag, and how validation works, see [references/mart-lightdash-recipes.md](references/mart-lightdash-recipes.md)

## Gotchas

CTE / framework-column / partition / `from.rollup` gotchas are in `.agents/dj/reference/ctes-and-subqueries.md`; materialization / storage gotchas are in `.agents/dj/reference/materialization.md`. The high-frequency ones:

- Subquery `column` is required for all operators except `exists`/`not_exists`
- CTEs must be ordered: a CTE can only reference CTEs defined **before** it in the `ctes` array
- **Un-aggregated `fct` + main-model `group_by` is an error** — every `fct` in the main `select` must set `agg` / `aggs`, wrap an aggregate in `expr` (`sum(x)`, `avg(x)`, `merge(cast(x as hyperloglog))`, `cast(tdigest_agg(x) as varbinary)`, `any_value(x)`, …), or `exclude_from_group_by: true`. Applies to scalar selects, CTE scalar refs, and bulk `all_from_cte` / `fcts_from_cte` carriers.
- Cross joins have no `on` property -- do not include `on: {}` or `on: null`
- Subquery `from` can reference a model, source, or CTE -- use `{ "cte": "name" }` for CTEs defined in the same model
- `topic` is not in `required` for `int_join_models` (it is for all other types) -- still set it in practice
- `mart_select_model` and `int_union_models` do not support `agg`/`aggs` in select items -- use only passthrough or expression columns
- **`meta` is free-form but has a few reserved keys**. Column `type`, `dimension`, `metrics`, `case_sensitive`, `origin` and model `metrics`, `local_tags`, `case_sensitive`, and any key on `lightdash.table` are framework-owned — author via the structured sibling field (`type`, `lightdash.*`, `tags: [{ type: "local", tag }]`, etc.). Collisions trigger Warning diagnostics in the Problems tab

## References

- [references/mart-lightdash-recipes.md](references/mart-lightdash-recipes.md) — recipes for marts that back a Lightdash explore: default time window via `lightdash.table.required_filters`, a summable metric on a `mart_select_model` passthrough, the right framework-column exclude flag, and how validation works.
