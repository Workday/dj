{{
  config(
    materialized="incremental",
    incremental_strategy="delete+insert",
    unique_key="supply_id",
    pre_hook="set session iterative_optimizer_timeout='60m'; set session query_max_planning_time='60m'"
  )
}}

WITH
	int__supply_chain__supplies__cost_analysis AS (
		SELECT
			stg__supply_chain__supplies__inventory.cost_cents,
			stg__supply_chain__supplies__inventory.cost_dollars,
			{{ cost_tier() }} AS cost_tier,
			stg__supply_chain__supplies__inventory.is_perishable,
			stg__supply_chain__supplies__inventory.portal_source_count,
			stg__products__catalog__catalog.product_name,
			stg__products__catalog__catalog.product_price_dollars,
			stg__supply_chain__supplies__inventory.product_sku,
			stg__products__catalog__catalog.product_type,
			stg__supply_chain__supplies__inventory.supply_category,
			stg__supply_chain__supplies__inventory.supply_id,
			stg__supply_chain__supplies__inventory.supply_name,
			{{ supply_to_price_ratio() }} AS supply_to_price_ratio
		FROM
			{{ ref('stg__supply_chain__supplies__inventory') }} stg__supply_chain__supplies__inventory
			LEFT JOIN {{ ref('stg__products__catalog__catalog') }} stg__products__catalog__catalog ON stg__supply_chain__supplies__inventory.product_sku = stg__products__catalog__catalog.product_sku
	)
SELECT
	*
FROM
	int__supply_chain__supplies__cost_analysis