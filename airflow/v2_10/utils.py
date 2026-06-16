from datetime import (
    date,
    datetime,
    timedelta,
)
import json
from itertools import islice
import re
import unittest
from typing import Sequence, TypedDict, Union

# Classes


class DbtNodeModel:
    resource_type = "model"
    unique_id: str


class DbtNodeTest:
    attached_node: str
    resource_type = "test"


class DbtResultAdapterResponse(TypedDict):
    rows_affected: int


class DbtResult:
    adapter_response: DbtResultAdapterResponse
    execution_time: float
    message: str
    node: Union[DbtNodeModel, DbtNodeTest]
    status: str
    unique_id: str


class DbtRunnerResponseResult:
    results: Sequence[DbtResult]


class DbtRunnerResponse:
    success: bool
    result: Union[
        None,  # clean, deps, init, source
        DbtRunnerResponseResult,  # build, compile, run, seed, snapshot, test, run-operation
    ] = None


# Types

DateRange = TypedDict("DateRange", {"end": str, "start": str})
ModelIdDate = TypedDict(
    "ModelIdDate",
    {
        "event_date": str,
        "model_id": str,
        "run_message": str | None,
        "run_rows": int,
        "run_seconds": int,
        "run_status": str,
    },
)
ModelIdDates = TypedDict(
    "ModelIdDates",
    {
        "id": str,
        "dates": list[ModelIdDate],
    },
)
SourceSelect = TypedDict("SourceSelect", {"data_type": str, "expr": str, "name": str})
SourceTableFunction = TypedDict(
    "SourceTableFunction",
    {
        "arg": str | None,
        "database": str | None,
        "dialect": str | None,
        "from": str | None,
        "name": str | None,
        "schema": str | None,
    },
)
SourceEtl = TypedDict(
    "SourceEtl",
    {
        "active": bool,
        "backfill_start": str | None,
        "lookback_days": int,
        "sql_event_date_updated_timestamps": str | None,
        "sql_retry": str | None,
    },
)
SourceEventDatetime = TypedDict(
    "SourceEventDatetime",
    {
        "data_type": str | None,
        "expr": str,
        "interval": str | None,
        "use_range": bool,
    },
)
SourceParent = TypedDict(
    "SourceParent",
    {
        "from": str,
        "select": list[SourceSelect | str],
        "table_function": SourceTableFunction | None,
    },
)
SourcePartitionDate = TypedDict(
    "SourcePartitionDate",
    {
        "data_type": str | None,
        "expr": str,
        "interval": str | None,
        "use_event_dates": bool,
        "use_range": bool,
    },
)
SourceWhere = TypedDict(
    "SourceWhere",
    {
        "expr": str,
    },
)
Source = TypedDict(
    "Source",
    {
        "database": str,
        "etl": SourceEtl | None,
        "etl_active": bool,
        "etl_backfill_start": str | None,
        "etl_lookback_days": int,
        "etl_parents": list[SourceParent] | None,
        "etl_sql_event_date_updated_timestamps": str | None,
        "etl_sql_retry": str | None,
        "etl_type": str,
        "event_datetime": SourceEventDatetime,
        "event_datetime_expr": str,
        "event_datetime_interval": str | None,
        "event_datetime_use_range": bool,
        "from": str,
        "partition_date": SourcePartitionDate,
        "partition_date_data_type": str | None,
        "partition_date_expr": str,
        "partition_date_interval": str | None,
        "partition_date_prefix": str,
        "partition_date_use_range": bool,
        "id": str,
        "schema": str,
        "table_function": SourceTableFunction | None,
        "table_function_arg": str | None,
        "table_function_database": str | None,
        "table_function_dialect": str | None,
        "table_function_name": str | None,
        "table_function_schema": str | None,
        "table_name": str,
        "where": SourceWhere | None,
        "where_expr": str | None,
    },
)
TestIdDate = TypedDict(
    "TestIdDate",
    {
        "event_date": str,
        "model_id": str,
        "test_id": str,
        "test_message": str | None,
        "test_rows": int,
        "test_seconds": int,
        "test_status": str,
    },
)
TestIdDates = TypedDict(
    "TestIdDates",
    {
        "id": str,
        "dates": list[TestIdDate],
    },
)

RunParsed = TypedDict(
    "RunParsed",
    {
        "model_id_dates_list": list[ModelIdDates],
        "test_id_dates_list": list[TestIdDates],
    },
)


class SourceExtended(Source):
    child_models: list[str]


# General utils
def chunk_list(data: list, chunk_size: int | None) -> list[list]:
    if not chunk_size:
        return [data]
    it = iter(data)
    return list(iter(lambda: list(islice(it, chunk_size)), []))


# Etl Utils
def build_runs(
    id_dates_list: list[dict],
    etl_timestamp: str,
    date_limit: int = None,
    chronological: bool = False
):

    ids_by_event_date: dict[str, list[str]] = {}
    merge_by_id_event_date: dict[str, dict] = {}

    for id_dates in id_dates_list:
        id: str = id_dates["id"]
        for fields in id_dates["dates"]:
            merge = {
                "id": id,
                "etl_timestamp": etl_timestamp,
            }
            merge.update(fields)
            event_date = fields["event_date"]

            merge_by_id_event_date[f"{id}.{event_date}"] = merge

            ids = ids_by_event_date.get(event_date, [])
            ids.append(id)
            ids_by_event_date[event_date] = ids

    # Sorting based on chronological order value
    ids_by_event_date = dict(sorted(ids_by_event_date.items(), reverse=not chronological))

    event_dates_by_ids: dict[str, list[str]] = {}
    for (
        event_date,
        ids,
    ) in ids_by_event_date.items():
        ids_string = ",".join(ids)
        event_dates: list[dict] = event_dates_by_ids.get(ids_string, [])
        event_dates.append(event_date)
        event_dates_by_ids[ids_string] = event_dates

    runs: list[dict] = []
    for (
        ids_string,
        event_dates,
    ) in event_dates_by_ids.items():
        ids = ids_string.split(",")
        if date_limit is None:
            event_dates_runs = [event_dates]
        else:
            # Split the event dates into chunks of the date limit
            event_dates_runs = [
                event_dates[i : i + date_limit]
                for i in range(
                    0,
                    len(event_dates),
                    date_limit,
                )
            ]
        for event_dates_run in event_dates_runs:
            # Collect the merges for this run
            merges = [
                merge_by_id_event_date[f"{id}.{event_date}"]
                for id in ids
                for event_date in event_dates_run
            ]
            runs.append(
                {
                    "event_dates": event_dates_run,
                    "ids": ids,
                    "merges": merges,
                }
            )

    return runs


