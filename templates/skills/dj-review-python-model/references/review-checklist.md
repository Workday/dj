# Review Checklist — Detailed Reference

Extended explanations, code examples, and edge cases for each check in the DJ Python model review.

---

## 1. Framework Compliance (F)

### F1: Required fields

**Pass condition:** `.python.json` contains `name`, `group`, and `topic` at the top level.

```json
{
  "name": "backstage_catalogs",
  "group": "etl",
  "topic": "api_data"
}
```

**Fail example:** Missing `topic` field — model cannot be discovered by Airflow or synced by the framework.

### F2: Naming convention

**Pattern:** `^[a-z][a-z0-9_]*$`

**Pass:** `backstage_catalogs`, `user_embeddings`, `daily_snapshot`
**Fail:** `BackstageCatalogs` (PascalCase), `backstage-catalogs` (hyphens), `2024_snapshot` (starts with digit)

### F3: Cells array

**Pass condition:** `cells` array exists and has at least one code cell.

**Why it matters:** The framework regenerates `.python.py` from `cells`. If `cells` is empty/missing and `.python.py` exists, the sync service skips overwriting (safety valve) — but this means the JSON is no longer the source of truth.

### F4: `run_etl` function

**Pass condition:** `.python.py` contains `def run_etl(context)` (exact signature).

**Why it matters:** Airflow's `etl_helper.py` scans for this function to discover executable models:
```python
# etl_helper.py discovery logic
if hasattr(module, 'run_etl') and callable(module.run_etl):
    # register as PythonOperator task
```

**Common failure:** Function named `main()`, `run()`, or `etl()` instead of `run_etl`.

### F5: `_trino_io` usage

**Pass condition:** All Trino operations use imports from `python_models._trino_io`.

**Fail patterns to flag:**
```python
# INLINE CONNECTION — violates framework
from trino.dbapi import connect
conn = connect(host='trino-host', port=8080, ...)

# RAW HTTP — violates framework
import requests
response = requests.post('http://trino:8080/v1/statement', ...)

# SQLALCHEMY — violates framework
from sqlalchemy import create_engine
engine = create_engine('trino://...')
```

**Correct pattern:**
```python
from python_models._trino_io import execute_trino, overwrite_partition
```

### F6: OUTPUT_CONFIG

**Pass condition:** Code contains `OUTPUT_CONFIG = PythonModelConfig(...)` with import from `python_models._config`.

```python
from python_models._config import PythonModelConfig

OUTPUT_CONFIG = PythonModelConfig(
    model_name="backstage_catalogs",
    model_type="python",
    namespace="python",
    description="Fetches catalog data from Backstage API",
)
```

**Fail:** Custom dataclass, plain dict, or missing `OUTPUT_CONFIG` variable entirely.

### F7: Sync drift detection

**How to check:** Compare the cells in `.python.json` against the content of `.python.py`. The framework generates `.py` by concatenating code cells (excluding the runner cell) separated by `\n\n\n`.

**Warning condition:** `.python.py` contains code not derivable from JSON cells — indicates hand-edits that will be lost on next sync.

### F8: Runner cell position

**Pass condition:** The last code cell in the `cells` array is the notebook runner:
```python
run_etl(context)
```

