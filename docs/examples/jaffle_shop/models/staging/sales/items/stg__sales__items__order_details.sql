-- DJ composed from fragments: jaffle_item_line_dims
{{
  config(
    materialized="ephemeral"
  )
}}

WITH
	stg__sales__items__order_details AS (
		SELECT
			sku LIKE 'BEV-%' AS is_beverage_item,
			sku LIKE 'JAF-%' AS is_jaffle_item,
			id AS item_id,
			order_id AS order_id,
			1 AS portal_source_count,
			sku AS product_sku,
			CASE
				WHEN sku LIKE 'JAF-%' THEN 'jaffle'
				WHEN sku LIKE 'BEV-%' THEN 'beverage'
				ELSE 'unknown'
			END AS product_type
		FROM
			{{ source('development__jaffle_shop_dev_seeds','raw_items') }}
	)
SELECT
	*
FROM
	stg__sales__items__order_details