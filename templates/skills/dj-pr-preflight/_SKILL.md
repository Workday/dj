---
name: dj-pr-preflight
description: >-
  Preflight checklist before merging DJ model work: modified models, sync, parse,
  compile, lineage, and data checks via DJ CLI. Use when the user asks to
  validate a branch, PR, or new int/mart explore before merge.
compatibility: DJ (Data JSON) Framework extension workspace with .dj/bin/dj
metadata:
  dj-skill: '1.0'
---

# DJ PR preflight

Run when the user wants **compile + data check + lineage** on changed models without grepping the repo. Use **`--file examples/…`** for every payload (see `dj-cli`).

## Checklist

1. **`.dj/bin/dj system.ping`**
2. **`dbt.modified-models`** — `--file` with `{ "projectName": "…" }` if needed.
3. **`model.sync`** — per changed model or full sync.
4. **`dbt.parse`** — `--timeout 600000` on large projects.
5. **`dbt.compile`** — `--file examples/dbt-compile.request.json` or `{ "select": "m1 m2" }` (not `modelNames` array).
6. **`model.lineage`** — `--file examples/model-lineage.request.json` (CLI defaults to full upstream chain).
7. **Data check (read path):**
   - **`model.data-check`** → show returned SQL to the user.
   - Ask: **“Run this read-only query in dev? (Yes/No)”** — use **`AskQuestion`** when available; otherwise wait for an explicit answer.
   - **Only on Yes:** `query.execute --file …` with that SQL (or a saved file under `examples/`).
8. **Build (write path — optional):**
   - Ask: **“Run dbt.run for [list models] in dev? (Yes/No)”**
   - **Only on Yes:** delegate to **`dj-run-dbt`** (never target production).

Do **not** skip step 7’s Yes/No gate because preflight is “read-only by default.”

## Related skills

- Authoring: **`dj-create-new-model`**
- dbt run/build: **`dj-run-dbt`**
- Lightdash YAML: **`dj-create-lightdash-yaml`**
