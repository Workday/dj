# DJ CLI command catalog

Run `.dj/bin/dj system.capabilities` for the **authoritative** live list. This file is an offline quick-ref (~40 operations).

Run `.dj/bin/dj system.capabilities` for the live operation list with `sideEffect` tags. Per-op syntax: `.dj/bin/dj <op> --help` or `docs/cli_commands/command-reference.md` (**Agent example** column).

**Agents:** prefer `--file examples/…` over inline `--json` for all ops **except** flat-body **`model.create`**, envelope/flat **`model.preview`**, and flat **`source.create`** (still `--file`, not flags-first). Run **`dj <op> --help`** for JSON invoke help. Flags merge into the payload: `--modelName`, `--projectName`, `--select`, `--sql`, `--depth` (flags override file fields).

**Flat JSON** for `model.create` and `source.create` only. **`model.preview` / `model.exists` / `model.update` / `model.cte-analysis`** use **`modelJson`** (preview also accepts flat create body). **`model.update`** requires **`modelJson`** plus **`originalModelPath`** or **`modelName`**. `projectName` is optional when the workspace has a single dbt project.

**Long runs:** `model.create`, `model.create-batch`, `dbt.parse` default to **600s** CLI timeout unless you pass `--timeout`.

**Disk SQL/YML vs dbt compile:** `model.sync` writes workspace `.sql`/`.yml`. `dbt.compile` only populates `target/compiled`.

---

## System (4)

| Op | sideEffect | Required fields | Agent example |
|----|------------|-----------------|---------------|
| `system.ping` | read | — | `.dj/bin/dj system.ping` |
| `system.capabilities` | read | — | `.dj/bin/dj system.capabilities` |
| `system.help` | read | optional `operation` | `.dj/bin/dj model.lineage --help` or `.dj/bin/dj system.help` |

---

## Read — dbt & discovery (12)

| Op | sideEffect | Required fields | Example |
|----|------------|-----------------|--------|
| `dbt.projects` | read | — | `{}` |
| `dbt.models` | read | — | `{ "projectName": "my_project" }` |
| `dbt.models.search` | read | — | `examples/dbt-models-search.request.json` |
| `dbt.sources` | read | — | `{}` |
| `dbt.modified-models` | read | — | `{ "projectName": "my_project" }` |
| `dbt.compiled-status` | read | `modelName` | `--modelName stg__…` or JSON |
| `dbt.model-outdated` | read | `modelName` | `{ "modelName": "stg__…" }` |
| `model.get` | read | `modelName` | `{ "modelName": "int__…" }` |
| `model.columns` | read | `modelName` | `examples/model-columns.request.json` |
| `model.similar` | read | anchors | `{ "fromModel": "int__…", "projectName": "my_project" }` |
| `lightdash.assets` | read | — | `{ "query": "wpc" }` optional |
| `workflow.scaffold-explore` | read | `upstreamModelName` | `{ "upstreamModelName": "int__…" }` |

---

## Read — Trino (4)

| Op | sideEffect | Required fields | Example |
|----|------------|-----------------|--------|
| `trino.catalogs` | read | — | `{}` |
| `trino.schemas` | read | `catalog` | `{ "catalog": "my_catalog" }` |
| `trino.tables` | read | `catalog`, `schema` | `{ "catalog": "…", "schema": "…" }` |
| `trino.columns` | read | `catalog`, `schema`, `table` | `{ "catalog": "…", "schema": "…", "table": "…" }` |

---

## Authoring (8)

| Op | sideEffect | Required fields | Example |
|----|------------|-----------------|--------|
| `model.create` | mutate | flat model fields | `examples/model-create.request.json` — auto-sync |
| `model.create-batch` | mutate | `{ "models": [ … ] }` | two models, one sync |
| `model.sync` | mutate | — or `modelName` | `{ "modelName": "…" }` |
| `source.create` | mutate | Trino table identity | catalog example in skill |
| `model.update` | mutate | `modelJson` + path or `modelName` | `examples/model-update.request.json` |
| `model.preview` | read | `modelJson` | `examples/model-preview.request.json` |
| `model.exists` | read | `modelJson` identity | `examples/model-exists.request.json` |
| `model.cte-analysis` | read | `modelJson` | wrapped model JSON |

---

## Mutate — dbt (5)

| Op | sideEffect | Required fields | Example |
|----|------------|-----------------|--------|
| `dbt.compile` | mutate | `modelName` **or** `select` | `examples/dbt-compile.request.json` or `--select "a b"` |
| `dbt.compile-select` | mutate | `select` | `{ "select": "mart__a int__b" }` |
| `dbt.compile-logs` | mutate | `modelName` or `select` | same as compile |
| `dbt.parse` | mutate | — | `{ "projectName": "my_project" }` |
| `dbt.run` | mutate | run config | `examples/dbt-run.request.json` — **user Yes/No first** |

**Compile note:** do not use `modelNames` array — use `"select": "m1 m2"` or a single `modelName`.

---

## Query & data read (7)

| Op | sideEffect | Required fields | Example |
|----|------------|-----------------|--------|
| `model.compiled-sql` | read | `modelName` | `--file examples/model-lineage.request.json` |
| `model.query` | read | `modelName` | `examples/model-query.request.json` |
| `model.lineage` | read | `modelName` | `examples/model-lineage.request.json` (CLI default `depth: -1`) |
| `model.data-check` | read | `modelName`, `template` | `{ "modelName": "…", "template": "stranded_capacity" }` |
| `model.reverse-lineage` | read | `kind`, `slug` | `{ "kind": "chart", "slug": "…" }` |
| `query.execute` | read | `sql` | `examples/query-execute.request.json` or `--sql 'SELECT 1'` |

Repo examples: [`examples/`](../../../../examples/).
