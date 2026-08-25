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

**SQL-first principle:** Python models are pre-dbt ETL pipelines. Python handles orchestration and external data ingestion; Trino SQL handles transformations and storage. The review validates this separation is maintained.

## When this skill applies

Use this skill when the user mentions: review python model, audit python model, validate python model, check python model, python model production readiness, python model compliance, python model lineage check, or any request to assess quality of `.python.json` / `.python.py` files.

**Out of scope** — delegate to sibling skills:

- Creating new Python models → `dj-create-python-model`
- SQL `.model.json` review/refactoring → `dj-review-and-refactor-model`
- Lightdash YAML → `dj-edit-lightdash-yaml`
- Verifying the model's output *data* against a legacy/reference table (this skill audits code, not data) → `dj-verify-pymodel-parity`
- Migrating a legacy notebook into a python model before it can be reviewed → `dj-migrate-notebook-to-pymodel`

## Workflow

- [ ] **1. Resolve scope.** Default to the open `.python.json` in the editor if any. Otherwise ask the user which Python model to review. Accept a file path or model name (`python__<group>__<topic>__<name>`).
- [ ] **2. Read both files.** Load the `.python.json` and its companion `.python.py`. If either is missing, note it as an immediate finding. Also read `.dj/schemas/python-model.schema.json` for validation reference.
- [ ] **3. Run checklist.** Apply all checks from the four categories below. Record each as pass/fail/warning with supporting detail.
- [ ] **4. Cross-reference lineage.** Parse SQL statements in the code cells to extract all tables referenced in FROM/JOIN clauses. Compare against `python_model_upstream_sources` entries for completeness.
- [ ] **5. Render report.** Output the structured report using the template below. Categorize findings by severity (Issue / Warning / Suggestion).
- [ ] **6. Recommendations.** Close with a priority-ordered list of actionable improvements.

## Review categories

### 1. Framework Compliance (F)

| Check | What to validate                                                                                                                                                              |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1    | `.python.json` has required fields: `name`, `group`, `topic`                                                                                                                  |
| F2    | Name/group/topic match pattern `^[a-z][a-z0-9_]*$`                                                                                                                            |
| F3    | `cells` array is present and non-empty in JSON                                                                                                                                |
| F4    | `.python.py` contains `if __name__ == "__main__":` script entry (scaffold calls `run_etl(build_context_from_env())`)                                                                 |
| F5    | Uses `_trino_io` helpers (`from python_models._trino_io import ...`) — no inline Trino connection code (`trino.dbapi.connect`, `create_engine`, raw `requests.post` to Trino) |
| F6    | `OUTPUT_CONFIG` uses `PythonModelConfig` from `python_models._config`                                                                                                         |
| F7    | `.python.py` content is derivable from JSON `cells` (no hand-edits that would be lost on next sync)                                                                           |
| F8    | Runner cell (`run_etl(context)`) is the last code cell in JSON                                                                                                                |
| F9    | ETL follows the standard function structure: `extract()`, `transform_and_load()`, `cleanup()`, `run_etl()`                                                                    |

### 2. Lineage Readiness (L) — end-to-end validation

The DJ lineage engine discovers Python models by querying Iceberg `$properties` on output tables. It reads:

- `python_model_name` — model identity
- `python_model_table` — output table name
- `python_model_upstream_sources` — comma-separated `schema.table` pairs for upstream lineage edges

The review validates the **full chain**: JSON metadata → `PythonModelConfig` → Iceberg table properties → lineage discoverability.

