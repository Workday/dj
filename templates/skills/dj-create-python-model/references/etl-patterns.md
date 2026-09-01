# ETL Pattern Reference

Stage-level patterns for both orchestrators. All Trino I/O goes through **`python_models._trino_io`** — no inline `trino.dbapi.connect`, no `execute_trino`, no standalone `delete()`.

Default output target: `glue_development.opus_python_source` (override via `output` in `.python.json` and `get_catalog_name()` / `get_namespace_name()` at runtime).

Build `table_fqn` for every helper call:

```python
from python_models._config import PythonModelConfig, get_catalog_name

table_fqn = f"{get_catalog_name()}.{OUTPUT_CONFIG.namespace}.{OUTPUT_CONFIG.table_name or OUTPUT_CONFIG.model_name}"
```

---

## Orchestrator patterns

### Pandas orchestrator

```python
def run_etl(context: dict):
    """Pandas end-to-end flow."""
    df = extract(context)
    df = transform(df, context)
    load(df, context)
    post_load(context)
```

### SQL / Trino orchestrator

```python
def run_etl(context: dict):
    """SQL end-to-end flow."""
    extract(context)          # optional — stage external data or no-op
    transform_and_load(context)
    cleanup(context)
```

### Mixed (author choice)

Combine stages when the user requests it — e.g. pandas `extract` + SQL `transform_and_load` after staging. Not required by the framework.

---

## Extract patterns

Extract is Python — it pulls data from external systems or reads Trino partitions into a DataFrame. Skip when the SQL path reads directly from existing Trino tables.

### REST API with pagination

```python
def extract(context: dict) -> pd.DataFrame:
    """Fetch paginated data from REST API."""
    import requests
    log.info(f"Extracting for {context['ds']}...")

    url = INPUT_VARIABLES.get("api_url", "https://api.example.com/data")
    headers = {
        "Authorization": f"Bearer {INPUT_VARIABLES.get('api_token', '')}",
        "Content-Type": "application/json",
    }

    all_records = []
    page = 1
    per_page = 100

    while True:
        resp = requests.get(
            url, headers=headers,
            params={"page": page, "per_page": per_page},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

        if isinstance(data, dict):
            records = data.get("items", data.get("results", data.get("data", [])))
        else:
            records = data

        if not records:
            break

        all_records.extend(records)
        log.info(f"Page {page}: fetched {len(records)} records (total: {len(all_records)})")
        page += 1

    return pd.DataFrame(all_records)
```

### REST API with cursor-based pagination

```python
def extract(context: dict) -> pd.DataFrame:
    """Fetch data using cursor-based pagination."""
    import requests
    log.info(f"Extracting for {context['ds']}...")

    url = INPUT_VARIABLES.get("api_url")
    headers = {"Authorization": f"Bearer {INPUT_VARIABLES.get('api_token', '')}"}

    all_records = []
    cursor = None

    while True:
        params = {"limit": 100}
        if cursor:
            params["cursor"] = cursor

        resp = requests.get(url, headers=headers, params=params, timeout=30)
        resp.raise_for_status()
        body = resp.json()

        records = body.get("data", [])
        all_records.extend(records)

        cursor = body.get("next_cursor")
        if not cursor or not records:
            break

    return pd.DataFrame(all_records)
```

### CSV from S3

```python
def extract(context: dict) -> pd.DataFrame:
    """Download and read CSV from S3."""
    import boto3
    log.info(f"Extracting for {context['ds']}...")

    s3 = boto3.client("s3")
    bucket = INPUT_VARIABLES.get("s3_bucket", "my-data-bucket")
    prefix = INPUT_VARIABLES.get("s3_prefix", "raw-data")
    key = f"{prefix}/{context['ds']}/data.csv"

    log.info(f"Downloading s3://{bucket}/{key}")
    obj = s3.get_object(Bucket=bucket, Key=key)
    return pd.read_csv(io.BytesIO(obj["Body"].read()))
```

