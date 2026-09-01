# Worked Example: Topic Pipeline (Pandas + Trino Upstream)

A three-model topic under `dags/python_models/etl/tenant_status/` — create each model via **Create Python Model** (one at a time) or batch-write `.python.json` files with this skill.

| Model | Style | Role |
| ----- | ----- | ---- |
| `tenant_events` | Pandas | Ingest API → Iceberg |
| `tenant_migrations` | Pandas | Ingest S3 CSV → Iceberg |
| `tenant_migration_status` | Pandas | Reads both upstream tables via `read_partition_to_dataframe`, merges in pandas, writes via `overwrite_partition_from_dataframe` |

DJ auto-infers trino `upstream_sources` on model 3 from `depends_on` when you save or sync `.python.json`. Authors may also declare them explicitly.

---

## Topic-level `.python.json` configs

### Model 1: `tenant_events` (API → Iceberg)

```jsonc
{
  "name": "tenant_events",
  "group": "etl",
  "topic": "tenant_status",
  "description": "Daily tenant events from Backstage API",
  "model_type": "python",
  "dags": ["opus_python_source"],
  "compute": "kpo",
  "kpo_size": "small",
  "depends_on": [],
  "upstream_sources": [
    { "type": "external", "value": "api::backstage_tenant_events" }
  ],
  "output": {
    "database": "glue_development",
    "schema": "opus_python_source",
    "table": "tenant_events",
    "partition_by": ["portal_partition_daily"],
    "write_mode": "overwrite_partitions"
  },
  "dependencies": ["requests>=2.28.0", "pandas>=2.0.0"],
  "tags": ["python-model", "api"]
}
```

Key cells (abbreviated):

```python
from python_models._trino_io import overwrite_partition_from_dataframe
from python_models._config import PythonModelConfig, get_catalog_name, build_context_from_env

OUTPUT_CONFIG = PythonModelConfig(
    model_name="tenant_events",
    namespace="opus_python_source",
    table_name="tenant_events",
    model_type="python",
    description="Daily tenant events from Backstage API",
)

def extract(context: dict) -> pd.DataFrame:
    import requests
    resp = requests.get(INPUT_VARIABLES["api_url"], headers={"Authorization": f"Bearer {INPUT_VARIABLES['api_token']}"})
    resp.raise_for_status()
    return pd.DataFrame(resp.json())

def transform(df: pd.DataFrame, context: dict) -> pd.DataFrame:
    df = df.rename(columns={"tenantId": "tenant_id", "eventType": "event_type"})
    df["portal_partition_daily"] = context["ds"]
    return df

def load(df: pd.DataFrame, context: dict) -> None:
    table_fqn = f"{get_catalog_name()}.{OUTPUT_CONFIG.namespace}.{OUTPUT_CONFIG.table_name}"
    columns = ["tenant_id", "event_type", "portal_partition_daily"]
    overwrite_partition_from_dataframe(
        table_fqn, "portal_partition_daily", context["ds"], df, columns
    )

def run_etl(context: dict):
    df = extract(context)
    df = transform(df, context)
    load(df, context)

if __name__ == "__main__":
    run_etl(build_context_from_env())
```

### Model 2: `tenant_migrations` (S3 CSV → Iceberg)

```jsonc
{
  "name": "tenant_migrations",
  "group": "etl",
  "topic": "tenant_status",
  "description": "Daily tenant migration records from S3 CSV",
  "depends_on": [],
  "upstream_sources": [
    { "type": "external", "value": "s3::data-lake/tenant_migrations/{ds}/migrations.csv" }
  ],
  "output": {
    "database": "glue_development",
    "schema": "opus_python_source",
    "table": "tenant_migrations",
    "partition_by": ["portal_partition_daily"],
    "write_mode": "overwrite_partitions"
  },
  "dependencies": ["boto3>=1.28.0", "pandas>=2.0.0"]
}
```

Pandas extract reads S3; `load()` uses `overwrite_partition_from_dataframe` the same way as model 1.

### Model 3: `tenant_migration_status` (integration — reads inferred trino upstreams)

```jsonc
{
  "name": "tenant_migration_status",
  "group": "etl",
  "topic": "tenant_status",
  "description": "Combines tenant events and migrations into a daily status table",
  "depends_on": ["tenant_events", "tenant_migrations"],
  "upstream_sources": [
    { "type": "trino", "value": "glue_development.opus_python_source.tenant_events" },
    { "type": "trino", "value": "glue_development.opus_python_source.tenant_migrations" }
  ],
  "output": {
    "database": "glue_development",
    "schema": "opus_python_source",
    "table": "tenant_migration_status",
    "partition_by": ["portal_partition_daily"],
    "write_mode": "overwrite_partitions"
  }
}
```

