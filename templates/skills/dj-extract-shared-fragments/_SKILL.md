---
name: dj-extract-shared-fragments
description: Extract repeated select columns or model config from existing .model.json files into shared *.fragment.json files and wire *_from_fragment / root fragments references.
---

# Extract shared fragments

Use when several models duplicate the same `select` columns or the same materialization/tags/meta block.

## Workflow

1. **Discover duplicates** — Compare `select` arrays and config blocks across models (DJ CLI `model.get` / repo search). Prefer extracting stable, team-owned shapes.
2. **Create `*.fragment.json`** — `kind: "select"` for columns; `kind: "config"` for shared model config. Place next to related models; name without extension (e.g. `focus_cost_columns.fragment.json` → name `focus_cost_columns`).
3. **Replace in models** — Use `{ "type": "all_from_fragment", "fragment": "<name>" }` (or dims/fcts variants) and/or root `"fragments": ["<config_fragment>"]`.
4. **Sync** — Run **DJ: Sync to SQL and YML** (or `dj sync`). Fix composition diagnostics in the Problems tab.
5. **Verify** — `model.get` should show the same `resolved` shape as before extraction; on-disk JSON stays authored (raw), not flattened.

## Guardrails

- Do not edit generated `.sql` / `.yml`.
- Preserve JSONC comments when rewriting `.model.json`.
- One fragment per cohesive concern (columns vs config), not mega-files.

## Reference

Field semantics, merge rules, and CLI workflow: `.agents/dj/reference/fragments-and-templates.md`.