### S3 object listing (multi-file)

```python
def extract(context: dict) -> pd.DataFrame:
    """List and read multiple files from an S3 prefix."""
    import boto3
    log.info(f"Extracting for {context['ds']}...")

    s3 = boto3.client("s3")
    bucket = INPUT_VARIABLES.get("s3_bucket", "my-data-bucket")
    prefix = f"{INPUT_VARIABLES.get('s3_prefix', 'data')}/{context['ds']}/"

    paginator = s3.get_paginator("list_objects_v2")
    frames = []

    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            if obj["Key"].endswith(".csv"):
                log.info(f"Reading {obj['Key']}")
                body = s3.get_object(Bucket=bucket, Key=obj["Key"])
                frames.append(pd.read_csv(io.BytesIO(body["Body"].read())))

    if not frames:
        log.warning(f"No CSV files found under s3://{bucket}/{prefix}")
        return pd.DataFrame()

    return pd.concat(frames, ignore_index=True)
```

### Read upstream Trino partition (pandas path)

When `upstream_sources` declares a trino table, read via `_trino_io`:

```python
from python_models._trino_io import read_partition_to_dataframe

def extract(context: dict) -> pd.DataFrame:
    """Read an upstream Iceberg partition declared in upstream_sources."""
    ds = context["ds"]
    upstream_fqn = f"{get_catalog_name()}.opus_python_source.upstream_model_a"
    return read_partition_to_dataframe(
        upstream_fqn,
        "portal_partition_daily",
        ds,
        columns=["id", "name", "amount"],
    )
```

Declare in `.python.json`:

```json
"upstream_sources": [
  { "type": "trino", "value": "glue_development.opus_python_source.upstream_model_a" }
]
```

### Data already in Trino (SQL path — skip extract)

```python
def extract(context: dict) -> None:
    """No extraction — transform_and_load reads directly from Trino."""
    log.info("Source data is in Trino — skipping extract")
```

---

## Pandas transform patterns

```python
def transform(df: pd.DataFrame, context: dict) -> pd.DataFrame:
    """Pandas transforms — set partition column before load."""
    if df is None or df.empty:
        return pd.DataFrame()

    # Example: nested JSON flattening
    if "metadata" in df.columns:
        meta_df = pd.json_normalize(df["metadata"].apply(
            lambda x: x if isinstance(x, dict) else {}
        ))
        meta_df.columns = [f"meta_{c}" for c in meta_df.columns]
        df = pd.concat([df.drop(columns=["metadata"]), meta_df], axis=1)

    df["portal_partition_daily"] = context["ds"]
    return df
```

### Merge multiple upstream DataFrames

```python
def transform(dfs: dict[str, pd.DataFrame], context: dict) -> pd.DataFrame:
    """Join upstream partitions in pandas (integration model pattern)."""
    merged = dfs["model_a"].merge(dfs["model_b"], on="tenant_id", how="outer")
    merged["portal_partition_daily"] = context["ds"]
    return merged
```

---

## Pandas load pattern

```python
from python_models._trino_io import overwrite_partition_from_dataframe

def load(df: pd.DataFrame, context: dict) -> None:
    """Write partition output from a DataFrame."""
    if df is None or df.empty:
        log.warning("No data to load")
        return

    ds = context["ds"]
    table_fqn = f"{get_catalog_name()}.{OUTPUT_CONFIG.namespace}.{OUTPUT_CONFIG.table_name}"
    columns = ["tenant_id", "status", "portal_partition_daily"]
    overwrite_partition_from_dataframe(
        table_fqn,
        "portal_partition_daily",
        ds,
        df,
        columns,
        batch_size=1000,
    )
    log.info(f"Loaded {len(df)} rows into {table_fqn} for {ds}")
```

---

## SQL stage pattern (optional — SQL path with external extract)

