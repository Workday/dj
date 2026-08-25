"""Reusable KubernetesPodOperator factory for DJ python model execution.

Target: Airflow 2.10 with ``apache-airflow-providers-cncf-kubernetes`` 8.x
(uses ``on_finish_action``, not ``is_delete_operator_pod``).

Cluster/image config is resolved at task-execution time from the shared
Airflow Variable ``airflow_runner_cfg``. Pod sizing presets are loaded from
``kpo_sizes.yml`` beside this module (optional ``size_specs`` override in
the Variable JSON).
"""

from __future__ import annotations

from datetime import timedelta
from functools import lru_cache
from pathlib import Path
from typing import Literal, Mapping, Sequence

from airflow import DAG
from airflow.providers.cncf.kubernetes.operators.pod import KubernetesPodOperator
from kubernetes.client import models as k8s

_DEFAULT_IMAGE_PULL_SECRETS: tuple[str, ...] = ("wd-docker-artifactory-cred",)

_RUNNER_CFG_VAR_NAME: str = "airflow_runner_cfg"
_IMAGE_TPL: str = f"{{{{ var.json.{_RUNNER_CFG_VAR_NAME}.image }}}}"
_TAG_TPL: str = f"{{{{ var.json.{_RUNNER_CFG_VAR_NAME}.tag }}}}"
_NAMESPACE_TPL: str = f"{{{{ var.json.{_RUNNER_CFG_VAR_NAME}.namespace }}}}"
_CONFIG_FILE_TPL: str = f"{{{{ var.json.{_RUNNER_CFG_VAR_NAME}.config_file }}}}"
_CLUSTER_CONTEXT_TPL: str = f"{{{{ var.json.{_RUNNER_CFG_VAR_NAME}.cluster_context }}}}"

_IMAGE_REF: str = f"{_IMAGE_TPL}:{_TAG_TPL}"

PodSize = Literal["small", "medium", "large", "xlarge"]

_DEFAULT_SIZE_SPECS: dict[str, tuple[str, str]] = {
    "small": ("1", "2Gi"),
    "medium": ("2", "4Gi"),
    "large": ("2", "8Gi"),
    "xlarge": ("2", "16Gi"),
}

_SIZES_YAML_PATH = Path(__file__).resolve().parent / "kpo_sizes.yml"


def _parse_size_specs_from_yaml(path: Path) -> dict[str, tuple[str, str]]:
    if not path.is_file():
        return dict(_DEFAULT_SIZE_SPECS)

    try:
        import yaml
    except ImportError:
        return dict(_DEFAULT_SIZE_SPECS)

    try:
        raw = yaml.safe_load(path.read_text()) or {}
    except Exception:
        return dict(_DEFAULT_SIZE_SPECS)

    sizes = raw.get("sizes") or {}
    parsed: dict[str, tuple[str, str]] = {}
    for name, spec in sizes.items():
        if not isinstance(spec, dict):
            continue
        cpu = spec.get("cpu")
        memory = spec.get("memory")
        if cpu and memory:
            parsed[str(name)] = (str(cpu), str(memory))
    return parsed if parsed else dict(_DEFAULT_SIZE_SPECS)


def _merge_variable_size_specs(specs: dict[str, tuple[str, str]]) -> dict[str, tuple[str, str]]:
    try:
        from airflow.models import Variable

        cfg = Variable.get(_RUNNER_CFG_VAR_NAME, deserialize_json=True, default_var={})
        if not isinstance(cfg, dict):
            return specs
        overrides = cfg.get("size_specs") or {}
        if not isinstance(overrides, dict):
            return specs
        merged = dict(specs)
        for name, spec in overrides.items():
            if isinstance(spec, dict) and spec.get("cpu") and spec.get("memory"):
                merged[str(name)] = (str(spec["cpu"]), str(spec["memory"]))
        return merged
    except Exception:
        return specs


