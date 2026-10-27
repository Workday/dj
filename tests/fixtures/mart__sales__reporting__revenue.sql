{{
  config(
    materialized="view"
  )
}}

WITH
	mart__sales__reporting__revenue AS (
		SELECT
			customer_id,
			customer_name,
			datetime,
			day_of_week(order_date) IN (6, 7) AS is_weekend_order,
			order_date,
			order_id,
			EXTRACT(
				MONTH
				FROM
					order_date
			) AS order_month,
			EXTRACT(
				QUARTER
				FROM
					order_date
			) AS order_quarter,
			EXTRACT(
				YEAR
				FROM
					order_date
			) AS order_year,
			portal_source_count,
			CASE
				WHEN order_total_dollars >= 15.00 THEN 'High'
				WHEN order_total_dollars >= 8.00 THEN 'Medium'
				ELSE 'Low'
			END AS revenue_tier,
			store_id,
			store_name,
			CAST(subtotal_cents AS DECIMAL(10, 2)) / 100.0 AS subtotal_dollars,
			CAST(tax_paid_cents AS DECIMAL(10, 2)) / 100.0 AS tax_dollars,
			order_total_dollars AS total_dollars,
			-- partition columns
			portal_partition_monthly,
			portal_partition_daily,
			portal_partition_hourly
		FROM
			{{ ref('int__sales__orders__enriched') }}
	)
SELECT
	*
FROM
	mart__sales__reporting__revenue