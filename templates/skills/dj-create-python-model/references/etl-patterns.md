# ETL Pattern Reference

Detailed patterns for each ETL stage. **SQL-first:** all transformation and loading patterns use Trino SQL by default. DataFrame patterns are provided only for cases where SQL cannot express the logic.

All patterns target `glue_development.opus_python_source` by default.

---

## Trino Connection Helper

Include this in all models that use Trino for staging or transformation. All patterns below assume this function is defined:

```python
def get_trino_conn():
    """Reusable Trino connection."""
    from trino.dbapi import connect
    return connect(
        host=INPUT_VARIABLES.get("trino_host", "localhost"),
        port=int(INPUT_VARIABLES.get("trino_port", "8080")),
        user=INPUT_VARIABLES.get("trino_user", "etl"),
        catalog="glue_development",
        schema="opus_python_source",
    )
```

---

## Orchestrator Patterns

### SQL-first flow (preferred)

```python
def run_etl(context: dict):
    """Main ETL orchestrator — SQL-first flow."""
    df = extract(context)
    stage(df, context)
    transform_and_load(context)
    cleanup(context)
```

### DataFrame fallback flow

```python
def run_etl(context: dict):
    """Main ETL orchestrator — DataFrame fallback for Python-only transforms."""
    df = extract(context)
    df = transform(df, context)
    load(df, context)
    post_load(context)
```

---

## Extract Patterns

Extract is always Python — it pulls data from external systems into a DataFrame (or skips extraction if data is already in Trino).

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

    log.info(f"Total records extracted: {len(all_records)}")
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

### Data already in Trino (skip extract)

When the source data is already available in Trino, skip extraction entirely and go straight to SQL transform + load:

```python
def extract(context: dict):
    """No extraction needed — source data is already in Trino."""
    log.info("Source data is in Trino — skipping extract, will transform via SQL")
    return None
```

---

## Stage Pattern

Stage a raw DataFrame into a temporary Trino table so all subsequent transformation happens in SQL. **Always batch INSERTs** to manage memory.

```python
def stage(df: pd.DataFrame, context: dict) -> None:
    """Stage raw data into a temporary Trino table."""
    if df is None or df.empty:
        log.warning("No data to stage")
        return

    conn = get_trino_conn()
    cursor = conn.cursor()
    table_name = OUTPUT_CONFIG.table_name or OUTPUT_CONFIG.model_name
    staging_table = f"stg_tmp_{table_name}"

    cursor.execute(f"DROP TABLE IF EXISTS glue_development.opus_python_source.{staging_table}")

    columns = df.columns.tolist()
    col_defs = ", ".join(f"{c} VARCHAR" for c in columns)
    cursor.execute(
        f"CREATE TABLE glue_development.opus_python_source.{staging_table} ({col_defs})"
    )

    batch_size = 1000
    for i in range(0, len(df), batch_size):
        batch = df.iloc[i:i + batch_size]
        values_list = []
        for _, row in batch.iterrows():
            vals = ", ".join(
                f"'{str(v).replace(chr(39), chr(39)+chr(39))}'" for v in row
            )
            values_list.append(f"({vals})")
        cursor.execute(
            f"INSERT INTO glue_development.opus_python_source.{staging_table} "
            f"VALUES {', '.join(values_list)}"
        )

    log.info(f"Staged {len(df)} rows into {staging_table}")
```

---

## Transform + Load Patterns (SQL-first)

All transformations are SQL expressions executed by Trino. Trino manages the Iceberg table writes.

### Column renaming and type casting

```python
def transform_and_load(context: dict) -> None:
    conn = get_trino_conn()
    cursor = conn.cursor()
    ds = context["ds"]
    target = f"glue_development.opus_python_source.{OUTPUT_CONFIG.table_name}"
    staging = f"glue_development.opus_python_source.stg_tmp_{OUTPUT_CONFIG.table_name}"

    cursor.execute(f"""
        CREATE TABLE IF NOT EXISTS {target} (
            user_id VARCHAR,
            full_name VARCHAR,
            created_at TIMESTAMP,
            amount DOUBLE,
            portal_partition_daily VARCHAR
        )
        WITH (
            format = 'PARQUET',
            partitioned_by = ARRAY['portal_partition_daily']
        )
    """)

    cursor.execute(f"DELETE FROM {target} WHERE portal_partition_daily = '{ds}'")

    cursor.execute(f"""
        INSERT INTO {target}
        SELECT
            CAST(userID AS VARCHAR) AS user_id,
            TRIM(fullName) AS full_name,
            CAST(createdAt AS TIMESTAMP) AS created_at,
            CAST(amount AS DOUBLE) AS amount,
            '{ds}' AS portal_partition_daily
        FROM {staging}
    """)

    log.info(f"Transform + load complete: {target}")
```

### Filtering with WHERE

```python
    cursor.execute(f"""
        INSERT INTO {target}
        SELECT
            id,
            name,
            status,
            CAST(amount AS DOUBLE) AS amount,
            '{ds}' AS portal_partition_daily
        FROM {staging}
        WHERE status IN ('active', 'pending')
          AND CAST(amount AS DOUBLE) > 0
    """)
```

