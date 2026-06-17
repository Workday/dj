---
name: dj-create-python-model
description: >-
  Create a DJ .python.json file for a new Python ETL model. Use when the user
  wants to create a Python model, ETL pipeline, data ingestion, API fetch,
  CSV import, or any pre-dbt Python data processing task.
compatibility: DJ (Data JSON) Framework extension workspace with .dj/schemas/
metadata:
  dj-skill: '1.0'
---

# Create DJ Python Model

**Create** new **`.python.json`** files for Python ETL models. These are **not** dbt SQL models — they are pre-dbt Python pipelines that extract data from external sources (APIs, databases, files) and load it into Iceberg tables. Downstream dbt SQL models then consume these tables as sources.

**SQL-first principle:** Use **Trino SQL** for transformations and loading wherever possible. Trino manages compute, memory, partitioning, and table metadata — let it do the heavy lifting. Use **pandas DataFrames only when SQL cannot express the logic** (API response parsing, nested JSON flattening, ML preprocessing). Python's role is orchestration and external data ingestion; Trino's role is transformation and storage.

**Never** hand-edit **`.python.py`** — only edit **`.python.json`** (the framework regenerates `.py` from the `cells` array).

## When this skill applies

Use this skill when the user mentions: python model, ETL, data ingestion, API fetch, CSV import, pre-dbt processing, Python pipeline, data extraction, or creating a model that pulls data from an external system.

**Out of scope** — delegate to sibling skills:

- SQL `.model.json` files (staging/intermediate/mart) → `dj-create-new-model`
- `.source.json` files → `dj-create-new-model`
- Lightdash YAML → `dj-edit-lightdash-yaml`
- Refactoring existing models → `dj-review-and-refactor-model`

## Interactive gathering workflow

Ask the user the following questions in order. Batch related questions together to minimize round-trips. Skip questions when the answer is already clear from context.

### Step 1: Identity

Ask for:

| Field | Rule | Example |
|-------|------|---------|
| **name** | `^[a-z][a-z0-9_]*$` | `backstage_catalogs` |
| **group** | One of: `ml`, `etl`, `analytics`, `others` (or project-configured groups) | `etl` |
| **topic** | `^[a-z][a-z0-9_]*$` | `api_data` |
| **description** | Free text (optional) | `Fetches catalog data from Backstage API` |

### Step 2: DAG assignment

Ask which Airflow DAG(s) to attach the model to. Look at existing DAGs in the project (`dags/` directory). If the model is a utility/library module, `dags` can be empty.

### Step 3: Data source type

Ask what kind of data source the model will extract from:

| Source type | Typical packages | Extract pattern |
|-------------|-----------------|-----------------|
| **REST API** | `requests` | HTTP GET/POST with pagination |
| **Database / Trino** | `trino` | SQL query via Trino client |
| **CSV / file** | `pandas` | `pd.read_csv()` from local or S3 |
| **S3 objects** | `boto3` | List/download from S3 bucket |
| **Custom** | User-specified | User provides extract logic |

### Step 4: Transformation needs — SQL-first decision

Ask what transformations are needed. Then apply this decision tree:

**Can the transformation be expressed as SQL?**

| If YES (use Trino SQL) | If NO (use pandas DataFrame) |
|------------------------|------------------------------|
| Filtering / WHERE clauses | Nested JSON flattening (dicts/lists) |
| Column renaming / aliasing | API response parsing / pagination |
| Type casting (CAST) | ML preprocessing (scikit-learn, etc.) |
| Deduplication (ROW_NUMBER) | Complex string parsing not in SQL |
| Aggregation (GROUP BY) | External service calls mid-transform |
| Joins with other Trino tables | Binary/image data processing |
| Date partitioning | |
| Window functions | |
| CASE expressions | |

**Always ask:** "Can this transformation be done in Trino SQL?" before defaulting to pandas. SQL transformations are preferred because:

- Trino manages compute and memory — no Python OOM on large datasets
- Trino handles partitioned writes natively — no manual partition management
- SQL transformations are declarative and easier to reason about
- Trino pushes predicates down to storage — reads only needed data

