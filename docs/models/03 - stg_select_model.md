# Staging Select Model

## 1. Introduction

The `stg_select_model` model type is designed to select and transform data from existing dbt models rather than directly from source tables. This model type is particularly useful for creating secondary staging layers, applying additional transformations to already-staged data, or creating specialized views of existing models for specific downstream purposes.

## 2. Creating with Visual Editor

You can create this model type using the visual canvas:

1. Run `DJ: Create Model` from Command Palette, or select "Create Model" under Actions in tree view
2. Step 1 - Basic Information: Select model type `stg_select_model`, enter group, topic, and name
3. Step 2 - Data Modeling: Use the visual editor
4. Add Select node, choose model, configure columns

See [Visual Editor Guide](../VISUAL_EDITOR.md) for complete canvas documentation and workflow examples.

---

## 3. Purpose

The primary purposes of the `stg_select_model` model are:

- **Secondary Staging:** Create additional staging layers on top of existing staged data
- **Specialized Views:** Generate focused views of broader staging models for specific use cases
- **Post-Union Transformations:** Apply transformations after data has been unioned from multiple sources
- **Data Refinement:** Add business logic or calculations to already-cleaned staging data
- **Performance Optimization:** Create materialized views of frequently-used subsets of larger models

## 4. Model Configuration

A `stg_select_model` requires the following configuration parameters:

- **`type`:** `stg_select_model`
- **`group`:** A logical grouping for the model (e.g., `jaffle_shop`, `ecommerce`, `finance`)
- **`topic`:** A more specific categorization within the group (e.g., `customers`, `orders`, `products`)
- **`name`:** A unique name for the model following naming conventions
- **`materialized`:** Either `ephemeral` or `incremental`
- **`from`:** Specifies the source model:
  - **`model`:** Reference to an existing dbt model (string identifier)
- **`select`:** Array of column definitions (same structure as other staging models)

## 5. Key Differences from stg_select_source

| Aspect             | stg_select_source       | stg_select_model          |
| ------------------ | ----------------------- | ------------------------- |
| **Data Source**    | Raw source tables/seeds | Existing dbt models       |
| **Primary Use**    | Initial data cleaning   | Secondary transformations |
| **From Structure** | `from.source`           | `from.model`              |
| **Typical Layer**  | First staging layer     | Secondary staging layer   |

## 6. When to Use stg_select_model

### Ideal Use Cases

1. **After Union Operations:** Transform data that has been unioned from multiple sources
2. **Business Logic Addition:** Add calculated fields or business rules to clean staging data
3. **Performance Optimization:** Create focused, materialized views of large staging models
4. **Data Subsetting:** Extract specific subsets of data for specialized downstream processing
5. **Column Standardization:** Apply consistent formatting across multiple related staging models

### Common Scenarios

- Creating customer segments from unified customer data
- Calculating derived metrics from clean order data
- Filtering large datasets for specific business units
- Adding computed fields that require clean, staged data as input

## 7. Basic Example: Enhanced Store Analysis

Let's build on our jaffle shop store data. Assume we have a unified store model from `stg_union_sources` and want to add business intelligence and performance metrics.

**Prerequisite:** We have a staging model `stg__sales__stores__all_locations` from our union sources example.

```json
{
  "type": "stg_select_model",
  "group": "sales",
  "topic": "stores",
  "name": "enhanced_locations",
  "materialization": "ephemeral",
  "from": {
    "model": "stg__sales__stores__all_locations"
  },
  "select": [
    {
      "name": "store_id",
      "expr": "store_id",
      "type": "dim",
      "description": "Unique store identifier"
    },
    {
      "name": "store_name",
      "expr": "store_name",
      "type": "dim",
      "description": "Store location name"
    },
    {
      "name": "store_name_clean",
      "expr": "TRIM(UPPER(store_name))",
      "type": "dim",
      "description": "Standardized store name"
    },
    {
      "name": "region",
      "expr": "region",
      "type": "dim",
      "description": "Geographic region"
    },
    {
      "name": "tax_rate",
      "expr": "tax_rate",
      "type": "fct",
      "description": "Local tax rate"
    },
    {
      "name": "tax_rate_percentage",
      "expr": "tax_rate * 100",
      "type": "fct",
      "description": "Tax rate as percentage"
    },
    {
      "name": "tax_tier",
      "expr": "CASE WHEN tax_rate >= 0.10 THEN 'High Tax' WHEN tax_rate >= 0.07 THEN 'Medium Tax' ELSE 'Low Tax' END",
      "type": "dim",
      "description": "Tax rate classification"
    },
    {
      "name": "opened_date",
      "expr": "opened_date",
      "type": "dim",
      "description": "Store opening date"
    },
    {
      "name": "days_since_opening",
      "expr": "date_diff('day', opened_date, CURRENT_DATE)",
      "type": "fct",
      "description": "Number of days since store opened"
    },
    {
      "name": "store_age_category",
      "expr": "CASE WHEN date_diff('day', opened_date, CURRENT_DATE) >= 1095 THEN 'Established' WHEN date_diff('day', opened_date, CURRENT_DATE) >= 365 THEN 'Mature' ELSE 'New' END",
      "type": "dim",
      "description": "Store age classification"
    },
    {
      "name": "is_active",
      "expr": "is_active",
      "type": "dim",
      "description": "Whether store is currently active"
    },
    {
      "name": "is_high_tax_location",
      "expr": "tax_rate >= 0.08",
      "type": "dim",
      "description": "Whether store is in high-tax location"
    }
  ]
}
```

This example demonstrates:

