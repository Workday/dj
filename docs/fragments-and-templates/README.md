# Fragments and templates — guide

Reuse column sets and model shapes across your dbt project with **`*.fragment.json`** and **`*.template.json`** files. This guide is for authors working in the DJ repository or reading docs online.

## Table of contents

| # | Topic | What you will learn |
|---|--------|---------------------|
| 1 | [Overview](01-overview.md) | Raw vs resolved models; when to use shared files |
| 2 | [Select fragments](02-select-fragments.md) | Column fragments; `*_from_fragment`; overrides; CTEs |
| 3 | [Config fragments](03-config-fragments.md) | Shared materialization, tags, meta; merge rules |
| 4 | [Templates](04-templates.md) | `extends` / `with`; parameters; child models |
| 5 | [Refactoring](05-refactoring.md) | Extract duplicates; verify with CLI and sync |
| 6 | [Tooling and agents](06-tooling-and-agents.md) | IDE, wizard, CLI, skills |

## Example material

| Resource | Purpose |
|----------|---------|
| [Copy-paste JSON bundle](../../examples/fragments-and-templates/README.md) | FinOps billing walkthrough (fragments + template + models) |
| [Jaffle Shop Lightdash](../../examples/jaffle_shop_lightdash/README.md#fragments--templates-in-this-project) | Fragments and template wired into the tutorial project |

## Related docs

- [Model types](../models/README.md) — the 11 model `type` values fragments and templates still use
- [Staging union sources](../models/02%20-%20stg_union_sources.md) — sharing column lists across union legs

## Coding agents

When `dj.codingAgent` is enabled, DJ deploys a lean reference to `.agents/dj/reference/fragments-and-templates.md` in your dbt project (no `docs/` folder). Human-readable tutorials and copy-paste JSON live only under `docs/` in the DJ extension repository.
