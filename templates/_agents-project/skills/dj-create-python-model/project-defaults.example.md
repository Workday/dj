# Python model project defaults (example)

Copy to `.agents/project/skills/dj-create-python-model/project-defaults.md` in your dbt project and fill in project-specific values. DJ skills read this file in **Step 0** before proposing defaults.

## authoring_mode

`hand-written` | `cells`

- **hand-written** — metadata-only `.python.json` + hand-authored `.python.py` (common in mature repos)
- **cells** — `.python.json` holds a `cells` array; DJ scaffolds `.python.py` from the Create Python Model webview

## catalogs

| Environment | Catalog |
| ----------- | ------- |
| dev         | `<dev_catalog>` e.g. `glue_development` |
| prod        | `<prod_catalog>` e.g. `glue_production` |

## output defaults

| Field | Value |
| ----- | ----- |
| `output.database` | `<dev_catalog>` |
| `output.schema` | `<python_output_schema>` |
| `output.partition_by` | `["portal_partition_daily"]` |
| `output.write_mode` | `overwrite_partitions` |
| `namespace` | `<python_output_schema>` or project convention |

## airflow

| Field | Value |
| ----- | ----- |
| default_dag | `<dag_id>` — must exist under `dags/` |
| kpo_image | `<kpo_runner_image>` (if using `compute: kpo`) |
| python_models_s3_bucket_var | `python_models_s3_bucket` |

## source registration

Path to the `.source.json` that registers python-model output tables for downstream dbt:

`<path/to/source>.source.json`

## helper patterns (optional)

Document project-specific APIs beyond generic `_trino_io` — e.g. `TableSpec`, topic `_helpers.py`, `execute_sql` / `fetch_value` naming.

## groups

Registered python-model `group` values: `ml`, `etl`, `analytics`, `perftools`, …
