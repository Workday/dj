from __future__ import annotations

import json
import logging
import os
import re
import runpy
import time
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

from airflow.exceptions import AirflowSkipException
from airflow.models import Variable
from airflow.models.dag import DagContext
from airflow.operators.python import PythonOperator
from airflow.utils.email import send_email
from airflow.utils.task_group import TaskGroup

from _ext_.services import trino_run
from _ext_.kpo_factory import build_gated_kpo_task

log = logging.getLogger(__name__)

PYTHON_DIR = Path(__file__).parent.parent / "python_models"

PYTHON_SOURCE_CONFIG_VAR = "dj_python_source_config"
RUN_MESSAGE_MAX_LENGTH = 500


def _sql_escape(value: str | None) -> str:
    if value is None:
        return ""
    return str(value).replace("'", "''")


def sql_python_model_runs_merge(
    *,
    catalog: str,
    schema: str,
    table: str,
    model_name: str,
    model_group: str,
    etl_date: str,
    etl_timestamp: str,
    run_status: str,
    run_seconds: float,
    is_skipped: bool,
    run_message: str | None = None,
) -> str:
    """Build MERGE SQL for python model run tracking meta table."""
    message_sql = (
        f"'{_sql_escape(run_message[:RUN_MESSAGE_MAX_LENGTH])}'"
        if run_message
        else "NULL"
    )
    return f"""
        MERGE INTO {catalog}.{schema}.{table} old
        USING (
            VALUES (
                '{_sql_escape(model_name)}',
                '{_sql_escape(model_group)}',
                cast('{etl_date}' as date),
                cast('{etl_timestamp}' as timestamp(6)),
                '{_sql_escape(run_status)}',
                {run_seconds},
                {str(is_skipped).lower()},
                {message_sql}
            )
        ) new (
            model_name, model_group, etl_date, etl_timestamp,
            run_status, run_seconds, is_skipped, run_message
        )
        ON (old.model_name = new.model_name AND old.etl_date = new.etl_date)
        WHEN MATCHED THEN UPDATE SET
            model_group = new.model_group,
            etl_timestamp = new.etl_timestamp,
            run_status = new.run_status,
            run_seconds = new.run_seconds,
            is_skipped = new.is_skipped,
            run_message = new.run_message
        WHEN NOT MATCHED THEN INSERT (
            model_name, model_group, etl_date, etl_timestamp,
            run_status, run_seconds, is_skipped, run_message
        ) VALUES (
            new.model_name, new.model_group, new.etl_date, new.etl_timestamp,
            new.run_status, new.run_seconds, new.is_skipped, new.run_message
        )
    """


def record_python_model_run(
    *,
    model_name: str,
    model_group: str,
    etl_date: str,
    etl_timestamp: str,
    run_status: str,
    run_seconds: float,
    is_skipped: bool,
    run_message: str | None = None,
    context: dict | None = None,
) -> None:
    """Persist a python model run outcome to Trino meta table."""
    if not etl_timestamp:
        log.warning("Skipping run record for %s: etl_timestamp not set", model_name)
        return

    tracking = get_python_source_run_tracking_config(context)
    merge_sql = sql_python_model_runs_merge(
        catalog=tracking["catalog"],
        schema=tracking["schema"],
        table=tracking["table"],
        model_name=model_name,
        model_group=model_group,
        etl_date=etl_date,
        etl_timestamp=etl_timestamp,
        run_status=run_status,
        run_seconds=run_seconds,
        is_skipped=is_skipped,
        run_message=run_message,
    )
    trino_run(merge_sql)
    log.info(
        "Recorded python model run: %s status=%s skipped=%s in %.2fs",
        model_name,
        run_status,
        is_skipped,
        run_seconds,
    )


def _get_etl_timestamp_from_context(context: dict) -> str | None:
    ti = context.get("ti")
    if not ti:
        return None
    return ti.xcom_pull(key="etl_timestamp", task_ids="start_etl")


def _get_recorded_model_names(etl_timestamp: str, context: dict) -> set[str]:
    """Return model names already recorded for this DAG run etl_timestamp."""
    tracking = get_python_source_run_tracking_config(context)
    sql = f"""
        SELECT model_name
        FROM {tracking["catalog"]}.{tracking["schema"]}.{tracking["table"]}
        WHERE etl_timestamp = cast('{etl_timestamp}' as timestamp(6))
    """
    rows = trino_run(sql)
    return {row[0] for row in rows if row and row[0]}


def _build_task_model_registry(
    dag_id: str,
    python_source_config: dict | None = None,
) -> dict[str, dict]:
    """Map Airflow task_id to topic and model_ids for python model tasks."""
    if python_source_config is None:
        python_source_config = get_python_source_config()

    models = discover_models(dag_id)
    by_topic: dict[str, list[dict]] = defaultdict(list)
    for model in models:
        by_topic[model.get("topic") or "default"].append(model)

    registry: dict[str, dict] = {}
    for topic, topic_models in sorted(by_topic.items()):
        if python_source_config.get(topic, {}).get("skip", False):
            continue
        for model_tasks in _compute_model_tasks(topic_models):
            kpo_models = [m for m in model_tasks if _model_uses_kpo(m)]
            airflow_models = [m for m in model_tasks if not _model_uses_kpo(m)]

            if kpo_models:
                for m in kpo_models:
                    model_id = m["model_id"]
                    registry[model_id] = {
                        "topic": topic,
                        "models": [model_id],
                    }

            if airflow_models:
                task_name = "_".join(m["model_id"] for m in airflow_models)
                registry[task_name] = {
                    "topic": topic,
                    "models": [m["model_id"] for m in airflow_models],
                }
    return registry


