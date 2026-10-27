---
name: dj-review-python-model
description: >-
  Review a DJ Python model (.python.py + .python.json) for framework
  compliance, lineage readiness, downstream integration, and performance —
  ensuring it meets DJ standards before productionising. Use when the user
  wants to review, audit, validate, or check a Python model for production
  readiness.
compatibility: DJ (Data JSON) Framework extension workspace with .dj/schemas/ and dags/python_models/
metadata:
  dj-skill: '1.0'
---

# Review DJ Python Model

**Goal:** audit a `.python.json` + `.python.py` pair against DJ framework standards and produce a **structured report** covering framework compliance, lineage readiness, downstream integration, and performance. This skill is **read-only** — it surfaces issues and recommendations but does not auto-fix.

**Authoring philosophy:** Python models may use **pandas end-to-end**, **SQL end-to-end**, or **mixed** orchestration. The review validates consistency with the chosen style — not SQL-first compliance.

## When this skill applies

Use this skill when the user mentions: review python model, audit python model, validate python model, check python model, python model production readiness, python model compliance, python model lineage check, or any request to assess quality of `.python.json` / `.python.py` files.

**Out of scope** — delegate to sibling skills:

- Creating new Python models → `dj-create-python-model`
- SQL `.model.json` review/refactoring → `dj-review-and-refactor-model`
- Lightdash YAML → `dj-edit-lightdash-yaml`
- Verifying the model's output *data* against a legacy/reference table (this skill audits code, not data) → `dj-verify-pymodel-parity`
- Migrating a legacy notebook into a python model before it can be reviewed → `dj-migrate-notebook-to-pymodel`

## Step 0 — Resolve project defaults (before checklist)

1. Read `.agents/project/skills/dj-review-python-model/project-defaults.md` if it exists.
2. Read `.agents/project/skills/dj-create-python-model/project-defaults.md` for shared catalog/schema/authoring-mode defaults.
3. If missing, discover from sibling models under `dags/python_models/` and project source registrations.
4. Apply project `authoring_mode` when interpreting F3/F7/F9 (hand-written models may have empty `cells` in JSON).

## Workflow

- [ ] **1. Resolve scope.** Default to the open `.python.json` in the editor if any. Otherwise ask which Python model to review. Accept a file path or model name (`python__<group>__<topic>__<name>`).
- [ ] **2. Read both files.** Load the `.python.json` and its companion `.python.py`. If either is missing, note it as an immediate finding. Also read `.dj/schemas/python-model.schema.json` for validation reference.
- [ ] **3. Run checklist.** Apply all checks from the four categories below. Record each as pass/fail/warning with supporting detail.
- [ ] **4. Cross-reference lineage.** Parse SQL and `_trino_io` calls to extract Trino tables read. Compare against `upstream_sources` in JSON. Verify `depends_on` aligns with Python-model data dependencies.
- [ ] **5. Render report.** Output the structured report using the template below. Categorize findings by severity (Issue / Warning / Suggestion).
- [ ] **6. Recommendations.** Close with a priority-ordered list of actionable improvements.

## Review categories

### 1. Framework Compliance (F)

| Check | What to validate |
| ----- | ---------------- |
| F1 | `.python.json` has required fields: `name`, `group`, `topic` |
| F2 | Name/group/topic match pattern `^[a-z][a-z0-9_]*$` |
| F3 | `.python.json` is valid with required metadata; `cells` is an optional non-authoritative snapshot (may be empty when the model is authored via `.python.py` directly) |
| F4 | Script entry: **`__main__`** + `run_etl(build_context_from_env())` (MWAA worker / KPO `python` path) **or** **`def run_etl(context)`** only when a documented import/entrypoint orchestrator calls it (no bare top-level `run_etl(...)`) |
| F5 | Uses `_trino_io` helpers (`from python_models._trino_io import …`) — no inline Trino connection code (`trino.dbapi.connect`, `create_engine`, raw HTTP to Trino) |
| F6 | `OUTPUT_CONFIG` uses `PythonModelConfig` from `python_models._config` |
| F7 | `.python.py` is present and treated as the code source of truth — hand-edited code is expected and preserved (DJ never overwrites it from JSON) |
| F8 | `.python.py` is import-safe — no side-effectful top-level statement such as a bare `run_etl(context)` at module scope |
| F9 | ETL follows a coherent orchestrator: pandas (`extract` / `transform` / `load`) **or** SQL (`extract` / `transform_and_load` / `cleanup`) **or** documented mixed pattern |

### 2. Lineage Readiness (L)

The DJ lineage engine discovers Python models via Iceberg `$properties` on output tables:

- `python_model_name` — model identity
- `python_model_table` — output table name
- `python_model_upstream_sources` — JSON array of `{ "type": "trino"|"external", "value": "..." }`

**`depends_on` vs `upstream_sources` — validate both when reading model output:**

| Field | Role | Review focus |
| ----- | ---- | ------------ |
| `depends_on` | Airflow task ordering | Upstream Python models whose output this model reads must be listed |
| `upstream_sources` | Lineage graph edges | Every Trino table and external system read must be declared |

DJ auto-infers trino `upstream_sources` from `depends_on` at create/sync — inferred entries are valid. Flag missing `depends_on` when the model reads a sibling Python output; flag missing `upstream_sources` when the model reads any upstream table or external system.

| Check | What to validate |
| ----- | ---------------- |
| L1 | JSON includes `name`, `description`, `namespace` / `output.schema`, `table_name` / `output.table` |
| L2 | `upstream_sources` is set when the model reads upstream data (Trino tables or external systems) |
| L3 | Each `trino` entry uses **`catalog.schema.table`** (canonical). **`schema.table`** (2-part) → legacy **warning** |
| L4 | Each `external` entry uses a stable identifier (`s3::…`, `api::…`, `jenkins::…`, or project convention) |
| L5 | **Completeness** — every Trino table read (SQL FROM/JOIN, `read_partition_to_dataframe`, etc.) appears in `upstream_sources` |
| L6 | **Accuracy** — every `upstream_sources` entry corresponds to a source actually read (no stale entries) |
| L7 | `depends_on` lists upstream Python models when this model reads their output tables |
| L8 | `dags` populated (empty = utility module, not a scheduled lineage participant) |
| L9 | Model ID from file path matches `python_model_name`: `python__<group>__<topic>__<name>` |
| L10 | Companion `.python.py` exists alongside `.python.json` |
| L11 | `OUTPUT_CONFIG.table_name` matches downstream `.source.json` references, if any |

### 3. Downstream Integration (D)

| Check | What to validate |
| ----- | ---------------- |
| D1 | Output table uses project catalog/schema convention from Step 0 (`<dev_catalog>.<python_output_schema>`) |
| D2 | Partition column `portal_partition_daily` emitted in output (SQL or pandas) when using partition writes |
| D3 | Column names follow `snake_case` |
| D4 | No `SELECT *` in production SQL INSERT statements |
| D5 | Table name matches model name for source discovery |
| D6 | Output columns deterministic across reruns for the same `ds` |

### 4. Performance & Best Practices (P)

| Check | What to validate |
| ----- | ---------------- |
| P1 | **Orchestrator consistency** — pandas, SQL, or mixed path is coherent; flag only contradictions (e.g. SQL-expressible transform duplicated in pandas when author chose SQL-only) |
| P2 | Staging tables cleaned up in `cleanup()` (SQL path) or no orphaned `stg_tmp_*` tables |
| P3 | Partition predicate pushdown on large Trino source reads |
| P4 | Batch staging / writes for large datasets (`overwrite_partition_from_dataframe` batch_size, chunked API pagination) |
| P5 | Write mode appropriate: `overwrite_partition` / `overwrite_partition_from_dataframe` for idempotent daily loads |
| P6 | No full-table scans on partitioned sources without partition filters |
| P7 | `_trino_io` API names correct: `execute_sql`, `fetch_value` — not `execute_trino` |
| P8 | Explicit `CAST(… AS type)` in SQL path; appropriate pandas dtypes in pandas path |
| P9 | Error handling — `cleanup()` in `finally` when staging tables are used |
| P10 | Idempotency — rerun for same `ds` produces identical partition output |

## Report template

```text
## Python Model Review: python__<group>__<topic>__<name>

### Summary
| Field | Value |
|-------|-------|
| Model ID | python__<group>__<topic>__<name> |
| File | <path to .python.json> |
| Orchestrator | pandas / SQL / mixed |
| DAG(s) | <dag list or "none (utility module)"> |
| Output | <database>.<schema>.<table> |
| Write mode | <mode> |
| Partition | <columns> |
| Depends on | <upstream Python models or "none"> |

### Findings: X issues, Y warnings, Z suggestions

### 1. Framework Compliance
[F1] PASS/ISSUE/WARNING: <description>
     Detail: <evidence or recommendation>

### 2. Lineage Readiness
[L1] PASS/ISSUE/WARNING: <description>
     Detail: <evidence or recommendation>
     depends_on: <list>
     upstream_sources declared: <list>
     Tables read in code: <list>
     Missing from upstream_sources: <gaps>
     Missing from depends_on: <gaps>
     Stale in upstream_sources: <phantom entries>

### 3. Downstream Integration
[D1] PASS/ISSUE/WARNING: <description>
     Detail: <evidence or recommendation>

### 4. Performance & Best Practices
[P1] PASS/ISSUE/WARNING: <description>
     Detail: <evidence or recommendation>

### Recommendations (priority-ordered)
1. [CRITICAL] <action item> — fixes <check IDs>
2. [HIGH] <action item> — fixes <check IDs>
3. [MEDIUM] <action item> — fixes <check IDs>
4. [LOW] <action item> — fixes <check IDs>
```

