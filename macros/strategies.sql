{% macro get_incremental_dj_iceberg_partition_overwrite_sql(arg_dict) %}
    {{ return(adapter.dispatch('get_incremental_dj_iceberg_partition_overwrite_sql', 'dbt')(arg_dict)) }}
{% endmacro %}

{% macro default__get_incremental_dj_iceberg_partition_overwrite_sql(arg_dict) %}
    {%- set target_relation = arg_dict["target_relation"] -%}
    {%- set temp_relation = arg_dict["temp_relation"] -%}
    {%- set config_properties = config.get("properties", {}) -%}
    {%- set dest_columns = arg_dict["dest_columns"] -%}
    {%- set dest_cols_csv = get_quoted_csv(dest_columns | map(attribute="name")) -%}

    {#- 1. Parse the table's configuration to see how it is partitioned -#}
    {%- if "partitioning" in config_properties -%}
        {%- set raw_partitioning = config_properties["partitioning"] | string -%}
        {%- set partitioned_by = (raw_partitioning | replace("ARRAY['", "") | replace("']", "") | replace("'", "")).split(", ") -%}
    {%- else -%}
        {%- set partitioned_by = [] -%}
    {%- endif -%}
    {%- set partitioned_by = partitioned_by | reject('==', '') | list -%}

    {% if is_incremental() %}
        {#- 2. Pull the raw variable string -#}
        {%- set raw_date_var = var('execute_date', var('event_dates', modules.datetime.date.today().strftime('%Y-%m-%d'))) | string -%}

        {#- 3. Handle ~ range, comma-separated list (source_etl), or single date -#}
        {%- set is_range = false -%}
        {%- set is_date_list = false -%}
        {%- set date_list = [] -%}
        {%- set month_list = [] -%}
        {%- set start_date = none -%}
        {%- set end_date = none -%}
        {%- set start_month = none -%}
        {%- set end_month = none -%}

        {%- if '~' in raw_date_var -%}
            {%- set date_parts = raw_date_var.split('~') -%}
            {%- set start_date = date_parts[0] | trim -%}
            {%- set end_date = date_parts[1] | trim -%}
            {%- set start_month = start_date[0:7] ~ "-01" -%}
            {%- set end_month = end_date[0:7] ~ "-01" -%}
            {%- set is_range = true -%}
        {%- elif ',' in raw_date_var -%}
            {%- set is_date_list = true -%}
            {%- for date_part in raw_date_var.split(',') -%}
                {%- set date_part = date_part | trim -%}
                {%- if date_part -%}
                    {%- do date_list.append(date_part) -%}
                    {%- set month_part = date_part[0:7] ~ "-01" -%}
                    {%- if month_part not in month_list -%}
                        {%- do month_list.append(month_part) -%}
                    {%- endif -%}
                {%- endif -%}
            {%- endfor -%}
        {%- else -%}
            {%- set start_date = raw_date_var | trim -%}
            {%- set start_month = start_date[0:7] ~ "-01" -%}
        {%- endif -%}

        {#- 4. Build the delete conditions based on the precise structural rules -#}
        {%- set delete_conditions = [] -%}

        {#- Monthly rule applies if column is a partition -#}
        {%- if 'portal_partition_monthly' in partitioned_by -%}
            {%- if is_range -%}
                {%- do delete_conditions.append("portal_partition_monthly BETWEEN DATE '" ~ start_month ~ "' AND DATE '" ~ end_month ~ "'") -%}
            {%- elif is_date_list -%}
                {%- if month_list | length == 1 -%}
                    {%- do delete_conditions.append("portal_partition_monthly = DATE '" ~ month_list[0] ~ "'") -%}
                {%- else -%}
                    {%- set month_literals = [] -%}
                    {%- for month_part in month_list -%}
                        {%- do month_literals.append("DATE '" ~ month_part ~ "'") -%}
                    {%- endfor -%}
                    {%- do delete_conditions.append("portal_partition_monthly IN (" ~ month_literals | join(", ") ~ ")") -%}
                {%- endif -%}
            {%- else -%}
                {%- do delete_conditions.append("portal_partition_monthly = DATE '" ~ start_month ~ "'") -%}
            {%- endif -%}
        {%- endif -%}

        {#- Daily and Hourly tables both get the additional daily filter block -#}
        {%- if 'portal_partition_daily' in partitioned_by or 'portal_partition_hourly' in partitioned_by -%}
            {%- if is_range -%}
                {%- do delete_conditions.append("portal_partition_daily BETWEEN DATE '" ~ start_date ~ "' AND DATE '" ~ end_date ~ "'") -%}
            {%- elif is_date_list -%}
                {%- if date_list | length == 1 -%}
                    {%- do delete_conditions.append("portal_partition_daily = DATE '" ~ date_list[0] ~ "'") -%}
                {%- else -%}
                    {%- set daily_literals = [] -%}
                    {%- for date_part in date_list -%}
                        {%- do daily_literals.append("DATE '" ~ date_part ~ "'") -%}
                    {%- endfor -%}
                    {%- do delete_conditions.append("portal_partition_daily IN (" ~ daily_literals | join(", ") ~ ")") -%}
                {%- endif -%}
            {%- else -%}
                {%- do delete_conditions.append("portal_partition_daily = DATE '" ~ start_date ~ "'") -%}
            {%- endif -%}
        {%- endif -%}

        {#- Dynamic environment filtering if 'env_type' is passed and exists as a partition -#}
        {%- if 'wd_env_type' in partitioned_by and var('env_type', none) is not none -%}
            {%- do delete_conditions.append("wd_env_type = '" ~ var('env_type') ~ "'") -%}
        {%- endif -%}

        {#- Run the clear down if conditions were built -#}
        {%- if delete_conditions | length > 0 %}
            delete from {{ target_relation }}
            where {{ delete_conditions | join(" and ") }};
        {%- else -%}
            {#- 
              FALLBACK FOR UNPARTITIONED TABLES:
              If the table has no partitions, clear the entire table to prevent 
              data duplication during the subsequent INSERT phase.
            -#}
            delete from {{ target_relation }};
        {%- endif -%}

    {% endif %}

    {#- 5. Stream data directly from the view straight to the target table -#}
    insert into {{ target_relation }} ({{ dest_cols_csv }})
    (
        select {{ dest_cols_csv }}
        from {{ temp_relation }}
    );

{% endmacro %}