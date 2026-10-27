{{
  config(
    materialized="ephemeral"
  )
}}

WITH
	int__sales__analytics__monthly_revenue AS (
		SELECT
			customer_first_name,
			customer_id,
			customer_name,
			date_trunc('month', datetime) AS datetime,
			order_date,
			order_id,
			ordered_at,
			sum(portal_source_count) AS portal_source_count,
			store_id,
			store_name,
			-- partition columns
			portal_partition_monthly
		FROM
			{{ ref('int__sales__orders__enriched') }}
		WHERE
			{{ _ext_event_date_filter("portal_partition_monthly", data_type="date", interval="month") }}
		GROUP BY
			customer_first_name,
			customer_id,
			customer_name,
			date_trunc('month', datetime),
			order_date,
			order_id,
			ordered_at,
			store_id,
			store_name,
			portal_partition_monthly
	)
SELECT
	*
FROM
	int__sales__analytics__monthly_revenue