### Severity classification

| Severity | Criteria | Report label |
| -------- | -------- | ------------ |
| **Issue** | Blocks production or breaks lineage/downstream consumers | `ISSUE` |
| **Warning** | Degrades performance, violates best practices, or creates maintenance risk | `WARNING` |
| **Suggestion** | Quality improvement, not blocking | `SUGGESTION` |

### Recommendation priority

| Priority | Criteria |
| -------- | -------- |
| CRITICAL | Lineage broken (L2/L5/L7 failures), missing script entry (F4), no partition column |
| HIGH | Inline Trino code, missing cleanup, stale `upstream_sources`, missing `depends_on` for Python upstream |
| MEDIUM | Orchestrator inconsistency, missing batch staging, no error handling |
| LOW | Legacy 2-part trino FQN, naming style, documentation gaps |

## Hard rules (DO NOT)

- **DO NOT** edit any files. Read-only review.
- **DO NOT** execute SQL against Trino. Static code analysis only.
- **DO NOT** skip lineage cross-reference (L5/L6/L7). Parse code for table reads and compare to `upstream_sources` and `depends_on`.
- **DO NOT** report PASS without evidence (code snippet or field value).
- **DO NOT** invent findings. Mark N/A with reason when a check does not apply.
- **DO NOT** FAIL P1 solely because the model uses pandas — only flag inconsistencies with the chosen style.

## Lineage cross-reference procedure

1. **Extract Trino tables from code:** Scan cells for SQL strings (FROM/JOIN), `read_partition_to_dataframe(…)` first argument, and f-string table FQNs.
2. **Normalize:** Prefer `catalog.schema.table`. Accept `schema.table` with catalog from `get_catalog_name()` or `output.database`.
3. **Exclude:** model's own output table, `stg_tmp_*` staging tables, CTE names.
4. **Compare to `upstream_sources`:** Every remaining table needs a matching `trino` entry (L5). Extra entries with no code reference → stale (L6).
5. **Compare to `depends_on`:** When a read table is another Python model's output in the same topic, that model's `name` must appear in `depends_on` (L7).

## Conventions reference

- **File layout:** `dags/python_models/<group>/<topic>/<name>.python.json` + `.python.py`
- **Model ID:** `python__<group>__<topic>__<name>`
- **Source of truth for code:** `.python.py` — edit it directly (DJ never rewrites it from JSON). `.python.json` holds metadata + a non-authoritative `cells` snapshot. Never hand-edit generated `_trino_io.py` / `_config.py` / `_model_tasks.py`
- **`_trino_io` SQL path:** `execute_sql`, `fetch_value`, `overwrite_partition`, `overwrite`, `append`, `merge`, `update`
- **`_trino_io` pandas path:** `read_partition_to_dataframe`, `overwrite_partition_from_dataframe`
- **Do not use:** `execute_trino`, inline `trino.dbapi.connect`, standalone `delete()`
- **Trino connection (generated `_trino_io.py`):** Airflow Variables `dj_etl_trino_host`, `dj_etl_trino_user`, `dj_etl_trino_password` (same as source ETL). KPO may prefetch `DJ_ETL_TRINO_HOST`, `DJ_ETL_TRINO_USER`, `DJ_ETL_TRINO_PASSWORD` into the pod env.
- **Script entry:** `if __name__ == "__main__":` with `build_context_from_env()` from `_config.py` for MWAA worker / KPO `python <file>` — or `def run_etl(context)` when a project entrypoint imports the module and invokes it
- **`upstream_sources` trino format:** `catalog.schema.table` (canonical); `schema.table` legacy
- **`upstream_sources` external format:** `s3::…`, `api::…`, `jenkins::…`
- **Partition contract:** `portal_partition_daily` in partition-based models
- **Table properties:** `python_model_name`, `python_model_type`, `python_model_namespace`, `python_model_table`, `python_model_description`, `python_model_upstream_sources`

## Detailed checklist reference

For extended explanations, code examples, and edge cases, see [references/review-checklist.md](references/review-checklist.md).

## Evaluation scenarios

For prompt → expected-finding cases (which check ID each condition should raise), see [evals/evals.md](evals/evals.md).
