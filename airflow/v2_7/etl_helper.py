from __future__ import annotations

import importlib.util
import json
import logging
import re
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

from airflow.exceptions import AirflowSkipException
from airflow.models import Variable
from airflow.operators.python import PythonOperator
from airflow.utils.task_group import TaskGroup
# from airflow.providers.cncf.kubernetes.operators.kubernetes_pod import KubernetesPodOperator
# from kubernetes.client import models as k8s

log = logging.getLogger(__name__)

PYTHON_DIR = Path(__file__).parent.parent / "python_models"

PYTHON_SOURCE_CONFIG_VAR = "dj_python_source_config"


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
    dates_in: str | list | dict = ""

    if topic:
        conf = (context.get("dag_run").conf or {}) if context.get("dag_run") else {}
        runtime_config = conf.get("python_source_config") or get_python_source_config()
        topic_cfg = runtime_config.get(topic, {})

        if topic_cfg.get("skip", False):
            log.info("Skipping model %s (topic %s skip=True at runtime)", model["model_id"], topic)
            raise AirflowSkipException(f"topic {topic} skip=True")

        date_to_run = topic_cfg.get("date_to_run", "")
        if not passes_schedule_gate(date_to_run, context["ds"]):
            log.info(
                "Skipping model %s (topic %s schedule gate '%s' not met for ds %s)",
                model["model_id"], topic, date_to_run, context["ds"],
            )
            raise AirflowSkipException(
                f"topic {topic} schedule gate '{date_to_run}' not met"
            )

        skip_models = topic_cfg.get("skip_model", [])
        if isinstance(skip_models, str):
            skip_models = [skip_models]
        skip_models = [m for m in skip_models if m and str(m).strip()]
        if model["model_id"] in skip_models:
            log.info(
                "Skipping model %s (topic %s skip_model=%s)",
                model["model_id"], topic, skip_models,
            )
            return

        dates_in = topic_cfg.get("dates_in", "")

    dates = resolve_dates_in(dates_in, context["ds"])

    ds = dates[0]
    ctx = {"ds": ds, "ds_nodash": ds.replace("-", ""), "dates": dates}
    execute_model(model, ctx)


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