def _resolve_model_id_for_mapped_ti(
    ti,
    models: list[str],
    context: dict | None = None,
) -> str | None:
    """Resolve model_id for a mapped task instance."""
    rendered = getattr(ti, "rendered_map_index", None)
    if rendered and str(rendered) in models:
        return str(rendered)

    if context:
        model_id = context.get("model_id")
        if model_id and model_id in models:
            return model_id
        model = context.get("model") or {}
        model_id = model.get("model_id")
        if model_id and model_id in models:
            return model_id

    map_index = getattr(ti, "map_index", -1)
    if isinstance(map_index, int) and 0 <= map_index < len(models):
        return models[map_index]

    rendered_str = str(rendered) if rendered is not None else ""
    if rendered_str.isdigit():
        idx = int(rendered_str)
        if 0 <= idx < len(models):
            return models[idx]

    return None


def _record_reconciled_model_run(
    *,
    model_id: str,
    model_group: str,
    etl_date: str,
    etl_timestamp: str,
    run_status: str,
    run_message: str,
    context: dict,
) -> None:
    try:
        record_python_model_run(
            model_name=model_id,
            model_group=model_group,
            etl_date=etl_date,
            etl_timestamp=etl_timestamp,
            run_status=run_status,
            run_seconds=0.0,
            is_skipped=False,
            run_message=run_message,
            context=context,
        )
    except Exception as exc:
        log.warning(
            "Failed to reconcile python model run for %s: %s",
            model_id,
            exc,
        )


def _record_airflow_task_failure(context: dict) -> None:
    """Record model run failures that occur before _execute_model_with_context runs."""
    try:
        ti = context["ti"]
        if ti.state not in ("failed", "upstream_failed"):
            return
        if ti.state == "failed" and ti.start_date is not None:
            return

        etl_timestamp = _get_etl_timestamp_from_context(context)
        if not etl_timestamp:
            return

        dag_id = context["dag_run"].dag_id
        registry = _build_task_model_registry(dag_id)
        batch_info = registry.get(ti.task_id)
        if not batch_info:
            return

        topic = batch_info["topic"]
        models = batch_info["models"]
        etl_date = context["ds"]
        run_message = (
            getattr(ti, "note", None)
            or "Airflow task failed before model execution (no task logs)"
        )

        if ti.state == "failed" and ti.map_index >= 0:
            model_id = _resolve_model_id_for_mapped_ti(ti, models, context)
            if model_id:
                _record_reconciled_model_run(
                    model_id=model_id,
                    model_group=topic,
                    etl_date=etl_date,
                    etl_timestamp=etl_timestamp,
                    run_status="error",
                    run_message=run_message,
                    context=context,
                )
        elif ti.state == "upstream_failed":
            blocked_message = "Blocked by failed upstream batch"
            if ti.map_index >= 0:
                model_id = _resolve_model_id_for_mapped_ti(ti, models, context)
                targets = [model_id] if model_id else models
            else:
                targets = models
            for model_id in targets:
                if model_id:
                    _record_reconciled_model_run(
                        model_id=model_id,
                        model_group=topic,
                        etl_date=etl_date,
                        etl_timestamp=etl_timestamp,
                        run_status="upstream_failed",
                        run_message=blocked_message,
                        context=context,
                    )
    except Exception as exc:
        log.warning("Failed to record Airflow task failure callback: %s", exc)


def reconcile_python_model_runs_from_airflow(
    context: dict,
    etl_timestamp: str | None,
) -> None:
    """Backfill meta rows for Airflow failures not captured by _execute_model_with_context."""
    if not etl_timestamp:
        log.warning("Skipping python model run reconciliation: etl_timestamp not set")
        return

    dag_run = context["dag_run"]
    dag_id = dag_run.dag_id
    etl_date = context["ds"]
    recorded = _get_recorded_model_names(etl_timestamp, context)
    registry = _build_task_model_registry(dag_id)

    for ti in dag_run.get_task_instances():
        if ti.state not in ("failed", "upstream_failed"):
            continue

        batch_info = registry.get(ti.task_id)
        if not batch_info:
            continue

        topic = batch_info["topic"]
        models = batch_info["models"]
        run_message = (
            getattr(ti, "note", None)
            or "Airflow task failed before model execution (no task logs)"
        )

        if ti.state == "failed" and ti.map_index >= 0:
            model_id = _resolve_model_id_for_mapped_ti(ti, models)
            if model_id and model_id not in recorded:
                _record_reconciled_model_run(
                    model_id=model_id,
                    model_group=topic,
                    etl_date=etl_date,
                    etl_timestamp=etl_timestamp,
                    run_status="error",
                    run_message=run_message,
                    context=context,
                )
                recorded.add(model_id)
        elif ti.state == "upstream_failed":
            blocked_message = "Blocked by failed upstream batch"
            if ti.map_index >= 0:
                model_id = _resolve_model_id_for_mapped_ti(ti, models)
                targets = [model_id] if model_id else models
            else:
                targets = models
            for model_id in targets:
                if model_id and model_id not in recorded:
                    _record_reconciled_model_run(
                        model_id=model_id,
                        model_group=topic,
                        etl_date=etl_date,
                        etl_timestamp=etl_timestamp,
                        run_status="upstream_failed",
                        run_message=blocked_message,
                        context=context,
                    )
                    recorded.add(model_id)

    log.info(
        "Reconciled python model runs from Airflow for etl_timestamp=%s",
        etl_timestamp,
    )


