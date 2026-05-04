{% macro get_incremental_dj_iceberg_partition_overwrite_sql(arg_dict) %}
    {{ return(adapter.dispatch('get_incremental_dj_iceberg_partition_overwrite_sql', 'dbt')(arg_dict)) }}
{% endmacro %}

{% macro default__get_incremental_dj_iceberg_partition_overwrite_sql(arg_dict) %}
    {%- set target_relation = arg_dict["target_relation"] -%}
    {%- set temp_relation = arg_dict["temp_relation"] -%}
    {%- set config_properties = config.get("properties", {}) -%}
    {%- set dest_columns = arg_dict["dest_columns"] -%}
    {%- set dest_cols_csv = get_quoted_csv(dest_columns | map(attribute="name")) -%}

    {%- if "partitioning" in config_properties -%}
        {%- set raw_partitioning = config_properties["partitioning"] | string -%}
        {%- set partitioned_by = (raw_partitioning | replace("ARRAY['", "") | replace("']", "") | replace("'", "")).split(", ") -%}
    {%- else -%}
        {%- set partitioned_by = [] -%}
    {%- endif -%}

    {%- set partitioned_by = partitioned_by | reject('==', '') | list -%}
    {%- set mat_relation = temp_relation.incorporate(path={"identifier": temp_relation.identifier ~ "_mat"}) -%}

    {% if execute %}
        {# 1. Create the materialized table once #}
        {%- do run_query("create or replace table " ~ mat_relation ~ " as (select " ~ dest_cols_csv ~ " from " ~ temp_relation ~ ")") -%}
    {% endif %}

    {% if is_incremental() and partitioned_by | length > 0 %}
        {%- set target_columns = adapter.get_columns_in_relation(target_relation) -%}
        {%- set col_types = {} -%}
        {%- for col in target_columns -%}
            {%- do col_types.update({col.name | lower: col.data_type}) -%}
        {%- endfor -%}

        {%- set get_partitions_sql -%}
            select distinct {{ partitioned_by | join(", ") }} from {{ mat_relation }}
        {%- endset -%}
        {%- set partition_results = run_query(get_partitions_sql) -%}

        {% if execute and partition_results.rows | length > 0 %}
            {# 3. Run individual DELETEs. 
               Trino treats these as simple metadata drops. No OR-complexity issues. #}
            {%- for row in partition_results.rows -%}
                {%- set row_conditions = [] -%}
                {%- for val in row.values() -%}
                    {%- set col_name = partitioned_by[loop.index0] | replace('"', '') | replace('`', '') | lower -%}
                    {%- set col_type = col_types.get(col_name, 'varchar') | lower -%}
                    
                    {%- if val is none -%}
                        {%- do row_conditions.append(partitioned_by[loop.index0] ~ " IS NULL") -%}
                    {%- elif 'date' in col_type -%}
                        {%- do row_conditions.append(partitioned_by[loop.index0] ~ " = DATE '" ~ val ~ "'") -%}
                    {%- elif 'timestamp' in col_type -%}
                        {%- do row_conditions.append(partitioned_by[loop.index0] ~ " = CAST('" ~ val ~ "' AS " ~ col_type ~ ")") -%}
                    {%- else -%}
                        {%- do row_conditions.append(partitioned_by[loop.index0] ~ " = '" ~ (val | string | replace("'", "''")) ~ "'") -%}
                    {%- endif -%}
                {%- endfor -%}
                
                delete from {{ target_relation }} where {{ row_conditions | join(" AND ") }};
            {%- endfor -%}
        {% endif %}
    {% elif is_incremental() %}
        delete from {{ target_relation }};
    {% endif %}

    {# 4. Finally, insert the new data #}
    insert into {{ target_relation }} ({{ dest_cols_csv }})
    select {{ dest_cols_csv }} from {{ mat_relation }};

    drop table if exists {{ mat_relation }};
{% endmacro %}