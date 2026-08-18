---
name: dj-migrate-notebook-to-pymodel
description: >-
  Migrate a legacy Jupyter notebook (.ipynb) into a DJ python model. Reads the
  notebook, classifies cells into extract/transform/load/exploratory, flags
  hardcoded secrets and non-deterministic code, applies the SQL-first decision
  tree, and produces a migration plan report for the user to approve before
  any .python.json is scaffolded. Use when the user wants to migrate, port, or
  convert an existing notebook/.ipynb into a python model. Not for scaffolding
  a python model from scratch (-> dj-create-python-model), verifying old vs.
  new table parity after migration (-> dj-verify-pymodel-parity), or auditing
  an existing python model (-> dj-review-python-model).
compatibility: DJ (Data JSON) Framework extension workspace with .dj/schemas/ and dags/python_models/
metadata:
  dj-skill: '1.0'
---

# Migrate Notebook to DJ Python Model

**Goal:** turn a legacy Jupyter notebook (`.ipynb`) that runs an ETL job into a DJ python model — a JSON-defined pipeline that extracts data from external sources and loads it into Iceberg tables for downstream dbt models to consume. This is a **two-phase** skill: Phase A analyzes the notebook and produces a migration plan for the user to review; Phase B (only after approval) scaffolds the actual `.python.json`.

**SQL-first principle carries over from the target framework:** wherever a notebook cell's pandas transform can be expressed as Trino SQL, the migration plan proposes SQL instead of carrying pandas logic forward. Python is for orchestration and external ingestion; Trino is for transformation and storage.

## When this skill applies

Use this skill when the user mentions: migrate a notebook, convert a notebook, port a notebook, turn this `.ipynb` into a python model, or asks to bring a legacy/manual notebook pipeline into the framework.

**Out of scope** — delegate to sibling skills:

- Building the final `.python.json` once the plan is approved → **`dj-create-python-model`** (Phase B below hands off to it)
- Verifying the migrated model's output table matches the old notebook's output table → **`dj-verify-pymodel-parity`**
- Auditing a python model for production readiness after migration → **`dj-review-python-model`**

## Phase A — Analyze (read-only, always runs first)

- [ ] **1. Read the notebook.** Parse the `.ipynb` JSON. Walk `cells` in order, keeping `cell_type` (`code`/`markdown`), `source`, and any `outputs`.
- [ ] **2. Strip notebook-only output.** Never read or echo back the contents of a cell's `outputs` array in the migration report — it may contain stale data, PII, or credentials from a prior run. Analyze `source` only.
- [ ] **3. Classify every code cell** into one stage:
  - **Extract** — reads from an external source (`requests.get`, a DB/Trino client, `pd.read_csv`, `boto3` S3 calls).
  - **Transform** — pandas/DataFrame manipulation (filter, merge, groupby, reshape, type conversion).
  - **Load** — writes the result somewhere (`df.to_sql`, `df.to_parquet`, `df.to_csv` to a shared location, a DB `INSERT`).
  - **Exploratory/drop** — plotting (`matplotlib`, `seaborn`, `plotly`), `display()`/`print()`-only cells, interactive widgets, ad-hoc `df.head()`/`df.describe()` checks, commented-out scratch code. These are dropped from the migration — record each with a one-line reason.