def _escape_html(value: str) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _append_failure_table_rows(html_content: str, models: list, status_color: str) -> str:
    for model in models:
        model_name = model[0] if model[0] else "N/A"
        model_group = model[1] if len(model) > 1 and model[1] else "N/A"
        run_status = model[2] if len(model) > 2 and model[2] else "error"
        run_message = model[3] if len(model) > 3 and model[3] else "N/A"
        etl_date = model[4] if len(model) > 4 and model[4] else "N/A"
        run_message_escaped = (
            _escape_html(run_message) if run_message != "N/A" else "N/A"
        )
        html_content += f"""
            <tr>
                <td>{model_name}</td>
                <td>{model_group}</td>
                <td style="color: {status_color}; font-weight: bold;">{run_status}</td>
                <td>{etl_date}</td>
                <td>{run_message_escaped}</td>
            </tr>
        """
    return html_content


def send_python_source_failure_notification(
    email_list: list[str],
    context: dict,
    etl_timestamp: str | None,
) -> None:
    """Send consolidated HTML failure summary for DAG run."""
    if not email_list:
        return
    if not etl_timestamp:
        log.warning("etl_timestamp is required to query python model failures")
        return

    dag_run = context["dag_run"]
    tracking = get_python_source_run_tracking_config(context)
    failed_models_sql = f"""
        SELECT
            model_name,
            model_group,
            run_status,
            substring(run_message, 1, 100) AS run_message,
            cast(etl_date AS varchar) AS etl_date
        FROM {tracking["catalog"]}.{tracking["schema"]}.{tracking["table"]}
        WHERE etl_timestamp = cast('{etl_timestamp}' as timestamp(6))
          AND run_status = 'error'
        ORDER BY model_group, model_name
    """
    upstream_failed_sql = f"""
        SELECT
            model_name,
            model_group,
            run_status,
            substring(run_message, 1, 100) AS run_message,
            cast(etl_date AS varchar) AS etl_date
        FROM {tracking["catalog"]}.{tracking["schema"]}.{tracking["table"]}
        WHERE etl_timestamp = cast('{etl_timestamp}' as timestamp(6))
          AND run_status = 'upstream_failed'
        ORDER BY model_group, model_name
    """
    failed_models = trino_run(failed_models_sql)
    upstream_failed_models = trino_run(upstream_failed_sql)
    if not failed_models and not upstream_failed_models:
        return

    subject = (
        f"[Python Models] {dag_run.dag_id} - DAG Failures - "
        f"{dag_run.execution_date.strftime('%Y-%m-%d %H:%M:%S')}"
    )
    html_content = f"""
        <h2>Python Models - Failure Summary</h2>
        <p><strong>DAG ID:</strong> source_etl's {dag_run.dag_id}</p>
        <p><strong>Execution Date:</strong> {dag_run.execution_date}</p>
        <p><strong>ETL Timestamp:</strong> {etl_timestamp}</p>
    """

    if failed_models:
        html_content += f"""
        <h3>Failed Models ({len(failed_models)}):</h3>
        <table border="1" cellpadding="5" cellspacing="0">
            <tr>
                <th>Model Name</th>
                <th>Model Group</th>
                <th>Run Status</th>
                <th>ETL Date</th>
                <th>Error Message</th>
            </tr>
        """
        html_content = _append_failure_table_rows(html_content, failed_models, "red")
        html_content += "</table>"

    if upstream_failed_models:
        html_content += f"""
        <h3>Upstream Failed Models ({len(upstream_failed_models)}):</h3>
        <table border="1" cellpadding="5" cellspacing="0">
            <tr>
                <th>Model Name</th>
                <th>Model Group</th>
                <th>Run Status</th>
                <th>ETL Date</th>
                <th>Error Message</th>
            </tr>
        """
        html_content = _append_failure_table_rows(
            html_content, upstream_failed_models, "orange"
        )
        html_content += "</table>"

    dag_run_url = None
    try:
        from airflow.configuration import conf

        webserver_base_url = conf.get("webserver", "BASE_URL", fallback="")
        if webserver_base_url:
            webserver_base_url = webserver_base_url.rstrip("/")
            dag_run_url = (
                f"{webserver_base_url}/dags/{dag_run.dag_id}/grid"
                f"?dag_run_id={dag_run.run_id}"
            )
    except Exception as exc:
        log.warning("Could not construct DAG run URL: %s", exc)

    if dag_run_url:
        html_content += (
            f'<p>Please check the <a href="{dag_run_url}">Airflow UI</a> '
            "for detailed logs and error messages.</p>"
        )
    else:
        html_content += (
            "<p>Please check the Airflow UI for detailed logs and error messages.</p>"
        )

    send_email(to=email_list, subject=subject, html_content=html_content)
    log.info(
        "Sent consolidated failure notification: %s failed, %s upstream_failed",
        len(failed_models),
        len(upstream_failed_models),
    )