| Check | What to validate                                                                                                                                                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1    | `PythonModelConfig` instantiation emits all required properties: `python_model_name`, `python_model_type`, `python_model_namespace`, `python_model_table`, `python_model_description`                    |
| L2    | `python_model_upstream_sources` is set on the output table — code must call `ALTER TABLE ... SET PROPERTIES` or use PyIceberg catalog API to write this key listing all source tables the ETL reads from |
| L3    | Each entry in `python_model_upstream_sources` follows `schema.table` format (dot-separated, matching actual source tables)                                                                               |
| L4    | **Completeness** — every table referenced in `extract()` / `transform_and_load()` SQL (FROM/JOIN clauses) appears in `python_model_upstream_sources` (no missing upstream edges)                         |
| L5    | **Accuracy** — every entry in `python_model_upstream_sources` corresponds to a table actually queried in the model (no stale/phantom entries)                                                            |
| L6    | `dags` field is populated in JSON (model is scheduled, discoverable by Airflow DAG lineage). Empty `dags` = utility module, not a lineage participant                                                    |
| L7    | `depends_on` correctly lists upstream Python models whose output tables this model reads (task dependency mirrors data dependency)                                                                       |
| L8    | Model ID derivable from file path matches `python_model_name` in properties: `python__<group>__<topic>__<name>`                                                                                          |
| L9    | Companion `.python.py` exists alongside `.python.json` (required for Airflow `etl_helper.py` discovery)                                                                               |
| L10   | `OUTPUT_CONFIG.table_name` (or `model_name` fallback) matches the table name referenced in downstream `.source.json` files, if any exist in the project                                                  |

### 3. Downstream Integration (D)

| Check | What to validate                                                                                                              |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| D1    | Output table uses standard catalog/schema convention (`glue_development.opus_python_source` or project-configured equivalent) |
| D2    | Partition column `portal_partition_daily` is emitted in output SQL (`'{ds}' AS portal_partition_daily` or equivalent)         |
| D3    | Column names in output SQL follow `snake_case` convention (no camelCase, no spaces, no special characters)                    |
| D4    | No `SELECT *` in production INSERT — explicit column enumeration for schema stability and consumer predictability             |
| D5    | Table name matches model name for source discovery (`OUTPUT_CONFIG.table_name or model_name` → downstream `source.table`)     |
| D6    | Output columns are stable — column order and types should be deterministic across runs                                        |

### 4. Performance & Best Practices (P)

| Check | What to validate                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1    | **SQL-first adherence** — transformations (filter, cast, aggregate, join, deduplicate) done in Trino SQL, not pandas/Python                      |
| P2    | Staging tables cleaned up in `cleanup()` — no orphaned `stg_tmp_*` tables left after ETL completes                                               |
| P3    | Partition predicate pushdown — WHERE clauses on source tables include partition column filters                                                   |
| P4    | Batch staging — large datasets chunked before INSERT (not unbounded single INSERT of millions of rows)                                           |
| P5    | Write mode appropriate for use case: `overwrite_partition` for idempotent daily loads, `append` for event streams, `overwrite` for full refresh  |
| P6    | No full-table scans — queries against large tables include a partition filter or LIMIT                                                           |
| P7    | DataFrame operations restricted to external ingestion — any pandas/polars used only for API response parsing, not for SQL-expressible transforms |
| P8    | Explicit `CAST(... AS type)` in SQL for type safety — not relying on pandas `.astype()` or implicit coercion                                     |
| P9    | Error handling — `run_etl()` has try/except with cleanup on failure (staging tables dropped even if transform fails)                             |
| P10   | Idempotency — re-running the model for the same `ds` produces identical results (no append-on-rerun for partition-based models)                  |

## Report template

Render the full report in this structure. Adapt headings to the actual model. Omit empty sections.

```text
## Python Model Review: python__<group>__<topic>__<name>

### Summary
| Field | Value |
|-------|-------|
| Model ID | python__<group>__<topic>__<name> |
| File | <path to .python.json> |
| DAG(s) | <dag list or "none (utility module)"> |
| Output | <database>.<schema>.<table> |
| Write mode | <mode> |
| Partition | <columns> |
| Depends on | <upstream models or "none"> |

### Findings: X issues, Y warnings, Z suggestions

### 1. Framework Compliance
[F1] PASS/ISSUE/WARNING: <description>
     Detail: <evidence or recommendation>

### 2. Lineage Readiness
[L1] PASS/ISSUE/WARNING: <description>
     Detail: <evidence or recommendation>
     Tables in SQL: <list of tables found in FROM/JOIN>
     Tables in upstream_sources: <list declared>
     Missing from upstream_sources: <any gaps>
     Stale in upstream_sources: <any phantom entries>

### 3. Downstream Integration
[D1] PASS/ISSUE/WARNING: <description>
     Detail: <evidence or recommendation>

### 4. Performance & Best Practices
[P1] PASS/ISSUE/WARNING: <description>
     Detail: <evidence or recommendation>
     Impact: <what could go wrong>
     Suggestion: <how to fix>

### Recommendations (priority-ordered)
1. [CRITICAL] <action item> — fixes <check IDs>
2. [HIGH] <action item> — fixes <check IDs>
3. [MEDIUM] <action item> — fixes <check IDs>
4. [LOW] <action item> — fixes <check IDs>
```

