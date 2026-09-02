# DJ CLI command catalog

Run `.dj/bin/dj system.capabilities` for the live list from the running extension. This file is the offline quick-ref (27 operations).

Payloads are **flat JSON** unless noted. `projectName` is optional when the workspace has a single dbt project.

---

## System (2)

| Op | sideEffect | Required fields | Example payload sketch |
|----|------------|-----------------|------------------------|
| `system.ping` | read | — | (no payload) |
| `system.capabilities` | read | — | (no payload) |

---

## Read — dbt (6)

| Op | sideEffect | Required fields | Example payload sketch |
|----|------------|-----------------|------------------------|
| `dbt.projects` | read | — | `{}` or omit |
| `dbt.models` | read | — | `{ "projectName": "opus" }` |
| `dbt.sources` | read | — | `{}` or omit |
| `dbt.modified-models` | read | — | `{ "projectName": "opus" }` |
| `dbt.compiled-status` | read | `modelName` | `{ "modelName": "stg__grp__topic__name" }` |
| `dbt.model-outdated` | read | `modelName` | `{ "modelName": "stg__grp__topic__name" }` |

---

## Read — Trino (4)

| Op | sideEffect | Required fields | Example payload sketch |
|----|------------|-----------------|------------------------|
| `trino.catalogs` | read | — | `{}` or omit |
| `trino.schemas` | read | `catalog` | `{ "catalog": "opus_raw_dl" }` |
| `trino.tables` | read | `catalog`, `schema` | `{ "catalog": "opus_raw_dl", "schema": "pharos_metrics_views" }` |
| `trino.columns` | read | `catalog`, `schema`, `table` | `{ "catalog": "opus_raw_dl", "schema": "pharos_metrics_views", "table": "node_cpu_hourly_cost_view" }` |

---

## Authoring (6)

| Op | sideEffect | Required fields | Example payload sketch |
|----|------------|-----------------|------------------------|
| `model.create` | mutate | model definition fields | `{ "type": "stg_select_source", "group": "core", "topic": "sales", "name": "customers", "from": { "source": "raw__public.customers" }, "select": ["id", "name"] }` |
| `source.create` | mutate | Trino table identity | `{ "projectName": "opus", "trinoCatalog": "opus_raw_dl", "trinoSchema": "pharos_metrics_views", "trinoTable": "node_cpu_hourly_cost_view" }` |
| `model.update` | mutate | model identity + changes | `{ "modelName": "stg__grp__topic__name", … }` |
| `model.preview` | read | model definition fields | Same shape as `model.create` — returns SQL/YAML/columns without writing |
| `model.exists` | read | model identity | `{ "type": "stg_select_source", "group": "core", "topic": "sales", "name": "customers" }` |
| `model.cte-analysis` | read | model with CTEs | `{ "modelName": "int__grp__topic__name" }` or full model payload |

---

## Mutate — dbt (4)

| Op | sideEffect | Required fields | Example payload sketch |
|----|------------|-----------------|------------------------|
| `dbt.compile` | mutate | `modelName` | `{ "modelName": "stg__grp__topic__name" }` |
| `dbt.compile-logs` | mutate | `modelName` | `{ "modelName": "stg__grp__topic__name" }` |
| `dbt.parse` | mutate | — | `{ "projectName": "opus" }` |
| `dbt.run` | mutate | run config | `{ "modelName": "stg__grp__topic__name" }` or `{ "config": { … } }` — **warehouse write; confirm with user** |

---

## Query & data read (5)

| Op | sideEffect | Required fields | Example payload sketch |
|----|------------|-----------------|------------------------|
| `model.compiled-sql` | read | `modelName` | `{ "modelName": "stg__grp__topic__name" }` |
| `model.query` | read | `modelName` | `{ "modelName": "stg__grp__topic__name" }` |
| `model.lineage` | read | `modelName` | `{ "modelName": "stg__grp__topic__name" }` |
| `model.reverse-lineage` | read | `kind`, `slug` | `{ "kind": "chart", "slug": "my-chart" }` |
| `query.execute` | read | `sql` | `{ "sql": "SELECT 1", "limit": 10 }` — read-only SELECT only |
