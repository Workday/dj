from airflow.decorators import dag, task
from airflow.utils.trigger_rule import TriggerRule
from datetime import date, datetime, timedelta, timezone
import json

from _ext_.services import (
    airflow_timeout,
    dbt_build,
    dbt_invoke,
    k8s_scale,
    log,
    trino_run,
    send_dag_failure_notification,
)
from _ext_.utils import (
    build_runs,
    chunk_list,
    date_from_iso,
    date_to_iso,
    get_model_name_from_id,
    parse_dbt_source,
    SourceExtended,
    sql_dbt_source_dates_new,
    sql_dbt_source_dates_old,
)
from _ext_.variables import (
    custom_failure_notifications,
    email_notifications,
    error_run_limit,
    error_run_timeout_minutes,
    etl_schema,
    event_date_delay,
    exclude_models,
    k8s_workers_end,
    k8s_workers_start,
    model_date_limit,
    model_date_tasks,
    model_run_limit,
    model_run_timeout_minutes,
    optimize_date_delay,
    optimize_date_limit,
    # optimize_file_compression_codec,
    optimize_file_size_threshold,
    optimize_run_limit,
    optimize_run_tasks,
    optimize_run_timeout_minutes,
    override_backfill_start,
    override_sources,
    run_chronological,
    schedule_cron,
    source_date_limit,
    source_date_tasks,
    source_run_limit,
    source_run_timeout_minutes,
    storage_type,
    suppress_notifications,
    trino_catalog,
    trino_schema,
    vacuum_date_delay,
    vacuum_run_tasks,
    vacuum_run_limit,
    vacuum_run_timeout_minutes,
)


dag_email_list: list[str] = []
if not suppress_notifications:
    dag_email_list.append(email_notifications)