If `upstream_sources` is omitted, DJ infers the two trino entries from `depends_on` at create time.

Key cells:

```python
from python_models._trino_io import (
    read_partition_to_dataframe,
    overwrite_partition_from_dataframe,
)
from python_models._config import PythonModelConfig, get_catalog_name, build_context_from_env

OUTPUT_CONFIG = PythonModelConfig(
    model_name="tenant_migration_status",
    namespace="opus_python_source",
    table_name="tenant_migration_status",
    model_type="python",
    description="Combines tenant events and migrations into a daily status table",
)

EVENTS_FQN = f"{get_catalog_name()}.opus_python_source.tenant_events"
MIGRATIONS_FQN = f"{get_catalog_name()}.opus_python_source.tenant_migrations"

def extract(context: dict) -> dict[str, pd.DataFrame]:
    ds = context["ds"]
    return {
        "events": read_partition_to_dataframe(
            EVENTS_FQN, "portal_partition_daily", ds,
            columns=["tenant_id", "event_type"],
        ),
        "migrations": read_partition_to_dataframe(
            MIGRATIONS_FQN, "portal_partition_daily", ds,
            columns=["tenant_id", "migration_status"],
        ),
    }

def transform(dfs: dict[str, pd.DataFrame], context: dict) -> pd.DataFrame:
    merged = dfs["events"].merge(dfs["migrations"], on="tenant_id", how="outer")
    merged["has_event"] = merged["event_type"].notna()
    merged["portal_partition_daily"] = context["ds"]
    return merged

def load(df: pd.DataFrame, context: dict) -> None:
    table_fqn = f"{get_catalog_name()}.{OUTPUT_CONFIG.namespace}.{OUTPUT_CONFIG.table_name}"
    columns = ["tenant_id", "event_type", "migration_status", "has_event", "portal_partition_daily"]
    overwrite_partition_from_dataframe(
        table_fqn, "portal_partition_daily", context["ds"], df, columns
    )

def run_etl(context: dict):
    dfs = extract(context)
    df = transform(dfs, context)
    load(df, context)

if __name__ == "__main__":
    run_etl(build_context_from_env())
```

---

## SQL-path alternative (model 1 only)

The same API ingest can use the SQL orchestrator instead — stage with `stage()`, then `overwrite_partition` with a SQL `source_query`. Both paths are valid; pick one per model.

```python
from python_models._trino_io import execute_sql, overwrite_partition

def transform_and_load(context: dict) -> None:
    ds = context["ds"]
    catalog = get_catalog_name()
    target_fqn = f"{catalog}.{OUTPUT_CONFIG.namespace}.{OUTPUT_CONFIG.table_name}"
    staging_fqn = f"{catalog}.{OUTPUT_CONFIG.namespace}.stg_tmp_{OUTPUT_CONFIG.table_name}"

    source_query = f"""
        SELECT
            CAST(tenantId AS VARCHAR) AS tenant_id,
            TRIM(eventType) AS event_type,
            '{ds}' AS portal_partition_daily
        FROM {staging_fqn}
    """
    overwrite_partition(
        target_fqn,
        "portal_partition_daily",
        ds,
        source_query=source_query,
        columns=["tenant_id", "event_type", "portal_partition_daily"],
    )

def cleanup(context: dict) -> None:
    catalog = get_catalog_name()
    staging_fqn = f"{catalog}.{OUTPUT_CONFIG.namespace}.stg_tmp_{OUTPUT_CONFIG.table_name}"
    execute_sql(f"DROP TABLE IF EXISTS {staging_fqn}")
```

---

## Lineage result

After successful KPO runs, each output table carries:

```json
{
  "python_model_name": "tenant_migration_status",
  "python_model_upstream_sources": "[{\"type\":\"trino\",\"value\":\"glue_development.opus_python_source.tenant_events\"},{\"type\":\"trino\",\"value\":\"glue_development.opus_python_source.tenant_migrations\"}]"
}
```

Model Lineage renders:

- External leaves for `api::…` and `s3::…` on models 1–2
- Trino-ref nodes for upstream tables on model 3
- Python model nodes for each output table
- Recursive walk from downstream dbt sources through the full chain

---

## Downstream dbt source

Register each output table, then reference in `.model.json`:

```
glue_development__opus_python_source.tenant_migration_status
```

Use **`dj-create-source`** after the first successful run.
