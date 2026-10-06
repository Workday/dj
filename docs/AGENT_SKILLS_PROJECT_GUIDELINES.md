# Agent skills — project defaults

DJ ships **generic** agent skills under `.agents/skills/dj-*`. Those folders are refreshed on **`DJ: Refresh Projects`** and must not hold organization-specific catalog names, DAG ids, or migration rules.

Project-specific values live in a **project-owned layer** that DJ never overwrites.

## What lives where

| Layer | Location | DJ Refresh |
| ----- | -------- | ---------- |
| Generic workflows | `templates/skills/dj-*` → `.agents/skills/dj-*` | Overwrites |
| Framework hub | `templates/_agents-dj` → `.agents/dj/` | Overwrites |
| **Project defaults** | `.agents/project/skills/<skill-name>/project-defaults.md` | **Never touched** |
| Copy-paste starters (DJ repo only) | `templates/_agents-project/skills/*/project-defaults.example.md` | Not deployed |
| CLI binary | `.dj/bin/dj` | Redeployed on activation |

Some repos also commit **project-only** skills (for example custom `dbt-*` skills) under `.agents/skills/` — those are unrelated to DJ's `dj-*` templates.

## Agent precedence

When working in a DJ-enabled workspace:

1. **Project defaults** — read `project-defaults.md` for the active skill (Step 0 in python-model skills). Migrate/review skills also read create defaults for shared catalog/schema.
2. **DJ CLI** — when `.dj/bin/dj system.ping` succeeds, prefer listed bridge operations over hand-authoring JSON, grepping for columns, or raw `trino-cli` / `dbt` (see `dj-cli` and `dj-cli-registry` skills).
3. **Generic skill workflow** — follow deployed `SKILL.md` steps.
4. **Fallback** — `.dj/schemas/`, manifest, and raw CLI per `.agents/dj/AGENTS.md` safety rules.

Defaults answer **what values** to use; the CLI answers **how to discover and create** without guessing when the extension is running.

## Rule: do not fork `dj-*` skills

Do **not** copy or edit `.agents/skills/dj-*/SKILL.md` to bake in org defaults. Forked skills are lost on the next refresh and drift from DJ fixes.

Instead:

1. Add or update `.agents/project/skills/<skill-name>/project-defaults.md`.
2. Let each `dj-*` skill's **Step 0** point the agent at that file before proposing catalogs, schemas, or migration behavior.

## Path convention

One defaults file per DJ python-model skill:

```text
.agents/project/skills/dj-create-python-model/project-defaults.md
.agents/project/skills/dj-review-python-model/project-defaults.md
.agents/project/skills/dj-migrate-notebook-to-pymodel/project-defaults.md
```

Optional **sibling** files in the same folder (no `references/` subfolder under project skills), for example:

```text
.agents/project/skills/dj-migrate-notebook-to-pymodel/trino-dialect-cheatsheet.md
```

Link siblings from `project-defaults.md` so agents load them when needed ([progressive disclosure](https://agentskills.io/specification)).

## Cross-skill sharing

Put **canonical** catalog, schema, authoring mode, source registration path, and helper APIs in:

`.agents/project/skills/dj-create-python-model/project-defaults.md`

`dj-review-python-model` and `dj-migrate-notebook-to-pymodel` defaults should reference that file for shared values instead of duplicating them.

## Git

- **Commit** `.agents/project/` in your dbt project repo so every developer and agent sees the same defaults.
- Contrast with `.dj/` — often gitignored or machine-local; project defaults are intentional shared config.

## Getting started

Copy the examples from the DJ extension repo:

`templates/_agents-project/skills/<skill-name>/project-defaults.example.md`

Rename to `project-defaults.md` under `.agents/project/skills/<skill-name>/` in your workspace and fill in values.

See also [Agent Skills](AGENT_SKILLS.md) for enabling skills and the skill catalog.
