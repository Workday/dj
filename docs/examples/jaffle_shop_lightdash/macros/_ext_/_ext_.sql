{# Model macros #}

{%- macro _ext_event_date_filter(expr, data_type='varchar', dialect='trino', include='', interval='day', use_range=false) -%}
    {%- set ranges = _ext_event_date_ranges(include=include, interval=interval) -%}
    {%- if use_range -%}
        {{ _ext_date_range_filter(expr, data_type=data_type, dialect=dialect, ranges=ranges, use_range=use_range) }}
    {%- else -%}
        {%- set in_list = [] -%}
        {%- set prefix = _ext_data_type_prefix(data_type) -%}
        {%- set quote = _ext_date_dialect_quote(dialect) -%}
        {%- for range in ranges -%}
            {%- do in_list.append(prefix ~ quote ~ range['start'] ~ quote) -%}
        {%- endfor -%}
        {{ _ext_date_in_filter(expr, values=in_list|join(',')) }}
    {%- endif -%}
{%- endmacro -%}

{%- macro _ext_event_datetime_filter(expr, data_type='varchar', dialect='trino', include='', interval='day', use_range=false) -%}
    {%- set ranges = _ext_event_date_ranges(include=include, interval=interval) -%}
    {%- if use_range -%}
        {{ _ext_date_range_filter(expr, data_type=data_type, dialect=dialect, ranges=ranges, use_range=use_range) }}
    {%- else -%}
        {%- set in_list = [] -%}
        {%- set prefix = '' -%}
        {%- if dialect == 'trino' -%}
            {%- set prefix = 'date ' -%}
        {%- endif -%}
        {%- set interval_expr -%}
            {%- if dialect == 'trino' -%}
                date_trunc('{{ interval }}', cast({{ expr }} as date))
            {%- else -%}
                {{ expr }}
            {%- endif -%}
        {%- endset -%}
        {%- set quote = _ext_date_dialect_quote(dialect) -%}
        {%- for range in ranges -%}
            {%- do in_list.append(prefix ~ quote ~ range['start'] ~ quote) -%}
        {%- endfor -%}
        {{ _ext_date_in_filter(interval_expr, values=in_list|join(',')) }}
    {%- endif -%}
{%- endmacro -%}

{%- macro _ext_partition_date_filter(expr, compile_dates=false, data_type='varchar', dialect='trino', include='', interval='day', source_id='', use_range=false, use_event_dates=false) -%}
    {%- if use_event_dates -%}
        {%- set ranges = _ext_event_date_ranges(include=include, interval=interval) -%}
        {%- if use_range -%}
            {{ _ext_date_range_filter(expr, data_type=data_type, dialect=dialect, ranges=ranges, use_range=use_range) }}
        {%- else -%}
            {%- set in_list = [] -%}
            {%- set prefix = _ext_data_type_prefix(data_type) -%}
            {%- set quote = _ext_date_dialect_quote(dialect) -%}
            {%- for range in ranges -%}
                {%- do in_list.append(prefix ~ quote ~ range['start'] ~ quote) -%}
            {%- endfor -%}
            {{ _ext_date_in_filter(expr, values=in_list|join(',')) }}
        {%- endif -%}
    {%- elif compile_dates -%}
        {%- set query = _ext_partition_date_query(data_type='varchar', include=include, source_id=source_id) -%}
        {%- set ranges = [] -%}
        {%- if source_id|length > 0 -%}
            {%- set results = run_query(query) -%}
            {%- if execute -%}
                {%- set partition_dates = results.columns[0].values() -%}
                {%- for partition_date in partition_dates -%}
                    {%- set start = modules.datetime.datetime.fromisoformat(partition_date) -%}
                    {%- set end = start + modules.datetime.timedelta(days=1) -%}
                    {%- do ranges.append({
                        "start": modules.datetime.datetime.strftime(start, '%Y-%m-%d'),
                        "end": modules.datetime.datetime.strftime(end, '%Y-%m-%d'),
                    }) -%}
                {%- endfor -%}
            {%- endif -%}
        {%- endif -%}
        {%- if use_range -%}
            {{ _ext_date_range_filter(expr, data_type=data_type, dialect=dialect, ranges=ranges, use_range=use_range) }}
        {%- else -%}
            {%- set in_list = [] -%}
            {%- set prefix = _ext_data_type_prefix(data_type) -%}
            {%- set quote = _ext_date_dialect_quote(dialect) -%}
            {%- for range in ranges -%}
                {%- do in_list.append(prefix ~ quote ~ range['start'] ~ quote) -%}
            {%- endfor -%}
            {{ _ext_date_in_filter(expr, values=in_list|join(',')) }}
        {%- endif -%}
    {%- else -%}
        {%- set query = _ext_partition_date_query(data_type=data_type, include=include, source_id=source_id) -%}
        {{ _ext_date_in_filter(expr, values=query) }}
    {%- endif -%}
{%- endmacro -%}


{# Utility macros #}

{%- macro _ext_data_type_prefix(data_type='varchar') -%}
    {%- set prefix = '' -%}
    {%- if data_type == 'date' -%}
        {%- set prefix = 'DATE ' -%}
    {%- elif data_type == 'timestamp' -%}
        {%- set prefix = 'TIMESTAMP ' -%}
    {%- endif -%}
    {{ return(prefix) }}
{%- endmacro -%}

{%- macro _ext_date_in_filter(expr, values) -%}
    {{ expr }} IN ({{ values }})
{%- endmacro -%}

{%- macro _ext_date_range_filter(expr, data_type='varchar', dialect='trino', ranges=[], use_range=false) -%}
    {%- set filter_list = [] -%}
    {%- set prefix = _ext_data_type_prefix(data_type) -%}
    {%- set quote = _ext_date_dialect_quote(dialect) -%}
    {%- if use_range -%}
        {%- for range in ranges -%}
            {%- do filter_list.append('(' ~ expr ~ ' >= ' ~ prefix ~ quote ~ range['start'] ~ quote ~ ' AND ' ~ expr ~ ' < ' ~ prefix ~ quote ~ range['end'] ~ quote ~ ')') -%}
        {%- endfor -%}
    {%- else -%}
        {%- set in_list = [] -%}
        {%- for range in ranges -%}
            {%- do in_list.append(prefix ~ quote ~ range['start'] ~ quote) -%}
        {%- endfor -%}
        {%- do filter_list.append(expr ~ ' IN (' ~ in_list|join(',') ~ ')') -%}
    {%- endif -%}
    {{ filter_list|join(' OR ') }}
{%- endmacro -%}

{%- macro _ext_date_dialect_quote(dialect='trino') -%}
    {%- set quote = "'" -%}
    {%- if dialect == 'bigquery' -%}
        {%- set quote = '"' -%}
    {%- endif -%}
    {{ return(quote) }}
{%- endmacro -%}

{%- macro _ext_event_date_ranges(include='', interval='day') %}
    {%- set event_datetimes = _ext_event_datetimes(include=include) -%}
    {%- set ranges = [] -%}
    {%- set filters = [] -%}
    {%- for event_datetime in event_datetimes -%}
        {%- if interval == 'month' -%}
            {%- set start_iso = modules.datetime.datetime.strftime(event_datetime, '%Y-%m') ~ '-01' -%}
            {%- set start_datetime = modules.datetime.datetime.fromisoformat(start_iso) -%}
            {%- set end_datetime = start_datetime + modules.datetime.timedelta(days=31) -%}
            {%- set end_iso = modules.datetime.datetime.strftime(end_datetime, '%Y-%m') ~ '-01' -%}
            {%- do ranges.append({
                "start": start_iso,
                "end": end_iso,
            }) -%}
        {%- else -%}
            {%- set start_datetime = event_datetime -%}
            {%- set start_iso = modules.datetime.datetime.strftime(start_datetime, '%Y-%m-%d') -%}
            {%- set end_datetime = start_datetime + modules.datetime.timedelta(days=1) -%}
            {%- set end_iso = modules.datetime.datetime.strftime(end_datetime, '%Y-%m-%d') -%}
            {%- do ranges.append({
                "start": start_iso,
                "end": end_iso,
            }) -%}
        {%- endif -%}
    {%- endfor -%}
    {{ return(ranges) }}
{%- endmacro -%}

{%- macro _ext_event_date_string(data_type='varchar', include='', interval='day') -%}
    {%- set event_datetimes = _ext_event_datetimes(include=include) -%}
    {%- set dates = [] -%}
    {%- set prefix = _ext_data_type_prefix(data_type) -%}
    {%- for event_datetime in event_datetimes -%}
        {%- if interval == 'month' -%}
            {%- set date = prefix ~ "'" ~ modules.datetime.datetime.strftime(event_datetime,'%Y-%m') ~ "-01'" -%}
        {%- else -%}
            {%- set date = prefix ~ "'" ~ modules.datetime.datetime.strftime(event_datetime,'%Y-%m-%d') ~ "'" -%}
        {%- endif -%}
        {%- do dates.append(date) -%}
    {%- endfor -%}
    {{ return(dates|join(',')) }}
{%- endmacro -%}

{%- macro _ext_event_dates_table(include='') -%}
    {%- set dates = [] -%}
    {%- set event_datetimes = _ext_event_datetimes(include=include) -%}
    {%- for event_datetime in event_datetimes -%}
        {%- set date = modules.datetime.datetime.strftime(event_datetime,'%Y-%m-%d') -%}
        {%- if not date in dates -%}
            {%- do dates.append("date '" ~ date ~ "'") -%}
        {%- endif -%}
    {%- endfor -%}
(VALUES ({{ dates|join('),(') }})) event_dates(_ext_event_date)
{%- endmacro -%}

{%- macro _ext_event_datetimes(include='') -%}
    {%- set datetimes = [] -%}
    {%- set datetimes_iso = [] -%}
    {%- set event_dates_var = var('event_dates') -%}
    {%- if '~' in event_dates_var -%}
        {%- set start_date, end_date = event_dates_var.split('~') -%}
        {%- set start_datetime = modules.datetime.datetime.fromisoformat(start_date) -%}
        {%- set end_datetime = modules.datetime.datetime.fromisoformat(end_date) -%}
        {%- set days = (end_datetime - start_datetime).days + 1 -%}
        {%- for i in range(days) -%}
            {%- set datetime = start_datetime + modules.datetime.timedelta(days=i) -%}
            {%- do datetimes.append(datetime) -%}
        {%- endfor -%}
    {%- elif ',' in event_dates_var -%}
        {%- set dates = event_dates_var.split(',') -%}
        {%- for date in dates -%}
            {%- do datetimes.append(modules.datetime.datetime.fromisoformat(date)) -%}
        {%- endfor -%}
    {%- else -%}
        {%- do datetimes.append(modules.datetime.datetime.fromisoformat(event_dates_var)) -%}
    {%- endif -%}
    {%- if include == "month" -%}
        {%- set event_month_starts = [] -%}
        {%- for datetime in datetimes -%}
            {%- set event_month_start = datetime.replace(day=1) -%}
            {%- if not event_month_start in event_month_starts -%}
                {%- do event_month_starts.append(event_month_start) -%}
            {%- endif -%}
        {%- endfor -%}
        {%- for event_month_start in event_month_starts -%}
            {%- set event_month_next = (event_month_start + modules.datetime.timedelta(days=31)).replace(day=1) -%}
            {%- set event_month_days = (event_month_next - event_month_start).days -%}
            {%- for i in range(event_month_days) -%}
                {%- set datetime = event_month_start + modules.datetime.timedelta(days=i) -%}
                {%- if not datetime in datetimes -%}
                    {%- do datetimes.append(datetime) -%}
                {%- endif -%}
            {%- endfor -%}
        {%- endfor -%}
    {%- endif -%}
    {{ return(datetimes) }}
{%- endmacro -%}

{%- macro _ext_partition_date_query(data_type='varchar', include='', source_id='') -%}
    WITH source_dates AS (
        SELECT CASE WHEN cardinality(array_agg(partition_dates)) > 0 THEN array_distinct(flatten(array_agg(partition_dates))) ELSE array[{{ _ext_event_date_string(data_type='date') }}] END AS partition_dates
        FROM {{ project_name }}.source_etl.dbt_source_dates
        WHERE source_id = '{{ source_id }}' AND event_date IN ({{ _ext_event_date_string(data_type='date', include=include) }})
    )
    SELECT distinct(cast(partition_date as {{ data_type }})) as partition_date
    FROM source_dates
    CROSS JOIN unnest(source_dates.partition_dates) as t(partition_date)
{%- endmacro -%}