# Review Checklist — Detailed Reference

Extended explanations, code examples, and edge cases for each check in the DJ Python model review.

---

## 1. Framework Compliance (F)

### F1: Required fields

**Pass condition:** `.python.json` contains `name`, `group`, and `topic` at the top level.

```json
{
  "name": "tenant_events",
  "group": "etl",
  "topic": "tenant_status"
}
```

**Fail:** Missing `topic` — model cannot be discovered by Airflow or synced by the framework.

### F2: Naming convention

**Pattern:** `^[a-z][a-z0-9_]*$`

**Pass:** `tenant_events`, `user_embeddings`, `daily_snapshot`
**Fail:** `TenantEvents` (PascalCase), `tenant-events` (hyphens), `2024_snapshot` (starts with digit)

### F3: Code source of truth

**Pass condition:** `.python.json` is valid with the required metadata, and a companion `.python.py` exists with authored code.

`.python.py` is the source of truth for code. The `cells` array in `.python.json` is an optional, non-authoritative snapshot of the last notebook save — it may be empty when the model is authored by editing `.python.py` directly, which is fine and not a failure.

### F4: `__main__` script entry

**Pass condition:** `.python.py` contains:

```python
if __name__ == "__main__":
    from python_models._config import build_context_from_env
    run_etl(build_context_from_env())
```

**Why it matters:** Airflow worker and KPO pods execute the script as `__main__` via `python <path>` — not import + callable lookup. `build_context_from_env()` reads `PYMODEL_DS`, `PYMODEL_DS_NODASH`, `PYMODEL_DATES` and configures stdout logging for KPO.

### F5: `_trino_io` usage

**Pass condition:** All Trino operations use imports from `python_models._trino_io`.

**Fail patterns:**

```python
# INLINE CONNECTION
from trino.dbapi import connect
conn = connect(host="trino-host", port=8080, ...)

# DEPRECATED API NAME
from python_models._trino_io import execute_trino

# RAW HTTP
response = requests.post("http://trino:8080/v1/statement", ...)
```

**Correct patterns:**

```python
# SQL path
from python_models._trino_io import execute_sql, fetch_value, overwrite_partition

# Pandas path
from python_models._trino_io import read_partition_to_dataframe, overwrite_partition_from_dataframe
```

### F6: OUTPUT_CONFIG

**Pass condition:**

```python
from python_models._config import PythonModelConfig

OUTPUT_CONFIG = PythonModelConfig(
    model_name="tenant_events",
    model_type="python",
    namespace="opus_python_source",
    table_name="tenant_events",
    description="Daily tenant events from API",
)
```

**Fail:** Custom dataclass, plain dict, or missing `OUTPUT_CONFIG`.

### F7: Code source of truth (no JSON overwrite)

`.python.py` is the source of truth for code; DJ never rewrites it from `.python.json`. Hand-edited code is **expected and preserved** — it is not lost on sync. (The `cells` array in JSON is only a snapshot written when the notebook is saved.)

**Pass condition:** `.python.py` is present and contains the authored ETL code.

### F8: Import safety

**Pass condition:** `.python.py` has no side-effectful top-level statements — e.g. no bare `run_etl(context)` at module scope (which would execute on import). Execution goes through the `__main__` block.

```python
# FAIL — runs on import
run_etl(context)

# PASS — script entry only
if __name__ == "__main__":
    from python_models._config import build_context_from_env
    run_etl(build_context_from_env())
```

**Why it matters:** Airflow workers import the module and KPO runs `python <file>` — a top-level runner call would fire at import time. Only the derived `# Python Model: …` header is notebook-only; all other code in the notebook view is real module code.

### F9: Orchestrator structure

**Pass — pandas path:**

```python
def extract(context): ...
def transform(df, context): ...
def load(df, context): ...
def run_etl(context): ...
```

**Pass — SQL path:**

```python
def extract(context): ...       # optional
def transform_and_load(context): ...
def cleanup(context): ...
def run_etl(context): ...
```

**Pass — mixed:** Documented combination (e.g. pandas extract + SQL transform_and_load).

**Warning:** SQL path with staging but no `cleanup()`. Missing `extract()` is acceptable when data is already in Trino.

---

## 2. Lineage Readiness (L)

### L1: Table properties emission

DJ writes Iceberg properties after each successful MWAA or KPO run from `.python.json` metadata:

