# DJ skills index

All DJ agent skills deployed to `.agents/skills/` when `dj.codingAgent` is enabled. **CLI?** = whether `.dj/bin/dj` ops apply when `system.ping` succeeds.

---

## Skills by domain

### Model authoring (SQL)

| Skill | Trigger intents | Primary CLI ops | CLI? |
|-------|----------------|-----------------|------|
| `dj-create-new-model` | create, scaffold, add staging/intermediate/mart model | `model.create`, `model.preview`, `model.exists`, `trino.columns`, `dbt.models`, `dbt.sources` | Yes |
| `dj-convert-sql-to-model` | formalize existing SQL query as model | `model.preview`, `model.create` | Yes |
| `dj-create-source` | register raw Trino table as `.source.json` | `source.create`, `trino.columns`, `trino.tables` | Yes |
| `dj-review-and-refactor-model` | review, audit, modernize, refactor `.model.json` | `model.preview`, `model.update`, `model.cte-analysis` | Yes |
| `dj-migrate-ephemerals-to-ctes` | inline ephemeral models as CTEs | `model.preview`, `model.update` | Partial |
| `dj-govern-model` | governance audit — ownership, PII, compliance | `dbt.models`, `dbt.sources` (discovery) | Partial |
| `dj-update-ai-hints` | add/update Lightdash AI hints in model/source JSON | — | No |

### Python models

| Skill | Trigger intents | Primary CLI ops | CLI? |
|-------|----------------|-----------------|------|
| `dj-create-python-model` | create Python ETL model, ingestion, API fetch | — | No |
| `dj-review-python-model` | review/audit Python model for production | — | No |
| `dj-migrate-notebook-to-pymodel` | migrate Jupyter notebook to python model | — | No |
| `dj-verify-pymodel-parity` | verify python model output vs legacy table | `query.execute` | Partial |
| `dj-document-pymodels` | generate topic README for python models | — | No |

### Execution & inspection

| Skill | Trigger intents | Primary CLI ops | CLI? |
|-------|----------------|-----------------|------|
| `dj-run-dbt` | compile, parse, run dbt | `dbt.compile`, `dbt.parse`, `dbt.run`, `dbt.compile-logs` | Yes |
| `dj-run-trino` | query Trino, preview rows, inspect schema | `trino.*`, `query.execute` (prefer over raw `trino-cli`) | Yes |
| `dj-trino-analyzer` | diagnose Trino query performance from `.dj/diagnostics/` JSON | — | No |

### Lightdash

| Skill | Trigger intents | Primary CLI ops | CLI? |
|-------|----------------|-----------------|------|
| `dj-create-lightdash-yaml` | create new chart/dashboard YAML from scratch | `model.lineage`, `model.compiled-sql` (discovery) | Partial |
| `dj-edit-lightdash-yaml` | edit existing chart/dashboard YAML | `model.lineage`, `model.compiled-sql` (discovery) | Partial |

### Project setup & git

| Skill | Trigger intents | Primary CLI ops | CLI? |
|-------|----------------|-----------------|------|
| `dj-initialize` | set up DJ in existing dbt project | — | No |
| `dj-git-workflow` | commit, branch, stage DJ work | — | No |
| `dj-resolve-merge-conflicts` | resolve merge/rebase conflicts in DJ files | — | No |

### CLI meta

| Skill | Trigger intents | Primary CLI ops | CLI? |
|-------|----------------|-----------------|------|
| `dj-cli` | invoke `.dj/bin/dj`, CLI patterns, exit codes | `system.ping`, `system.capabilities`, all ops | Yes |
| `dj-cli-registry` | pick skill, route request, find CLI op | `system.capabilities` | Yes |

---

## Reverse index: CLI op → skill(s)

| CLI op | Used by skill(s) |
|--------|------------------|
| `system.ping` | `dj-cli` (bootstrap all skills) |
| `system.capabilities` | `dj-cli`, `dj-cli-registry` |
| `dbt.projects` | `dj-create-new-model` (project discovery) |
| `dbt.models` | `dj-create-new-model`, `dj-govern-model` |
| `dbt.sources` | `dj-create-new-model`, `dj-govern-model` |
| `dbt.modified-models` | `dj-run-dbt` |
| `dbt.compiled-status` | `dj-run-dbt`, `dj-review-and-refactor-model` |
| `dbt.model-outdated` | `dj-run-dbt`, `dj-review-and-refactor-model` |
| `dbt.compile` | `dj-run-dbt`, `dj-convert-sql-to-model` |
| `dbt.compile-logs` | `dj-run-dbt` |
| `dbt.parse` | `dj-run-dbt`, `dj-create-new-model` (manifest refresh) |
| `dbt.run` | `dj-run-dbt` |
| `trino.catalogs` | `dj-create-source`, `dj-run-trino` |
| `trino.schemas` | `dj-create-source`, `dj-run-trino` |
| `trino.tables` | `dj-create-source`, `dj-run-trino` |
| `trino.columns` | `dj-create-new-model`, `dj-create-source`, `dj-run-trino` |
| `model.create` | `dj-create-new-model`, `dj-convert-sql-to-model` |
| `model.update` | `dj-review-and-refactor-model`, `dj-migrate-ephemerals-to-ctes` |
| `model.preview` | `dj-create-new-model`, `dj-convert-sql-to-model`, `dj-review-and-refactor-model`, `dj-migrate-ephemerals-to-ctes` |
| `model.exists` | `dj-create-new-model` |
| `model.cte-analysis` | `dj-review-and-refactor-model` |
| `source.create` | `dj-create-source` |
| `model.compiled-sql` | `dj-create-lightdash-yaml`, `dj-edit-lightdash-yaml` |
| `model.lineage` | `dj-create-lightdash-yaml`, `dj-edit-lightdash-yaml` |
| `model.query` | `dj-run-trino` (model data preview) |
| `model.reverse-lineage` | `dj-create-lightdash-yaml` |
| `query.execute` | `dj-run-trino`, `dj-verify-pymodel-parity` |