def discover_models(dag_id: str | None = None) -> list[dict]:
    """Scan python_models for .python.json configs with companion .python.py files.

    If dag_id is provided, only return models whose 'dags' field includes
    that DAG. Models with no dags (utility modules) are always skipped.
    """
    print(f"Scanning for models in: {PYTHON_DIR}")
    models: list[dict] = []
    if not PYTHON_DIR.exists():
        print(f"WARNING: Python model directory not found: {PYTHON_DIR}")
        return models

    for json_file in sorted(PYTHON_DIR.glob("**/*.python.json")):
        try:
            config = json.loads(json_file.read_text())
        except Exception as exc:
            print(f"Skipping {json_file.name} (invalid JSON: {exc})")
            continue

        model_dags = config.get("dags", [])
        if not model_dags:
            continue
        if dag_id and dag_id not in model_dags:
            continue

        py_file = json_file.with_suffix("").with_suffix(".python.py")
        if not py_file.exists():
            print(f"Skipping {json_file.name} (no companion .python.py)")
            continue

        model: dict = {
            "model_id": config.get("name", json_file.stem),
            "model_path": str(py_file),
            "script_rel": str(py_file.relative_to(PYTHON_DIR)),
            "model_type": "python",
            "depends_on": config.get("depends_on", []),
            "task_group": config.get("task_group"),
            "topic": config.get("topic", ""),
            "compute": config.get("compute", "kpo"),
            "kpo_size": config.get("kpo_size", "small"),
        }

        if config.get("output"):
            model["table_name"] = config["output"].get("table", "")
        model.setdefault("namespace", config.get("group", ""))
        model.setdefault("description", config.get("description", ""))

        print(f"Discovered: {model['model_id']}")
        models.append(model)

    print(f"Total models discovered: {len(models)}")
    return models


def execute_model(model: dict, context: dict) -> None:
    """Run a model .python.py file as __main__ with PYMODEL_* env from context."""
    model_path = model["model_path"]
    model_id = model["model_id"]

    if not Path(model_path).exists():
        raise FileNotFoundError(f"Model file not found: {model_path}")

    print(f"Executing model: {model_id}")

    pymodel_keys = ("PYMODEL_DS", "PYMODEL_DS_NODASH", "PYMODEL_DATES")
    prev = {k: os.environ.get(k) for k in pymodel_keys}
    try:
        os.environ["PYMODEL_DS"] = context["ds"]
        os.environ["PYMODEL_DS_NODASH"] = context["ds_nodash"]
        if "dates" in context:
            os.environ["PYMODEL_DATES"] = json.dumps(context["dates"])
        else:
            os.environ.pop("PYMODEL_DATES", None)
        runpy.run_path(model_path, run_name="__main__")
    finally:
        for key, value in prev.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    print(f"Completed model: {model_id}")