- `python_model_name` ← `name`
- `python_model_namespace` ← `namespace` / `output.schema`
- `python_model_table` ← `table_name` / `output.table`
- `python_model_description` ← `description`
- `python_model_upstream_sources` ← `upstream_sources`

Authors do not need `set_extra_properties` calls in model code for lineage.

### L2: `upstream_sources` when model reads upstream data

**Pass condition:** `.python.json` includes `upstream_sources` when the model reads Trino tables or external systems.

```json
"upstream_sources": [
  { "type": "trino", "value": "glue_development.opus_python_source.tenant_events" },
  { "type": "external", "value": "api::backstage_tenant_events" }
]
```

**Fail:** Model reads upstream data but `upstream_sources` is missing or empty — lineage shows the Python node with no upstream edges.

**N/A:** Model with no upstream reads (pure external generate with no declared source) — rare; confirm with author.

### L3: Trino format validation

**Pass (canonical):**

```json
{ "type": "trino", "value": "glue_development.opus_python_source.tenant_events" }
```

**Warning (legacy 2-part):**

```json
{ "type": "trino", "value": "opus_python_source.tenant_events" }
```

Still parsed with catalog from parent context — recommend migrating to 3-part FQN.

**Fail:**

```json
{ "type": "trino", "value": "tenant_events" }
```

Missing schema — cannot resolve table location.

### L4: External format validation

**Pass:**

```json
{ "type": "external", "value": "s3::data-lake/tenant_migrations/{ds}/migrations.csv" }
{ "type": "external", "value": "api::backstage_tenant_events" }
{ "type": "external", "value": "jenkins::nightly-export-job" }
```

**Warning:** Free-form string with no prefix convention — acceptable if stable and documented.

### L5: Completeness — no missing upstream edges

**Procedure:**

1. Extract Trino tables from:
   - SQL strings: `FROM catalog.schema.table`, `JOIN schema.table`
   - `read_partition_to_dataframe("catalog.schema.table", …)`
   - F-strings building FQNs from `get_catalog_name()`
2. Normalize to `catalog.schema.table`.
3. Exclude: own output table, `stg_tmp_*` tables, CTE aliases.
4. Every remaining table must match a `trino` entry in `upstream_sources`.

**Example finding:**

```
Tables read in code: glue_development.opus_python_source.tenant_events, glue_development.analytics.user_sessions
upstream_sources trino entries: glue_development.opus_python_source.tenant_events
Missing: glue_development.analytics.user_sessions
```

### L6: Accuracy — no stale entries

Every `upstream_sources` entry must correspond to a source actually read.

**Example finding:**

```
upstream_sources: tenant_events, old_events_table
Tables read in code: tenant_events only
Stale: old_events_table
```

**Severity:** Warning — misleading graph edges.

### L7: `depends_on` alignment

**Pass condition:** When model A reads the output table of Python model B, model A's `depends_on` includes B's `name`.

```json
{
  "name": "tenant_migration_status",
  "depends_on": ["tenant_events", "tenant_migrations"],
  "upstream_sources": [
    { "type": "trino", "value": "glue_development.opus_python_source.tenant_events" },
    { "type": "trino", "value": "glue_development.opus_python_source.tenant_migrations" }
  ]
}
```

**Why both matter:**

- `depends_on` — Airflow waits for upstream tasks
- `upstream_sources` — Model Lineage draws edges

DJ may auto-infer trino `upstream_sources` from `depends_on` — inferred entries are valid. Missing `depends_on` when reading a sibling Python output is an **issue** (race condition).

### L8: DAG assignment

**Pass:** `"dags": ["daily_etl_dag"]`
**Warning:** `"dags": []` — utility module; lineage via table properties only, no Airflow task node.

### L9: Model ID consistency

File path `dags/python_models/etl/tenant_status/tenant_events.python.json` → `python__etl__tenant_status__tenant_events` → matches `python_model_name` in Iceberg properties.

### L10: Companion `.python.py` exists

**Fail:** Missing `.python.py` — Airflow cannot execute the model.

### L11: Downstream source reference match

If `.source.json` files reference this model's output, table name must match `OUTPUT_CONFIG.table_name` (or `model_name` fallback).

---

## 3. Downstream Integration (D)

### D1: Standard catalog/schema

**Default:** `glue_development.opus_python_source.<table_name>`

Custom schema is acceptable when documented. Flag unknown namespaces.

### D2: Partition column emission

**Pass (SQL):**