- **Secondary staging:** Building on unified data from `stg_union_sources`
- **Business intelligence:** Adding tax tier classifications and store age categories
- **Calculated fields:** Computing days since opening and percentage conversions
- **Data standardization:** Creating clean, uppercase store names
- **Boolean flags:** Creating binary indicators for business logic
- **Performance metrics:** Adding derived metrics for downstream analysis

## 8. Advanced Example: Order Enrichment with Business Logic

Let's create an enhanced order model that builds on our unified order data and adds sophisticated business logic.

**Prerequisite:** We have a staging model `stg__sales__orders__unified_orders` from our union sources example.

```json
{
  "type": "stg_select_model",
  "group": "sales",
  "topic": "orders",
  "name": "enriched_orders",
  "materialization": "incremental",
  "from": {
    "model": "stg__sales__orders__unified_orders"
  },
  "select": [
    {
      "name": "order_id",
      "expr": "order_id",
      "type": "dim",
      "description": "Unique order identifier"
    },
    {
      "name": "customer_id",
      "expr": "customer_id",
      "type": "dim",
      "description": "Customer identifier"
    },
    {
      "name": "store_id",
      "expr": "store_id",
      "type": "dim",
      "description": "Store identifier"
    },
    {
      "name": "order_date",
      "expr": "order_date",
      "type": "dim",
      "description": "Order date"
    },
    {
      "name": "order_datetime",
      "expr": "order_datetime",
      "type": "dim",
      "description": "Order timestamp"
    },
    {
      "name": "order_year",
      "expr": "EXTRACT(YEAR FROM order_date)",
      "type": "dim",
      "description": "Order year"
    },
    {
      "name": "order_month",
      "expr": "EXTRACT(MONTH FROM order_date)",
      "type": "dim",
      "description": "Order month"
    },
    {
      "name": "is_weekend_order",
      "expr": "day_of_week(order_date) IN (6, 7)",
      "type": "dim",
      "description": "Whether order was placed on weekend"
    },
    {
      "name": "subtotal_cents",
      "expr": "subtotal_cents",
      "type": "fct",
      "description": "Order subtotal in cents"
    },
    {
      "name": "tax_paid_cents",
      "expr": "tax_paid_cents",
      "type": "fct",
      "description": "Tax amount in cents"
    },
    {
      "name": "order_total_cents",
      "expr": "order_total_cents",
      "type": "fct",
      "description": "Total order amount in cents"
    },
    {
      "name": "order_total_dollars",
      "expr": "CAST(order_total_cents AS DECIMAL(10,2)) / 100.0",
      "type": "fct",
      "description": "Total order amount in dollars"
    },
    {
      "name": "order_size_category",
      "expr": "CASE WHEN order_total_cents >= 2000 THEN 'Large' WHEN order_total_cents >= 1000 THEN 'Medium' ELSE 'Small' END",
      "type": "dim",
      "description": "Order size classification"
    },
    {
      "name": "tax_rate_calculated",
      "expr": "CASE WHEN subtotal_cents > 0 THEN CAST(tax_paid_cents AS DECIMAL(10,4)) / CAST(subtotal_cents AS DECIMAL(10,4)) ELSE 0 END",
      "type": "fct",
      "description": "Calculated tax rate from order amounts"
    },
    {
      "name": "data_source",
      "expr": "data_source",
      "type": "dim",
      "description": "Source system identifier"
    },
    {
      "name": "order_status",
      "expr": "order_status",
      "type": "dim",
      "description": "Order status"
    },
    {
      "name": "is_legacy_order",
      "expr": "data_source = 'legacy_pos'",
      "type": "dim",
      "description": "Whether order came from legacy system"
    }
  ]
}
```

This example demonstrates:

- **Temporal analysis:** Adding time-based dimensions (year, month, quarter, day of week, hour)
- **Business categorization:** Creating order size categories and time-of-day classifications
- **Unit conversions:** Converting between cents and dollars for business-friendly reporting
- **Calculated metrics:** Computing tax rates from order amounts
- **Boolean indicators:** Creating flags for weekend orders and legacy system identification
- **Complex transformations:** Advanced CASE statements for sophisticated business logic

## 9. Best Practices

### Model Dependencies

- **Clear lineage:** Ensure the source model is well-documented and stable
- **Version compatibility:** Consider the impact of changes to upstream models
- **Dependency management:** Use appropriate materialization strategies for upstream models
- **Testing:** Validate that transformations work correctly with source model changes

### Business Logic Implementation

- **Consistent calculations:** Apply uniform business rules across similar transformations
- **Documentation:** Clearly document complex business logic and calculations
- **Validation:** Test business rules against known expected outcomes
- **Maintainability:** Keep complex logic readable and well-commented

### Performance Optimization

- **Materialization strategy:** Use `ephemeral` for lightweight transformations, `incremental` for large datasets
- **Column selection:** Only select and transform columns needed downstream
- **Complex calculations:** Consider pre-computing expensive operations
- **Indexing:** Ensure upstream models have appropriate indexes for join performance

## 10. Integration with Data Pipeline

The `stg_select_model` serves as a secondary staging layer:

1. **Source models** → `stg_select_model` → **Enhanced staging data**
2. **Union models** → `stg_select_model` → **Business-enriched data**
3. **Clean staging data** → `stg_select_model` → **Analytics-ready staging**
4. **Multi-source staging** → `stg_select_model` → **Unified business views**

**Example Pipeline Flow:**

```text
stg__sales__stores__all_locations
                ↓
    stg__sales__stores__enhanced_locations
                ↓
        Intermediate Models
```

---

_This documentation provides comprehensive coverage of `stg_select_model` with realistic examples from the jaffle shop business scenario. Each example demonstrates practical applications for enhancing and enriching existing staged data._
