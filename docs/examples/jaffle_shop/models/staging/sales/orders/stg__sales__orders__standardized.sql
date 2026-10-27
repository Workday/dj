{{
  config(
    materialized="ephemeral"
  )
}}

WITH
	stg__sales__orders__standardized AS (
		SELECT
			customer AS customer_id,
			cast(ordered_at AS timestamp(6)) AS datetime,
			DATE(CAST(ordered_at AS TIMESTAMP)) AS order_date,
			id AS order_id,
			order_total AS order_total_cents,
			CAST(ordered_at AS TIMESTAMP) AS ordered_at,
			1 AS portal_source_count,
			store_id AS store_id,
			subtotal AS subtotal_cents,
			tax_paid AS tax_paid_cents,
			-- partition columns
			date_trunc('month', cast(ordered_at AS date)) AS portal_partition_monthly,
			date_trunc('day', cast(ordered_at AS date)) AS portal_partition_daily,
			date_trunc('hour', cast(ordered_at AS timestamp(6))) AS portal_partition_hourly
		FROM
			{{ source('development__jaffle_shop_dev_seeds','raw_orders') }}
		WHERE
			{{ _ext_partition_date_filter("ordered_at", compile_dates=true, data_type="timestamp", source_id="source.jaffle_shop.development__jaffle_shop_dev_seeds.raw_orders", use_event_dates=true, use_range=true) }}
			AND {{ _ext_event_datetime_filter("ordered_at") }}
	)
SELECT
	*
FROM
	stg__sales__orders__standardized