### Step 5: Output configuration

Present the defaults and ask if the user wants to override any:

| Field | Default | Override? |
|-------|---------|-----------|
| `output.database` | `glue_development` | Yes |
| `output.schema` | `opus_python_source` | Yes |
| `output_type` | `iceberg` | Yes (alternative: `s3`) |
| `output.write_mode` | `overwrite_partitions` | Yes |
| `output.partition_by` | `["portal_partition_daily"]` | Yes |
| `namespace` | `python` | Yes |

### Step 6: Dependencies & optional fields

Ask about:

- **Python packages** needed beyond the defaults (e.g., `requests>=2.28.0`, `boto3`)
- **depends_on** — other Python models that must complete first
- **tags** — organizational tags (predefined: `python-model`, `api`, `csv`, `s3`, `trino`, `snapshot`, `iceberg`)
- **owner** — team or individual
- **enable_notebook** — generate companion `.python.ipynb` (default: `true`)

## Optimization guidance

**Proactively suggest these optimizations** to the user while building the model. Do not wait for the user to ask — surface relevant advice based on the model's source type, transformation needs, and data volume.

### Partitioning strategy

- **Default:** `portal_partition_daily` — suits most daily ingestion workloads
- **Low-volume data** (< 1000 rows/day): consider `portal_partition_monthly` to avoid small-file overhead
- **High-cardinality or large tables**: consider composite partitions (e.g., `["portal_partition_daily", "region"]`) for better predicate pushdown
- **Event streams**: partition by hour if sub-daily granularity is needed

### SQL transform best practices

- **Never `SELECT *`** in production transforms — always enumerate needed columns explicitly
- **Always filter on partition columns** in WHERE clauses to enable predicate pushdown
- **Use `CAST(... AS type)`** in the SQL SELECT instead of pandas type conversion
- **Deduplicate with `ROW_NUMBER()`** window function instead of pandas `drop_duplicates`
- **Aggregations belong in SQL** — `GROUP BY` in Trino uses distributed compute, unlike single-node pandas
- **Joins with Trino tables** — join against existing Iceberg/Trino tables in SQL rather than merging DataFrames

### Write mode selection

| Write mode | Use when |
|------------|----------|
| `overwrite_partitions` | Idempotent daily loads — rerun-safe, replaces only affected partitions |
| `append` | Event streams or append-only logs — never overwrites existing data |
| `overwrite` | Full table refresh — replaces entire table on each run |

### Resource management

- **Stage then transform**: for API/CSV sources, stage raw data into a temporary Trino table, then run SQL transforms. Drop the staging table after the final write
- **Batch large API responses**: chunk into batches (e.g., 10,000 rows) before staging to Trino to manage memory
- **Avoid loading entire datasets into pandas**: if data is already in Trino, query it with SQL — do not pull it into a DataFrame just to push it back

## File path and naming

```
dags/python_models/<group>/<topic>/<name>.python.json
```

Model ID convention: `python__<group>__<topic>__<name>`

## Schema reference

Before writing, read `.dj/schemas/python-model.schema.json` to validate field shapes. Required fields: `name`, `group`, `topic`.

## Workflow checklist

- [ ] Step 1: Gather identity (name, group, topic, description)
- [ ] Step 2: Determine DAG assignment
- [ ] Step 3: Identify data source type and extraction pattern
- [ ] Step 4: Determine transformation needs (SQL-first decision tree)
- [ ] Step 5: Confirm output config (defaults to `glue_development` / `opus_python_source`)
- [ ] Step 6: Collect dependencies and optional fields
- [ ] Step 7: Suggest performance optimizations based on source type and data volume
- [ ] Step 8: Read `.dj/schemas/python-model.schema.json` for validation
- [ ] Step 9: Write `.python.json` at `dags/python_models/<group>/<topic>/<name>.python.json`
- [ ] Step 10: Verify the file matches the schema

## ETL cell structure

The `cells` array in `.python.json` uses notebook format. Each cell has `cell_type` (`code` or `markdown`), `source` (array of strings, each ending with `\n`), and optional `metadata`, `outputs`, `execution_count`.

