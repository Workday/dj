# Tooling and agents

## VS Code / DJ extension

| Feature | What it does |
|---------|----------------|
| JSON Schema | Validation for `*.fragment.json`, `*.template.json`, and composition fields on models |
| Go to definition | Cursor on a fragment or template **name** in `.model.json` → open shared file |
| CodeLens | Top of shared file: “Used by N models” |
| **DJ: Preview Resolved Model JSON** | Editor menu on `.model.json` → merged JSON in a side tab |
| Problems tab | Composition and schema errors; clears when fixed |

## Model wizard

| Step | Fragments / templates |
|------|------------------------|
| Basic Information | Optional **Template** picker + `with` parameter fields |
| Additional Fields | **Config fragments** multi-select when the project defines `kind: "config"` fragments |
| Data Modeling | **Add from fragment** on the column panel (`*_from_fragment`) |

Editing a template **child** loads the merged model; save writes a minimal child file when you use the normal update flow.

## CLI (`.dj/bin/dj` when the extension is active)

| Operation | Use |
|-----------|-----|
| `fragment.list` / `fragment.get` | Discover fragments; `get` includes `usedBy` model names |
| `template.list` / `template.get` | Templates and parameter names |
| `model.get` | Returns **`raw`** (file) and **`resolved`** (for SQL/YAML) |

See [command catalog](../../templates/skills/dj-cli/references/command-catalog.md).

## AI agents

| Resource | Role |
|----------|------|
| [This guide](../README.md) | Full examples and refactor recipes |
| `.agents/dj/reference/fragments-and-templates.md` | Lean reference deployed into your dbt project when `dj.codingAgent` is on |
| [`dj-extract-shared-fragments`](../../templates/skills/dj-extract-shared-fragments/_SKILL.md) | Skill: extract duplicate columns/config into fragments |
| [`dj-cli`](../../templates/skills/dj-cli/SKILL.md) | Prefer CLI discovery before repo-wide search |

**Agent workflow:** `fragment.list` → `model.get` on a target model → edit JSONC → `model.sync` or extension sync → confirm `resolved` unchanged after refactors.

## Copy-paste fixtures

[examples/fragments-and-templates](../../examples/fragments-and-templates/README.md) — FinOps billing bundle aligned with unit tests.

## Live project demo

[Jaffle Shop Lightdash](../../examples/jaffle_shop_lightdash/README.md#fragments--templates-in-this-project) — fragments and template used in the tutorial tree.
