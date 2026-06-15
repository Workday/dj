from airflow.models import Variable


def var(name: str, default: str = "") -> str:
    return Variable.get(name, default)


dbt_project: str = var("dj_etl_dbt_project")
dbt_threads: int = int(var("dj_etl_dbt_threads", "1"))
etl_schema: str = var("dj_etl_etl_schema", "source_etl")
custom_failure_notifications: bool = (
    var("dj_etl_custom_failure_notifications", "false").lower() == "true"
)
email_notifications: str = var("dj_etl_email_notifications")
error_run_limit: int = int(var("dj_etl_error_run_limit", "0"))
error_run_timeout_minutes: int = int(var("dj_etl_error_run_timeout_minutes", "0"))
event_date_delay: int = int(var("dj_etl_event_date_delay", "1"))
exclude_models: list[str] = (
    [
        model_id.split(".")[-1].strip()
        for model_id in var("dj_etl_exclude_models", "").split(",")
    ]
    if var("dj_etl_exclude_models")
    else []
)
is_local: bool = var("dj_etl_is_local", "false").lower() == "true"
k8s_config_path: str = var("dj_etl_k8s_config_path")
k8s_deployment_name: str = var("dj_etl_k8s_deployment_name")
k8s_namespace: str = var("dj_etl_k8s_namespace")
k8s_workers_end: int = (
    int(var("dj_etl_k8s_workers_end")) if var("dj_etl_k8s_workers_end") else None
)
k8s_workers_start: int = (
    int(var("dj_etl_k8s_workers_start")) if var("dj_etl_k8s_workers_start") else None
)
model_date_limit: int = int(var("dj_etl_model_date_limit", "1"))
model_date_tasks: int = int(var("dj_etl_model_date_tasks", "4"))
model_run_limit: int = int(var("dj_etl_model_run_limit", "0"))
model_run_timeout_minutes: int = int(var("dj_etl_model_run_timeout_minutes", "0"))
optimize_date_delay: int = (
    int(var("dj_etl_optimize_date_delay"))
    if var("dj_etl_optimize_date_delay")
    else None
)
optimize_date_limit: int = (
    int(var("dj_etl_optimize_date_limit"))
    if var("dj_etl_optimize_date_limit")
    else None
)
optimize_file_compression_codec: str = var(
    "dj_etl_optimize_file_compression_codec", "ZSTD"
)
optimize_file_size_threshold: str = var("dj_etl_optimize_file_size_threshold", "100MB")
optimize_run_limit: int = int(var("dj_etl_optimize_run_limit", "0"))
optimize_run_tasks: int = int(var("dj_etl_optimize_run_tasks", "1"))
optimize_run_timeout_minutes: int = int(var("dj_etl_optimize_run_timeout_minutes", "0"))
override_backfill_start: str = var("dj_etl_override_backfill_start")
override_models: list[str] = (
    [
        model_id.split(".")[-1].strip()
        for model_id in var("dj_etl_override_models", "").split(",")
    ]
    if var("dj_etl_override_models")
    else []
)
override_sources: list[str] = (
    [
        ".".join(source_id.split(".")[-2:]).strip()
        for source_id in var("dj_etl_override_sources", "").split(",")
    ]
    if var("dj_etl_override_sources")
    else []
)
run_chronological: bool = var("dj_etl_run_chronological", "false").lower() == "true"
schedule_cron: str = var("dj_etl_schedule_cron", "0 */6 * * *")
storage_type: str = var("dj_etl_storage_type", "delta_lake")
skip_sources: bool = var("dj_etl_skip_sources", "false").lower() == "true"
source_date_limit: int = int(var("dj_etl_source_date_limit", "5"))
source_date_tasks: int = int(var("dj_etl_source_date_tasks", "4"))
source_run_limit: int = int(var("dj_etl_source_run_limit", "0"))
source_run_timeout_minutes: int = int(var("dj_etl_source_run_timeout_minutes", "0"))
suppress_notifications: bool = (
    var("dj_etl_suppress_notifications", "false").lower() == "true"
)
trino_catalog: str = var("dj_etl_trino_catalog")
trino_host: str = var("dj_etl_trino_host")
trino_password: str = var("dj_etl_trino_password")
trino_schema: str = var("dj_etl_trino_schema")
trino_user: str = var("dj_etl_trino_user")
vacuum_date_delay: int = (
    int(var("dj_etl_vacuum_date_delay")) if var("dj_etl_vacuum_date_delay") else None
)
vacuum_run_limit: int = int(var("dj_etl_vacuum_run_limit", "0"))
vacuum_run_tasks: int = int(var("dj_etl_vacuum_run_tasks", "1"))
vacuum_run_timeout_minutes: int = int(var("dj_etl_vacuum_run_timeout_minutes", "0"))
