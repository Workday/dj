from __future__ import annotations

import importlib.util
import json
import logging
import re
import time
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

from airflow.exceptions import AirflowSkipException
from airflow.models import Variable
from airflow.operators.python import PythonOperator
from airflow.utils.email import send_email
from airflow.utils.task_group import TaskGroup

from _ext_.services import trino_run
from _ext_.variables import trino_catalog
# from airflow.providers.cncf.kubernetes.operators.kubernetes_pod import KubernetesPodOperator
# from kubernetes.client import models as k8s

log = logging.getLogger(__name__)

PYTHON_DIR = Path(__file__).parent.parent / "python_models"

PYTHON_SOURCE_CONFIG_VAR = "dj_python_source_config"
DEFAULT_RUN_TRACKING_SCHEMA = "opus_python_sources"
DEFAULT_RUN_TRACKING_TABLE = "python_model_runs"
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
    """Map Airflow task_id to topic and model_ids for mapped python model tasks."""
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
            task_name = "_".join(m["model_id"] for m in model_tasks)
            registry[f"{topic}.{task_name}"] = {
                "topic": topic,
                "models": [m["model_id"] for m in model_tasks],
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
        f"{dag_run.dag_id} DAG Failures - "
        f"{dag_run.execution_date.strftime('%Y-%m-%d %H:%M:%S')}"
    )
    html_content = f"""
        <h2>Model and Test Failure Summary</h2>
        <p><strong>DAG ID:</strong> {dag_run.dag_id}</p>
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
    """Scan python/ for .python.json configs with run_etl() companion .py files.

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

        text = py_file.read_text()
        if "def run_etl(" not in text:
            print(f"Skipping {py_file.name} (no run_etl function)")
            continue

        model: dict = {
            "model_id": config.get("name", json_file.stem),
            "model_path": str(py_file),
            "model_type": "python",
            "depends_on": config.get("depends_on", []),
            "task_group": config.get("task_group"),
            "topic": config.get("topic", ""),
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
    """Dynamically import a model file and call its run_etl(context)."""
    model_path = model["model_path"]
    model_id = model["model_id"]

    if not Path(model_path).exists():
        raise FileNotFoundError(f"Model file not found: {model_path}")

    print(f"Executing model: {model_id}")

    spec = importlib.util.spec_from_file_location(model_id, model_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    if not hasattr(module, "run_etl"):
        raise AttributeError(f"Model missing run_etl() function: {model_path}")

    module.run_etl(context)
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

    tasks = {}
    for model in models:
        build_kw = dict(
            task_id=f"python_model__{model['model_id']}",
            python_callable=execute_model,
            op_kwargs={
                "model": model,
                "context": {"ds": "{{ ds }}", "ds_nodash": "{{ ds_nodash }}"},
            },
        )
        if dag is not None:
            build_kw["dag"] = dag
        task = PythonOperator(**build_kw)
        tasks[model["model_id"]] = task

    has_upstream = set()
    is_depended_on = set()
    for model in models:
        for dep_name in model.get("depends_on", []):
            if dep_name in tasks:
                tasks[dep_name] >> tasks[model["model_id"]]
                has_upstream.add(model["model_id"])
                is_depended_on.add(dep_name)

    entry_tasks = [t for name, t in tasks.items() if name not in has_upstream]
    exit_tasks = [t for name, t in tasks.items() if name not in is_depended_on]

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
    return {
        "catalog": tracking.get("catalog") or trino_catalog,
        "schema": tracking.get("schema", DEFAULT_RUN_TRACKING_SCHEMA),
        "table": tracking.get("table", DEFAULT_RUN_TRACKING_TABLE),
    }


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
    dates_in: str | list | dict = ""
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
        if topic:
            conf = (context.get("dag_run").conf or {}) if context.get("dag_run") else {}
            runtime_config = conf.get("python_source_config") or get_python_source_config()
            topic_cfg = runtime_config.get(topic, {})

            if topic_cfg.get("skip", False):
                log.info(
                    "Skipping model %s (topic %s skip=True at runtime)",
                    model_name,
                    topic,
                )
                _record("skipped", 0.0, True)
                raise AirflowSkipException(f"topic {topic} skip=True")

            date_to_run = topic_cfg.get("date_to_run", "")
            if not passes_schedule_gate(date_to_run, context["ds"]):
                log.info(
                    "Skipping model %s (topic %s schedule gate '%s' not met for ds %s)",
                    model_name,
                    topic,
                    date_to_run,
                    context["ds"],
                )
                _record("skipped", 0.0, True)
                raise AirflowSkipException(
                    f"topic {topic} schedule gate '{date_to_run}' not met"
                )

            skip_models = topic_cfg.get("skip_model", [])
            if isinstance(skip_models, str):
                skip_models = [skip_models]
            skip_models = [m for m in skip_models if m and str(m).strip()]
            if model_name in skip_models:
                log.info(
                    "Skipping model %s (topic %s skip_model=%s)",
                    model_name,
                    topic,
                    skip_models,
                )
                _record("skipped", 0.0, True)
                return

            dates_in = topic_cfg.get("dates_in", "")

        dates = resolve_dates_in(dates_in, context["ds"])
        etl_date = dates[0]
        ctx = {"ds": etl_date, "ds_nodash": etl_date.replace("-", "")}
        if dates_in:
            ctx["dates"] = dates

        started_at = time.perf_counter()
        execute_model(model, ctx)
        _record("success", time.perf_counter() - started_at, False)
    except AirflowSkipException:
        raise
    except Exception as exc:
        elapsed = time.perf_counter() - started_at if started_at is not None else 0.0
        _record("error", elapsed, False, run_message=str(exc))
        raise


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

    with TaskGroup(group_id=group_id or dag_id) as tg:
        prev_task = None
        for model_tasks in model_task_batches:
            task_name = "_".join(m["model_id"] for m in model_tasks)
            mapped_task = PythonOperator.partial(
                task_id=task_name,
                python_callable=_execute_model_with_context,
                map_index_template="{{ model_id }}",
                on_failure_callback=_record_airflow_task_failure,
            ).expand(op_kwargs=[{"model": m, "model_id": m["model_id"]} for m in model_tasks])

            if prev_task is not None:
                prev_task >> mapped_task
            prev_task = mapped_task

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

        with TaskGroup(group_id=topic) as tg:
            prev_task = None
            for model_tasks in model_task_batches:
                task_name = "_".join(m["model_id"] for m in model_tasks)

                op_kwargs_list = [
                    {
                        "model": m,
                        "model_id": m["model_id"],
                        "topic": topic,
                    }
                    for m in model_tasks
                ]

                mapped_task = PythonOperator.partial(
                    task_id=task_name,
                    python_callable=_execute_model_with_context,
                    map_index_template="{{ model_id }}",
                    on_failure_callback=_record_airflow_task_failure,
                ).expand(op_kwargs=op_kwargs_list)

                if prev_task is not None:
                    prev_task >> mapped_task
                prev_task = mapped_task

        topic_groups.append(tg)

    return topic_groups if topic_groups else None


# def register_k8s_model_tasks(
#     dag_id: str,
#     image: str,
#     k8s_config_path: str,
#     cluster_context: str,
#     namespace: str = "mwaa",
#     image_pull_secret: str = "wd-docker-artifactory-cred",
#     dag=None,
# ) -> tuple:
#     """Create KubernetesPodOperator tasks for each Python model and wire depends_on.
#
#     Each pod runs dags/python_models/entrypoint.py inside the pymodels image.
#     Airflow context (ds) and Trino credentials are injected as env vars via
#     Jinja templates so values are resolved at execution time, not parse time.
#
#     Returns (entry_tasks, exit_tasks) for chaining into the parent DAG.
#     Returns (None, None) if no models are found.
#     """
#     models = discover_models(dag_id)
#     if not models:
#         return None, None
#
#     # Group models by task_group; models without one form solo groups keyed by model_id.
#     groups: dict = {}
#     for m in models:
#         key = m.get("task_group") or m["model_id"]
#         groups.setdefault(key, []).append(m)
#
#     # model_id → group_key for cross-group dependency wiring
#     model_to_group: dict = {m["model_id"]: (m.get("task_group") or m["model_id"]) for m in models}
#
#     _shared_env = [
#         k8s.V1EnvVar(name="PYMODEL_DS", value="{{ ds }}"),
#         k8s.V1EnvVar(
#             name="OPUS-ETL-CLUSTER-HOST",
#             value="{{ var.value.get('opus-etl-cluster-host') }}",
#         ),
#         k8s.V1EnvVar(
#             name="OPUS-ETL-USER-NAME",
#             value="{{ var.value.get('opus-etl-user-name') }}",
#         ),
#         k8s.V1EnvVar(
#             name="OPUS-ETL-CLUSTER-PASSWORD",
#             value="{{ var.value.get('opus-etl-cluster-password') }}",
#         ),
#         k8s.V1EnvVar(
#             name="DJ_PYTHON_MODEL_CATALOG_NAME",
#             value="{{ var.value.get('dj_python_model_catalog_name', 'glue') }}",
#         ),
#     ]
#
#     tasks: dict = {}
#     for group_key, group_models in groups.items():
#         if len(group_models) == 1:
#             m = group_models[0]
#             task_id = f"python_model__{m['model_id']}"
#             group_env = [k8s.V1EnvVar(name="PYMODEL_MODEL_ID", value=m["model_id"])]
#         else:
#             task_id = f"python_model_group__{group_key}"
#             ids = ",".join(m["model_id"] for m in group_models)
#             group_env = [k8s.V1EnvVar(name="PYMODEL_MODEL_IDS", value=ids)]
#
#         build_kw = dict(
#             task_id=task_id,
#             namespace=namespace,
#             image=image,
#             image_pull_secrets=[k8s.V1LocalObjectReference(name=image_pull_secret)],
#             cmds=["python3.11", "/opt/py_models/entrypoint.py"],
#             env_vars=_shared_env + group_env,
#             is_delete_operator_pod=True,
#             get_logs=True,
#             config_file=k8s_config_path,
#             in_cluster=False,
#             cluster_context=cluster_context,
#             startup_timeout_seconds=300,
#         )
#         if dag is not None:
#             build_kw["dag"] = dag
#         tasks[group_key] = KubernetesPodOperator(**build_kw)
#
#     # Wire cross-group Airflow dependencies.
#     has_upstream: set = set()
#     is_depended_on: set = set()
#     for m in models:
#         group_key = model_to_group[m["model_id"]]
#         for dep_model_id in m.get("depends_on", []):
#             dep_group = model_to_group.get(dep_model_id)
#             if dep_group and dep_group != group_key and dep_group in tasks:
#                 tasks[dep_group] >> tasks[group_key]
#                 has_upstream.add(group_key)
#                 is_depended_on.add(dep_group)
#
#     entry_tasks = [t for k, t in tasks.items() if k not in has_upstream]
#     exit_tasks = [t for k, t in tasks.items() if k not in is_depended_on]
#     return entry_tasks, exit_tasks