Stage raw external data into a temporary table before SQL transforms. Use `create_iceberg_table` + batched `execute_sql` INSERTs, or stage in pandas and load via `overwrite_partition_from_dataframe` to a `stg_tmp_*` table.

```python
from python_models._trino_io import create_iceberg_table, overwrite_partition_from_dataframe

def stage(df: pd.DataFrame, context: dict) -> None:
    """Stage raw API data into a temporary Iceberg table for SQL transforms."""
    if df is None or df.empty:
        log.warning("No data to stage")
        return

    catalog = get_catalog_name()
    staging_fqn = f"{catalog}.{OUTPUT_CONFIG.namespace}.stg_tmp_{OUTPUT_CONFIG.table_name}"
    columns = [(c, "VARCHAR") for c in df.columns.tolist()]

    create_iceberg_table(staging_fqn, columns)
    # Write all rows to a single staging partition (ds-scoped for cleanup)
    df = df.copy()
    df["_stage_partition"] = context["ds"]
    staging_columns = list(df.columns)
    overwrite_partition_from_dataframe(
        staging_fqn, "_stage_partition", context["ds"], df, staging_columns
    )
    log.info(f"Staged {len(df)} rows into {staging_fqn}")
```

---

## SQL transform + load patterns

All partition loads use `overwrite_partition` — not manual `DELETE` + `INSERT`.

### Column renaming and type casting

```python
from python_models._trino_io import overwrite_partition

def transform_and_load(context: dict) -> None:
    ds = context["ds"]
    catalog = get_catalog_name()
    target_fqn = f"{catalog}.{OUTPUT_CONFIG.namespace}.{OUTPUT_CONFIG.table_name}"
    staging_fqn = f"{catalog}.{OUTPUT_CONFIG.namespace}.stg_tmp_{OUTPUT_CONFIG.table_name}"

    source_query = f"""
        SELECT
            CAST(userID AS VARCHAR) AS user_id,
            TRIM(fullName) AS full_name,
            CAST(createdAt AS TIMESTAMP) AS created_at,
            CAST(amount AS DOUBLE) AS amount,
            '{ds}' AS portal_partition_daily
        FROM {staging_fqn}
    """
    overwrite_partition(
        target_fqn,
        "portal_partition_daily",
        ds,
        source_query=source_query,
        columns=["user_id", "full_name", "created_at", "amount", "portal_partition_daily"],
    )
```

### Filtering with WHERE

```python
    source_query = f"""
        SELECT id, name, status, CAST(amount AS DOUBLE) AS amount, '{ds}' AS portal_partition_daily
        FROM {staging_fqn}
        WHERE status IN ('active', 'pending')
          AND CAST(amount AS DOUBLE) > 0
    """
```

### Deduplication with ROW_NUMBER

```python
    source_query = f"""
        SELECT id, name, status, updated_at, '{ds}' AS portal_partition_daily
        FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) AS rn
            FROM {staging_fqn}
        )
        WHERE rn = 1
    """
```

### Aggregation with GROUP BY

```python
    source_query = f"""
        SELECT
            category,
            region,
            SUM(CAST(amount AS DOUBLE)) AS total_amount,
            COUNT(*) AS record_count,
            '{ds}' AS portal_partition_daily
        FROM {staging_fqn}
        GROUP BY category, region
    """
```

### Join with existing Trino tables

```python
    source_fqn = f"{catalog}.opus_python_source.raw_events"
    lookup_fqn = f"{catalog}.opus_python_source.region_lookup"

    source_query = f"""
        SELECT
            s.id, s.name, r.region_name,
            CAST(s.amount AS DOUBLE) AS amount,
            '{ds}' AS portal_partition_daily
        FROM {source_fqn} s
        LEFT JOIN {lookup_fqn} r ON s.region_code = r.region_code
        WHERE s.portal_partition_daily = '{ds}'
    """
```

### Source already in Trino (no staging)

