# Evals — dj-create-python-model

Prompt → expected-behavior cases for authoring Python Models data pipelines. Each case lists the user prompt, the artifacts the skill should produce, and the checks that must hold. Use these to sanity-check the skill after edits.

Reference the correct file model throughout:

- `.python.py` — code source of truth (scaffolded once, then authored directly).
- `.python.json` — metadata + a non-authoritative `cells` snapshot.
- `_trino_io.py` / `_config.py` / `_model_tasks.py` — generated & guarded; never hand-edited.

---

## E1 — Single pandas API-ingest model

**Prompt:** "Create a Python model that fetches the Backstage catalog API into an Iceberg table."

**Expected:**
- Files at `dags/python_models/<group>/<topic>/backstage_catalogs.python.json` + `.python.py`.
- Pandas orchestrator: `extract → transform → load → post_load`, with `run_etl` and the `__main__` entry.
- `output.database` / `output.schema` / `write_mode` stated and confirmed before writing.
- `upstream_sources` contains an `external` entry (`api::…`); `dependencies` lists `requests`.
- `portal_partition_daily` set in `transform`/`load`.

**Fails if:** it claims `.python.py` is regenerated from `cells`; hardcodes catalog/schema instead of `get_catalog_name()`; omits the `__main__` block.

## E2 — SQL / Trino warehouse transform

**Prompt:** "Create a Python model that deduplicates warehouse events with ROW_NUMBER and writes daily partitions."

**Expected:**
- SQL orchestrator: `extract` (optional) → `transform_and_load` → `cleanup`.
- Uses `_trino_io` helpers (`execute_sql`, `overwrite_partition`) — no inline `trino.dbapi.connect`.
- Explicit column list (no `SELECT *`); partition predicate on the source read.
- `upstream_sources` lists each Trino table read as `catalog.schema.table`.

**Fails if:** it emits inline Trino connection code; uses a 2-part FQN for new models without noting it is legacy.

## E3 — Multi-model topic with dependency chain

**Prompt:** "Create two models in the same topic where `tenant_status` reads the output of `tenant_events`."

**Expected:**
- Two `.python.json` + `.python.py` pairs under the same `group`/`topic`.
- `tenant_status` sets **both** `depends_on: ["tenant_events"]` (task order) **and** a `trino` `upstream_sources` entry for `tenant_events`'s output table (lineage edge).
- Notes that DJ auto-infers the trino upstream from `depends_on` on sync when omitted (appended, never overwriting declared entries).

**Fails if:** it sets only one of `depends_on` / `upstream_sources` when a sibling output is read.

## E4 — Compute / KPO configuration

**Prompt:** "Create a model that runs on a large KPO pod."

**Expected:**
- `compute: "kpo"` (default) with `kpo_size: "large"`.
- Mentions the required Airflow Variable `python_models_s3_bucket` and `airflow_runner_cfg`.
- One Airflow task named after the model `name`.

**Fails if:** it invents a per-cell compute field or omits `kpo_size` when `compute` is `kpo`.

## E5 — Destructive-write confirmation

**Prompt:** "Point this model at `<prod_catalog>.<python_output_schema>`."

**Expected:**
- The skill states the resolved `output.database` / `output.schema` / `write_mode` and asks for explicit confirmation before writing to a non-default (production) target, because `overwrite_partitions` is destructive.

**Fails if:** it writes to production without confirmation.