```sql
SELECT col_a, '{ds}' AS portal_partition_daily FROM ...
```

**Pass (pandas):**

```python
df["portal_partition_daily"] = context["ds"]
```

**Exception:** `output.write_mode: "overwrite"` full refresh — suggestion only.

### D3: Column naming

All output columns in `snake_case`. Flag `userId`, `Created At`.

### D4: No `SELECT *`

```sql
-- FAIL
INSERT INTO target SELECT * FROM staging

-- PASS
INSERT INTO target SELECT user_id, email, portal_partition_daily FROM staging
```

### D5: Table name matches model name

Convention: table `<name>` in output schema matches model `name` unless `table_name` override is intentional and documented.

### D6: Deterministic output

**Warning:** `ROW_NUMBER()` without deterministic tie-break, `NOW()` as data column, non-deterministic UDFs.

---

## 4. Performance & Best Practices (P)

### P1: Orchestrator consistency (not SQL-first)

**Accept — pandas end-to-end:**

```python
df = extract(context)
df = transform(df, context)
load(df, context)  # overwrite_partition_from_dataframe
```

**Accept — SQL end-to-end:**

```python
extract(context)
transform_and_load(context)  # overwrite_partition
cleanup(context)
```

**Accept — mixed** when documented.

**Flag as warning — inconsistency only:**

```python
# Author chose SQL path but filters in pandas after staging unnecessarily
df = df[df["status"] == "active"]  # could be SQL WHERE
```

Do **not** fail solely because pandas is used. Fail only when the chosen style is contradicted without justification.

### P2: Staging table cleanup

**SQL path pass:**

```python
def cleanup(context):
    execute_sql(f"DROP TABLE IF EXISTS {staging_fqn}")
```

**Fail:** Staging tables created but never dropped.

### P3: Partition predicate pushdown

```sql
-- PASS
SELECT * FROM source WHERE portal_partition_daily = '{ds}'

-- FAIL on large partitioned tables
SELECT * FROM source WHERE name = 'foo'
```

Also applies to `read_partition_to_dataframe` — should pass partition column and value.

### P4: Batch staging / writes

**Pass:**

```python
overwrite_partition_from_dataframe(..., batch_size=1000)
```

**Warning:** Single unbounded INSERT of millions of rows.

### P5: Write mode appropriateness

| Pattern | Correct | Incorrect |
| ------- | ------- | --------- |
| Daily idempotent | `overwrite_partition` / `overwrite_partition_from_dataframe` | `append` |
| Event stream | `append` | `overwrite_partition` |
| Full refresh | `overwrite(…, "true", …)` | unnecessary partition logic |

### P6: Partition filters on large tables

Flag FROM/JOIN against partitioned Iceberg tables without partition predicates.

### P7: Correct API names

| Wrong | Correct |
| ----- | ------- |
| `execute_trino(sql)` | `execute_sql(sql)` |
| `execute_trino(sql, return_result=True)` | `fetch_value(sql)` |
| `delete(table, where)` | `overwrite_partition(…)` or `overwrite(…)` |

### P8: Type safety

**SQL path:** `CAST(raw_amount AS DECIMAL(18,2))`
**Pandas path:** appropriate dtypes before `overwrite_partition_from_dataframe`

### P9: Error handling

```python
def run_etl(context):
    try:
        extract(context)
        transform_and_load(context)
    finally:
        cleanup(context)
```

### P10: Idempotency

For partition-based models, rerun with same `ds` replaces the partition — no duplicate rows.

---

## Edge Cases

### Models without SQL (pure pandas)

Checks D4, P3, P6 may be N/A. `upstream_sources` with `external` entries still required when reading external systems. Trino reads via `read_partition_to_dataframe` still need `trino` entries.

### Models without Trino (S3 output)

When `output_type: "s3"`:

- D2, P3, P6 — N/A
- L2 — external `upstream_sources` still recommended
- F5 — `_trino_io` may be unused — N/A with reason

### Utility modules (empty `dags`)

L8, L7 (scheduling) become N/A. Framework compliance still applies.

### Auto-inferred upstream_sources

When `depends_on` is set and trino entries were auto-inferred at create time, L5 may pass even if the author did not hand-write `upstream_sources`. Verify inferred FQNs match actual output tables of upstream models.

### Topic pipelines

Review each model in the topic. Cross-check that integration models list all sibling `depends_on` entries and that `upstream_sources` trino FQNs use `catalog.schema.table`.