def register_python_model_tasks(dag_id: str, dag=None):
    """Create Airflow tasks for each Python model and wire depends_on ordering.

    Pass ``dag`` when using classic ``with DAG(...) as dag``; omit inside ``@dag``
    TaskFlow DAGs so operators bind to the implicit DAG.

    Returns (entry_tasks, exit_tasks) for chaining into the parent DAG.
    Returns (None, None) if no models are found.
    """
    models = discover_models(dag_id)
    if not models:
        return None, None

    if dag is None:
        dag = _current_dag()

    kpo_tasks: dict[str, object] = {}
    airflow_tasks: dict[str, PythonOperator] = {}

    for model in models:
        model_id = model["model_id"]
        if _model_uses_kpo(model):
            kpo_tasks[model_id] = build_gated_kpo_task(
                task_id=model_id,
                dag=dag,
                model=model,
                topic=model.get("topic", ""),
                python_model_name=model["script_rel"],
                script_args=["--run-id", "{{ dag_run.run_id }}", "--logical-date", "{{ ds }}"],
                size=model.get("kpo_size", "small"),
                labels={"component": "python-model", "variant": model.get("topic", "")},
                on_success_callback=_record_kpo_success,
                on_failure_callback=_record_kpo_failure,
            )
        else:
            airflow_tasks[model_id] = PythonOperator(
                task_id=f"python_model__{model_id}",
                python_callable=_execute_model_with_context,
                op_kwargs={
                    "model": model,
                    "context": {"ds": "{{ ds }}", "ds_nodash": "{{ ds_nodash }}"},
                },
                dag=dag,
            )

    all_ids = {m["model_id"] for m in models}
    for model in models:
        model_id = model["model_id"]
        for dep_name in model.get("depends_on", []):
            if dep_name not in all_ids:
                continue
            if dep_name in kpo_tasks and model_id in kpo_tasks:
                kpo_tasks[dep_name] >> kpo_tasks[model_id]
            elif dep_name in airflow_tasks and model_id in airflow_tasks:
                airflow_tasks[dep_name] >> airflow_tasks[model_id]

    has_upstream: set[str] = set()
    is_depended_on: set[str] = set()
    for model in models:
        model_id = model["model_id"]
        for dep_name in model.get("depends_on", []):
            if dep_name in all_ids:
                has_upstream.add(model_id)
                is_depended_on.add(dep_name)

    entry_tasks = []
    exit_tasks = []
    for model in models:
        model_id = model["model_id"]
        if model_id in kpo_tasks and model_id not in has_upstream:
            entry_tasks.append(kpo_tasks[model_id])
        if model_id in airflow_tasks and model_id not in has_upstream:
            entry_tasks.append(airflow_tasks[model_id])
        if model_id in kpo_tasks and model_id not in is_depended_on:
            exit_tasks.append(kpo_tasks[model_id])
        if model_id in airflow_tasks and model_id not in is_depended_on:
            exit_tasks.append(airflow_tasks[model_id])

    return entry_tasks, exit_tasks


def _compute_model_tasks(models: list[dict]) -> list[list[dict]]:
    """Topological-level sort of models by depends_on. Returns model-task batches.

    Each batch contains models whose dependencies are fully resolved by prior
    batches. Models within the same batch can run in parallel.
    """
    from python_models._model_tasks import compute_model_tasks_from_deps

    id_set = {m["model_id"] for m in models}
    deps = {m["model_id"]: [d for d in m.get("depends_on", []) if d in id_set] for m in models}
    model_map = {m["model_id"]: m for m in models}

    id_model_task_batches = compute_model_tasks_from_deps(list(id_set), deps)
    return [[model_map[mid] for mid in batch] for batch in id_model_task_batches]


def get_python_source_config() -> dict:
    """Read python_source_config from the Airflow Variable (JSON).

    Returns the parsed config, or ``{}`` when the Variable is unset. No
    defaults are merged -- values come entirely from Airflow.
    """
    raw = Variable.get(PYTHON_SOURCE_CONFIG_VAR, default_var=None)
    if raw is None:
        log.warning("Variable '%s' not found -- returning empty config", PYTHON_SOURCE_CONFIG_VAR)
        return {}
    if isinstance(raw, str):
        cleaned = re.sub(r",\s*([\]}])", r"\1", raw)
        return json.loads(cleaned)
    return raw


def get_python_source_run_tracking_config(context: dict | None = None) -> dict:
    """Resolve catalog/schema/table for python model run tracking meta table."""
    config: dict = {}
    if context and context.get("dag_run"):
        config = (context["dag_run"].conf or {}).get("python_source_config") or {}
    if not config:
        config = get_python_source_config()

    tracking = config.get("run_tracking") or {}
    catalog = tracking.get("catalog")
    schema = tracking.get("schema")
    table = tracking.get("table")

    missing = [
        key for key, value in (("catalog", catalog), ("schema", schema), ("table", table))
        if not value
    ]
    if missing:
        raise ValueError(
            f"run_tracking.{missing[0]} is required in Airflow Variable "
            f"'{PYTHON_SOURCE_CONFIG_VAR}' (run_tracking must include catalog, schema, table)"
        )

    return {"catalog": catalog, "schema": schema, "table": table}