- [ ] **4. Flag magic commands.** `%%time`, `!pip install ...`, `%matplotlib inline`, `%%bash`, etc. have no notebook-model equivalent — list them as dropped, and if a `!pip install` reveals a runtime dependency, carry that package name forward into the plan's dependency list instead of the magic itself.
- [ ] **5. Flag hardcoded secrets.** Scan every cell for API keys, tokens, passwords, or connection strings (literal strings assigned to variables named/matching `key`, `token`, `secret`, `password`, `conn(ection)?_string`, or high-entropy literals passed to auth headers/params). **Never carry a found secret into the plan or the eventual model** — call it out explicitly and state it must move to environment variables or the project's secret manager before the model can run.
- [ ] **6. Identify source type and destination.** From the extract/load cells, determine the source type (REST API, DB/Trino, CSV/file, S3) and the destination (what table or path is written, and in what mode — append vs. overwrite/replace).
- [ ] **7. Apply the SQL-first decision tree** (from `dj-create-python-model`) to every transform cell:

  | If the pandas op is... | Propose |
  | --- | --- |
  | Filtering / boolean masking | Trino `WHERE` |
  | Column rename / select subset | Trino column aliasing / `SELECT` list |
  | `.astype(...)` type conversion | Trino `CAST(... AS type)` |
  | `.drop_duplicates()` | Trino `ROW_NUMBER()` dedup |
  | `.groupby().agg(...)` | Trino `GROUP BY` |
  | `pd.merge` / `.join()` | Trino `JOIN` |
  | Nested JSON flattening (`pd.json_normalize`, dict/list unpacking) | Stays pandas (SQL can't easily express this) |
  | API pagination / response parsing | Stays pandas |
  | ML preprocessing (`sklearn`, embeddings, etc.) | Stays pandas |

  Record each transform cell's verdict (→ SQL or stays pandas) with the proposed SQL/pandas equivalent.

- [ ] **8. Flag non-determinism / order dependence.** Look for: cells that reference variables only defined by running an earlier cell out of its written order, global mutable state mutated across cells, `datetime.now()`/`random`/`np.random` without a fixed seed or an explicit `context["ds"]`-derived date. Each is a migration risk — the DJ model must be safely re-runnable for a given `ds`.
- [ ] **9. Render the migration plan report** (template below) and stop — do not proceed to Phase B until the user approves it or asks for changes.

### Migration plan report template

```text
## Notebook Migration Plan: <notebook file name>

### Proposed identity (confirm with user)
| Field | Proposed | Notes |
|-------|----------|-------|
| name  | <name>   | ^[a-z][a-z0-9_]*$ |
| group | <group>  | |
| topic | <topic>  | |

### Source & destination
- Source type: <REST API / DB / CSV / S3 / custom>
- Extract pattern: <one line>
- Destination: <table/path>, write mode: <append/overwrite/replace inferred from notebook>

### Cell classification
| Cell # | Stage | Summary | Disposition |
|--------|-------|---------|-------------|
| 1 | markdown | ... | keep as narrative |
| 2 | extract | fetches X via requests.get | migrate to extract() |
| 3 | exploratory | df.head() sanity check | drop — exploratory only |
| ... | | | |

### Dropped cells (with reason)
- Cell #<n>: <reason — plotting / display-only / magic command / exploratory>

### Magic commands found
- `<magic>` in cell #<n> — dropped; <if it revealed a dependency, note it here>

### Pandas → SQL mapping
| Cell # | Pandas operation | Proposal |
|--------|-------------------|----------|
| 4 | `df.groupby("id").sum()` | Trino `GROUP BY id` |
| 5 | `pd.json_normalize(resp["items"])` | stays pandas (nested JSON) |

### Flagged secrets — MUST resolve before migration
- Cell #<n>: `<variable name>` looks like a hardcoded <credential type>. Move to env var / secret manager; do not carry into the new model.

### Non-determinism / order-dependence risks
- Cell #<n>: <description of risk and why it blocks safe re-runs>

### Open questions for the user
- <e.g., "Cell 6 writes to `s3://bucket/path` in append mode with no idempotency key — should the migrated model dedupe by run date?">
```

- [ ] **10. Wait for the user to approve the plan, or apply requested edits and re-render.** Do not scaffold anything until this happens.

## Phase B — Build (only after the user approves the plan)

- [ ] **11. Hand off to `dj-create-python-model`.** Walk that skill's interactive gathering workflow (identity, DAG assignment, source type, transformation needs, output configuration, dependencies), but pre-fill every answer from the approved Phase A plan instead of asking the user again — only ask what the plan left open (see "Open questions").
- [ ] **12. Use `dj-create-python-model`'s ETL cell structure and `_trino_io` helpers** for the generated `cells` array. Do not invent a different structure — this guarantees the output is schema-correct and consistent with hand-authored models.
- [ ] **13. After the `.python.json` is written**, tell the user the notebook can be retired once the model is verified — suggest running **`dj-verify-pymodel-parity`** against the old notebook's output table and the new model's output table before deleting the notebook.

## Hard rules (DO NOT)

- **DO NOT** scaffold or write any `.python.json` before the user has approved the Phase A plan.
- **DO NOT** echo a notebook cell's `outputs` array contents into the migration report — analyze `source` only.
- **DO NOT** carry a hardcoded secret found in the notebook into the new model, the plan report, or any generated code — flag it and stop short of reproducing it.
- **DO NOT** default risky ambiguous behavior (e.g., unclear write mode, unclear idempotency) silently — list it under "Open questions" and ask.
- **DO NOT** invent a different `.python.json` structure from what `dj-create-python-model` defines — Phase B must produce output that skill would also produce.

## Reference

For common notebook idiom → DJ/Trino equivalent mappings, see [references/notebook-pattern-mapping.md](references/notebook-pattern-mapping.md).

For the full python model conventions this skill hands off to (ETL cell structure, `_trino_io` DML helpers, output config defaults, write-mode selection), see the **`dj-create-python-model`** skill — read it before Phase B.
