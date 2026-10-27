{{
  config(
    materialized="incremental",
    incremental_strategy="overwrite_existing_partitions",
    pre_hook="set session iterative_optimizer_timeout='60m'; set session query_max_planning_time='60m'",
    properties={"partitioned_by":"ARRAY['portal_partition_monthly', 'portal_partition_daily', 'portal_partition_hourly']"}
  )
}}

WITH
	int__sales__orders__enriched AS (
		SELECT
			stg__customers__profiles__clean.customer_first_name,
			stg__sales__orders__standardized.customer_id,
			stg__customers__profiles__clean.customer_name,
			stg__sales__orders__standardized.datetime,
			stg__sales__orders__standardized.order_date,
			stg__sales__orders__standardized.order_id,
			stg__sales__orders__standardized.order_total_cents,
			CAST(
				stg__sales__orders__standardized.order_total_cents AS DECIMAL(10, 2)
			) / 100.0 AS order_total_dollars,
			stg__sales__orders__standardized.ordered_at,
			stg__sales__orders__standardized.portal_source_count,
			stg__sales__orders__standardized.store_id,
			stg__sales__stores__locations.store_name,
			stg__sales__stores__locations.store_tax_rate,
			stg__sales__orders__standardized.subtotal_cents,
			stg__sales__orders__standardized.tax_paid_cents,
			-- partition columns
			stg__sales__orders__standardized.portal_partition_monthly,
			stg__sales__orders__standardized.portal_partition_daily,
			stg__sales__orders__standardized.portal_partition_hourly
		FROM
			{{ ref('stg__sales__orders__standardized') }} stg__sales__orders__standardized
			LEFT JOIN {{ ref('stg__customers__profiles__clean') }} stg__customers__profiles__clean ON stg__sales__orders__standardized.customer_id = stg__customers__profiles__clean.customer_id
			LEFT JOIN {{ ref('stg__sales__stores__locations') }} stg__sales__stores__locations ON stg__sales__orders__standardized.store_id = stg__sales__stores__locations.store_id
		WHERE
			{{ _ext_event_date_filter("stg__sales__orders__standardized.portal_partition_monthly", data_type="date", interval="month") }}
			AND {{ _ext_event_date_filter("stg__sales__orders__standardized.portal_partition_daily", data_type="date") }}
	)
SELECT
	*
FROM
	int__sales__orders__enriched