**Why it matters:** This cell is stripped when generating `.python.py` (it's notebook-only for interactive execution). If it's not last, other cells after it would also be stripped.

### F9: Standard function structure

**Pass condition:** Code follows the ETL function contract:
```python
def extract(context):
    """Fetch data from external source."""
    ...

def transform_and_load(context):
    """Transform and write to Iceberg."""
    ...

def cleanup(context):
    """Drop staging tables."""
    ...

def run_etl(context):
    """Orchestrate the ETL."""
    extract(context)
    transform_and_load(context)
    cleanup(context)
```

**Warning:** Missing `cleanup()` (staging tables may leak). Missing `extract()` is acceptable if data comes directly from existing Trino tables.

---

## 2. Lineage Readiness (L)

### L1: Table properties emission

**Pass condition:** `PythonModelConfig` class (from `_config.py`) has a `table_properties` property that returns all required keys:

```python
@property
def table_properties(self) -> dict[str, str]:
    return {
        "python_model_name": self.model_name,
        "python_model_type": self.model_type,
        "python_model_namespace": self.namespace,
        "python_model_table": self.table_name or self.model_name,
        "python_model_description": self.description,
    }
```

**How to check:** Verify `OUTPUT_CONFIG` fields populate all five keys. Missing `description` is a warning (lineage node renders without description).

### L2: `python_model_upstream_sources` is set

**Pass condition:** The code explicitly sets `python_model_upstream_sources` on the output table via one of:

**Option A — ALTER TABLE SET PROPERTIES (Trino SQL):**
```python
execute_trino(f"""
    ALTER TABLE {OUTPUT_CONFIG.full_table_id}
    SET PROPERTIES extra_properties = MAP(
        ARRAY['python_model_upstream_sources'],
        ARRAY['opus_python_source.raw_events,analytics.user_sessions']
    )
""")
```

**Option B — PyIceberg catalog API:**
```python
table = catalog.load_table(OUTPUT_CONFIG.table_id)
with table.update_properties() as update:
    update.set("python_model_upstream_sources", "schema.table1,schema.table2")
```

**Option C — Set via `PythonModelConfig.table_properties` extension:**
```python
OUTPUT_CONFIG = PythonModelConfig(
    ...,
    upstream_sources=["opus_python_source.raw_events", "analytics.user_sessions"],
)
# table_properties includes python_model_upstream_sources automatically
```

**Fail:** No code path sets `python_model_upstream_sources` — lineage graph will show the Python model node but no upstream edges.

### L3: Format validation

**Pass condition:** Each entry in `python_model_upstream_sources` is `schema.table` format.

**Pass:** `opus_python_source.raw_events`, `analytics.user_sessions`
**Fail:** `iceberg_catalog.opus_python_source.raw_events` (includes catalog — lineage parser splits on first dot only), `raw_events` (missing schema)

### L4: Completeness — no missing upstream edges

**Procedure:**

1. Extract all table references from SQL in code cells:
   ```sql
   -- These patterns indicate source tables:
   FROM catalog.schema.table
   JOIN catalog.schema.table
   FROM schema.table
   JOIN schema.table
   ```

2. Normalize to `schema.table` (strip catalog prefix).

3. Exclude:
   - The model's own output table
   - Staging tables (`stg_tmp_*`, `tmp_*`)
   - Inline CTEs (WITH clause names)

4. Every remaining table must appear in `python_model_upstream_sources`.

**Example finding:**
```
Tables in SQL: opus_python_source.raw_events, analytics.user_sessions, reference.countries
Tables in upstream_sources: opus_python_source.raw_events, analytics.user_sessions
Missing from upstream_sources: reference.countries
```

### L5: Accuracy — no stale entries

**Procedure:** Every entry in `python_model_upstream_sources` must correspond to a table actually referenced in the model's SQL.

**Example finding:**
```
Tables in upstream_sources: opus_python_source.raw_events, opus_python_source.old_events
Tables in SQL: opus_python_source.raw_events
Stale in upstream_sources: opus_python_source.old_events
```

**Severity:** Warning (stale entries don't break lineage but create misleading edges in the graph).

### L6: DAG assignment

**Pass:** `"dags": ["daily_etl_dag"]` — model is scheduled.
**Warning:** `"dags": []` — model is a utility module. Lineage still works via table properties, but there's no Airflow task node in the DAG graph.

### L7: `depends_on` alignment

**Pass condition:** If model A reads from the output table of model B, then model A's `depends_on` should include model B's name.

**Example:**
```json
// Model: user_features.python.json
{
  "depends_on": ["user_embeddings"],  // user_embeddings writes to python.user_embeddings
  ...
}
```

**Why it matters:** `depends_on` wires Airflow task dependencies. Without it, model A may execute before model B finishes writing, reading stale/empty data.

### L8: Model ID consistency

**Pass condition:** File path `dags/python_models/etl/api_data/backstage_catalogs.python.json` → model ID `python__etl__api_data__backstage_catalogs` → matches `python_model_name` in table properties.

### L9: Companion `.python.py` exists

**Pass condition:** For file `<name>.python.json`, the file `<name>.python.py` exists in the same directory.

**Fail:** Airflow cannot discover or execute the model without the `.py` file.

### L10: Downstream source reference match

**Pass condition:** If any `.source.json` in the project references this Python model's output table, the table name must match `OUTPUT_CONFIG.table_name` (or `model_name` fallback).

**How to check:** Search project for `.source.json` files containing the model's output table name in their `tables` array.

---

## 3. Downstream Integration (D)

### D1: Standard catalog/schema

**Pass condition:** Output table uses the project-standard catalog and schema for Python model outputs.

**Default convention:** `glue_development.opus_python_source.<table_name>`

**When to flag:** Custom schema is acceptable but should be documented in `description` or `variables`. Flag if namespace doesn't match any known project convention.

### D2: Partition column emission

**Pass condition:** Output INSERT SQL includes `portal_partition_daily` column:

```sql
INSERT INTO {table}
SELECT
    col_a,
    col_b,
    '{ds}' AS portal_partition_daily
FROM ...
```

**Why it matters:** Downstream dbt models and the DJ framework expect this column for incremental processing. Without it, `overwrite_partition` DML will fail.

**Exception:** Models with `output.write_mode: "overwrite"` (full table refresh) may omit partition columns — flag as suggestion, not issue.

### D3: Column naming

**Pass condition:** All output column names in the INSERT SQL follow `snake_case`:
- `user_id` (pass)
- `created_at` (pass)
- `userId` (fail — camelCase)
- `Created At` (fail — spaces)

### D4: No `SELECT *`

**Pass condition:** Production INSERT statements enumerate columns explicitly.

```sql
-- FAIL:
INSERT INTO {table} SELECT * FROM staging

-- PASS:
INSERT INTO {table}
SELECT user_id, email, created_at, portal_partition_daily
FROM staging
```

**Why it matters:** `SELECT *` makes the output schema dependent on upstream schema changes. A column added upstream silently changes the downstream contract.

### D5: Table name matches model name

**Pass condition:** `OUTPUT_CONFIG.table_name` (or `model_name` fallback) matches what downstream consumers reference.

Convention: `python__<group>__<topic>__<name>` → table `<name>` in namespace `python`.

### D6: Deterministic output

**Warning conditions:**
- Non-deterministic functions without ORDER BY (e.g., `ROW_NUMBER()` without deterministic tie-breaking)
- UNION without explicit column ordering
- JSON field extraction where key order varies

---

## 4. Performance & Best Practices (P)

### P1: SQL-first adherence

**Flag these as violations:**

```python
# VIOLATION: filtering in pandas instead of SQL WHERE
df = df[df['status'] == 'active']

# VIOLATION: aggregation in pandas instead of SQL GROUP BY
result = df.groupby('category').agg({'amount': 'sum'})

# VIOLATION: join in pandas instead of SQL JOIN
merged = pd.merge(df1, df2, on='user_id')

# VIOLATION: dedup in pandas instead of SQL ROW_NUMBER
df = df.drop_duplicates(subset=['user_id'])

# VIOLATION: type casting in pandas instead of SQL CAST
df['amount'] = df['amount'].astype(float)
```

**Acceptable pandas usage:**
```python
# OK: parsing API JSON response into rows
df = pd.json_normalize(api_response['data'])

# OK: chunking for batch INSERT staging
for chunk in np.array_split(df, num_batches):
    stage_to_trino(chunk)
```

### P2: Staging table cleanup

**Pass condition:** `cleanup()` function drops all staging tables:

```python
def cleanup(context):
    execute_trino("DROP TABLE IF EXISTS iceberg_catalog.stg_tmp.backstage_raw")
```

**Fail:** No `cleanup()` function, or staging tables created in `extract()` not referenced in `cleanup()`.

**Impact:** Orphaned staging tables accumulate storage costs and namespace pollution.

### P3: Partition predicate pushdown

**Pass condition:** Queries against large source tables include partition column in WHERE:

```sql
-- PASS: partition filter enables pushdown
SELECT * FROM source_table
WHERE portal_partition_daily = '{ds}'

-- FAIL: full table scan
SELECT * FROM source_table
```

### P4: Batch staging

**Pass condition:** For large datasets, staging uses batched inserts:

```python
BATCH_SIZE = 10000
for i in range(0, len(df), BATCH_SIZE):
    batch = df.iloc[i:i+BATCH_SIZE]
    values = format_values(batch)
    execute_trino(f"INSERT INTO staging_table VALUES {values}")
```

**Warning trigger:** Single INSERT with > 100,000 rows or no batching visible for API pagination results.

### P5: Write mode appropriateness

| Data pattern | Correct write mode | Incorrect |
|-------------|-------------------|-----------|
| Daily snapshot, rerun-safe | `overwrite_partition` | `append` (duplicates on rerun) |
| Event stream, never reprocess | `append` | `overwrite_partition` (loses history) |
| Full refresh, small table | `overwrite(..., "true", insert_sql=...)` | `overwrite_partition` (unnecessary complexity) |
| Upsert by key | `merge` | `overwrite(..., "true", ...)` (loses unmatched rows) |

### P6: Partition filters on large tables

**Flag:** Any FROM/JOIN against a known large table (Iceberg table with partitions) without a WHERE clause filtering on partition columns.

### P7: DataFrame restriction

**Pass condition:** pandas/polars usage is limited to:
- API response parsing (`pd.json_normalize`, `pd.DataFrame(response_data)`)
- CSV/file reading (`pd.read_csv`)
- Batch chunking for staging
- Data that cannot exist in Trino yet (external ingestion)

**Fail:** Using DataFrame operations on data already in Trino (pull → transform → push back).

### P8: Explicit CAST

**Pass condition:** Type conversions in SQL INSERT use explicit CAST:

```sql
SELECT
    CAST(raw_amount AS DECIMAL(18,2)) AS amount,
    CAST(event_date AS DATE) AS event_date
FROM staging
```

**Fail:** Relying on implicit coercion or pandas `.astype()` for data that lands in Trino.

### P9: Error handling

**Pass condition:** `run_etl()` ensures cleanup runs even on failure:

```python
def run_etl(context):
    try:
        extract(context)
        transform_and_load(context)
    finally:
        cleanup(context)
```

**Fail:** Linear call without try/finally — staging tables leak on transform failure.

### P10: Idempotency

**Pass condition:** For `overwrite_partition` models, re-running with the same `ds` produces identical output (DELETE + INSERT pattern).

**Warning conditions:**
- `append` mode used with partition-based data (duplicates on rerun)
- Non-deterministic expressions in SELECT without dedup logic
- Timestamp-based columns that change on each execution (e.g., `NOW()` as `loaded_at`)

---

## Edge Cases

### Models without SQL (pure Python-to-S3)

If `output_type: "s3"`, several checks become N/A:
- D2 (partition column) — S3 models may use Hive-style partitioning differently
- P3/P6 (partition pushdown) — no Trino source queries
- L2 (upstream_sources) — may not be discoverable via Iceberg properties

Mark these as `N/A (S3 output model)` in the report.

### Utility modules (empty `dags`)

Models with `"dags": []` are importable Python utilities, not scheduled ETL. Checks L6, L7, L9 become N/A. Framework compliance checks still apply.

### Models reading from other Python model outputs

If this model reads from another Python model's output table (not an external source), `depends_on` is critical (L7) and the upstream table should appear in `python_model_upstream_sources` (L4).