### Severity classification

| Severity       | Criteria                                                                   | Report label |
| -------------- | -------------------------------------------------------------------------- | ------------ |
| **Issue**      | Blocks production deployment or breaks lineage/downstream consumers        | `ISSUE`      |
| **Warning**    | Degrades performance, violates best practices, or creates maintenance risk | `WARNING`    |
| **Suggestion** | Improvement opportunity; not blocking but raises quality                   | `SUGGESTION` |

### Recommendation priority

| Priority | Criteria                                                                |
| -------- | ----------------------------------------------------------------------- |
| CRITICAL | Lineage broken (L2-L5 failures), missing `__main__` entry, no partition column |
| HIGH     | Inline Trino code, missing cleanup, stale upstream_sources              |
| MEDIUM   | Non-SQL-first transforms, missing batch staging, no error handling      |
| LOW      | Naming style, column order, documentation gaps                          |

## Hard rules (DO NOT)

- **DO NOT** edit any files. This is a read-only review skill.
- **DO NOT** execute SQL queries against Trino to validate table existence. Work from static code analysis only.
- **DO NOT** skip the lineage cross-reference (L4/L5). Always parse SQL to extract referenced tables and compare against declared upstream sources.
- **DO NOT** report a check as PASS without evidence. Show the relevant code snippet or field value that confirms compliance.
- **DO NOT** invent findings. If a check is not applicable (e.g., model has no SQL transforms because it's pure Python-to-S3), mark it as `N/A` with a reason.
- **DO NOT** render empty sections. If all checks in a category pass, still show them as PASS but omit the Recommendations section if there are zero issues/warnings.

## Lineage cross-reference procedure (L4/L5 detail)

To validate upstream source completeness:

1. **Extract SQL tables from code cells:** Scan all code cells for SQL strings (f-strings, triple-quoted strings). Parse FROM and JOIN clauses to extract fully-qualified table references (`catalog.schema.table` or `schema.table`).
2. **Normalize references:** Strip catalog prefix if present. Convert to `schema.table` format.
3. **Exclude self-references:** Remove the model's own output table from the list.
4. **Exclude staging tables:** Remove any `stg_tmp_*` tables (these are transient staging tables created and dropped within the same ETL).
5. **Compare against declared sources:** Match the extracted set against `python_model_upstream_sources` entries.
6. **Report gaps:** Any table in SQL but not in upstream_sources = missing edge (L4 failure). Any entry in upstream_sources not found in SQL = stale entry (L5 warning).

## Conventions reference

- **File layout:** `dags/python_models/<group>/<topic>/<name>.python.json` + `.python.py`
- **Model ID:** `python__<group>__<topic>__<name>`
- **Source of truth:** `.python.json` — never hand-edit `.python.py`
- **`_trino_io.py` DML helpers:** `execute_trino`, `overwrite_partition` / `overwrite` (keyword `insert_sql=` or `source_query=` + optional `columns=`), `append`, `merge`, `delete`, `update`
- **Script entry:** `if __name__ == "__main__":` with `build_context_from_env()` from `_config.py` — Airflow and KPO run the file as `__main__`
- **Scaffold convention:** `def run_etl(context)` orchestrates extract/transform/cleanup; recommended but not enforced at discovery
- **Partition contract:** downstream dbt models expect `portal_partition_daily` column in output
- **Table properties for lineage:** `python_model_name`, `python_model_type`, `python_model_namespace`, `python_model_table`, `python_model_description`, `python_model_upstream_sources`

## Detailed checklist reference

For extended explanations, code examples, and edge cases for each check, see [references/review-checklist.md](references/review-checklist.md).
