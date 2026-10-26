# DJ CLI command catalog

Run `.dj/bin/dj system.capabilities` for the **authoritative** live list. This file is an offline quick-ref (~40 operations).

Run `.dj/bin/dj system.capabilities` for the live operation list with `sideEffect` tags. Per-op syntax: `.dj/bin/dj <op> --help` or `docs/cli_commands/command-reference.md` (**Agent example** column).

**Agents:** prefer `--file examples/…` over inline `--json` for all ops **except** flat-body **`model.create`**, envelope/flat **`model.preview`**, and flat **`source.create`** (still `--file`, not flags-first). Run **`dj <op> --help`** for JSON invoke help. Flags merge into the payload: `--modelName`, `--projectName`, `--select`, `--sql`, `--depth` (flags override file fields).

**JSON in the tables below** is the **whole** CLI payload for `--file` / `--json` / stdin — top-level fields only (e.g. `projectName`, `modelName`). The bridge adds the internal `type` and `request` wrapper; **never** pass webview/API envelopes such as `{ "type": "framework-fragment-list", "request": { … } }`. Prefer flags when an op supports them: `.dj/bin/dj fragment.list --projectName my_project`.

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

## Read — dbt & discovery

| Op | sideEffect | Required fields | Agent example |
|----|------------|-----------------|---------------|
| `dbt.projects` | read | — | `.dj/bin/dj dbt.projects` (add `--projectName` only when multiple dbt projects) |
| `dbt.models` | read | — | `.dj/bin/dj dbt.models --projectName my_project` |
| `dbt.models.search` | read | — | `.dj/bin/dj dbt.models.search --file examples/dbt-models-search.request.json` |
| `dbt.sources` | read | — | `.dj/bin/dj dbt.sources` |
| `dbt.modified-models` | read | — | `.dj/bin/dj dbt.modified-models --projectName my_project` |
| `dbt.compiled-status` | read | `modelName` | `.dj/bin/dj dbt.compiled-status --modelName stg__g__t__name --projectName my_project` |
| `dbt.model-outdated` | read | `modelName` | `.dj/bin/dj dbt.model-outdated --modelName stg__g__t__name --projectName my_project` |
| `model.get` | read | `modelName` | `.dj/bin/dj model.get --modelName int__g__t__name --projectName my_project` (`raw` + `resolved`) |
| `fragment.list` | read | — | `.dj/bin/dj fragment.list --projectName my_project` |
| `fragment.get` | read | `name` | `.dj/bin/dj fragment.get --name focus_cost_columns --projectName my_project` |
| `template.list` | read | — | `.dj/bin/dj template.list --projectName my_project` |
| `template.get` | read | `name` | `.dj/bin/dj template.get --name focus_monthly_cost --projectName my_project` |
| `model.columns` | read | `modelName` | `.dj/bin/dj model.columns --file examples/model-columns.request.json` |
| `model.similar` | read | anchors | `.dj/bin/dj model.similar --modelName int__g__t__name --projectName my_project` |
| `lightdash.assets` | read | — | `.dj/bin/dj lightdash.assets --file examples/lightdash-assets.request.json` |
| `workflow.scaffold-explore` | read | `upstreamModelName` | `.dj/bin/dj workflow.scaffold-explore --file examples/workflow-scaffold-explore.request.json` |

---

## Read — Trino (4)

| Op | sideEffect | Required fields | Agent example |
|----|------------|-----------------|---------------|
| `trino.catalogs` | read | — | `.dj/bin/dj trino.catalogs` |
| `trino.schemas` | read | `catalog` | `.dj/bin/dj trino.schemas --file examples/trino-schemas.request.json` |
| `trino.tables` | read | `catalog`, `schema` | `.dj/bin/dj trino.tables --file examples/trino-tables.request.json` |
| `trino.columns` | read | `catalog`, `schema`, `table` | `.dj/bin/dj trino.columns --file examples/trino-columns.request.json` |

---

## Authoring (8)

| Op | sideEffect | Required fields | Agent example |
|----|------------|-----------------|---------------|
| `model.create` | mutate | flat model fields | `.dj/bin/dj model.create --file examples/model-create.request.json` — auto-sync |
| `model.create-batch` | mutate | `{ "models": [ … ] }` | `.dj/bin/dj model.create-batch --file batch.json` |
| `model.sync` | mutate | — or `modelName` | `.dj/bin/dj model.sync --modelName int__g__t__name --projectName my_project` |
| `source.create` | mutate | Trino table identity | `.dj/bin/dj source.create --file examples/source-create.request.json` |
| `model.update` | mutate | `modelJson` + path or `modelName` | `.dj/bin/dj model.update --file examples/model-update.request.json` |
| `model.preview` | read | `modelJson` | `.dj/bin/dj model.preview --file examples/model-preview.request.json` |
| `model.exists` | read | `modelJson` identity | `.dj/bin/dj model.exists --file examples/model-exists.request.json` |
| `model.cte-analysis` | read | `modelJson` | `.dj/bin/dj model.cte-analysis --file examples/model-preview.request.json` |

---

## Mutate — dbt (5)

| Op | sideEffect | Required fields | Agent example |
|----|------------|-----------------|---------------|
| `dbt.compile` | mutate | `modelName` **or** `select` | `.dj/bin/dj dbt.compile --file examples/dbt-compile.request.json` or `--select "mart__a int__b"` |
| `dbt.compile-select` | mutate | `select` | `.dj/bin/dj dbt.compile-select --select "mart__a int__b" --projectName my_project` |
| `dbt.compile-logs` | mutate | `modelName` or `select` | same as `dbt.compile` |
| `dbt.parse` | mutate | — | `.dj/bin/dj dbt.parse --file examples/dbt-project.request.json` |
| `dbt.run` | mutate | run config | `.dj/bin/dj dbt.run --file examples/dbt-run.request.json` — **user Yes/No first** |

**Compile note:** do not use `modelNames` array — use `"select": "m1 m2"` or a single `modelName`.

---

## Query & data read (7)

| Op | sideEffect | Required fields | Agent example |
|----|------------|-----------------|---------------|
| `model.compiled-sql` | read | `modelName` | `.dj/bin/dj model.compiled-sql --modelName int__g__t__name --projectName my_project` |
| `model.query` | read | `modelName` | `.dj/bin/dj model.query --file examples/model-query.request.json` |
| `model.lineage` | read | `modelName` | `.dj/bin/dj model.lineage --file examples/model-lineage.request.json` (default `depth: -1`) |
| `model.data-check` | read | `modelName`, `template` | `.dj/bin/dj model.data-check --modelName mart__g__t__name --file payload.json` (`{"template":"stranded_capacity",…}` in file) |
| `model.reverse-lineage` | read | `kind`, `slug` | `.dj/bin/dj model.reverse-lineage --file payload.json` (`{"kind":"chart","slug":"…"}` in file) |
| `query.execute` | read | `sql` | `.dj/bin/dj query.execute --sql 'SELECT 1'` or `--file examples/query-execute.request.json` |

Repo examples: [`examples/`](../../../../examples/).