@dag(
    catchup=False,
    dag_id="source_etl",
    default_args={
        "email": dag_email_list,
        "email_on_failure": not custom_failure_notifications,
        "email_on_retry": False,
        "owner": "airflow",
        "retries": 0,
        "retry_delay": timedelta(minutes=1),
        "start_date": datetime(2021, 1, 1, tzinfo=timezone.utc),
    },
    max_active_runs=1,
    params={
        "skip_sources": False,
    },
    schedule=schedule_cron,
    start_date=datetime(1970, 1, 1),
    tags=["json"],
)
def source_etl_dag():

    @task(task_id="start_etl")
    def start_etl(ti=None, **context):
        """
        Generate an ETL timestamp and scale up K8s workers if configured.
        """
        etl_timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")

        # Set xcom variables for access from future tasks
        ti.xcom_push(key="etl_timestamp", value=etl_timestamp)
        if k8s_workers_start is not None:
            # Scale up the workers to the desired number
            k8s_scale(workers=k8s_workers_start)

    @task(task_id="create_source_tables")
    def create_source_tables():
        """
        Create the schema and tables for tracking ETL metadata if they don't exist.
        """
        partition_kw = "partitioning" if storage_type == "iceberg" else "partitioned_by"

        # Create new schema for the source etl tables if it doesn't exist yet
        trino_run(
            f"""
            CREATE SCHEMA IF NOT EXISTS {trino_catalog}.{etl_schema}
            """
        )

        # Create table for tracking model run dates if it doesn't exist yet
        trino_run(
            f"""
            CREATE TABLE IF NOT EXISTS {trino_catalog}.{etl_schema}.dbt_model_dates (
                model_id varchar,
                event_date date,
                etl_timestamp timestamp(6),
                optimize_timestamp timestamp(6),
                vacuum_timestamp timestamp(6),
                run_dates array(date),
                run_message varchar,
                run_rows bigint,
                run_seconds double,
                run_status varchar
            )
            WITH (
                {partition_kw} = ARRAY['model_id']
            )
        """
        )

        # Create table for mapping source dates if it doesn't exist yet
        trino_run(
            f"""
            CREATE TABLE IF NOT EXISTS {trino_catalog}.{etl_schema}.dbt_sources (
                source_id varchar,
                properties varchar,
                etl_active boolean
            )
            WITH (
                {partition_kw} = ARRAY['etl_active']
            )
        """
        )

        # Create table for mapping source dates if it doesn't exist yet
        trino_run(
            f"""
            CREATE TABLE IF NOT EXISTS {trino_catalog}.{etl_schema}.dbt_source_dates (
                source_id varchar,
                event_date date,
                event_count bigint,
                partition_dates array(date),
                etl_timestamp timestamp(6)
            )
            WITH (
                {partition_kw} = ARRAY['source_id']
            )
        """
        )

        # Create table for tracking test results if it doesn't exist yet
        trino_run(
            f"""
            CREATE TABLE IF NOT EXISTS {trino_catalog}.{etl_schema}.dbt_test_dates (
                test_id varchar,
                model_id varchar,
                event_date date,
                etl_timestamp timestamp(6),
                test_dates array(date),
                test_message varchar,
                test_rows bigint,
                test_seconds double,
                test_status varchar
            )
            WITH (
                {partition_kw} = ARRAY['model_id']
            )
        """
        )

    @task(task_id="fetch_sources")
    def fetch_sources(ti=None, **context):
        """
        Parse the dbt manifest and extract ETL-active sources and their downstream models.
        """
        sources: list[dict] = []
        sources_merge_args: list[dict] = []

        dbt_manifest_response = dbt_invoke(
            args=["parse"],
            context=context,
        )
        dbt_manifest = dbt_manifest_response.result
        for source_id, source_node in dbt_manifest.sources.items():
            if len(override_sources) > 0:
                # If we have override sources, we'll only run the sources that are in the override list
                source_ref = ".".join(source_id.split(".")[-2:]).strip()
                if source_ref not in override_sources:
                    log.info(f"{source_id} is not in the override list")
                    continue

            source_child_map = dbt_manifest.child_map.get(source_id, [])

            source_dict = {
                # "created_at": source_node.created_at,
                "database": source_node.database,
                "description": source_node.description,
                # "freshness": source_node.freshness,
                # "loaded_at_field": source_node.loaded_at_field,
                "meta": source_node.meta,
                "name": source_node.name,
                # "resource_type": source_node.resource_type,
                "schema": source_node.schema,
                "source_meta": source_node.source_meta,
                "tags": source_node.tags,
                "unique_id": source_node.unique_id,
            }
            source = parse_dbt_source(
                source_properties=source_dict,
                override_backfill_start=override_backfill_start,
            )
            etl_active = source["etl_active"]

            if not etl_active or len(source_child_map) == 0:
                log.info(f"{source_id} is not configured for etl")
                continue

            sources_merge_args.append(
                f"""(
                '{source_id}','{json.dumps(source_dict).replace("'","''")}',{etl_active}
                )"""
            )

            # Recursively find all downstream models
            child_models = []

            def append_to_models(parent_id):
                model_name = get_model_name_from_id(parent_id)
                if model_name in exclude_models:
                    # If this model is excluded, we'll exclude it and all downstream children
                    return
                model_node = dbt_manifest.nodes.get(parent_id)
                # We are only adding incremental to the source models list
                if model_node and model_node.config.materialized == "incremental":
                    # We are also only adding models with json tags for now
                    if "json" in model_node.config.tags:
                        child_models.append(parent_id)
                child_map = dbt_manifest.child_map.get(parent_id, [])
                for child in child_map:
                    if child not in child_models:
                        append_to_models(child)

            for child in source_child_map:
                append_to_models(child)

            source.update({"child_models": child_models})
            sources.append(source)

        if len(sources_merge_args) > 0:
            # Update the dbt_sources table to indicate which sources are in master and being actively managed by the etl
            sources_merge_sql = f"""
                MERGE INTO {trino_catalog}.{etl_schema}.dbt_sources old USING (VALUES {','.join(sources_merge_args)}) new (source_id, properties, etl_active)
                ON (old.source_id = new.source_id)
                WHEN MATCHED
                    THEN UPDATE SET properties = new.properties, etl_active = new.etl_active
                WHEN NOT MATCHED
                    THEN INSERT (source_id, properties, etl_active) VALUES (new.source_id, new.properties, new.etl_active)
                """
            trino_run(sources_merge_sql)

        return sources

    @task(
        task_id="fetch_source_dates",
        max_active_tis_per_dagrun=source_date_tasks,
        map_index_template="{{ source.id.split('.', 2)[2] }}",
    )
    def fetch_source_dates(source: SourceExtended, ti=None, **context):
        """
        Identify which dates have new data for a source that need to be processed.
        """
        source_id = source["id"]

        skip_sources = context.get("params", {}).get("skip_sources", False)
        if skip_sources:
            # If skipping sources, we don't need to fetch any source dates
            log.info(f"Skipping source runs for {source['id']}")
            return {
                "id": source_id,
                "dates": [],
            }

        etl_timestamp = ti.xcom_pull(key="etl_timestamp", task_ids="start_etl")
        etl_date = datetime.strptime(etl_timestamp, "%Y-%m-%d %H:%M:%S.%f").date()
        event_date_base = etl_date - timedelta(days=event_date_delay)

        if source["etl_type"] == "run_schedule":
            return {
                "id": source_id,
                "dates": [
                    {
                        "event_date": date_to_iso(event_date_base),
                        "event_count": "NULL",
                        "partition_dates": [date_to_iso(event_date_base)],
                    }
                ],
            }

        etl_backfill_start = source["etl_backfill_start"]
        etl_lookback_days = source["etl_lookback_days"]
        etl_sql_event_date_updated_timestamps = source[
            "etl_sql_event_date_updated_timestamps"
        ]

        updated_dates: list[dict] = []

        # Build list of event dates to query
        event_dates = [event_date_base]

        # First check for backfill days we need to populate
        if etl_backfill_start:
            date_backfill_start = datetime.strptime(
                etl_backfill_start, "%Y-%m-%d"
            ).date()
            if etl_lookback_days and etl_lookback_days > 0:
                date_backfill_end = event_date_base - timedelta(days=etl_lookback_days)
            else:
                date_backfill_end = event_date_base

            etl_backfill_days = (date_backfill_end - date_backfill_start).days
            if etl_backfill_days > 0:
                event_dates_backfill: list[date] = []
                for i in range(0, etl_backfill_days):
                    event_date = date_backfill_start + timedelta(days=i)
                    event_dates_backfill.append(event_date)

                dbt_source_dates_old_sql = sql_dbt_source_dates_old(
                    source=source,
                    event_dates=event_dates_backfill,
                    database_name=trino_catalog,
                    etl_schema=etl_schema,
                )
                dbt_source_dates_old_rows = trino_run(dbt_source_dates_old_sql)
                dbt_source_dates_old: list[date] = []
                for old in dbt_source_dates_old_rows:
                    event_date_old: date = old[0]
                    etl_timestamp_old: str | None = old[3]
                    if event_date_old and etl_timestamp_old:
                        # Only consider this date run before if it has an etl_timestamp
                        dbt_source_dates_old.append(event_date_old)

                # Include the last day of the backfill range
                for event_date_backfill in event_dates_backfill:
                    if (
                        event_date_backfill not in dbt_source_dates_old
                        and event_date_backfill not in event_dates
                    ):
                        event_dates.append(event_date_backfill)

        # Then check for lookback days
        if etl_lookback_days > 0:
            for i in range(1, etl_lookback_days + 1):
                event_date_lookback = event_date_base - timedelta(days=i)
                if (
                    not date_backfill_start
                    or event_date_lookback >= date_backfill_start
                ) and event_date_lookback not in event_dates:
                    event_dates.append(event_date_lookback)

        # Sorting in run_chronological order, reverse by default
        event_dates.sort(reverse=not run_chronological)

        # We'll try with the full list of event dates first, but if this fails we'll cut in half and try again
        dbt_source_dates_new_rows = []
        dbt_source_dates_old_rows = []

        attempts_current = 1
        attempts_max = 3

        def load_dbt_source_dates():
            # Outside variables that we may mutate within this function
            nonlocal attempts_current
            nonlocal dbt_source_dates_new_rows
            nonlocal dbt_source_dates_old_rows
            nonlocal event_dates

            try:
                dbt_source_dates_new_sql = sql_dbt_source_dates_new(
                    source=source, event_dates=event_dates
                )
                dbt_source_dates_new_rows = trino_run(dbt_source_dates_new_sql)
                dbt_source_dates_old_sql = sql_dbt_source_dates_old(
                    source=source,
                    event_dates=event_dates,
                    database_name=trino_catalog,
                    etl_schema=etl_schema,
                )
                dbt_source_dates_old_rows = trino_run(dbt_source_dates_old_sql)
            except:
                # If we get an error, we'll try again with half the number of event dates
                if attempts_current < attempts_max:
                    attempts_current += 1
                    log.info(
                        f"Error fetching source dates for {source['id']}, retrying with half the number of event dates"
                    )
                    event_dates = event_dates[: (len(event_dates) // 2)]

                    load_dbt_source_dates()
                else:
                    raise Exception(
                        f"Couldn't load source dates after {attempts_max} attempts"
                    )

        load_dbt_source_dates()

        updated_timestamp_by_event_date: dict[str, str] = {}
        if etl_sql_event_date_updated_timestamps:
            event_dates_iso = [date_to_iso(event_date) for event_date in event_dates]
            event_dates_string = "'" + "','".join(event_dates_iso) + "'"
            sql_event_date_updated_timestamps = f"""
                WITH timestamps as ({etl_sql_event_date_updated_timestamps})
                SELECT
                    cast(event_date as date) as event_date,
                    cast(updated_timestamp as timestamp(6)) as updated_timestamp
                FROM timestamps
                WHERE cast(event_date as varchar) in ({event_dates_string})
            """
            event_date_updated_timestamps = trino_run(sql_event_date_updated_timestamps)
            for row in event_date_updated_timestamps:
                updated_timestamp_by_event_date[row[0]] = row[1]

        for new in dbt_source_dates_new_rows:
            event_date_new_iso: str = new[0]
            event_date_new: date = date_from_iso(event_date_new_iso)
            if event_date_new > event_date_base:
                # Don't include future dates
                continue
            merge_new = False
            found_old = False
            for old in dbt_source_dates_old_rows:
                event_date_old: date = old[0]
                etl_timestamp_old: str = old[3]
                if event_date_old and event_date_new == event_date_old:
                    found_old = True
                    if etl_timestamp_old is None:
                        # If there's no etl_timestamp, we should run this date
                        merge_new = True
                        break
                    event_count_old = old[1]
                    event_count_new = new[1]
                    if event_count_new != event_count_old:
                        merge_new = True
                        break
                    # Even if the event count hasn't changed, we'll check whether there is an updated_timestamp greater than the last etl_timestamp
                    event_date_updated_timestamp = updated_timestamp_by_event_date.get(
                        event_date_new
                    )
                    if (
                        event_date_updated_timestamp
                        and etl_timestamp_old
                        and event_date_updated_timestamp > etl_timestamp_old
                    ):
                        merge_new = True
                        break

            if (
                not found_old
            ):  # If the event date is not found in the old table, it should be merged
                merge_new = True

            if merge_new:
                updated_dates.append(
                    {
                        "event_date": new[0],
                        "event_count": new[1],
                        "partition_dates": new[2],
                    }
                )

        return {
            "id": source_id,
            "dates": updated_dates,
        }

    @task(task_id="fetch_source_runs", trigger_rule=TriggerRule.ALL_DONE)
    def fetch_source_runs(source_dates: list[dict], ti=None):
        source_id_dates_list: list[dict] = (
            source_dates  # Since we only got one result per expanded fetch_source_dates, we don't need to unnest lists here
        )

        etl_timestamp = ti.xcom_pull(key="etl_timestamp", task_ids="start_etl")

        source_runs = build_runs(
            source_id_dates_list, etl_timestamp, date_limit=source_date_limit, chronological=run_chronological
        )

        # Perform the merges first, before running the sources, because might limit and/or timeout the source run tasks
        for source_run in source_runs:
            source_merges: list[dict] = source_run["merges"]

            # Build the SQL to merge the new source date info into the source dates table
            source_merge_args: list[str] = []
            for source_merge in source_merges:
                source_merge_args.append(
                    f"""(
                    '{source_merge['id']}',
                    cast('{source_merge['event_date']}' as date),
                    {source_merge['event_count']},
                    cast(array{source_merge['partition_dates']} as array(date)),
                    cast('{source_merge['etl_timestamp']}' as timestamp(6))
                )"""
                )

            if len(source_merge_args) > 0:
                source_dates_merge_sql = f"""
                    MERGE INTO {trino_catalog}.{etl_schema}.dbt_source_dates old USING (VALUES {','.join(source_merge_args)}) new (source_id, event_date, event_count, partition_dates, etl_timestamp)
                    ON (old.source_id = new.source_id AND old.event_date = new.event_date)
                    WHEN MATCHED
                        THEN UPDATE SET event_count = new.event_count, partition_dates = new.partition_dates, etl_timestamp = new.etl_timestamp
                    WHEN NOT MATCHED
                        THEN INSERT (source_id, event_date, event_count, partition_dates, etl_timestamp) VALUES (new.source_id, new.event_date, new.event_count, new.partition_dates, new.etl_timestamp)
                    """
                # We need to merge the source dates before running the source models
                trino_run(source_dates_merge_sql)

        run_sources_timestamp = datetime.now(timezone.utc).strftime(
            "%Y-%m-%d %H:%M:%S.%f"
        )
        ti.xcom_push(key="run_sources_timestamp", value=run_sources_timestamp)

        chunked_source_runs = chunk_list(source_runs, source_run_limit)
        if not chunked_source_runs:
            return []
        return chunked_source_runs[0]

    @task(
        task_id="run_sources",
        max_active_tis_per_dagrun=1,
        trigger_rule=TriggerRule.ALL_DONE,  # We'll run the ones that were successful, even if some failed
        map_index_template="{{ source_run.event_dates[0] if source_run.event_dates | length == 1 else (source_run.event_dates | min) ~ '~' ~ (source_run.event_dates | max) }}",
    )
    def run_sources(source_run: dict, ti=None, **context):
        etl_timestamp = ti.xcom_pull(key="etl_timestamp", task_ids="start_etl")

        run_sources_timestamp = ti.xcom_pull(
            key="run_sources_timestamp", task_ids="fetch_source_runs"
        )
        if run_sources_timestamp and source_run_timeout_minutes:
            airflow_timeout(
                start_timestamp=run_sources_timestamp,
                timeout_minutes=source_run_timeout_minutes,
            )

        event_dates: list[str] = source_run["event_dates"]

        select_list: list[str] = []
        for source_id in source_run["ids"]:
            source_name = source_id.split(".")[2] + "." + source_id.split(".")[3]
            select_list.append(f"tag:json,source:{source_name}+")

        dbt_build(
            context,
            etl_timestamp,
            event_dates,
            select_list,
        )

    # Returns an array of downstream models by source to run if dates are missing
    @task(
        task_id="fetch_models", trigger_rule=TriggerRule.ALL_DONE
    )  # We want this to trigger even if there were no source runs and that task was skipped
    def fetch_models(ti=None):
        # Reuse the same list of sources from the fetch_sources task
        sources: list[SourceExtended] = ti.xcom_pull(
            key="return_value", task_ids="fetch_sources"
        )

        # Loop through the sources initially to determine the max backfill start date for each model across all upstream sources
        backfill_start_by_model: dict[str, str] = {}
        lookback_days_by_model: dict[str, int] = {}
        for source in sources:
            source_backfill_start = source["etl_backfill_start"]
            source_lookback_days = source["etl_lookback_days"]
            if source_backfill_start or source_lookback_days:
                for model_id in source["child_models"]:
                    # Set the latest backfill start date across all parent sources
                    if source_backfill_start:
                        model_backfill_start = backfill_start_by_model.get(
                            model_id, None
                        )
                        if (
                            not model_backfill_start
                            or source_backfill_start > model_backfill_start
                        ):
                            backfill_start_by_model[model_id] = source_backfill_start
                    # Set the max lookback days across across all parent sources
                    if source_lookback_days:
                        model_lookback_days = lookback_days_by_model.get(model_id, None)
                        if (
                            not model_lookback_days
                            or source_lookback_days > model_lookback_days
                        ):
                            lookback_days_by_model[model_id] = source_lookback_days

        # Loop through the sources again to build the list of models to run with their max backfill start and lookback days included
        source_models_list: list[dict] = []
        for source in sources:
            models: list[dict] = []
            for model_id in source["child_models"]:
                backfill_start = backfill_start_by_model.get(model_id, None)
                lookback_days = lookback_days_by_model.get(model_id, None)
                models.append(
                    {
                        "id": model_id,
                        "backfill_start": backfill_start,
                        "lookback_days": lookback_days,
                    }
                )
            source_models_list.append(
                {
                    "source_id": source["id"],
                    "models": models,
                }
            )

        return source_models_list

    @task(
        task_id="fetch_model_dates",
        max_active_tis_per_dagrun=model_date_tasks,
        map_index_template="{{ source_models.source_id.split('.', 2)[2] }}",
    )
    def fetch_model_dates(source_models: dict, ti=None):
        source_id = source_models["source_id"]
        models = source_models["models"]
        model_ids = [model["id"] for model in models]

        # Build lookup of successful model dates by model_id and event_date to determine which remaining dates from the source need to be run
        successful_etl_timestamps_by_model_event_date: dict[str, str] = {}
        successful_model_dates_sql = f"""
            SELECT
                m.model_id,
                cast(m.event_date as varchar) as event_date,
                m.etl_timestamp,
                sum(case when t.test_status <> 'pass' then 1 else 0 end) as failed_tests
            FROM
                {trino_catalog}.{etl_schema}.dbt_model_dates m
            LEFT OUTER JOIN
                {trino_catalog}.{etl_schema}.dbt_test_dates t ON m.model_id = t.model_id AND m.event_date = t.event_date AND m.etl_timestamp = t.etl_timestamp
            WHERE
                m.model_id IN ('{"','".join(model_ids)}') AND m.run_status = 'success'
            GROUP BY
                m.model_id,
                cast(m.event_date as varchar),
                m.etl_timestamp
            HAVING
                sum(case when t.test_status <> 'pass' then 1 else 0 end) = 0
            ORDER BY
                cast(m.event_date as varchar) DESC
        """
        successful_model_dates = trino_run(successful_model_dates_sql)
        for model_date in successful_model_dates:
            model_id = model_date[0]
            event_date = model_date[1]
            etl_timestamp = model_date[2]
            model_event_date = f"{model_id}_{event_date}"
            successful_etl_timestamps_by_model_event_date[model_event_date] = (
                etl_timestamp
            )

        model_id_dates_list: list[dict] = []
        source_dates_sql = f"""
            SELECT
                cast(event_date as varchar) as event_date,
                etl_timestamp
            FROM
                {trino_catalog}.{etl_schema}.dbt_source_dates
            WHERE
                source_id = '{source_id}'
            ORDER BY
                cast(event_date as varchar) DESC
        """
        source_dates = trino_run(source_dates_sql)
        for source_date in source_dates:
            event_date = source_date[0]
            source_etl_timestamp = source_date[1]
            for model in models:
                backfill_start = model["backfill_start"]
                if backfill_start and event_date < backfill_start:
                    # Don't run models for dates before the max backfill start across upstream sources
                    continue
                model_id = model["id"]
                model_event_date = f"{model_id}_{event_date}"
                model_etl_timestamp = successful_etl_timestamps_by_model_event_date.get(
                    model_event_date, None
                )
                model_dates: list[dict] = []
                if source_etl_timestamp and (
                    model_etl_timestamp is None
                    or source_etl_timestamp > model_etl_timestamp
                ):
                    model_dates.append({"event_date": event_date})
                model_id_dates_list.append(
                    {
                        "id": model_id,
                        "dates": model_dates,
                    }
                )

        return model_id_dates_list

    @task(task_id="fetch_model_runs")
    def fetch_model_runs(model_dates: list[list[dict]], ti=None):
        model_id_dates_list: list[dict] = [
            inner for outer in model_dates for inner in outer
        ]  # Since we get multiple results per expanded fetch_model_dates, we need to unnest lists here

        etl_timestamp = ti.xcom_pull(key="etl_timestamp", task_ids="start_etl")

        model_runs = build_runs(
            model_id_dates_list, etl_timestamp, date_limit=model_date_limit,chronological=run_chronological
        )

        run_models_timestamp = datetime.now(timezone.utc).strftime(
            "%Y-%m-%d %H:%M:%S.%f"
        )
        ti.xcom_push(key="run_models_timestamp", value=run_models_timestamp)

        chunked_model_runs = chunk_list(model_runs, model_run_limit)
        if not chunked_model_runs:
            return []
        return chunked_model_runs[0]

    @task(
        task_id="run_models",
        max_active_tis_per_dagrun=1,
        trigger_rule=TriggerRule.ALL_DONE,  # We'll run the ones that were successful, even if some failed
        map_index_template="{{ model_run.event_dates[0] if model_run.event_dates | length == 1 else (model_run.event_dates | min) ~ '~' ~ (model_run.event_dates | max) }}",
    )
    def run_models(model_run: dict, ti=None, **context):
        etl_timestamp = ti.xcom_pull(key="etl_timestamp", task_ids="start_etl")
        run_models_timestamp = ti.xcom_pull(
            key="run_models_timestamp", task_ids="fetch_model_runs"
        )
        if run_models_timestamp and model_run_timeout_minutes:
            airflow_timeout(
                start_timestamp=run_models_timestamp,
                timeout_minutes=model_run_timeout_minutes,
            )

        event_dates: list[str] = model_run["event_dates"]
        model_ids: list[str] = model_run["ids"]
        select_list: list[str] = []
        for model_id in model_ids:
            model_name = model_id.split(".")[2]
            select_list.append(
                f"{model_name}+"
            )  # Ensures we re-run all downstream with the updated model

        dbt_build(
            context,
            etl_timestamp,
            event_dates,
            select_list,
        )

    # Will retry any errors from the current etl timestamp
    @task(task_id="fetch_error_runs", trigger_rule=TriggerRule.ALL_DONE)
    def fetch_error_runs(ti=None):
        etl_timestamp = ti.xcom_pull(key="etl_timestamp", task_ids="start_etl")
        model_id_dates_list: list[dict] = []
        # Retry any failed models from the current etl timestamp
        sql_model_error_dates = f"""
            SELECT
                model_id,
                cast(event_date as varchar) as event_date
            FROM
                {trino_catalog}.{etl_schema}.dbt_model_dates
            WHERE
                etl_timestamp = cast('{etl_timestamp}' as timestamp(6)) AND run_status = 'error'
        """
        model_error_dates = trino_run(sql_model_error_dates)
        if len(model_error_dates) > 0:
            log.info(
                f"Found {len(model_error_dates)} failed model dates from {etl_timestamp}"
            )
            for row in model_error_dates:
                model_id_dates_list.append(
                    {"id": row[0], "dates": [{"event_date": row[1]}]}
                )

        error_runs = build_runs(
            id_dates_list=model_id_dates_list, etl_timestamp=etl_timestamp, date_limit=1
        )

        run_errors_timestamp = datetime.now(timezone.utc).strftime(
            "%Y-%m-%d %H:%M:%S.%f"
        )
        ti.xcom_push(key="run_errors_timestamp", value=run_errors_timestamp)

        chunked_error_runs = chunk_list(error_runs, error_run_limit)
        if not chunked_error_runs:
            return []
        return chunked_error_runs[0]

    # Will rerun any errors from the current etl timestamp
    @task(
        task_id="run_errors",
        max_active_tis_per_dagrun=1,
        map_index_template="{{ error_run.event_dates[0] if error_run.event_dates | length == 1 else (error_run.event_dates | min) ~ '~' ~ (error_run.event_dates | max) }}",
    )
    def run_errors(error_run: dict, ti=None, **context):
        etl_timestamp = ti.xcom_pull(key="etl_timestamp", task_ids="start_etl")
        run_errors_timestamp = ti.xcom_pull(
            key="run_errors_timestamp", task_ids="fetch_error_runs"
        )
        if run_errors_timestamp and error_run_timeout_minutes:
            airflow_timeout(
                start_timestamp=run_errors_timestamp,
                timeout_minutes=error_run_timeout_minutes,
            )

        event_dates: list[str] = error_run["event_dates"]
        model_ids: list[str] = error_run["ids"]
        select_list: list[str] = []
        for model_id in model_ids:
            model_name = model_id.split(".")[2]
            select_list.append(
                f"{model_name}+"
            )  # Ensures we re-run all downstream with the updated model

        dbt_build(
            context,
            etl_timestamp,
            event_dates,
            select_list,
        )

    # Will run optimize for any models that have reached their optimize date delay threshold
    @task(task_id="fetch_optimize_runs", trigger_rule=TriggerRule.ALL_DONE)
    def fetch_optimize_runs(ti=None):
        if not optimize_date_delay:
            # If we don't have an optimize date delay variable, we don't need to run any mapped tasks
            return []

        etl_timestamp = ti.xcom_pull(key="etl_timestamp", task_ids="start_etl")

        # Retry any failed models from the current etl timestamp
        sql_model_optimize_dates = f"""
            SELECT
                model_id,
                cast(event_date as varchar) as event_date,
                optimize_timestamp
            FROM
                {trino_catalog}.{etl_schema}.dbt_model_dates
            WHERE
                run_status = 'success'
                AND (
                    (optimize_timestamp IS NULL AND date_diff('day', etl_timestamp, timestamp '{etl_timestamp}') > {optimize_date_delay})
                    OR (optimize_timestamp IS NOT NULL AND date_diff('day', optimize_timestamp, etl_timestamp) > {optimize_date_delay})
                )
            ORDER BY
                event_date DESC
        """

        iso_event_dates_by_model_id: dict[str, list[str]] = {}
        model_optimize_dates = trino_run(sql_model_optimize_dates)
        if len(model_optimize_dates) > 0:
            log.info(
                f"Found {len(model_optimize_dates)} potential optimize model dates from {etl_timestamp}"
            )
            for row in model_optimize_dates:
                model_id = row[0]
                event_date = row[1]
                model_dates = iso_event_dates_by_model_id.get(model_id, [])
                if event_date not in model_dates:
                    model_dates.append(event_date)
                    iso_event_dates_by_model_id[model_id] = model_dates

        optimize_runs: list[dict] = []
        for model_id, event_dates in iso_event_dates_by_model_id.items():
            optimize_runs.append(
                {
                    "id": model_id,
                    "event_dates": event_dates,
                }
            )
        run_optimize_timestamp = datetime.now(timezone.utc).strftime(
            "%Y-%m-%d %H:%M:%S.%f"
        )
        ti.xcom_push(key="run_optimize_timestamp", value=run_optimize_timestamp)

        chunked_optimize_runs = chunk_list(optimize_runs, optimize_run_limit)
        if not chunked_optimize_runs:
            return []
        return chunked_optimize_runs[0]

    # Will optimize any models reaching the delay threshold
    @task(
        task_id="run_optimize",
        max_active_tis_per_dagrun=optimize_run_tasks,
        map_index_template="{{ optimize_run.id.split('.', 2)[2] }}",
    )
    def run_optimize(optimize_run: dict, ti=None, **context):
        etl_timestamp = ti.xcom_pull(key="etl_timestamp", task_ids="start_etl")

        run_optimize_timestamp = ti.xcom_pull(
            key="run_optimize_timestamp", task_ids="fetch_optimize_runs"
        )
        if run_optimize_timestamp and optimize_run_timeout_minutes:
            airflow_timeout(
                start_timestamp=run_optimize_timestamp,
                timeout_minutes=optimize_run_timeout_minutes,
            )

        log.info(optimize_run)

        if len(optimize_run["event_dates"]) == 0:
            log.info("No event dates found for optimize run")
            return

        model_id = optimize_run["id"]
        model_name = get_model_name_from_id(model_id)
        if not model_name:
            log.info("No model name found for optimize run")
            return

        event_dates = optimize_run["event_dates"]
        partition_column: str | None = None
        partition_dates: list[str] = []
        partition_daily_rows = trino_run(
            f"show columns from {model_name} like 'portal\_partition\_daily' escape '\\'"
        )
        if len(partition_daily_rows) > 0:
            log.info("Running optimize for daily partitioned model")
            partition_column = "portal_partition_daily"
            for event_date_iso in event_dates:
                partition_dates.append(f"date '{event_date_iso}'")
        else:
            partition_monthly_rows = trino_run(
                f"show columns from {model_name} like 'portal\_partition\_monthly' escape '\\'"
            )
            if len(partition_monthly_rows) > 0:
                log.info("Running optimize for monthly partitioned model")
                partition_column = "portal_partition_monthly"
                partitions_monthly: list[str] = []
                for event_date_iso in optimize_run["event_dates"]:
                    event_date = date_from_iso(event_date_iso)
                    event_date_month = event_date.replace(day=1)
                    event_date_month_iso = date_to_iso(event_date_month)
                    if event_date_month_iso not in partitions_monthly:
                        partition_dates.append(f"date '{event_date_month_iso}'")
                return

        if partition_column and len(partition_dates) > 0:
            for partition_dates_chunk in chunk_list(
                partition_dates, optimize_date_limit
            ):
                in_dates = ", ".join(partition_dates_chunk)
                trino_run(
                    f"ALTER TABLE {model_name} EXECUTE OPTIMIZE(file_size_threshold => '{optimize_file_size_threshold}') WHERE {partition_column} IN ({in_dates})"
                )
                trino_run(
                    f"""
                    UPDATE {trino_catalog}.{etl_schema}.dbt_model_dates
                    SET optimize_timestamp = cast('{etl_timestamp}' as timestamp(6))
                    WHERE model_id = '{model_id}' AND event_date IN ({in_dates})
                    """
                )
        else:
            log.info("Running optimize for non date partitioned model")
            trino_run(
                f"ALTER TABLE {model_name} EXECUTE OPTIMIZE(file_size_threshold => '{optimize_file_size_threshold}')"
            )
            trino_run(
                f"""
                UPDATE {trino_catalog}.{etl_schema}.dbt_model_dates
                SET optimize_timestamp = cast('{etl_timestamp}' as timestamp(6))
                """
            )

    # Will vacuum any models reaching the delay threshold
    @task(task_id="fetch_vacuum_runs", trigger_rule=TriggerRule.ALL_DONE)
    def fetch_vacuum_runs(ti=None):
        if not vacuum_date_delay:
            # If we don't have a vacuum date delay variable, we don't need to run any mapped tasks
            return []

        # Delta Lake requires a minimum vacuum retention of 7 days.
        # Iceberg's expire_snapshots/remove_orphan_files have no such minimum.
        if storage_type != "iceberg" and vacuum_date_delay < 7:
            raise Exception(
                f"Vacuum date delay is less than the recommended minimum of 7 for Delta Lake"
            )

        etl_timestamp = ti.xcom_pull(key="etl_timestamp", task_ids="start_etl")
        vacuum_runs: list[dict] = []
        # Retry any failed models from the current etl timestamp
        sql_model_vacuum_dates = f"""
            SELECT
                model_id,
                max(vacuum_timestamp) as vacuum_timestamp
            FROM
                {trino_catalog}.{etl_schema}.dbt_model_dates
            WHERE
                run_status = 'success'
            GROUP BY
                model_id
            HAVING
                max(vacuum_timestamp) IS NULL OR date_diff('day', max(vacuum_timestamp), timestamp '{etl_timestamp}') > {vacuum_date_delay}
        """

        model_vacuum_dates = trino_run(sql_model_vacuum_dates)
        if len(model_vacuum_dates) > 0:
            log.info(
                f"Found {len(model_vacuum_dates)} successful vacuum dates from {etl_timestamp}"
            )
            for row in model_vacuum_dates:
                vacuum_runs.append({"id": row[0]})

        run_vacuum_timestamp = datetime.now(timezone.utc).strftime(
            "%Y-%m-%d %H:%M:%S.%f"
        )
        ti.xcom_push(key="run_vacuum_timestamp", value=run_vacuum_timestamp)

        chunked_vacuum_runs = chunk_list(vacuum_runs, vacuum_run_limit)
        if not chunked_vacuum_runs:
            return []
        return chunked_vacuum_runs[0]

    # Will run vacuum on all models meeting the delay threshold
    @task(
        task_id="run_vacuum",
        max_active_tis_per_dagrun=vacuum_run_tasks,
        map_index_template="{{ vacuum_run.id.split('.', 2)[2] }}",
    )
    def run_vacuum(vacuum_run: dict, ti=None, **context):
        etl_timestamp = ti.xcom_pull(key="etl_timestamp", task_ids="start_etl")
        log.info(vacuum_run)

        run_vacuum_timestamp = ti.xcom_pull(
            key="run_vacuum_timestamp", task_ids="fetch_vacuum_runs"
        )
        if run_vacuum_timestamp and vacuum_run_timeout_minutes:
            airflow_timeout(
                start_timestamp=run_vacuum_timestamp,
                timeout_minutes=vacuum_run_timeout_minutes,
            )

        model_id = vacuum_run["id"]
        model_name = get_model_name_from_id(model_id)
        if not model_name:
            log.info("No model name found for vacuum run")
            return

        if storage_type == "iceberg":
            trino_run(
                f"ALTER TABLE {model_name} EXECUTE expire_snapshots(retention_threshold => '{vacuum_date_delay}d')"
            )
            trino_run(
                f"ALTER TABLE {model_name} EXECUTE remove_orphan_files(retention_threshold => '{vacuum_date_delay}d')"
            )
        else:
            trino_run(
                f"""
                CALL {trino_catalog}.system.vacuum('{trino_schema}', '{model_name}', '{vacuum_date_delay}d')
                """
            )
        trino_run(
            f"""
            UPDATE {trino_catalog}.{etl_schema}.dbt_model_dates
            SET vacuum_timestamp = cast('{etl_timestamp}' as timestamp(6))
            WHERE model_id = '{model_id}' AND date_diff('day', event_date, timestamp '{etl_timestamp}') > {vacuum_date_delay}
            """
        )

    @task(task_id="end_etl", trigger_rule=TriggerRule.ALL_DONE)
    def end_etl(ti=None, **context):
        """
        Finalize the ETL run. Scale down workers and send failure notifications if configured.
        """
        if custom_failure_notifications and not suppress_notifications:
            send_dag_failure_notification(
                email_list=dag_email_list,
                context=context,
                task_instance=ti,
            )

        if k8s_workers_end is not None:
            # Scale down the workers to the desired number
            k8s_scale(workers=k8s_workers_end)

    # Sequence tasks

    _start_etl = start_etl()
    _create_source_tables = create_source_tables()
    _fetch_sources = fetch_sources()
    _fetch_source_dates = fetch_source_dates.expand(source=_fetch_sources)
    _fetch_source_runs = fetch_source_runs(source_dates=_fetch_source_dates)
    _run_sources = run_sources.expand(source_run=_fetch_source_runs)
    _fetch_models = fetch_models()
    _fetch_model_dates = fetch_model_dates.expand(source_models=_fetch_models)
    _fetch_model_runs = fetch_model_runs(model_dates=_fetch_model_dates)
    _run_models = run_models.expand(model_run=_fetch_model_runs)
    _fetch_error_runs = fetch_error_runs()
    _run_errors = run_errors.expand(error_run=_fetch_error_runs)
    _fetch_optimize_runs = fetch_optimize_runs()
    _run_optimize = run_optimize.expand(optimize_run=_fetch_optimize_runs)
    _fetch_vacuum_runs = fetch_vacuum_runs()
    _run_vacuum = run_vacuum.expand(vacuum_run=_fetch_vacuum_runs)
    _end_etl = end_etl()

    (
        _start_etl
        >> _create_source_tables
        >> _fetch_sources
        >> _fetch_source_dates
        >> _fetch_source_runs
        >> _run_sources
        >> _fetch_models
        >> _fetch_model_dates
        >> _fetch_model_runs
        >> _run_models
        >> _fetch_error_runs
        >> _run_errors
        >> _fetch_optimize_runs
        >> _run_optimize
        >> _fetch_vacuum_runs
        >> _run_vacuum
        >> _end_etl
    )


etl = source_etl_dag()