```python
def transform_and_load(context: dict) -> None:
    """Direct SQL transform from an existing Trino table."""
    ds = context["ds"]
    catalog = get_catalog_name()
    source_fqn = f"{catalog}.analytics.raw_events"
    target_fqn = f"{catalog}.{OUTPUT_CONFIG.namespace}.{OUTPUT_CONFIG.table_name}"

    source_query = f"""
        SELECT event_id, event_type, user_id, COUNT(*) AS event_count, '{ds}' AS portal_partition_daily
        FROM {source_fqn}
        WHERE portal_partition_daily = '{ds}'
        GROUP BY event_id, event_type, user_id
    """
    overwrite_partition(
        target_fqn,
        "portal_partition_daily",
        ds,
        source_query=source_query,
        columns=["event_id", "event_type", "user_id", "event_count", "portal_partition_daily"],
    )
```

---

## Cleanup pattern (SQL path)

```python
from python_models._trino_io import execute_sql

def cleanup(context: dict) -> None:
    """Drop temporary staging tables."""
    catalog = get_catalog_name()
    staging_fqn = f"{catalog}.{OUTPUT_CONFIG.namespace}.stg_tmp_{OUTPUT_CONFIG.table_name}"
    execute_sql(f"DROP TABLE IF EXISTS {staging_fqn}")
    log.info(f"Dropped staging table: {staging_fqn}")
```

---

## Post-load patterns

### Validate with fetch_value

```python
from python_models._trino_io import fetch_value

def post_load(context: dict) -> None:
    """Verify data was written correctly."""
    ds = context["ds"]
    table_fqn = f"{get_catalog_name()}.{OUTPUT_CONFIG.namespace}.{OUTPUT_CONFIG.table_name}"

    row_count = fetch_value(f"""
        SELECT COUNT(*) FROM {table_fqn}
        WHERE portal_partition_daily = '{ds}'
    """)
    log.info(f"Post-load validation: {table_fqn} has {row_count} rows for {ds}")

    if not row_count:
        raise ValueError(f"No rows loaded for {ds}")
```

### Error handling with cleanup (SQL path)

```python
def run_etl(context: dict):
    try:
        extract(context)
        transform_and_load(context)
    finally:
        cleanup(context)
```

---

## Optimization patterns

### Partition pruning

```sql
-- Reads one partition
SELECT id, name FROM target WHERE portal_partition_daily = '2025-01-15'

-- Full table scan — avoid on large tables
SELECT id, name FROM target WHERE name = 'foo'
```

### Column projection

Enumerate columns in SELECT and INSERT — avoid `SELECT *` in production SQL.

### Write mode decision matrix

| Scenario | Write mode | Pattern |
| -------- | ---------- | ------- |
| Daily idempotent loads | `overwrite_partitions` | `overwrite_partition` / `overwrite_partition_from_dataframe` |
| Event streams | `append` | `append(table_fqn, insert_sql)` |
| Full table refresh | `overwrite` | `overwrite(table_fqn, "true", insert_sql=…)` |
| Upsert by key | merge | `merge(table_fqn, merge_sql)` |

### Batch size guidance (pandas writes)

| Columns | Recommended `batch_size` |
| ------- | ------------------------ |
| < 10 | 1000–5000 |
| 10–50 | 500–1000 |
| > 50 | 100–500 |

### Common pitfalls

| Pitfall | Fix |
| ------- | --- |
| Inline Trino connections | Import from `python_models._trino_io` |
| `execute_trino` (old name) | Use `execute_sql` / `fetch_value` |
| Manual `DELETE` before INSERT | Use `overwrite_partition` or `overwrite_partition_from_dataframe` |
| `SELECT *` in production SQL | Enumerate columns |
| Missing partition predicate | Add `WHERE portal_partition_daily = '{ds}'` on large sources |
| Orphaned `stg_tmp_*` tables | Call `cleanup()` in `finally` block |
