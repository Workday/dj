---
name: dj-migrate-notebook-to-pymodel
description: >-
  Migrate a legacy Jupyter notebook (.ipynb) or Python ETL script (.py) into a
  DJ python model. Phase A analyzes the source, classifies extract/transform/load
  stages, flags secrets and non-determinism, applies the SQL-first decision tree,
  and produces a migration plan for approval. Phase B authors the model or hands
  off to dj-create-python-model. Use when migrating, porting, or converting a
  notebook or legacy script into dags/python_models. Not for greenfield models
  (-> dj-create-python-model), parity checks (-> dj-verify-pymodel-parity), or
  audits (-> dj-review-python-model).
compatibility: DJ (Data JSON) Framework extension workspace with .dj/schemas/ and dags/python_models/
metadata:
  dj-skill: '1.0'
---

# Migrate Notebook / Legacy ETL → DJ Python Model

**Goal:** turn a legacy **`.ipynb`** or **`.py`** ETL into a DJ python model under `dags/python_models/<group>/<topic>/`.

| Phase | What happens |
| ----- | ------------ |
| **A — Analyze** | Read-only inventory + migration plan. **Stop for user approval.** |
| **B — Build** | After approval, author the model or hand off to `dj-create-python-model`. |

**SQL-first:** Prefer Trino SQL for transforms and loads. Use Python only for true external extract (API, CSV, S3, Jenkins) that cannot be queried in Trino.

## When this skill applies

Use when the user mentions: migrate/convert/port a notebook, convert an existing `.py` ETL, legacy script → python model, or attaches a `.py`/`.ipynb` to turn into a python model.

**Out of scope** — delegate:

| Need | Skill |
| ---- | ----- |
| Greenfield python model (no legacy file) | `dj-create-python-model` |
| Verify old vs new **data** after migration | `dj-verify-pymodel-parity` |
| Audit code for production readiness | `dj-review-python-model` |
| Topic README / lineage docs | `dj-document-pymodels` |
| SQL `.model.json` / sources | `dj-create-new-model` / `dj-create-source` |

## Step 0 — Resolve project defaults (before Phase A)

1. Read `.agents/project/skills/dj-migrate-notebook-to-pymodel/project-defaults.md` if it exists.
2. Read `.agents/project/skills/dj-create-python-model/project-defaults.md` for shared catalog/schema/authoring defaults.
3. Read any sibling files in those folders linked from the defaults (e.g. `trino-dialect-cheatsheet.md`).
4. If missing, discover from the repo: existing models under `dags/python_models/`, python-source `.source.json` files, `dbt_project.yml` vars, `dj.*` settings.
5. State resolved defaults in the migration plan before proposing identity fields.
6. Never assume org-specific catalog, schema, or DAG names without confirmation.

## Authoring shape — match the workspace

Before Phase B, inspect existing models under `dags/python_models/` and follow **that** layout:

| Workspace pattern | What Phase B produces |
| ----------------- | --------------------- |
| **Hand-written `.python.py`** (metadata-only `.python.json` + `def run_etl`) | Write `.python.json` **and** `.python.py`; mirror sibling models |
| **`cells` array in `.python.json`** (DJ-scaffolded `.python.py`) | Hand off to **`dj-create-python-model`** with answers pre-filled — do not invent a different `cells` structure |

### Production contract (either pattern)

- **Required for Airflow:** `def run_etl(context)` (discovery scans for `def run_etl(`).
- Only `run_etl(context)` is required — do not require public `extract` / `transform_and_load` / `cleanup` unless sibling models in the topic already use them.
- Output catalog/schema: from project defaults (Step 0) — validate against existing models and source registrations.
- DAG ids: must exist under `dags/`.
- Helper APIs: use `execute_sql` / `fetch_value` / `overwrite_partition` from `_trino_io` — not outdated aliases (`execute_trino`, inline `trino.dbapi.connect`).

---

## Phase A — Analyze (read-only, always first)

- [ ] **1. Obtain the legacy file** (path, upload, or paste). Support **`.ipynb` and `.py`**.
- [ ] **2. Inventory the source**
  - **Notebook:** parse `.ipynb` JSON; walk `cells` in order (`cell_type`, `source`). **Never** read/echo `outputs` (may contain PII/secrets/stale data).
  - **Script:** read the `.py` top-to-bottom; treat functions/blocks like cells for classification.
- [ ] **3. Classify every code unit** into: **Extract** / **Transform** / **Load** / **Exploratory-drop** (plotting, `display`/`head`/`describe`, widgets, scratch).
- [ ] **4. Flag magic commands** (`%%time`, `!pip install`, `%matplotlib`, `%%bash`, …). Drop them; if `!pip install` reveals a package, carry the package name into dependencies.
- [ ] **5. Flag hardcoded secrets** (keys/tokens/passwords/conn strings). **Never** copy secrets into the plan or model — require env / secret manager.
- [ ] **6. SQL discovery** — see below (apply project-specific rules from Step 0 when present).
- [ ] **7. Identify source type + destination** (REST, Trino/DB, CSV, S3, Jenkins) and write mode (append vs overwrite/partition).
- [ ] **8. Apply SQL-first mapping** to every transform. Use [references/notebook-pattern-mapping.md](references/notebook-pattern-mapping.md) and the decision tree from `dj-create-python-model`.
- [ ] **9. Flag non-determinism / order dependence** (`datetime.now()` without `context["ds"]`, unseeded random, out-of-order deps, global mutable state).
- [ ] **10. Propose DJ identity** (`name`, `group`, `topic`, `dags`, `output.table`, `upstream_sources`, `depends_on`, authoring shape).
- [ ] **11. Render the migration plan** (template below) and **stop** until the user approves or requests edits.
- [ ] **12. Wait for approval** (or edit + re-render). **Do not scaffold files before this.**