def build_test_merges(
    test_id_dates_list: list[TestIdDates],
    etl_timestamp: str,
) -> list[dict]:
    """Build merge dicts for test dates, keyed by (test_id, model_id, event_date)
    so tests referencing multiple models produce separate merge entries."""
    merges: list[dict] = []
    for id_dates in test_id_dates_list:
        test_id: str = id_dates["id"]
        for fields in id_dates["dates"]:
            merge = {
                "id": test_id,
                "etl_timestamp": etl_timestamp,
            }
            merge.update(fields)
            merges.append(merge)
    return merges


def date_add_days(date: date, days: int) -> date:
    return date + timedelta(days=days)


def date_from_iso(
    date_iso: str,
) -> date:
    # Truncate to only include the date part of iso strings
    date_iso = date_iso.split("T")[0]
    date_iso = date_iso.split(" ")[0]
    return datetime.strptime(date_iso, "%Y-%m-%d").date()


def date_to_iso(
    date: date,
) -> str:
    return date.strftime("%Y-%m-%d")


def parse_dbt_results(
    event_dates: list[str], run_response: DbtRunnerResponse
) -> RunParsed:
    model_id_dates_list: list[dict] = []
    raise_fail_exception: bool = False
    test_id_dates_list: list[TestIdDates] = []

    if run_response.result and run_response.result.results:
        for result in run_response.result.results:
            message = result.message.replace("'", "''") if result.message else ""
            rows = result.adapter_response.get("rows_affected", "NULL")
            seconds = result.execution_time
            status = result.status

            if result.node.resource_type == "model":
                model_id = result.node.unique_id
                model_id_dates_list.append(
                    {
                        "id": model_id,
                        "dates": [
                            {
                                "event_date": event_date,
                                "model_id": model_id,
                                "run_message": message,
                                "run_rows": rows,
                                "run_seconds": seconds,
                                "run_status": status,
                            }
                            for event_date in event_dates
                        ],
                    }
                )
                if status != "success":
                    # Only raising fail exception if a model fails or is skipped
                    raise_fail_exception = True

            elif result.node.resource_type == "test":
                test_id = result.node.unique_id
                model_id = getattr(result.node, "attached_node", None)

                # Collect all dependent model IDs
                model_ids: list[str] = [model_id] if model_id else []

                if not model_ids:
                    depends_on = getattr(result.node, "depends_on", None)
                    dep_nodes = None

                    if isinstance(depends_on, dict):
                        dep_nodes = depends_on.get("nodes")
                    elif depends_on:
                        dep_nodes = getattr(depends_on, "nodes", None)

                    if dep_nodes:
                        for dep in dep_nodes:
                            if isinstance(dep, str) and dep.startswith("model."):
                                model_ids.append(dep)

                # Skip test if no model_ids found
                if not model_ids:
                    continue

                # Emit one entry per dependent model
                for dep_model_id in model_ids:
                    test_id_dates_list.append(
                        {
                            "id": test_id,
                            "dates": [
                                {
                                    "event_date": event_date,
                                    "model_id": dep_model_id,
                                    "test_id": test_id,
                                    "test_message": message,
                                    "test_rows": rows,
                                    "test_seconds": seconds,
                                    "test_status": status,
                                }
                                for event_date in event_dates
                            ],
                        }
                    )

    return {
        "model_id_dates_list": model_id_dates_list,
        "raise_fail_exception": raise_fail_exception,
        "test_id_dates_list": test_id_dates_list,
    }


def get_model_name_from_id(model_id: str) -> str:
    return model_id.split(".")[-1]


# Patterns that indicate permanent (non-retryable) errors — these require a model
# or configuration change and will never self-resolve on retry.
PERMANENT_ERROR_PATTERNS: list[str] = [
    r"Compilation\s+Error",
    r"Parsing\s+Error",
    r"syntax\s+error",
    r"COLUMN_NOT_FOUND",
    r"TABLE_NOT_FOUND",
    r"SCHEMA_NOT_FOUND",
    r"CATALOG_NOT_FOUND",
    r"TYPE_MISMATCH",
    r"PERMISSION_DENIED",
    r"ACCESS_DENIED",
    r"AMBIGUOUS_NAME",
    r"DUPLICATE_COLUMN_NAME",
    r"MISSING_COLUMN_NAME",
    r"EXPRESSION_NOT_AGGREGATE",
    r"NOT_SUPPORTED",
    r"INVALID_ARGUMENTS",
    r"INVALID_CAST_ARGUMENT",
    r"INVALID_FUNCTION_ARGUMENT",
    r"DIVISION_BY_ZERO",
    r"INVALID_VIEW",
    r"relation\s+.*does\s+not\s+exist",
    r"column\s+.*does\s+not\s+exist",
]
_PERMANENT_RE = re.compile("|".join(PERMANENT_ERROR_PATTERNS), re.IGNORECASE)


