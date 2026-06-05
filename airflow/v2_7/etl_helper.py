from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from airflow.operators.python import PythonOperator

PYTHON_DIR = Path(__file__).parent.parent / "python_models"


def discover_models(dag_id: str | None = None) -> list[dict]:
    """Scan python_models/ for .python.json configs with run_etl() companion .py files.

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
        }

        try:
            spec = importlib.util.spec_from_file_location(py_file.stem, str(py_file))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            cfg = getattr(mod, "OUTPUT_CONFIG", None) or getattr(mod, "MODEL_CONFIG", None)
            if cfg is not None:
                model["model_id"] = getattr(cfg, "model_name", model["model_id"])
                model["namespace"] = getattr(cfg, "namespace", "")
                model["table_name"] = getattr(cfg, "table_name", "")
                model["description"] = getattr(cfg, "description", "")
        except Exception as exc:
            print(f"Config import failed for {py_file.name}: {exc}")

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
