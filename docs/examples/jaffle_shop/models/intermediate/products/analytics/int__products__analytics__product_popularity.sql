{{
  config(
    materialized="incremental",
    incremental_strategy="delete+insert",
    unique_key=["item_id","product_sku","product_type"],
    pre_hook="set session iterative_optimizer_timeout='60m'; set session query_max_planning_time='60m'"
  )
}}

WITH
	int__products__analytics__product_popularity AS (
		SELECT
			item_id,
			sum(portal_source_count) AS portal_source_count,
			product_sku,
			product_type,
			COUNT(*) AS total_items_sold,
			COUNT(DISTINCT order_id) AS total_orders
		FROM
			{{ ref('stg__sales__items__order_details') }}
		GROUP BY
			item_id,
			product_sku,
			product_type
	)
SELECT
	*
FROM
	int__products__analytics__product_popularity