def should_retry(run_response) -> bool:
    """
    Determine whether a failed dbt run deserves an immediate retry.

    Returns True (retry) by default. Only returns False when **every** failed model
    matches a known permanent error pattern that would never resolve without a
    model or configuration change.
    """
    if not run_response.result or not run_response.result.results:
        return False

    failed_messages: list[str] = []
    for result in run_response.result.results:
        if getattr(result.node, "resource_type", None) != "model":
            continue
        if result.status not in ("success", "pass"):
            failed_messages.append(result.message or "")

    if not failed_messages:
        return False

    # If any failed model does NOT match a permanent pattern, retry is worthwhile
    for message in failed_messages:
        if not _PERMANENT_RE.search(message):
            return True

    # Every failure is permanent — retry would not help
    return False


# Parse properties from the source
def parse_dbt_source(
    source_properties: dict | str,
    override_backfill_start: str | None = None,
) -> Source:
    # If stringified json, convert to dictionary
    if isinstance(source_properties, str):
        source_properties = json.loads(source_properties)

    database: str = source_properties.get("database", None)
    id: str = source_properties.get("unique_id", None)
    schema: str = source_properties.get("schema", None)
    table: str = source_properties.get("name", None)

    schema_meta: dict = source_properties.get("source_meta", {})
    table_meta: dict = source_properties.get("meta", {})

    # Each one of these can either be provided at the table level or the schema level
    etl: dict = table_meta.get(
        "etl",
        schema_meta.get("etl", {}),
    )
    event_datetime: dict = table_meta.get(
        "event_datetime",
        schema_meta.get(
            "event_datetime",
            {},
        ),
    )
    partition_date: dict = table_meta.get(
        "partition_date",
        schema_meta.get(
            "partition_date",
            {},
        ),
    )
    table_function: dict = table_meta.get(
        "table_function",
        schema_meta.get(
            "table_function",
            {},
        ),
    )
    where: dict = table_meta.get(
        "where",
        schema_meta.get("where", {}),
    )

    etl_active: bool = etl.get("active", False)
    etl_backfill_start: str = etl.get("backfill_start", None)
    if (
        etl_backfill_start
        and override_backfill_start
        and override_backfill_start > etl_backfill_start
    ):
        etl_backfill_start = override_backfill_start
    etl_lookback_days: int = etl.get("lookback_days", 0)
    etl_sql_event_date_updated_timestamps: str = etl.get(
        "sql_event_date_updated_timestamps",
        None,
    )
    etl_sql_retry: str = etl.get("sql_retry", None)
    etl_type: str = etl.get("type", "event_count")

    event_datetime_expr: str = event_datetime.get("expr", None)
    event_datetime_interval: str = event_datetime.get("interval", None)
    event_datetime_use_range: bool = event_datetime.get("use_range", False)

    partition_date_data_type: str = partition_date.get("data_type", None)
    partition_date_expr: str = partition_date.get("expr", None)
    partition_date_interval: str = partition_date.get("interval", "day")
    partition_date_prefix: str = ""
    if partition_date_data_type == "date":
        partition_date_prefix = "date "
    if partition_date_data_type == "timestamp":
        partition_date_prefix = "timestamp "
    partition_date_use_event_dates: bool = partition_date.get("use_event_dates", False)
    partition_date_use_range: bool = partition_date.get("use_range", False)

    table_function_arg: str = table_function.get("arg", None)
    table_function_database: str = table_function.get("database", None)
    table_function_dialect: str = table_function.get("dialect", None)
    table_function_name: str = table_function.get("name", None)
    table_function_schema: str = table_function.get("schema", None)

    where_expr: str = where.get("expr", None)

    return {
        "database": database,
        "etl": etl,
        "etl_active": etl_active,
        "etl_backfill_start": etl_backfill_start,
        "etl_lookback_days": etl_lookback_days,
        "etl_sql_event_date_updated_timestamps": etl_sql_event_date_updated_timestamps,
        "etl_sql_retry": etl_sql_retry,
        "etl_type": etl_type,
        "event_datetime": event_datetime,
        "event_datetime_expr": event_datetime_expr,
        "event_datetime_interval": event_datetime_interval,
        "event_datetime_use_range": event_datetime_use_range,
        "from": f"{database}.{schema}.{table}",
        "partition_date": partition_date,
        "partition_date_data_type": partition_date_data_type,
        "partition_date_expr": partition_date_expr,
        "partition_date_interval": partition_date_interval,
        "partition_date_prefix": partition_date_prefix,
        "partition_date_use_event_dates": partition_date_use_event_dates,
        "partition_date_use_range": partition_date_use_range,
        "id": id,
        "schema": schema,
        "table_function": table_function,
        "table_function_arg": table_function_arg,
        "table_function_database": table_function_database,
        "table_function_dialect": table_function_dialect,
        "table_function_name": table_function_name,
        "table_function_schema": table_function_schema,
        "table": table,
        "where": where,
        "where_expr": where_expr,
    }