def passes_schedule_gate(cron: str, ds: str) -> bool:
    """Return True if the cron fires on the ``ds`` calendar day (UTC).

    An empty ``cron`` disables the gate (always run). ``ds`` is the Airflow
    logical date (``YYYY-MM-DD``); the gate opens on any day the cron is
    scheduled to fire, regardless of the cron's time-of-day fields.

    Example (``"0 5 * * 2"`` = every Tuesday): passes when ``ds`` is a Tuesday.
    """
    if not cron:
        return True

    from croniter import croniter
    from datetime import timezone

    day = datetime.strptime(ds, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    next_fire = croniter(cron, day - timedelta(seconds=1)).get_next(datetime)
    return next_fire.date() == day.date()


def resolve_dates_in(dates_in: str | list | dict, ds: str) -> list[str]:
    """Resolve the ``dates_in`` config into a list of ISO date strings.

    Supported formats:
      - Empty ("" / None): current date, returns ``[ds]``.
      - ISO date string ("YYYY-MM-DD"): single date.
      - List of ISO date strings: multiple/specific dates.
      - Dict ``{"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}``: inclusive daily
        backfill range.
    """
    if not dates_in:
        return [ds]

    if isinstance(dates_in, str):
        return [dates_in]

    if isinstance(dates_in, list):
        cleaned = [str(d) for d in dates_in if d is not None and str(d).strip()]
        return cleaned if cleaned else [ds]

    if isinstance(dates_in, dict):
        start_raw = dates_in.get("start")
        end_raw = dates_in.get("end")
        if not start_raw or not end_raw:
            raise ValueError(
                "dates_in range requires both 'start' and 'end' keys"
            )
        start = datetime.strptime(start_raw, "%Y-%m-%d").date()
        end = datetime.strptime(end_raw, "%Y-%m-%d").date()
        if end < start:
            raise ValueError("dates_in range 'end' must be on/after 'start'")
        dates: list[str] = []
        current = start
        while current <= end:
            dates.append(current.strftime("%Y-%m-%d"))
            current += timedelta(days=1)
        return dates


def _model_uses_kpo(model: dict) -> bool:
    return model.get("compute", "kpo") != "airflow"


def _current_dag():
    dag = DagContext.get_current_dag()
    if dag is None:
        raise RuntimeError(
            "Python model task registration must run inside an active DAG context"
        )
    return dag


def _resolve_model_run(
    model: dict,
    topic: str,
    context: dict,
    *,
    record_fn=None,
) -> tuple[dict, str, str] | None:
    """Resolve partition context for a model run.

    Returns ``(ctx, etl_date, model_group)`` or ``None`` when ``skip_model``
    applies. Raises ``AirflowSkipException`` for topic-level skip / schedule gate.
    """
    model_name = model["model_id"]
    model_group = topic or model.get("topic", "")
    dates_in: str | list | dict = ""

    if topic:
        conf = (context.get("dag_run").conf or {}) if context.get("dag_run") else {}
        runtime_config = conf.get("python_source_config") or get_python_source_config()
        topic_cfg = runtime_config.get(topic, {})

        if topic_cfg.get("skip", False):
            if record_fn:
                record_fn("skipped", 0.0, True)
            raise AirflowSkipException(f"topic {topic} skip=True")

        date_to_run = topic_cfg.get("date_to_run", "")
        if not passes_schedule_gate(date_to_run, context["ds"]):
            if record_fn:
                record_fn("skipped", 0.0, True)
            raise AirflowSkipException(
                f"topic {topic} schedule gate '{date_to_run}' not met"
            )

        skip_models = topic_cfg.get("skip_model", [])
        if isinstance(skip_models, str):
            skip_models = [skip_models]
        skip_models = [m for m in skip_models if m and str(m).strip()]
        if model_name in skip_models:
            if record_fn:
                record_fn("skipped", 0.0, True)
            return None

        dates_in = topic_cfg.get("dates_in", "")

    dates = resolve_dates_in(dates_in, context["ds"])
    etl_date = dates[0]
    ctx = {"ds": etl_date, "ds_nodash": etl_date.replace("-", "")}
    if dates_in:
        ctx["dates"] = dates
    return ctx, etl_date, model_group


def _airflow_var(name: str, default: str = "") -> str:
    try:
        value = Variable.get(name, default_var=default)
        return value if value is not None else default
    except Exception:
        return default


def build_kpo_env_vars_from_context(ctx: dict) -> dict[str, str]:
    """Build pod env vars from a resolved partition context dict."""
    env: dict[str, str] = {
        "PYMODEL_DS": ctx["ds"],
        "PYMODEL_DS_NODASH": ctx["ds_nodash"],
        "DJ_PYTHON_MODEL_CATALOG_NAME": _airflow_var(
            "dj_python_model_catalog_name", "glue"
        ),
        "python_models_s3_bucket": _airflow_var("python_models_s3_bucket"),
        "python_model_s3_region": _airflow_var("python_model_s3_region", "us-west-2"),
        "OPUS-ETL-CLUSTER-HOST": _airflow_var("opus-etl-cluster-host"),
        "OPUS-ETL-USER-NAME": _airflow_var("opus-etl-user-name"),
        "OPUS-ETL-CLUSTER-PASSWORD": _airflow_var("opus-etl-cluster-password"),
    }
    if "dates" in ctx:
        env["PYMODEL_DATES"] = json.dumps(ctx["dates"])
    return env


def prepare_gated_kpo_run(model: dict, topic: str, context: dict) -> dict[str, str]:
    """Run gating for a KPO model, push tracking XCom, return pod env vars."""
    model_name = model["model_id"]
    model_group = topic or model.get("topic", "")
    etl_timestamp = _get_etl_timestamp_from_context(context)
    etl_date = context["ds"]

    def _record(
        run_status: str,
        run_seconds: float,
        is_skipped: bool,
        run_message: str | None = None,
        record_etl_date: str | None = None,
    ) -> None:
        try:
            record_python_model_run(
                model_name=model_name,
                model_group=model_group,
                etl_date=record_etl_date or etl_date,
                etl_timestamp=etl_timestamp or "",
                run_status=run_status,
                run_seconds=run_seconds,
                is_skipped=is_skipped,
                run_message=run_message,
                context=context,
            )
        except Exception as exc:
            log.warning("Failed to record python model run for %s: %s", model_name, exc)

    resolved = _resolve_model_run(model, topic, context, record_fn=_record)
    if resolved is None:
        raise AirflowSkipException(f"model {model_name} skipped (skip_model)")

    ctx, resolved_etl_date, resolved_group = resolved
    ti = context["ti"]
    ti.xcom_push(key="etl_date", value=resolved_etl_date)
    ti.xcom_push(key="model_group", value=resolved_group)
    return build_kpo_env_vars_from_context(ctx)


def _record_kpo_success(context: dict) -> None:
    _record_kpo_outcome(context, run_status="success")


def _record_kpo_failure(context: dict) -> None:
    ti = context.get("ti")
    run_message = None
    if ti is not None:
        run_message = getattr(ti, "note", None) or "KPO task failed"
    _record_kpo_outcome(context, run_status="error", run_message=run_message)


def _record_kpo_outcome(
    context: dict,
    run_status: str,
    run_message: str | None = None,
) -> None:
    try:
        ti = context["ti"]
        model_id = ti.task_id
        etl_date = ti.xcom_pull(key="etl_date") or context["ds"]
        model_group = ti.xcom_pull(key="model_group") or ""
        etl_timestamp = _get_etl_timestamp_from_context(context)

        started_at = ti.start_date
        run_seconds = 0.0
        if started_at is not None and ti.end_date is not None:
            run_seconds = (ti.end_date - started_at).total_seconds()

        record_python_model_run(
            model_name=model_id,
            model_group=model_group,
            etl_date=etl_date,
            etl_timestamp=etl_timestamp or "",
            run_status=run_status,
            run_seconds=run_seconds,
            is_skipped=False,
            run_message=run_message,
            context=context,
        )
    except Exception as exc:
        log.warning("Failed to record KPO model run: %s", exc)


def _wire_kpo_batch_depends_on(
    model_tasks: list[dict],
    kpo_tasks: dict[str, object],
) -> tuple[list, list]:
    """Wire depends_on across KPO tasks; return entry and exit tasks for the batch."""
    model_ids = {m["model_id"] for m in model_tasks}
    for m in model_tasks:
        model_id = m["model_id"]
        for dep_id in m.get("depends_on", []):
            if dep_id in model_ids and dep_id in kpo_tasks:
                kpo_tasks[dep_id] >> kpo_tasks[model_id]

    has_upstream: set[str] = set()
    is_depended_on: set[str] = set()
    for m in model_tasks:
        model_id = m["model_id"]
        for dep_id in m.get("depends_on", []):
            if dep_id in model_ids:
                has_upstream.add(model_id)
                is_depended_on.add(dep_id)

    entry_tasks = [
        kpo_tasks[m["model_id"]]
        for m in model_tasks
        if m["model_id"] not in has_upstream
    ]
    exit_tasks = [
        kpo_tasks[m["model_id"]]
        for m in model_tasks
        if m["model_id"] not in is_depended_on
    ]
    return entry_tasks, exit_tasks


def _register_kpo_model_batch(
    dag,
    topic: str,
    model_tasks: list[dict],
    prev_task,
) -> object:
    """Create one gated KPO task per model in a homogeneous KPO batch."""
    kpo_tasks: dict[str, object] = {}

    for m in model_tasks:
        model_id = m["model_id"]
        kpo_tasks[model_id] = build_gated_kpo_task(
            task_id=model_id,
            dag=dag,
            model=m,
            topic=topic,
            python_model_name=m["script_rel"],
            script_args=["--run-id", "{{ dag_run.run_id }}", "--logical-date", "{{ ds }}"],
            size=m.get("kpo_size", "small"),
            labels={"component": "python-model", "variant": topic},
            on_success_callback=_record_kpo_success,
            on_failure_callback=_record_kpo_failure,
        )

    entry_tasks, exit_tasks = _wire_kpo_batch_depends_on(model_tasks, kpo_tasks)
    if prev_task is not None:
        prev_task >> entry_tasks

    if len(exit_tasks) == 1:
        return exit_tasks[0]
    return exit_tasks


def _execute_model_with_context(
    model: dict,
    topic: str = "",
    **context,
) -> None:
    """Wrapper for execute_model that resolves the run's partition dates.

    When ``topic`` is provided, the config is read fresh from the triggering
    DAG conf / Airflow Variable at **runtime** (not parse time) so Variable
    updates take effect without a DAG re-parse. The topic config drives:
      - ``skip``: raise AirflowSkipException (model is a no-op this run).
      - ``date_to_run``: UTC cron schedule-gate -- skip unless the cron fires
        on the ``ds`` calendar day (see :func:`passes_schedule_gate`).
      - ``skip_model``: list of model_ids to skip.
      - ``dates_in``: partition-date selection (see :func:`resolve_dates_in`),
        passed as ``context["dates"]`` so models can use ``IN (...)`` filters.

    Without a ``topic`` (e.g. the standalone DAG path) there is no gating and
    the run uses the Airflow ``ds`` only.
    """
    model_name = model["model_id"]
    model_group = topic or model.get("topic", "")
    etl_timestamp = _get_etl_timestamp_from_context(context)
    etl_date = context["ds"]
    started_at: float | None = None

    def _record(
        run_status: str,
        run_seconds: float,
        is_skipped: bool,
        run_message: str | None = None,
        record_etl_date: str | None = None,
    ) -> None:
        try:
            record_python_model_run(
                model_name=model_name,
                model_group=model_group,
                etl_date=record_etl_date or etl_date,
                etl_timestamp=etl_timestamp or "",
                run_status=run_status,
                run_seconds=run_seconds,
                is_skipped=is_skipped,
                run_message=run_message,
                context=context,
            )
        except Exception as exc:
            log.warning("Failed to record python model run for %s: %s", model_name, exc)

    try:
        resolved = _resolve_model_run(model, topic, context, record_fn=_record)
        if resolved is None:
            return

        ctx, etl_date, _ = resolved
        started_at = time.perf_counter()
        execute_model(model, ctx)
        _record("success", time.perf_counter() - started_at, False)
    except AirflowSkipException:
        raise
    except Exception as exc:
        elapsed = time.perf_counter() - started_at if started_at is not None else 0.0
        _record("error", elapsed, False, run_message=str(exc))
        raise


def _register_model_task_batch(
    dag,
    topic: str,
    model_tasks: list[dict],
    prev_task,
) -> object:
    """Register a topological batch using KPO or Airflow worker compute per model."""
    kpo_models = [m for m in model_tasks if _model_uses_kpo(m)]
    airflow_models = [m for m in model_tasks if not _model_uses_kpo(m)]
    batch_exit = prev_task

    if kpo_models:
        batch_exit = _register_kpo_model_batch(dag, topic, kpo_models, batch_exit)

    if airflow_models:
        task_name = "_".join(m["model_id"] for m in airflow_models)
        op_kwargs_list = [
            {
                "model": m,
                "model_id": m["model_id"],
                **({"topic": topic} if topic else {}),
            }
            for m in airflow_models
        ]
        mapped_task = PythonOperator.partial(
            task_id=task_name,
            python_callable=_execute_model_with_context,
            dag=dag,
            on_failure_callback=_record_airflow_task_failure,
        ).expand(op_kwargs=op_kwargs_list)
        if batch_exit is not None:
            batch_exit >> mapped_task
        batch_exit = mapped_task

    return batch_exit


def register_python_model_mapped_tasks(dag_id: str, group_id: str | None = None):
    """Create a TaskGroup with model-task-batch mapped tasks for python models.

    This groups all models for a DAG into a single TaskGroup and organizes them into batches.
    Models in the same batch run as parallel mapped task instances; batches are
    chained sequentially to respect dependencies.

    Args:
        dag_id: The DAG identifier used to filter models from *.python.json configs.
        group_id: Optional TaskGroup ID (defaults to dag_id).

    Returns:
        The TaskGroup instance for chaining (e.g., start >> group >> end).
        Returns None if no models are found.
    """
    models = discover_models(dag_id)
    if not models:
        return None

    model_task_batches = _compute_model_tasks(models)
    dag = _current_dag()

    with TaskGroup(group_id=group_id or dag_id, prefix_group_id=False) as tg:
        prev_task = None
        for model_tasks in model_task_batches:
            prev_task = _register_model_task_batch(dag, "", model_tasks, prev_task)

    return tg


def register_python_model_mapped_tasks_by_topic(
    dag_id: str,
    python_source_config: dict | None = None,
):
    """Create per-topic TaskGroups with model-task-batch mapped tasks.

    Groups discovered models by their ``topic`` field (from *.python.json) and
    creates a separate TaskGroup for each topic.  Within each topic, models are
    organised into topological batches exactly like
    ``register_python_model_mapped_tasks``.

    The ``python_source_config`` dict controls per-topic ``skip`` and
    ``date_to_run`` behaviour.  If not provided, the Airflow Variable
    ``python_source_config`` is read.

    Returns a list of TaskGroup instances (one per non-skipped topic),
    or None if nothing was created.
    """
    if python_source_config is None:
        python_source_config = get_python_source_config()

    models = discover_models(dag_id)
    if not models:
        return None

    by_topic: dict[str, list[dict]] = defaultdict(list)
    for m in models:
        topic = m.get("topic") or "default"
        by_topic[topic].append(m)

    topic_groups: list[TaskGroup] = []

    for topic, topic_models in sorted(by_topic.items()):
        topic_cfg = python_source_config.get(topic, {})
        if topic_cfg.get("skip", False):
            log.info("Skipping topic %s (skip=True in python_source_config)", topic)
            continue

        model_task_batches = _compute_model_tasks(topic_models)
        dag = _current_dag()

        with TaskGroup(group_id=topic, prefix_group_id=False) as tg:
            prev_task = None
            for model_tasks in model_task_batches:
                prev_task = _register_model_task_batch(
                    dag, topic, model_tasks, prev_task
                )

        topic_groups.append(tg)

    return topic_groups if topic_groups else None
