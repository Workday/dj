# Worked Example: SQL-First Python Model

A complete `.python.json` for an API-fetch model using the SQL-first pattern.

**Flow:** Extract from Backstage API -> stage raw data into a temporary Trino table -> transform and load via SQL (`DELETE + INSERT INTO ... SELECT`) -> drop staging table.

**Target:** `glue_development.opus_python_source.backstage_catalogs`

```jsonc
{
  "name": "backstage_catalogs",
  "group": "etl",
  "topic": "backstage",
  "description": "Fetches catalog entities from Backstage API daily, stages to Trino, transforms and loads via SQL",
  "model_type": "python",
  "dags": ["source_etl"],
  "output_type": "iceberg",
  "output": {
    "database": "glue_development",
    "schema": "opus_python_source",
    "table": "backstage_catalogs",
    "partition_by": ["portal_partition_daily"],
    "write_mode": "overwrite_partitions"
  },
  "namespace": "python",
  "table_name": "backstage_catalogs",
  "enable_notebook": true,
  "dependencies": ["requests>=2.28.0", "trino>=0.327.0"],
  "tags": ["python-model", "api"],
  "owner": "platform-team",
  "variables": {
    "api_url": "https://backstage.example.com/api/catalog/entities",
    "api_token": "",
    "trino_host": "localhost",
    "trino_port": "8080",
    "trino_user": "etl"
  },
  "cells": [
    {
      "cell_type": "markdown",
      "metadata": {},
      "source": ["# Python Model: python__etl__backstage__backstage_catalogs\n", "**DAGs**: source_etl\n", "**Strategy**: SQL-first — extract from API, stage to Trino, transform + load via SQL\n"]
    },
    {
      "cell_type": "code",
      "execution_count": null,
      "metadata": {},
      "outputs": [],
      "source": [
        "from datetime import datetime\n",
        "import io\n",
        "import json\n",
        "import logging\n",
        "\n",
        "import pandas as pd\n",
        "import requests\n",
        "\n",
        "log = logging.getLogger(__name__)\n",
        "\n",
        "context = {\n",
        "    'ds': datetime.now().strftime('%Y-%m-%d'),\n",
        "    'ds_nodash': datetime.now().strftime('%Y%m%d'),\n",
        "}\n"
      ]
    },
    {
      "cell_type": "code",
      "execution_count": null,
      "metadata": {},
      "outputs": [],
      "source": [
        "from python_models._config import PythonModelConfig\n",
        "\n",
        "OUTPUT_CONFIG = PythonModelConfig(\n",
        "    model_name=\"backstage_catalogs\",\n",
        "    namespace=\"python\",\n",
        "    table_name=\"backstage_catalogs\",\n",
        "    model_type=\"python\",\n",
        "    description=\"Fetches catalog entities from Backstage API daily\",\n",
        ")\n"
      ]
    },
    {
      "cell_type": "code",
      "execution_count": null,
      "metadata": {},
      "outputs": [],
      "source": [
        "# ============================================================\n",
        "# INPUT VARIABLES\n",
        "# ============================================================\n",
        "INPUT_VARIABLES = {\n",
        "    \"name\": \"backstage_catalogs\",\n",
        "    \"group\": \"etl\",\n",
        "    \"topic\": \"backstage\",\n",
        "    \"description\": \"Fetches catalog entities from Backstage API daily\",\n",
        "    \"api_url\": \"https://backstage.example.com/api/catalog/entities\",\n",
        "    \"api_token\": \"\",\n",
        "    \"trino_host\": \"localhost\",\n",
        "    \"trino_port\": \"8080\",\n",
        "    \"trino_user\": \"etl\",\n",
        "}\n"
      ]
    },
    {
      "cell_type": "code",
      "execution_count": null,
      "metadata": {},
      "outputs": [],
      "source": [
        "# ============================================================\n",
        "# TRINO CONNECTION\n",
        "# ============================================================\n",
        "def get_trino_conn():\n",
        "    \"\"\"Reusable Trino connection.\"\"\"\n",
        "    from trino.dbapi import connect\n",
        "    return connect(\n",
        "        host=INPUT_VARIABLES.get(\"trino_host\", \"localhost\"),\n",
        "        port=int(INPUT_VARIABLES.get(\"trino_port\", \"8080\")),\n",
        "        user=INPUT_VARIABLES.get(\"trino_user\", \"etl\"),\n",
        "        catalog=\"glue_development\",\n",
        "        schema=\"opus_python_source\",\n",
        "    )\n"
      ]
    },
    {
      "cell_type": "code",
      "execution_count": null,
      "metadata": {},
      "outputs": [],
      "source": [
        "# ============================================================\n",
        "# EXTRACT\n",
        "# ============================================================\n",
        "def extract(context: dict) -> pd.DataFrame:\n",
        "    \"\"\"Fetch catalog entities from Backstage API.\"\"\"\n",
        "    log.info(f\"Extracting for {context['ds']}...\")\n",
        "    url = INPUT_VARIABLES[\"api_url\"]\n",
        "    headers = {\"Authorization\": f\"Bearer {INPUT_VARIABLES['api_token']}\"}\n",
        "\n",
        "    resp = requests.get(url, headers=headers)\n",
        "    resp.raise_for_status()\n",
        "    return pd.DataFrame(resp.json())\n"
      ]
    },
    {
      "cell_type": "code",
      "execution_count": null,
      "metadata": {},
      "outputs": [],
      "source": [
        "# ============================================================\n",
        "# STAGE (raw data -> temporary Trino table)\n",
        "# ============================================================\n",
        "def stage(df: pd.DataFrame, context: dict) -> None:\n",
        "    \"\"\"Stage raw data into a temporary Trino table.\"\"\"\n",
        "    if df is None or df.empty:\n",
        "        log.warning(\"No data to stage\")\n",
        "        return\n",
        "\n",
        "    conn = get_trino_conn()\n",
        "    cursor = conn.cursor()\n",
        "    staging_table = \"stg_tmp_backstage_catalogs\"\n",
        "\n",
        "    cursor.execute(f\"DROP TABLE IF EXISTS glue_development.opus_python_source.{staging_table}\")\n",
        "\n",
        "    columns = df.columns.tolist()\n",
        "    col_defs = \", \".join(f\"{c} VARCHAR\" for c in columns)\n",
        "    cursor.execute(\n",
        "        f\"CREATE TABLE glue_development.opus_python_source.{staging_table} ({col_defs})\"\n",
        "    )\n",
        "\n",
        "    batch_size = 1000\n",
        "    for i in range(0, len(df), batch_size):\n",
        "        batch = df.iloc[i:i + batch_size]\n",
        "        values_list = []\n",
        "        for _, row in batch.iterrows():\n",
        "            vals = \", \".join(f\"'{str(v).replace(chr(39), chr(39)+chr(39))}'\"\n",
        "                             for v in row)\n",
        "            values_list.append(f\"({vals})\")\n",
        "        cursor.execute(\n",
        "            f\"INSERT INTO glue_development.opus_python_source.{staging_table} \"\n",
        "            f\"VALUES {', '.join(values_list)}\"\n",
        "        )\n",
        "\n",
        "    log.info(f\"Staged {len(df)} rows into {staging_table}\")\n"
      ]
    },
    {
      "cell_type": "code",
      "execution_count": null,
      "metadata": {},
      "outputs": [],
      "source": [
        "# ============================================================\n",
        "# TRANSFORM + LOAD (all transformations in Trino SQL)\n",
        "# ============================================================\n",
        "def transform_and_load(context: dict) -> None:\n",
        "    \"\"\"Transform and load via Trino SQL.\"\"\"\n",
        "    conn = get_trino_conn()\n",
        "    cursor = conn.cursor()\n",
        "    ds = context[\"ds\"]\n",
        "    target = \"glue_development.opus_python_source.backstage_catalogs\"\n",
        "    staging = \"glue_development.opus_python_source.stg_tmp_backstage_catalogs\"\n",
        "\n",
        "    cursor.execute(f\"\"\"\n",
        "        CREATE TABLE IF NOT EXISTS {target} (\n",
        "            entity_ref VARCHAR,\n",
        "            kind VARCHAR,\n",
        "            name VARCHAR,\n",
        "            namespace VARCHAR,\n",
        "            portal_partition_daily VARCHAR\n",
        "        )\n",
        "        WITH (\n",
        "            format = 'PARQUET',\n",
        "            partitioned_by = ARRAY['portal_partition_daily']\n",
        "        )\n",
        "    \"\"\")\n",
        "\n",
        "    cursor.execute(f\"\"\"\n",
        "        DELETE FROM {target}\n",
        "        WHERE portal_partition_daily = '{ds}'\n",
        "    \"\"\")\n",
        "\n",
        "    cursor.execute(f\"\"\"\n",
        "        INSERT INTO {target}\n",
        "        SELECT\n",
        "            CAST(entity_ref AS VARCHAR) AS entity_ref,\n",
        "            TRIM(LOWER(kind)) AS kind,\n",
        "            TRIM(LOWER(name)) AS name,\n",
        "            COALESCE(namespace, 'default') AS namespace,\n",
        "            '{ds}' AS portal_partition_daily\n",
        "        FROM {staging}\n",
        "    \"\"\")\n",
        "\n",
        "    log.info(f\"Transform + load complete: {target}\")\n"
      ]
    },
    {
      "cell_type": "code",
      "execution_count": null,
      "metadata": {},
      "outputs": [],
      "source": [
        "# ============================================================\n",
        "# CLEANUP\n",
        "# ============================================================\n",
        "def cleanup(context: dict) -> None:\n",
        "    \"\"\"Drop temporary staging table.\"\"\"\n",
        "    conn = get_trino_conn()\n",
        "    cursor = conn.cursor()\n",
        "    staging_table = \"stg_tmp_backstage_catalogs\"\n",
        "    cursor.execute(f\"DROP TABLE IF EXISTS glue_development.opus_python_source.{staging_table}\")\n",
        "    log.info(f\"Dropped staging table: {staging_table}\")\n"
      ]
    },
    {
      "cell_type": "code",
      "execution_count": null,
      "metadata": {},
      "outputs": [],
      "source": [
        "# ============================================================\n",
        "# MAIN\n",
        "# ============================================================\n",
        "def run_etl(context: dict):\n",
        "    \"\"\"Main ETL orchestrator — SQL-first flow.\"\"\"\n",
        "    df = extract(context)\n",
        "    stage(df, context)\n",
        "    transform_and_load(context)\n",
        "    cleanup(context)\n"
      ]
    },
    {
      "cell_type": "code",
      "execution_count": null,
      "metadata": {},
      "outputs": [],
      "source": ["# Run the ETL\n", "run_etl(context)\n"]
    }
  ]
}
```