def sql_dbt_model_dates_merge(
    database_name: str,
    etl_timestamp: str,
    event_dates: list[str],
    model_id_dates_list: list[TestIdDates],
    etl_schema: str,
) -> str | None:
    model_merge_args: list[str] = []
    # Building model runs for the successful models just so we can collect the merges
    model_runs = build_runs(model_id_dates_list, etl_timestamp)
    for model_run in model_runs:
        for model_merge in model_run["merges"]:
            model_merge_args.append(
                f"""(
                    '{model_merge['id']}',
                    cast('{model_merge['event_date']}' as date),
                    cast('{model_merge['etl_timestamp']}' as timestamp(6)),
                    cast(array{event_dates} as array(date)),
                    '{model_merge['run_message']}',
                    {model_merge['run_rows']},
                    {model_merge['run_seconds']},
                    '{model_merge['run_status']}'
                )"""
            )

    # Update the model dates table with the model run results
    if len(model_merge_args) > 0:
        return f"""
                MERGE INTO {database_name}.{etl_schema}.dbt_model_dates old USING (VALUES {','.join(model_merge_args)}) new (model_id, event_date, etl_timestamp, run_dates, run_message, run_rows, run_seconds, run_status)
                ON (old.model_id = new.model_id AND old.event_date = new.event_date)
                WHEN MATCHED
                    THEN UPDATE SET etl_timestamp = new.etl_timestamp, run_dates = new.run_dates, run_message = new.run_message, run_rows = new.run_rows, run_seconds = new.run_seconds, run_status = new.run_status
                WHEN NOT MATCHED
                    THEN INSERT (model_id, event_date, etl_timestamp, run_dates, run_message, run_rows, run_seconds, run_status) VALUES (new.model_id, new.event_date, new.etl_timestamp, new.run_dates, new.run_message, new.run_rows, new.run_seconds, new.run_status)
                """

    return None


def sql_dbt_source_dates_new(
    source: Source,
    event_dates: list[date],
) -> str:
    database = source["database"]
    etl_lookback_days = source["etl_lookback_days"]
    event_datetime_expr = source["event_datetime_expr"]
    event_datetime_use_range = source["event_datetime_use_range"]
    partition_date_expr = source["partition_date_expr"]
    partition_date_interval = source["partition_date_interval"]
    partition_date_prefix = source["partition_date_prefix"]
    partition_date_use_range = source["partition_date_use_range"]
    schema = source["schema"]
    table = source["table"]
    table_function_name = source["table_function_name"]
    where_expr = source["where_expr"]

    date_quote = "'"
    if table_function_name:
        date_quote = '"'

    # Build event date filter
    event_datetime_or: list[str] = []
    if event_datetime_use_range:
        for event_date in event_dates:
            iso_start = date_to_iso(event_date)
            iso_end = date_to_iso(date_add_days(event_date, 1))
            event_datetime_or.append(
                f"({event_datetime_expr} >= {date_quote}{iso_start}{date_quote} AND {event_datetime_expr} < {date_quote}{iso_end}{date_quote})"
            )
    else:
        iso_dates: list[str] = []
        for event_date in event_dates:
            iso_date = date_to_iso(event_date)
            if iso_date not in iso_dates:
                iso_dates.append(iso_date)
        iso_dates.sort()
        in_list: list[str] = []
        for iso_date in iso_dates:
            in_list.append(f"date {date_quote}{iso_date}{date_quote}")
        event_datetime_or.append(
            f"date_trunc('day', cast({event_datetime_expr} as date)) IN ({','.join(in_list)})"
        )

    # Build partition date filter
    partition_date_or: list[str] = []
    if partition_date_use_range:
        for event_date in event_dates:
            if partition_date_interval == "month":
                iso_start = date_to_iso(event_date.replace(day=1))
                iso_end = date_to_iso(
                    date_add_days(event_date, etl_lookback_days + 31).replace(day=1)
                )
            else:
                iso_start = date_to_iso(event_date)
                iso_end = date_to_iso(date_add_days(event_date, etl_lookback_days + 1))
            partition_date_or.append(
                f"({partition_date_expr} >= {partition_date_prefix}{date_quote}{iso_start}{date_quote} AND {partition_date_expr} < {partition_date_prefix}{date_quote}{iso_end}{date_quote})"
            )
    else:
        iso_dates: list[str] = []
        for event_date in event_dates:
            if partition_date_interval == "month":
                iso_date = date_to_iso(event_date.replace(day=1))
            else:
                iso_date = date_to_iso(event_date)
            if iso_date not in iso_dates:
                iso_dates.append(iso_date)
            if etl_lookback_days > 0:
                for days in range(1, etl_lookback_days + 1):
                    if partition_date_interval == "month":
                        iso_lookback = date_to_iso(
                            date_add_days(event_date, days).replace(day=1)
                        )
                    else:
                        iso_lookback = date_to_iso(date_add_days(event_date, days))
                    if iso_lookback not in iso_dates:
                        iso_dates.append(iso_lookback)
        iso_dates.sort()
        in_list: list[str] = []
        for iso_date in iso_dates:
            in_list.append(f"{partition_date_prefix}{date_quote}{iso_date}{date_quote}")
        partition_date_or.append(f"{partition_date_expr} IN ({','.join(in_list)})")

    sql_from: str = ""
    sql_where: str = ""
    where_and: list[str] = []

    if where_expr:
        where_and.append(where_expr)

    if table_function_name:
        table_function_path = f"{source['table_function_database']}.{source['table_function_schema']}.{table_function_name}"
        if len(partition_date_or) > 0:
            where_and.append(f"({' OR '.join(partition_date_or)})")
        if len(event_datetime_or) > 0:
            where_and.append(f"({' OR '.join(event_datetime_or)})")
        sql_from = f"""FROM
    TABLE({table_function_path}({source['table_function_arg']} => '
        SELECT *
        FROM `{schema}.{table}`
        WHERE
            {' AND '.join(where_and)}
    '))"""
    else:
        if len(partition_date_or) > 0:
            where_and.append(f"({' OR '.join(partition_date_or)})")
        if len(event_datetime_or) > 0:
            where_and.append(f"({' OR '.join(event_datetime_or)})")
        sql_from = f"""FROM
    {database}.{schema}.{table}"""
        if len(where_and) > 0:
            sql_where = f"""WHERE
    {' AND '.join(where_and)}"""

    sql_dbt_source_dates_new = f"""
WITH source_dates as (
SELECT
    date_format(cast({event_datetime_expr} as timestamp), '%Y-%m-%d') as event_date,
    count({event_datetime_expr}) as event_count,
    date_format(cast({partition_date_expr} as timestamp), '%Y-%m-%d') as partition_date
{sql_from}
{sql_where}
GROUP BY
    date_format(cast({event_datetime_expr} as timestamp), '%Y-%m-%d'),
    date_format(cast({partition_date_expr} as timestamp), '%Y-%m-%d')
)
SELECT
    event_date,
    sum(event_count) as event_count,
    array_agg(distinct(partition_date)) as partition_dates
FROM
    source_dates
GROUP BY
    event_date
ORDER BY
    event_date DESC
"""

    return sql_dbt_source_dates_new


