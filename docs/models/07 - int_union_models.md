# Intermediate Union Models

## 1. Introduction

The `int_union_models` model type is designed for combining data from multiple models with compatible structures using SQL UNION operations. It stacks data from specified models vertically, creating a unified dataset from logically related but physically separated data sources. This is essential for consolidating similar data that exists across different models or systems.

## 2. Creating with Visual Editor

You can create this model type using the visual canvas:

1. Run `DJ: Create Model` from Command Palette, or select "Create Model" under Actions in tree view
2. Step 1 - Basic Information: Select model type `int_union_models`, enter group, topic, and name
3. Step 2 - Data Modeling: Use the visual editor
4. Add Select nodes for models, add Union node, configure column mapping

See [Visual Editor Guide](../VISUAL_EDITOR.md) for complete canvas documentation and workflow examples.

---

## 3. Purpose

The primary purposes of the `int_union_models` model are:

- **Data Consolidation:** Combine data from multiple models into a single unified view
- **Schema Standardization:** Create consistent data structures across disparate sources
- **Simplified Analysis:** Provide a single source of truth for related data
- **Historical Data Integration:** Merge current and historical data from different time periods
- **Multi-source Analytics:** Enable analysis across data from different systems or regions

## 4. Model Configuration

An `int_union_models` requires the following configuration parameters:

- **`type`:** `int_union_models`
- **`group`:** A logical grouping for the model (e.g., `jaffle_shop`, `ecommerce`, `finance`)
- **`topic`:** A more specific categorization within the group (e.g., `orders`, `customers`, `products`)
- **`name`:** A unique name for the model following naming conventions
- **`materialized`:** Either `ephemeral` or `incremental`
- **`from`:** Specifies the base model and union configuration:
  - **`model`:** The primary model (string identifier)
  - **`union`:** Union configuration:
    - **`type`:** Optional, can be `"all"` (defaults to UNION ALL behavior)
    - **`models`:** Array of additional model identifiers to union with the primary model
- **`select`:** Optional array of column definitions to specify which columns to include
- **`where`:** Optional filtering conditions applied to the unioned result

## 5. Union Process

The `int_union_models` model performs the following transformation:

1. **Schema Validation:** Ensures all models have compatible column structures
2. **Data Retrieval:** Fetches data from the base model and all union models
3. **Union Operation:** Performs UNION ALL to combine all datasets vertically
4. **Column Selection:** Applies select clause if specified to limit columns
5. **Filtering:** Applies where conditions if specified
6. **Output Generation:** Produces the consolidated result set

## 6. Basic Example: Unified Customer Analytics

Let's create a comprehensive customer view by combining customer data from different intermediate models that analyze different aspects of customer behavior.

**Scenario:** Combine customer insights from different intermediate models to create a unified customer analytics dataset.

**Source Models:**

- `int__customers__profiles__summary`: Basic customer profile data
- `int__customers__behavior__engagement`: Customer engagement metrics
- `int__customers__preferences__analysis`: Customer preference insights

```json
{
  "type": "int_union_models",
  "group": "customers",
  "topic": "analytics",
  "name": "unified_customer_insights",
  "materialization": "incremental",
  "from": {
    "model": "int__customers__profiles__summary",
    "union": {
      "type": "all",
      "models": [
        "int__customers__behavior__engagement",
        "int__customers__preferences__analysis"
      ]
    }
  },
  "select": [
    {
      "name": "customer_id",
      "expr": "customer_id",
      "type": "dim",
      "description": "Unique customer identifier"
    },
    {
      "name": "customer_name",
      "expr": "customer_name",
      "type": "dim",
      "description": "Customer full name"
    },
    {
      "name": "insight_type",
      "expr": "CASE WHEN _table_suffix = 'summary' THEN 'profile' WHEN _table_suffix = 'engagement' THEN 'behavior' ELSE 'preferences' END",
      "type": "dim",
      "description": "Type of customer insight"
    },
    {
      "name": "insight_category",
      "expr": "COALESCE(customer_segment, engagement_level, preference_category)",
      "type": "dim",
      "description": "Primary insight category"
    },
    {
      "name": "insight_value",
      "expr": "COALESCE(CAST(total_orders AS STRING), CAST(engagement_score AS STRING), preference_strength)",
      "type": "dim",
      "description": "Insight value as string"
    },
    {
      "name": "insight_score",
      "expr": "COALESCE(customer_value_score, engagement_score, preference_score)",
      "type": "fct",
      "description": "Numeric insight score"
    },
    {
      "name": "last_updated",
      "expr": "COALESCE(profile_updated_at, behavior_updated_at, preferences_updated_at)",
      "type": "dim",
      "description": "When this insight was last updated"
    },
    {
      "name": "data_source",
      "expr": "CASE WHEN _table_suffix = 'summary' THEN 'customer_profiles' WHEN _table_suffix = 'engagement' THEN 'customer_behavior' ELSE 'customer_preferences' END",
      "type": "dim",
      "description": "Source of the insight data"
    }
  ]
}
```

This example demonstrates:

- **Multi-model consolidation:** Combining different types of customer insights into one dataset
- **Schema harmonization:** Using COALESCE to handle different column names across models
- **Data source tracking:** Adding metadata to identify which model contributed each row
- **Flexible insights:** Creating a unified structure for different types of customer data
- **Business intelligence:** Combining profiles, behavior, and preferences for 360-degree customer view

## 7. Advanced Example: Multi-Channel Sales Analysis

