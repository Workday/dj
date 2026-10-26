# Overview

## Problem

Teams repeat the same `select` columns, Lightdash metrics, materialization blocks, and mart shapes in dozens of `.model.json` files. Copy-paste drifts: one model gets a fix, others do not.

## Solution: two shared file types

| File | You define | Models reference it |
|------|------------|---------------------|
| `*.fragment.json` | **Select** columns (`kind: "select"`) or **config** (`kind: "config"`) | `*_from_fragment` in `select`, and/or root `"fragments": ["name"]` |
| `*.template.json` | A reusable model body + `params` | `"extends": "template_name"` and `"with": { ... }` |

Place shared files anywhere under the dbt project; DJ discovers them on sync.

## Raw vs resolved (model composition)

**Authored (raw)** — what you keep in git in `.model.json`:

- Identity: `type`, `group`, `topic`, `name`
- References: `extends`, `with`, `fragments`, `*_from_fragment`
- Your deltas: extra `select` rows, overrides, `select_exclude`, etc.

**Resolved** — what DJ builds in memory for validation, SQL/YAML, lineage, and preview:

- Fragments expanded into normal `select` items and config keys
- Templates merged with child models and `${param}` substitution applied

Sync **never** writes the resolved JSON back to the model file. Generated `.sql` and `.yml` may include a short header comment listing which fragments/templates were used.

We call this merge step **model composition** (or **composition resolution**). User-facing docs usually say **fragments and templates**; composition is the engine term.

```text
  *.fragment.json ──┐
  *.template.json ──┼──► resolve ──► validated resolved model ──► .sql / .yml
  *.model.json  ────┘      (in memory)         (never saved as model.json)
```

## When to use what

| Situation | Prefer |
|-----------|--------|
| Same column definitions on many models (FinOps columns, standard keys) | **Select fragment** |
| Same tags, materialization, or meta on many models | **Config fragment** |
| Same model skeleton with different upstream model or label | **Template** + children |
| One-off model | Plain `.model.json` (no shared files) |

## When not to use shared files

- A single model with unique logic — a fragment adds indirection without benefit.
- Highly volatile columns that change independently per model — overrides help, but a fragment may not pay off.
- Replacing normal dbt `ref()` — templates use `model_ref` params for upstream names; they do not replace the dependency graph.

## Next steps

- [Select fragments](02-select-fragments.md)
- [Config fragments](03-config-fragments.md)
- [Templates](04-templates.md)