### SQL discovery (priority order)

**Commented SQL may be outdated.** Prefer live, authoritative query text over stale comments (project defaults may name specific legacy sources to handle).

1. **Live saved query / external SQL authority** — when the legacy code references a saved-query ID or external SQL store, **stop** and ask the user for the **current** query text. Do not invent or wrap blindly.
2. **Inline executable SQL** in the **active** (non-commented) code path.
3. **Commented / “old” SQL** — optional aid only; **confirm with the user** before porting. Never prefer over a live query reference without confirmation.

After SQL text exists: map tables → Trino availability → extract strategy (SQL-first vs Python extract). Apply dialect rewrites from project `trino-dialect-cheatsheet.md` when linked.

### Migration plan report template

```text
## Notebook / ETL Migration Plan: <file name>

### Proposed identity (confirm with user)
| Field | Proposed | Notes |
|-------|----------|-------|
| name  | <name>   | ^[a-z][a-z0-9_]*$ |
| group | <group>  | |
| topic | <topic>  | |
| dags  | <dag_id> | must exist under dags/ |
| output.table | <table> | Iceberg under <schema from Step 0> |
| upstream_sources | <catalog.schema.table, …> | tables this model reads |
| authoring shape | hand-written .py / cells→create | from workspace inspection |

### Source & destination
- Source type: <REST / Trino / CSV / S3 / Jenkins / custom>
- SQL authority: <live paste / inline / commented+confirmed / n/a>
- Extract pattern: <one line>
- Destination: <table>, write mode: <append / overwrite_partitions / …>

### Cell / block classification
| # | Stage | Summary | Disposition |
|---|-------|---------|-------------|
| 1 | extract | … | migrate |
| 2 | exploratory | df.head() | drop |

### Dropped (with reason)
- …

### Magic commands / secrets / non-determinism
- …

### Pandas → SQL mapping
| # | Operation | Proposal |
|---|-----------|----------|
| … | … | Trino … / stays pandas |

### Date / incremental / backfill (proposed)
- Incremental: <watermark column + context["ds"]>
- Backfill: <context["dates"] / topic dates_in — or open question>
- Do not invent ad-hoc from_date/to_date unless productized

### Open questions for the user
- …
```

---

## Phase B — Build (only after approval)

### B1. Choose path from workspace shape

**If hand-written `.python.py` models are the norm** (from Step 0 or sibling inspection):

1. Write `dags/python_models/<group>/<topic>/<name>.python.json` (metadata: `name`, `group`, `topic`, `dags`, `depends_on`, `tags`, `output`, `upstream_sources`, optional `variables`).
2. Write companion `<name>.python.py` with imports from `python_models._trino_io`, `_config`, and any topic helpers; `OUTPUT_CONFIG`; explicit-column SQL (no `SELECT *` into production Iceberg); **`def run_etl(context):`**.
3. Ensure `__init__.py` under `<group>/` and `<topic>/` if imports need them.
4. Mirror patterns in existing topic models.

**If the project uses `cells` in `.python.json`:**

1. Hand off to **`dj-create-python-model`**.
2. Pre-fill identity / DAG / source / transforms / output from the approved plan; only ask open questions.
3. Do not invent a different `cells` structure than that skill defines.

### B2. Date / incremental / backfill

| Mode | Mechanism |
| ---- | --------- |
| Incremental (default) | Watermark from target + `context["ds"]` as load/partition date |
| Backfill | `context["dates"]` from Airflow topic `dates_in` when the project uses it |
| Avoid | Undocumented `from_date` / `to_date` context keys |

Write the project partition column (default `portal_partition_daily`) for partition overwrite loads.

### B3. Downstream checklist

1. Register output in the project's python-source `.source.json` (path from Step 0) or ask the user to.
2. Suggest **`dj-verify-pymodel-parity`** vs the legacy output table before retiring the notebook/script.
3. Suggest **`dj-review-python-model`** for production readiness.
4. Suggest **`dj-document-pymodels`** when the topic has multiple models.

---

## Hard rules (DO NOT)

- **DO NOT** write `.python.json` / `.python.py` before the user approves the Phase A plan.
- **DO NOT** echo notebook `outputs` into the report — analyze `source` only.
- **DO NOT** carry hardcoded secrets into the plan, model, or generated code.
- **DO NOT** treat commented SQL as authoritative when a live query reference exists without confirmation.
- **DO NOT** use outdated helper names (`execute_trino`, inline `trino.dbapi.connect`).
- **DO NOT** invent DAG ids — validate against `dags/`.
- **DO NOT** default ambiguous write mode / idempotency silently — list under Open questions.
- **DO NOT** leave legacy DB `to_sql` / non-Trino load paths when the source is already in Trino.
- **DO NOT** invent a `cells` structure different from `dj-create-python-model` when using that path.

## Reference

- [references/notebook-pattern-mapping.md](references/notebook-pattern-mapping.md) — notebook idioms → DJ/Trino
- **`dj-create-python-model`** — ETL structure, output defaults, `_trino_io` helpers (read before Phase B)
- Siblings: `dj-verify-pymodel-parity`, `dj-review-python-model`, `dj-document-pymodels`