Let's create a more complex example that combines sales data from different channels and time periods for comprehensive analysis.

**Scenario:** Combine sales performance data from different channels and historical periods to create a unified sales analytics dataset.

**Source Models:**

- `int__sales__channels__online_performance`: Online sales metrics
- `int__sales__channels__instore_performance`: In-store sales metrics
- `int__sales__historical__legacy_performance`: Historical sales data from legacy system

```json
{
  "type": "int_union_models",
  "group": "sales",
  "topic": "performance",
  "name": "unified_sales_analytics",
  "materialization": "incremental",
  "from": {
    "model": "int__sales__channels__online_performance",
    "union": {
      "type": "all",
      "models": [
        "int__sales__channels__instore_performance",
        "int__sales__historical__legacy_performance"
      ]
    }
  },
  "select": [
    {
      "name": "sales_date",
      "expr": "COALESCE(transaction_date, sale_date, legacy_date)",
      "type": "dim",
      "description": "Date of sales transaction"
    },
    {
      "name": "channel",
      "expr": "CASE WHEN _table_suffix = 'online_performance' THEN 'online' WHEN _table_suffix = 'instore_performance' THEN 'in-store' ELSE 'legacy' END",
      "type": "dim",
      "description": "Sales channel"
    },
    {
      "name": "location_id",
      "expr": "COALESCE(store_id, location_code, legacy_location)",
      "type": "dim",
      "description": "Location identifier"
    },
    {
      "name": "product_sku",
      "expr": "COALESCE(product_sku, item_code, legacy_product_id)",
      "type": "dim",
      "description": "Product identifier"
    },
    {
      "name": "revenue_dollars",
      "expr": "COALESCE(online_revenue, instore_revenue, CAST(legacy_revenue_cents AS DECIMAL(10,2)) / 100.0)",
      "type": "fct",
      "description": "Revenue in dollars"
    },
    {
      "name": "units_sold",
      "expr": "COALESCE(quantity_sold, units_sold, legacy_quantity)",
      "type": "fct",
      "description": "Number of units sold"
    },
    {
      "name": "customer_count",
      "expr": "COALESCE(unique_customers, customer_count, legacy_customer_count)",
      "type": "fct",
      "description": "Number of unique customers"
    },
    {
      "name": "avg_order_value",
      "expr": "CASE WHEN COALESCE(unique_customers, customer_count, legacy_customer_count) > 0 THEN COALESCE(online_revenue, instore_revenue, CAST(legacy_revenue_cents AS DECIMAL(10,2)) / 100.0) / COALESCE(unique_customers, customer_count, legacy_customer_count) ELSE 0 END",
      "type": "fct",
      "description": "Average order value"
    },
    {
      "name": "data_quality_score",
      "expr": "CASE WHEN _table_suffix = 'legacy_performance' THEN 0.7 WHEN _table_suffix = 'online_performance' THEN 1.0 ELSE 0.9 END",
      "type": "fct",
      "description": "Data quality confidence score"
    },
    {
      "name": "is_current_system",
      "expr": "_table_suffix != 'legacy_performance'",
      "type": "dim",
      "description": "Whether data comes from current systems"
    }
  ],
  "where": [
    {
      "expr": "COALESCE(transaction_date, sale_date, legacy_date) >= '2022-01-01'"
    }
  ]
}
```

This example demonstrates:

- **Multi-channel consolidation:** Combining online, in-store, and legacy sales data
- **Complex schema harmonization:** Using COALESCE to handle different column names across systems
- **Data quality tracking:** Adding confidence scores for different data sources
- **Calculated metrics:** Computing average order values from available data
- **Temporal filtering:** Using WHERE clause to limit data to recent periods
- **System migration handling:** Distinguishing between current and legacy systems

## 8. Best Practices

### Schema Compatibility

- **Standardize column names:** Ensure all models have compatible column structures
- **Handle data type differences:** Use CAST functions to align data types across models
- **Use COALESCE strategically:** Handle different column names across models gracefully
- **Document schema variations:** Clearly document any differences between source models

### Data Quality Management

- **Add source tracking:** Include metadata to identify which model contributed each row
- **Implement quality scores:** Add confidence indicators for different data sources
- **Handle missing data:** Use appropriate defaults or null handling for missing columns
- **Validate union results:** Test that all expected data appears in the union

### Performance Optimization

- **Use appropriate materialization:** `incremental` for large datasets, `ephemeral` for smaller ones
- **Consider filtering:** Use WHERE clauses to limit data volume when appropriate
- **Monitor query performance:** Track execution times for complex unions
- **Optimize model order:** Place the largest or most frequently updated model first

## 9. Integration with Data Pipeline

The `int_union_models` serves as a consolidation layer:

1. **Multiple intermediate models** → `int_union_models` → **Unified intermediate data**
2. **Channel-specific models** → `int_union_models` → **Cross-channel analytics**
3. **Time-period models** → `int_union_models` → **Historical continuity**
4. **System-specific models** → `int_union_models` → **Migration-ready datasets**

**Example Pipeline Flow:**

```text
int__customers__profiles__summary + int__customers__behavior__engagement + int__customers__preferences__analysis
                                                    ↓
                                    int__customers__analytics__unified_customer_insights
                                                    ↓
                                            Mart Models & Analytics
```

---

_This documentation provides comprehensive coverage of `int_union_models` with realistic examples from the jaffle shop business scenario. Each example demonstrates practical applications for consolidating data from multiple intermediate models._