### SQL-first flow (preferred)

Use this when data comes from an external source (API, CSV, S3) but all transformations can be expressed in SQL:

1. **Markdown header** — model name and DAG info
2. **Imports + context** — standard imports and Airflow context dict
3. **Output config** — `PythonModelConfig` from `python_models/_config.py`
4. **Input variables** — model-specific constants
5. **Trino connection helper** — reusable `get_trino_conn()` function
6. **Extract** — `def extract(context)` fetches external data (API/CSV/S3) into a DataFrame
7. **Stage** — `def stage(df, context)` writes raw DataFrame to a temporary Trino staging table
8. **Transform + Load** — `def transform_and_load(context)` runs SQL `INSERT INTO ... SELECT` with all transformations against the staging table, writing directly into the final Iceberg table
9. **Cleanup** — `def cleanup(context)` drops the temporary staging table
10. **Main** — `def run_etl(context)` calls extract -> stage -> transform_and_load -> cleanup
11. **Runner** — notebook-only `run_etl(context)` call

### DataFrame-only flow (fallback)

Use this **only** when transformations cannot be expressed in SQL (nested JSON flattening, ML preprocessing, complex Python-only logic):

1. **Markdown header** — model name and DAG info
2. **Imports + context** — standard imports and Airflow context dict
3. **Output config** — `PythonModelConfig` from `python_models/_config.py`
4. **Input variables** — model-specific constants
5. **Extract** — `def extract(context) -> pd.DataFrame`
6. **Transform** — `def transform(df, context) -> pd.DataFrame` — only for Python-only transforms
7. **Load** — `def load(df, context)` — stages DataFrame to Trino, then runs SQL CTAS for the final table
8. **Post-load** — `def post_load(context) -> None`
9. **Main** — `def run_etl(context)` calls extract -> transform -> load -> post_load
10. **Runner** — notebook-only `run_etl(context)` call

### Code templates and worked example

For complete code templates for each ETL stage (extract, stage, transform+load, cleanup, orchestrators), see [references/etl-patterns.md](references/etl-patterns.md).

For a complete `.python.json` file showing the SQL-first pattern end-to-end, see [references/worked-example.md](references/worked-example.md).

## Downstream dbt integration

After the Python model writes data to `glue_development.opus_python_source.<table>`, downstream dbt SQL models reference it as a source using the DJ source notation:

```
glue_development__opus_python_source.<table_name>
```

(Double underscore separates catalog from schema, dot separates schema from table.)

## Conventions and gotchas

- **SQL-first** — prefer Trino SQL for all transformations that SQL can express. Use DataFrames only for external data ingestion and Python-only logic
- **Only edit `.python.json`** — the extension regenerates `.python.py` (and `.python.ipynb`) from the `cells` array
- **`run_etl()` is required** — Airflow's `etl_helper.py` scans for `def run_etl(` to discover models
- **`OUTPUT_CONFIG`** must use `PythonModelConfig` from `python_models/_config.py` — the extension auto-generates this file
- **`portal_partition_daily`** must be set as a column (either via SQL `'{ds}' AS portal_partition_daily` or pandas assignment) for partition-based writes
- **Always suggest optimizations** — partitioning strategy, column pruning, predicate pushdown, write mode selection
- **Stage then SQL-transform** — for external data sources, stage raw data into a temp Trino table, run SQL transforms against it, then drop the staging table
- **Never `SELECT *`** in production SQL — enumerate columns explicitly for clarity and performance
- **Drop staging tables** — always clean up `stg_tmp_*` tables in the cleanup step
- **Batch INSERT for staging** — chunk large DataFrames into batches (e.g., 1000 rows) when staging to Trino
- **`depends_on`** ordering is enforced by Airflow task dependency wiring
- **`_config.py` and `_etl_helper.py`** are auto-created by the extension — do not manually create them
- **Cell `source` format** — each element in the `source` array is a string ending with `\n`; the array represents lines
- **The notebook runner cell** (`run_etl(context)`) is stripped when generating `.python.py` — keep it as the last cell for interactive notebook use
- **Name uniqueness** — model names must be unique across all groups/topics within the project