### Deduplication with ROW_NUMBER

```python
    cursor.execute(f"""
        INSERT INTO {target}
        SELECT id, name, status, updated_at, '{ds}' AS portal_partition_daily
        FROM (
            SELECT
                *,
                ROW_NUMBER() OVER (
                    PARTITION BY id
                    ORDER BY updated_at DESC
                ) AS rn
            FROM {staging}
        )
        WHERE rn = 1
    """)
```

### Aggregation with GROUP BY

```python
    cursor.execute(f"""
        INSERT INTO {target}
        SELECT
            category,
            region,
            SUM(CAST(amount AS DOUBLE)) AS total_amount,
            COUNT(*) AS record_count,
            AVG(CAST(amount AS DOUBLE)) AS avg_amount,
            '{ds}' AS portal_partition_daily
        FROM {staging}
        GROUP BY category, region
    """)
```

### Join with existing Trino tables

```python
    cursor.execute(f"""
        INSERT INTO {target}
        SELECT
            s.id,
            s.name,
            r.region_name,
            CAST(s.amount AS DOUBLE) AS amount,
            '{ds}' AS portal_partition_daily
        FROM {staging} s
        LEFT JOIN glue_development.opus_python_source.region_lookup r
            ON s.region_code = r.region_code
    """)
```

### Window functions

```python
    cursor.execute(f"""
        INSERT INTO {target}
        SELECT
            id,
            name,
            amount,
            SUM(CAST(amount AS DOUBLE)) OVER (
                PARTITION BY category
                ORDER BY created_at
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS running_total,
            '{ds}' AS portal_partition_daily
        FROM {staging}
    """)
```

### CASE expressions

```python
    cursor.execute(f"""
        INSERT INTO {target}
        SELECT
            id,
            name,
            CASE
                WHEN CAST(amount AS DOUBLE) > 1000 THEN 'high'
                WHEN CAST(amount AS DOUBLE) > 100 THEN 'medium'
                ELSE 'low'
            END AS amount_tier,
            '{ds}' AS portal_partition_daily
        FROM {staging}
    """)
```

### Source already in Trino (no staging needed)

When source data is already in Trino, skip extract and stage entirely — go directly to SQL transform + load:

```python
def transform_and_load(context: dict) -> None:
    """Transform from an existing Trino source table — no staging needed."""
    conn = get_trino_conn()
    cursor = conn.cursor()
    ds = context["ds"]
    source = "glue_development.some_catalog.raw_events"
    target = f"glue_development.opus_python_source.{OUTPUT_CONFIG.table_name}"

    cursor.execute(f"""
        CREATE TABLE IF NOT EXISTS {target} (
            event_id VARCHAR,
            event_type VARCHAR,
            user_id VARCHAR,
            event_count BIGINT,
            portal_partition_daily VARCHAR
        )
        WITH (
            format = 'PARQUET',
            partitioned_by = ARRAY['portal_partition_daily']
        )
    """)

    cursor.execute(f"DELETE FROM {target} WHERE portal_partition_daily = '{ds}'")

    cursor.execute(f"""
        INSERT INTO {target}
        SELECT
            event_id,
            event_type,
            user_id,
            COUNT(*) AS event_count,
            '{ds}' AS portal_partition_daily
        FROM {source}
        WHERE portal_partition_daily = '{ds}'
        GROUP BY event_id, event_type, user_id
    """)

    log.info(f"Direct SQL transform + load complete: {target}")
```

---

## DataFrame Transform Patterns (fallback — use only when SQL cannot express the logic)

These patterns are for cases where the transformation requires Python-specific capabilities.

### Nested JSON flattening

SQL cannot easily handle deeply nested JSON with variable keys:

```python
def transform(df: pd.DataFrame, context: dict) -> pd.DataFrame:
    """Flatten nested JSON columns — SQL cannot handle variable-depth nesting."""
    if df is None or df.empty:
        return pd.DataFrame()

    if "metadata" in df.columns:
        meta_df = pd.json_normalize(df["metadata"].apply(
            lambda x: x if isinstance(x, dict) else {}
        ))
        meta_df.columns = [f"meta_{c}" for c in meta_df.columns]
        df = pd.concat([df.drop(columns=["metadata"]), meta_df], axis=1)

    df["portal_partition_daily"] = context["ds"]
    return df
```

### Complex string parsing

When regex or multi-step parsing logic is impractical in SQL:

```python
def transform(df: pd.DataFrame, context: dict) -> pd.DataFrame:
    """Parse structured strings that need multi-step regex — not practical in SQL."""
    import re
    if df is None or df.empty:
        return pd.DataFrame()

    pattern = r'(?P<host>[^:]+):(?P<port>\d+)/(?P<path>.+)'
    parsed = df["endpoint"].str.extract(pattern)
    df = pd.concat([df, parsed], axis=1)

    df["portal_partition_daily"] = context["ds"]
    return df
```

### ML preprocessing

When the transformation involves scikit-learn or similar:

```python
def transform(df: pd.DataFrame, context: dict) -> pd.DataFrame:
    """ML feature engineering — requires Python libraries."""
    from sklearn.preprocessing import LabelEncoder
    if df is None or df.empty:
        return pd.DataFrame()

    le = LabelEncoder()
    df["category_encoded"] = le.fit_transform(df["category"])

    df["portal_partition_daily"] = context["ds"]
    return df
```

After a DataFrame transform, **still load via Trino** by staging the result and using SQL CTAS:

```python
def load(df: pd.DataFrame, context: dict) -> None:
    """Stage transformed DataFrame to Trino, then write final table via SQL."""
    if df is None or df.empty:
        log.warning("No data to load")
        return

    stage(df, context)
    transform_and_load_from_staging(context)
    cleanup(context)
```

---

## Cleanup Pattern

Always drop staging tables after the final write:

```python
def cleanup(context: dict) -> None:
    """Drop temporary staging table."""
    conn = get_trino_conn()
    cursor = conn.cursor()
    table_name = OUTPUT_CONFIG.table_name or OUTPUT_CONFIG.model_name
    staging_table = f"stg_tmp_{table_name}"
    cursor.execute(
        f"DROP TABLE IF EXISTS glue_development.opus_python_source.{staging_table}"
    )
    log.info(f"Dropped staging table: {staging_table}")
```

---

## Post-Load Patterns

### Validate with Trino SQL

```python
def post_load(context: dict) -> None:
    """Verify data was written correctly via Trino query."""
    conn = get_trino_conn()
    cursor = conn.cursor()
    ds = context["ds"]
    target = f"glue_development.opus_python_source.{OUTPUT_CONFIG.table_name}"

    cursor.execute(f"""
        SELECT COUNT(*) AS row_count
        FROM {target}
        WHERE portal_partition_daily = '{ds}'
    """)
    row_count = cursor.fetchone()[0]
    log.info(f"Post-load validation: {target} has {row_count} rows for {ds}")

    if row_count == 0:
        raise ValueError(f"No rows loaded for {ds} — check extract and transform logic")
```

### Partition sync (Hive metastore)

```python
def post_load(context: dict) -> None:
    """Sync Hive metastore partitions after Iceberg write."""
    conn = get_trino_conn()
    cursor = conn.cursor()
    table = f"{OUTPUT_CONFIG.namespace}.{OUTPUT_CONFIG.table_name or OUTPUT_CONFIG.model_name}"
    cursor.execute(f"CALL iceberg.system.sync_partition_metadata('{table}')")
    log.info(f"Partition sync complete for {table}")
```

---

## Optimization Patterns

### Partition pruning

Always include partition column predicates in WHERE clauses to avoid full table scans:

```sql
-- GOOD: Trino prunes partitions, reads only one day
SELECT * FROM target WHERE portal_partition_daily = '2025-01-15'

-- BAD: full table scan — reads every partition
SELECT * FROM target WHERE name = 'foo'
```

### Column projection

Enumerate columns explicitly — never use `SELECT *` in production:

```sql
-- GOOD: reads only needed columns from Parquet/Iceberg
SELECT id, name, amount, portal_partition_daily FROM target

-- BAD: reads all columns, wastes I/O and memory
SELECT * FROM target
```

### EXPLAIN ANALYZE

Use `EXPLAIN ANALYZE` to verify query plans before deploying:

```python
def debug_query(context: dict) -> None:
    """Check query plan for performance issues."""
    conn = get_trino_conn()
    cursor = conn.cursor()

    cursor.execute(f"""
        EXPLAIN ANALYZE
        SELECT id, name, amount
        FROM glue_development.opus_python_source.stg_tmp_my_model
        WHERE status = 'active'
    """)

    for row in cursor.fetchall():
        log.info(row[0])
```

### Write mode decision matrix

| Scenario | Write mode | SQL pattern |
|----------|-----------|-------------|
| Daily idempotent loads | `overwrite_partitions` | `DELETE WHERE partition = ds` then `INSERT INTO ... SELECT` |
| Event streams / append-only | `append` | `INSERT INTO ... SELECT` (no DELETE) |
| Full table refresh | `overwrite` | `DROP TABLE` then `CREATE TABLE AS SELECT` |
| Slowly changing dimensions | `merge` (if supported) | `MERGE INTO ... USING ... ON ...` |

### Batch size for staging

For large DataFrames, tune the batch size based on column count:

| Columns | Recommended batch size |
|---------|----------------------|
| < 10 | 1000 - 5000 rows |
| 10 - 50 | 500 - 1000 rows |
| > 50 | 100 - 500 rows |

### Avoid common performance pitfalls

| Pitfall | Fix |
|---------|-----|
| `SELECT *` in transforms | Enumerate needed columns explicitly |
| No partition predicate in WHERE | Add `WHERE portal_partition_daily = '{ds}'` |
| Pulling Trino data into pandas for transforms | Use SQL transforms directly in Trino |
| Not dropping staging tables | Always call `cleanup()` after `transform_and_load()` |
| Single INSERT for entire DataFrame | Batch into chunks (e.g., 1000 rows) |
| Creating tables without `partitioned_by` | Always specify `partitioned_by = ARRAY['portal_partition_daily']` |
