---
name: dj-document-pymodels
description: >-
  Generate or refresh a topic-level README.md documenting every python model
  under a dags/python_models/<group>/<topic>/ folder — model table, data flow,
  business-logic notes, upstream/downstream references, and gotchas. Preserves
  hand-written prose across regenerations. Use when the user wants to
  document, write docs for, or generate a README for a python model topic or
  group. Not for creating or editing the python models themselves (->
  dj-create-python-model), dbt SQL model docs under docs/models/ (that's a
  separate existing convention), or auditing a model's production readiness
  (-> dj-review-python-model).
compatibility: DJ (Data JSON) Framework extension workspace with dags/python_models/
metadata:
  dj-skill: '1.0'
---

# Document Python Model Topic

**Goal:** generate or refresh a human-readable `README.md` for a `dags/python_models/<group>/<topic>/` folder, documenting every python model in that topic — what it does, how data flows through it, and what a future maintainer needs to know. Invoked on demand; not an automated sync feature.

**Scope:** this skill documents the `python_models/<group>/<topic>/` tree specifically. It does not generate or touch `docs/models/*.md` — that's the existing, separate convention for dbt SQL models.

## When this skill applies

Use this skill when the user mentions: document this topic, write a README for this python model group, generate docs for these python models, or update the topic documentation after adding/changing models.

**Out of scope** — delegate to sibling skills:

- Creating or editing the `.python.json` files themselves → **`dj-create-python-model`**
- Migrating a notebook into a new python model (document it once it exists) → **`dj-migrate-notebook-to-pymodel`**
- Auditing a model's production readiness → **`dj-review-python-model`**
- Verifying a model's output data → **`dj-verify-pymodel-parity`**

## Workflow

- [ ] **1. Resolve scope.** Ask which topic folder to document if not already clear: `dags/python_models/<group>/<topic>/`. A "group" may span multiple topics — confirm whether the user wants one topic's README or every topic under a group (one README per topic either way).
- [ ] **2. Scan all `.python.json` files** in the target topic folder. For each, read: `name`, `group`, `topic`, `description`, `dags`, `output` (database/schema/table, write_mode, partition_by), `depends_on`, and any markdown header cells in `cells` for narrative content the author already wrote.
- [ ] **3. Cross-reference lineage.** For upstream references, check each model's `depends_on` and any `.source.json` files it reads from (via SQL `FROM`/`JOIN` in its cells). For downstream references, search other `.python.json` / `.model.json` files in the project for `depends_on` entries or `source` references pointing at this model's output table.
- [ ] **4. Check for an existing README.** If `dags/python_models/<group>/<topic>/README.md` already exists, read it fully first.
  - If it has no `<!-- keep -->` markers, treat the whole file as regeneratable but show the user a diff before overwriting — do not silently replace hand-written prose the author may not have marked.
  - If it has `<!-- keep -->...<!-- /keep -->` blocks, preserve their contents verbatim and only regenerate everything outside them (primarily the model table, which is mechanically derived from the JSON files and should always reflect current state).
- [ ] **5. Draft the README** using the template in [references/topic-readme-template.md](references/topic-readme-template.md): topic purpose paragraph, model table, per-model sections (data flow, business-logic notes, upstream/downstream, gotchas).
  - **Topic purpose:** ask the user for a one-paragraph summary if it can't be reasonably inferred from the models' `description` fields — do not invent a purpose from thin air.
  - **Gotchas:** only include what's actually evidenced in the code/JSON (e.g., a rate-limit comment, a manual credential-rotation note, a known data-quality caveat mentioned in a markdown cell) — do not fabricate operational knowledge that isn't there. If nothing is evidenced, omit the subsection for that model rather than inventing filler.
- [ ] **6. Show the diff and confirm before writing.** Present the draft (or, for a refresh, a diff against the existing file) and get the user's go-ahead before writing to disk.
- [ ] **7. Write the README** to `dags/python_models/<group>/<topic>/README.md` only after confirmation.

## Hard rules (DO NOT)

- **DO NOT** silently overwrite an existing README without showing a diff first.
- **DO NOT** discard content inside `<!-- keep -->...<!-- /keep -->` markers when regenerating.
- **DO NOT** invent business-logic notes, gotchas, or a topic purpose that isn't evidenced in the model JSON, code, or user input — omit the subsection instead of fabricating content.
- **DO NOT** edit any `.python.json` file — this skill only reads them.
- **DO NOT** write to `docs/models/*.md` — that's a separate, existing convention for dbt SQL models.

## Reference

For the full README skeleton (section-by-section) and the `<!-- keep -->` preserve/regenerate convention, see [references/topic-readme-template.md](references/topic-readme-template.md).