def sql_dbt_source_dates_old(
    source: Source,
    event_dates: list[date],
    database_name: str,
    etl_schema: str,
) -> str:
    event_dates_iso: list[str] = [date_to_iso(event_date) for event_date in event_dates]
    event_dates_prefixed = "date '" + "',date '".join(event_dates_iso) + "'"
    sql = f"""
SELECT
    event_date,
    event_count,
    partition_dates,
    etl_timestamp
FROM
    {database_name}.{etl_schema}.dbt_source_dates
WHERE
    source_id = '{source['id']}'
    AND event_date IN ({event_dates_prefixed})
ORDER BY
    event_date DESC
"""

    return sql


def sql_dbt_test_dates_merge(
    database_name: str,
    etl_timestamp: str,
    event_dates: list[str],
    test_id_dates_list: list[TestIdDates],
    etl_schema: str,
) -> str | None:
    test_merges = build_test_merges(
        test_id_dates_list=test_id_dates_list,
        etl_timestamp=etl_timestamp,
    )
    test_merge_args: list[str] = []
    for test_merge in test_merges:
        test_merge_args.append(
            f"""(
                '{test_merge['id']}',
                '{test_merge['model_id']}',
                cast('{test_merge['event_date']}' as date),
                cast('{test_merge['etl_timestamp']}' as timestamp(6)),
                cast(array{event_dates} as array(date)),
                '{test_merge['test_message']}',
                {test_merge['test_rows']},
                {test_merge['test_seconds']},
                '{test_merge['test_status']}'
            )"""
        )

    if len(test_merge_args) > 0:
        return f"""
            MERGE INTO {database_name}.{etl_schema}.dbt_test_dates old USING (VALUES {','.join(test_merge_args)}) new (test_id, model_id, event_date, etl_timestamp, test_dates, test_message, test_rows, test_seconds, test_status)
            ON (old.test_id = new.test_id AND old.model_id = new.model_id AND old.event_date = new.event_date)
            WHEN MATCHED
                THEN UPDATE SET model_id = new.model_id, etl_timestamp = new.etl_timestamp, test_dates = new.test_dates, test_message = new.test_message, test_rows = new.test_rows, test_seconds = new.test_seconds, test_status = new.test_status
            WHEN NOT MATCHED
                THEN INSERT (test_id, model_id, event_date, etl_timestamp, test_dates, test_message, test_rows, test_seconds, test_status) VALUES (new.test_id, new.model_id, new.event_date, new.etl_timestamp, new.test_dates, new.test_message, new.test_rows, new.test_seconds, new.test_status)
            """

    return None


def sql_source_from(
    dialect: str | None,
    event_dates: list[date] | None,
    event_datetime: SourceEventDatetime | None,
    partition_date: SourcePartitionDate,
    partition_dates: list[date],
    source_from: str,
    table_function: SourceTableFunction | None,
    where_expr: str | None,
) -> str:
    quote_table = ""
    if dialect == "bigquery":
        quote_table = "`"

    if table_function:
        table_function_path = f"{table_function['database']}.{table_function['schema']}.{table_function['name']}"
        sql_where = sql_source_where(
            dialect=table_function["dialect"],
            event_dates=event_dates,
            event_datetime=event_datetime,
            partition_date=partition_date,
            partition_dates=partition_dates,
            where_expr=where_expr,
        )
        return f"""
FROM
    TABLE({table_function_path}({table_function['arg']} => '
    SELECT *
    FROM {quote_table}{table_function['from']}{quote_table}
    {sql_where}
'))
"""
    else:
        sql_where = sql_source_where(
            dialect="trino",
            event_dates=event_dates,
            event_datetime=event_datetime,
            partition_date=partition_date,
            partition_dates=partition_dates,
            where_expr=where_expr,
        )
        return f"""
FROM
    {source_from}
"""


def sql_source_where(
    dialect: str | None,
    event_dates: list[date] | None,
    event_datetime: SourceEventDatetime | None,
    partition_date: SourcePartitionDate,
    partition_dates: list[date],
    where_expr: str | None,
) -> str:
    sql_where = ""
    and_list: list[str] = []

    if where_expr:
        and_list.append(where_expr)

    sql_partition_dates = sql_where_dates(
        expr=partition_date["expr"],
        dates=event_dates if partition_date["use_event_dates"] else partition_dates,
        dialect=dialect,
        prefix=partition_date["prefix"],
        use_range=partition_date["use_range"],
    )
    if sql_partition_dates:
        and_list.append(sql_partition_dates)

    sql_event_dates = sql_where_dates(
        expr=event_datetime["expr"],
        dates=event_dates,
        dialect=dialect,
        prefix="",
        use_range=event_datetime["use_range"],
    )
    if sql_event_dates:
        and_list.append(sql_event_dates)

    if len(and_list) > 0:
        sql_where = f"WHERE ({') AND ('.join(and_list)})"

    return sql_where


