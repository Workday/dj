{{
  config(
    materialized="view"
  )
}}

WITH
	mart__sales__reporting__profitability AS (
		SELECT
			AVG(order_total_dollars) AS avg_order_value_dollars,
			COUNT(*) AS order_count,
			order_date,
			DATE_TRUNC('month', order_date) AS order_year_month,
			sum(portal_source_count) AS portal_source_count,
			SUM(order_total_dollars) AS revenue_per_day,
			store_id,
			store_name,
			SUM(order_total_dollars) AS total_revenue_dollars,
			SUM(CAST(tax_paid_cents AS DECIMAL(10, 2)) / 100.0) AS total_tax_collected_dollars
		FROM
			{{ ref('int__sales__orders__enriched') }}
		GROUP BY
			order_date,
			DATE_TRUNC('month', order_date),
			store_id,
			store_name
	)
SELECT
	*
FROM
	mart__sales__reporting__profitability