@lru_cache(maxsize=1)
def load_size_specs() -> dict[str, tuple[str, str]]:
    """Load pod CPU/memory presets from kpo_sizes.yml with optional Variable override."""
    return _merge_variable_size_specs(_parse_size_specs_from_yaml(_SIZES_YAML_PATH))


def _sanitize_pod_name(dag_id: str, task_id: str) -> str:
    raw = f"{dag_id}-{task_id}".replace("_", "-").lower()
    return raw[:63].rstrip("-")


def _container_resources(size: PodSize) -> k8s.V1ResourceRequirements:
    specs = load_size_specs()
    if size not in specs:
        raise ValueError(
            f"Invalid pod size {size!r}; expected one of {sorted(specs)}."
        )
    cpu, memory = specs[size]
    return k8s.V1ResourceRequirements(
        requests={"cpu": cpu, "memory": memory},
        limits={"cpu": cpu, "memory": memory},
    )


def _env_var_list(env: Mapping[str, str]) -> list[k8s.V1EnvVar]:
    return [k8s.V1EnvVar(name=name, value=value) for name, value in env.items()]


def build_kpo_task(
    *,
    task_id: str,
    dag: DAG,
    python_model_name: str,
    env_vars: Mapping[str, str],
    script_args: Sequence[str] | None = None,
    size: PodSize = "small",
    image_pull_policy: str = "IfNotPresent",
    image_pull_secrets: Sequence[str] = _DEFAULT_IMAGE_PULL_SECRETS,
    service_account_name: str = "default",
    retries: int = 1,
    retry_delay: timedelta = timedelta(minutes=5),
    retry_exponential_backoff: bool = True,
    startup_timeout_seconds: int = 600,
    on_finish_action: str = "delete_pod",
    deferrable: bool = False,
    logging_interval: int | None = 10,
    do_xcom_push: bool = False,
    labels: Mapping[str, str] | None = None,
    annotations: Mapping[str, str] | None = None,
    on_success_callback=None,
    on_failure_callback=None,
) -> KubernetesPodOperator:
    """Build a KubernetesPodOperator that invokes the image ENTRYPOINT."""
    env_map: dict[str, str] = {"PYTHONUNBUFFERED": "1"}
    env_map.update(env_vars)

    dag_labels: dict[str, str] = {
        "dag_id": dag.dag_id,
        "task_id": task_id,
        "run_id": "{{ dag_run.run_id | truncate(63, true, '') }}",
        "component": "airflow-kpo",
        "variant": dag.dag_id,
    }
    if labels:
        dag_labels.update(labels)

    arguments = [python_model_name, *(list(script_args) if script_args else [])]

    deferred_log_kwargs: dict[str, int] = {}
    if deferrable and logging_interval is not None:
        deferred_log_kwargs["logging_interval"] = logging_interval

    return KubernetesPodOperator(
        task_id=task_id,
        dag=dag,
        image=_IMAGE_REF,
        image_pull_policy=image_pull_policy,
        image_pull_secrets=[
            k8s.V1LocalObjectReference(name=n) for n in image_pull_secrets
        ],
        in_cluster=False,
        config_file=_CONFIG_FILE_TPL,
        cluster_context=_CLUSTER_CONTEXT_TPL,
        namespace=_NAMESPACE_TPL,
        name=_sanitize_pod_name(dag.dag_id, task_id),
        arguments=arguments,
        env_vars=_env_var_list(env_map),
        container_resources=_container_resources(size),
        service_account_name=service_account_name,
        get_logs=True,
        log_events_on_failure=True,
        on_finish_action=on_finish_action,
        do_xcom_push=do_xcom_push,
        deferrable=deferrable,
        **deferred_log_kwargs,
        retries=retries,
        retry_delay=retry_delay,
        retry_exponential_backoff=retry_exponential_backoff,
        startup_timeout_seconds=startup_timeout_seconds,
        reattach_on_restart=True,
        labels=dag_labels,
        annotations=dict(annotations or {}),
        on_success_callback=on_success_callback,
        on_failure_callback=on_failure_callback,
    )