def sql_where_dates(
    expr: str,
    dates: date,
    dialect: str = "trino",
    prefix: str = "",
    use_range: bool = False,
) -> str:
    or_list = []

    quote_date = "'"
    if dialect == "bigquery":
        quote_date = '"'

    if use_range:
        for d in dates:
            or_list.append(
                f"({expr} >= {prefix}{quote_date}{date_to_iso(d)}{quote_date} AND {expr} < {prefix}{quote_date}{date_to_iso(date_add_days(d, 1))}{quote_date})"
            )
    else:
        in_list = []
        for d in dates:
            in_list.append(f"{prefix}{quote_date}{date_to_iso(d)}{quote_date}")
        or_list.append(f"{expr} IN ({','.join(in_list)})")

    return f"({' OR '.join(or_list)})"


# Unit tests for the utils
class SourceEtlUtilsTest(unittest.TestCase):
    etl_timestamp = "2024-01-10T00:00:00.000000+00:00"

    model_id_dates_list = [
        {
            "id": "model.project.model1",
            "dates": [
                {"event_date": "2024-01-05"},
                {"event_date": "2024-01-04"},
                {"event_date": "2024-01-03"},
                {"event_date": "2024-01-02"},
                {"event_date": "2024-01-01"},
            ],
        },
        {
            "id": "model.project.model2",
            "dates": [
                {"event_date": "2024-01-05"},
                {"event_date": "2024-01-02"},
            ],
        },
        {
            "id": "model.project.model3",
            "dates": [],
        },
    ]

    model_runs = [
        {
            "event_dates": [
                "2024-01-05",
                "2024-01-02",
            ],
            "ids": [
                "model.project.model1",
                "model.project.model2",
            ],
            "merges": [
                {
                    "id": "model.project.model1",
                    "etl_timestamp": etl_timestamp,
                    "event_date": "2024-01-05",
                },
                {
                    "id": "model.project.model1",
                    "etl_timestamp": etl_timestamp,
                    "event_date": "2024-01-02",
                },
                {
                    "id": "model.project.model2",
                    "etl_timestamp": etl_timestamp,
                    "event_date": "2024-01-05",
                },
                {
                    "id": "model.project.model2",
                    "etl_timestamp": etl_timestamp,
                    "event_date": "2024-01-02",
                },
            ],
        },
        {
            "event_dates": [
                "2024-01-04",
                "2024-01-03",
                "2024-01-01",
            ],
            "ids": ["model.project.model1"],
            "merges": [
                {
                    "id": "model.project.model1",
                    "etl_timestamp": etl_timestamp,
                    "event_date": "2024-01-04",
                },
                {
                    "id": "model.project.model1",
                    "etl_timestamp": etl_timestamp,
                    "event_date": "2024-01-03",
                },
                {
                    "id": "model.project.model1",
                    "etl_timestamp": etl_timestamp,
                    "event_date": "2024-01-01",
                },
            ],
        },
    ]

    model_runs_with_date_limit_2 = [
        {
            "event_dates": [
                "2024-01-05",
                "2024-01-02",
            ],
            "ids": [
                "model.project.model1",
                "model.project.model2",
            ],
            "merges": [
                {
                    "id": "model.project.model1",
                    "etl_timestamp": etl_timestamp,
                    "event_date": "2024-01-05",
                },
                {
                    "id": "model.project.model1",
                    "etl_timestamp": etl_timestamp,
                    "event_date": "2024-01-02",
                },
                {
                    "id": "model.project.model2",
                    "etl_timestamp": etl_timestamp,
                    "event_date": "2024-01-05",
                },
                {
                    "id": "model.project.model2",
                    "etl_timestamp": etl_timestamp,
                    "event_date": "2024-01-02",
                },
            ],
        },
        {
            "event_dates": [
                "2024-01-04",
                "2024-01-03",
            ],
            "ids": ["model.project.model1"],
            "merges": [
                {
                    "id": "model.project.model1",
                    "etl_timestamp": etl_timestamp,
                    "event_date": "2024-01-04",
                },
                {
                    "id": "model.project.model1",
                    "etl_timestamp": etl_timestamp,
                    "event_date": "2024-01-03",
                },
            ],
        },
        {
            "event_dates": ["2024-01-01"],
            "ids": ["model.project.model1"],
            "merges": [
                {
                    "id": "model.project.model1",
                    "etl_timestamp": etl_timestamp,
                    "event_date": "2024-01-01",
                },
            ],
        },
    ]

    source_id_dates_list = [
        {
            "id": "source.project.schema.table1",
            "dates": [
                {
                    "event_date": "2024-01-04",
                    "event_count": 104,
                    "partition_dates": ["2024-01-04"],
                },
                {
                    "event_date": "2024-01-05",
                    "event_count": 105,
                    "partition_dates": ["2024-01-05"],
                },
                {
                    "event_date": "2024-01-03",
                    "event_count": 103,
                    "partition_dates": ["2024-01-03"],
                },
                {
                    "event_date": "2024-01-02",
                    "event_count": 102,
                    "partition_dates": [
                        "2024-01-02",
                        "2024-01-01",
                    ],
                },
                {
                    "event_date": "2024-01-01",
                    "event_count": 101,
                    "partition_dates": ["2024-01-01"],
                },
            ],
        },
        {
            "id": "source.project.schema.table2",
            "dates": [
                {
                    "event_date": "2024-01-05",
                    "event_count": 205,
                    "partition_dates": ["2024-01-05"],
                },
                {
                    "event_date": "2024-01-02",
                    "event_count": 202,
                    "partition_dates": [
                        "2024-01-02",
                        "2024-01-01",
                    ],
                },
            ],
        },
        {
            "id": "source.project.schema.table3",
            "dates": [],
        },
    ]

    source_runs = [
        {
            "event_dates": [
                "2024-01-05",
                "2024-01-02",
            ],
            "ids": [
                "source.project.schema.table1",
                "source.project.schema.table2",
            ],
            "merges": [
                {
                    "id": "source.project.schema.table1",
                    "etl_timestamp": etl_timestamp,
                    "event_date": "2024-01-05",
                    "event_count": 105,
                    "partition_dates": ["2024-01-05"],
                },
                {
                    "id": "source.project.schema.table1",
                    "etl_timestamp": etl_timestamp,
                    "event_date": "2024-01-02",
                    "event_count": 102,
                    "partition_dates": [
                        "2024-01-02",
                        "2024-01-01",
                    ],
                },
                {
                    "id": "source.project.schema.table2",
                    "etl_timestamp": etl_timestamp,
                    "event_date": "2024-01-05",
                    "event_count": 205,
                    "partition_dates": ["2024-01-05"],
                },
                {
                    "id": "source.project.schema.table2",
                    "etl_timestamp": etl_timestamp,
                    "event_date": "2024-01-02",
                    "event_count": 202,
                    "partition_dates": [
                        "2024-01-02",
                        "2024-01-01",
                    ],
                },
            ],
        },
        {
            "event_dates": [
                "2024-01-04",
                "2024-01-03",
                "2024-01-01",
            ],
            "ids": ["source.project.schema.table1"],
            "merges": [
                {
                    "id": "source.project.schema.table1",
                    "etl_timestamp": etl_timestamp,
                    "event_date": "2024-01-04",
                    "event_count": 104,
                    "partition_dates": ["2024-01-04"],
                },
                {
                    "id": "source.project.schema.table1",
                    "etl_timestamp": etl_timestamp,
                    "event_date": "2024-01-03",
                    "event_count": 103,
                    "partition_dates": ["2024-01-03"],
                },
                {
                    "id": "source.project.schema.table1",
                    "etl_timestamp": etl_timestamp,
                    "event_date": "2024-01-01",
                    "event_count": 101,
                    "partition_dates": ["2024-01-01"],
                },
            ],
        },
    ]

    source_runs_with_date_limit_2 = [
        {
            "event_dates": [
                "2024-01-05",
                "2024-01-02",
            ],
            "ids": [
                "source.project.schema.table1",
                "source.project.schema.table2",
            ],
            "merges": [
                {
                    "id": "source.project.schema.table1",
                    "etl_timestamp": etl_timestamp,
                    "event_count": 105,
                    "event_date": "2024-01-05",
                    "partition_dates": ["2024-01-05"],
                },
                {
                    "id": "source.project.schema.table1",
                    "etl_timestamp": etl_timestamp,
                    "event_count": 102,
                    "event_date": "2024-01-02",
                    "partition_dates": [
                        "2024-01-02",
                        "2024-01-01",
                    ],
                },
                {
                    "id": "source.project.schema.table2",
                    "etl_timestamp": etl_timestamp,
                    "event_count": 205,
                    "event_date": "2024-01-05",
                    "partition_dates": ["2024-01-05"],
                },
                {
                    "id": "source.project.schema.table2",
                    "etl_timestamp": etl_timestamp,
                    "event_count": 202,
                    "event_date": "2024-01-02",
                    "partition_dates": [
                        "2024-01-02",
                        "2024-01-01",
                    ],
                },
            ],
        },
        {
            "event_dates": [
                "2024-01-04",
                "2024-01-03",
            ],
            "ids": ["source.project.schema.table1"],
            "merges": [
                {
                    "id": "source.project.schema.table1",
                    "etl_timestamp": etl_timestamp,
                    "event_count": 104,
                    "event_date": "2024-01-04",
                    "partition_dates": ["2024-01-04"],
                },
                {
                    "id": "source.project.schema.table1",
                    "etl_timestamp": etl_timestamp,
                    "event_count": 103,
                    "event_date": "2024-01-03",
                    "partition_dates": ["2024-01-03"],
                },
            ],
        },
        {
            "event_dates": ["2024-01-01"],
            "ids": ["source.project.schema.table1"],
            "merges": [
                {
                    "id": "source.project.schema.table1",
                    "etl_timestamp": etl_timestamp,
                    "event_count": 101,
                    "event_date": "2024-01-01",
                    "partition_dates": ["2024-01-01"],
                },
            ],
        },
    ]

    test_id_dates_list = [
        {
            "id": "test.project.test_id_1",
            "dates": [
                {
                    "event_date": "2024-01-01",
                    "test_dates": ["2024-01-01", "2024-01-02"],
                    "test_message": "",
                    "test_seconds": 1,
                    "test_status": "pass",
                },
                {
                    "event_date": "2024-01-02",
                    "test_dates": ["2024-01-01", "2024-01-02"],
                    "test_message": "",
                    "test_seconds": 1,
                    "test_status": "pass",
                },
            ],
        },
        {
            "id": "test.project.test_id_2",
            "dates": [
                {
                    "event_date": "2024-01-01",
                    "test_dates": ["2024-01-01", "2024-01-02"],
                    "test_message": "Test failed",
                    "test_seconds": 1,
                    "test_status": "fail",
                },
                {
                    "event_date": "2024-01-02",
                    "test_dates": ["2024-01-01", "2024-01-02"],
                    "test_message": "Test failed",
                    "test_seconds": 1,
                    "test_status": "fail",
                },
            ],
        },
    ]

    # Tests with models
    def test_build_model_runs(
        self,
    ):
        self.maxDiff = 5000
        self.assertEqual(
            build_runs(
                self.model_id_dates_list,
                self.etl_timestamp,
            ),
            self.model_runs,
        )
        self.assertEqual(
            build_runs(
                self.model_id_dates_list,
                self.etl_timestamp,
                date_limit=2,
            ),
            self.model_runs_with_date_limit_2,
        )

    # Tests with sources
    def test_build_source_runs(
        self,
    ):
        self.maxDiff = 5000
        self.assertEqual(
            build_runs(
                self.source_id_dates_list,
                self.etl_timestamp,
            ),
            self.source_runs,
        )
        self.assertEqual(
            build_runs(
                self.source_id_dates_list,
                self.etl_timestamp,
                date_limit=2,
            ),
            self.source_runs_with_date_limit_2,
        )

    def test_sql_dbt_source_dates_existing(
        self,
    ):
        self.maxDiff = 5000
        source = {
            "id": "source.project.schema.table",
        }
        database_name = "project"
        event_dates = [
            date(2024, 1, 1),
            date(2024, 1, 2),
            date(2024, 1, 3),
            date(2024, 1, 4),
            date(2024, 1, 5),
        ]
        self.assertEqual(
            sql_dbt_source_dates_old(
                source=source,
                event_dates=event_dates,
                database_name=database_name,
                etl_schema="source_etl",
            ),
            """
SELECT
    event_date,
    event_count,
    partition_dates,
    etl_timestamp
FROM
    project.source_etl.dbt_source_dates
WHERE
    source_id = 'source.project.schema.table'
    AND event_date IN (date '2024-01-01',date '2024-01-02',date '2024-01-03',date '2024-01-04',date '2024-01-05')
ORDER BY
    event_date DESC
""",
        )

    def test_sql_dbt_source_dates_new(
        self,
    ):
        self.maxDiff = 5000
        source = {
            "database": "source",
            "etl_lookback_days": 5,
            "event_datetime_expr": "event_datetime",
            "event_datetime_use_range": False,
            "partition_date_expr": "partition_date",
            "partition_date_interval": "day",
            "partition_date_prefix": "date ",
            "partition_date_use_range": False,
            "schema": "schema",
            "table": "table",
            "table_function_arg": None,
            "table_function_database": None,
            "table_function_dialect": None,
            "table_function_name": None,
            "table_function_schema": None,
            "where_expr": None,
        }
        event_dates = [
            date(2024, 1, 1),
            date(2024, 1, 2),
        ]
        self.assertEqual(
            sql_dbt_source_dates_new(
                source,
                event_dates,
            ),
            """
WITH source_dates as (
SELECT
    date_format(cast(event_datetime as timestamp), '%Y-%m-%d') as event_date,
    count(event_datetime) as event_count,
    date_format(cast(partition_date as timestamp), '%Y-%m-%d') as partition_date
FROM
    source.schema.table
WHERE
    (partition_date IN (date '2024-01-01',date '2024-01-02',date '2024-01-03',date '2024-01-04',date '2024-01-05',date '2024-01-06',date '2024-01-07')) AND (date_trunc('day', cast(event_datetime as date)) IN (date '2024-01-01',date '2024-01-02'))
GROUP BY
    date_format(cast(event_datetime as timestamp), '%Y-%m-%d'),
    date_format(cast(partition_date as timestamp), '%Y-%m-%d')
)
SELECT
    event_date,
    sum(event_count) as event_count,
    array_agg(distinct(partition_date)) as partition_dates
FROM
    source_dates
GROUP BY
    event_date
ORDER BY
    event_date DESC
""",
        ),

    def test_sql_dbt_source_dates_new_with_bigquery_table_function(
        self,
    ):
        self.maxDiff = 5000
        source = {
            "database": "source",
            "etl_lookback_days": 5,
            "event_datetime_expr": "event_datetime",
            "event_datetime_use_range": True,
            "partition_date_expr": "partition_date",
            "partition_date_interval": "day",
            "partition_date_prefix": "",
            "partition_date_use_range": True,
            "schema": "schema",
            "table": "table",
            "table_function_arg": "table_function_arg",
            "table_function_database": "table_function_database",
            "table_function_dialect": "bigquery",
            "table_function_name": "table_function_name",
            "table_function_schema": "table_function_schema",
            "where_expr": None,
        }
        event_dates = [
            date(2024, 1, 1),
            date(2024, 1, 2),
        ]
        self.assertEqual(
            sql_dbt_source_dates_new(
                source,
                event_dates,
            ),
            """
WITH source_dates as (
SELECT
    date_format(cast(event_datetime as timestamp), '%Y-%m-%d') as event_date,
    count(event_datetime) as event_count,
    date_format(cast(partition_date as timestamp), '%Y-%m-%d') as partition_date
FROM
    TABLE(table_function_database.table_function_schema.table_function_name(table_function_arg => '
        SELECT *
        FROM `schema.table`
        WHERE
            ((partition_date >= "2024-01-01" AND partition_date < "2024-01-07") OR (partition_date >= "2024-01-02" AND partition_date < "2024-01-08")) AND ((event_datetime >= "2024-01-01" AND event_datetime < "2024-01-02") OR (event_datetime >= "2024-01-02" AND event_datetime < "2024-01-03"))
    '))

GROUP BY
    date_format(cast(event_datetime as timestamp), '%Y-%m-%d'),
    date_format(cast(partition_date as timestamp), '%Y-%m-%d')
)
SELECT
    event_date,
    sum(event_count) as event_count,
    array_agg(distinct(partition_date)) as partition_dates
FROM
    source_dates
GROUP BY
    event_date
ORDER BY
    event_date DESC
""",
        )


if __name__ == "__main__":
    unittest.main()
