# Intermediate Select Model

## 1. Introduction

The `int_select_model` is the workhorse of the intermediate layer in dbt projects using DJ. It transforms staging models into analysis-ready datasets by performing selections, transformations, aggregations, and filtering. This model type is essential for implementing business logic and creating the building blocks for downstream mart models.

## 2. Creating with Visual Editor

You can create this model type using the visual canvas:

1. Run `DJ: Create Model` from Command Palette, or select "Create Model" under Actions in tree view
2. Step 1 - Basic Information: Select model type `int_select_model`, enter group, topic, and name
3. Step 2 - Data Modeling: Use the visual editor
4. Add Select node, choose model, configure aggregations and GROUP BY

See [Visual Editor Guide](../VISUAL_EDITOR.md) for complete canvas documentation and workflow examples.

---

## 3. Purpose

The primary purposes of the `int_select_model` are:

- **Business Logic Implementation:** Apply business rules and calculations to clean staging data
- **Data Aggregation:** Perform grouping and aggregation operations for analytical insights
- **Performance Optimization:** Pre-calculate metrics and aggregations to improve downstream query performance
- **Data Preparation:** Create analysis-ready datasets for mart models and reporting
- **Complex Transformations:** Handle sophisticated data transformations that go beyond simple staging operations

## 4. Model Configuration

An `int_select_model` requires the following configuration parameters:

- **`type`:** `int_select_model`
- **`group`:** A logical grouping for the model (e.g., `jaffle_shop`, `ecommerce`, `finance`)
- **`topic`:** A more specific categorization within the group (e.g., `customers`, `orders`, `products`)
- **`name`:** A unique name for the model following naming conventions
- **`materialized`:** Either `ephemeral` or `incremental`
- **`from`:** Specifies the source model:
  - **`model`:** Reference to an existing dbt model (string identifier)
- **`select`:** Array of column definitions with support for aggregations
- **`where`:** Optional filtering conditions
- **`group_by`:** Optional grouping specifications for aggregations
- **`having`:** Optional post-aggregation filtering
- **`order_by`:** Optional result ordering
- **`limit`:** Optional row limit
- **`offset`:** Optional row offset

## 5. Key Features of int_select_model

### Aggregation Support

Unlike staging models, `int_select_model` supports aggregation functions:

- **`aggs`:** Array of aggregation functions (`sum`, `min`, `max`, `avg`, `count`, `tdigest`, `hll`)
- **`group_by`:** Grouping specifications for aggregations
- **`having`:** Post-aggregation filtering

### Advanced Column Types

- **Fact columns with aggregations:** Numeric columns that can be aggregated
- **Dimension columns:** Categorical columns for grouping and filtering
- **Calculated columns:** Derived columns using SQL expressions

## 6. Basic Example: Customer Profile Summary

Let's create a customer profile summary with business logic using our jaffle shop staging data.

**Prerequisite:** We have `stg__customers__profiles__clean` from our staging examples.

```json
{
  "type": "int_select_model",
  "group": "customers",
  "topic": "profiles",
  "name": "summary",
  "from": {
    "model": "stg__customers__profiles__clean"
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
      "name": "first_name",
      "expr": "first_name",
      "type": "dim",
      "description": "Customer first name"
    },
    {
      "name": "last_name",
      "expr": "last_name",
      "type": "dim",
      "description": "Customer last name"
    },
    {
      "name": "customer_segment",
      "expr": "CASE WHEN total_orders >= 10 THEN 'VIP' WHEN total_orders >= 3 THEN 'Regular' ELSE 'New' END",
      "type": "dim",
      "description": "Customer segment classification"
    },
    {
      "name": "has_last_name",
      "expr": "last_name IS NOT NULL",
      "type": "dim",
      "description": "Whether customer provided a last name"
    }
  ]
}
```

This example demonstrates:

- **Business logic implementation:** Customer segmentation based on ID ranges
- **Boolean transformations:** Converting NULL checks to boolean flags
- **Data enrichment:** Adding derived fields to staging data
- **Simple transformations:** Pass-through columns with business context

## 7. Advanced Example: Product Popularity Analysis

Let's create a product popularity analysis with aggregations using our jaffle shop order items data.

**Prerequisites:** We have `stg__sales__items__order_details` from our staging examples.

```json
{
  "type": "int_select_model",
  "group": "products",
  "topic": "analytics",
  "name": "product_popularity",
  "from": {
    "model": "stg__sales__items__order_details"
  },
  "select": [
    {
      "name": "product_sku",
      "expr": "product_sku",
      "type": "dim",
      "description": "Product SKU identifier"
    },
    {
      "name": "product_type",
      "expr": "product_type",
      "type": "dim",
      "description": "Product category"
    },
    {
      "name": "total_orders",
      "expr": "COUNT(DISTINCT order_id)",
      "type": "fct",
      "description": "Number of unique orders containing this product"
    },
    {
      "name": "total_items_sold",
      "expr": "COUNT(*)",
      "type": "fct",
      "description": "Total quantity of this product sold"
    },
    {
      "name": "item_id",
      "expr": "item_id",
      "type": "dim",
      "description": "Order item identifier"
    }
  ],
  "group_by": [
    {
      "expr": "product_sku"
    },
    {
      "expr": "product_type"
    },
    {
      "expr": "item_id"
    }
  ]
}
```

This example shows:

- **Aggregation functions:** COUNT and COUNT DISTINCT for different metrics
- **Grouping logic:** Multiple columns for proper aggregation
- **Business metrics:** Order counts and item quantities
- **Mixed column types:** Dimensions for grouping, facts for aggregation

## 8. Select Configuration Options

### Model-Level Selection

Select all columns from a source model:

```json
{
  "model": "stg__sales_operations__orders__standardized_orders",
  "type": "all_from_model"
}
```

Select only dimensions:

```json
{
  "model": "stg__sales_operations__orders__standardized_orders",
  "type": "dims",
  "exclude": ["internal_id", "created_at"]
}
```

> `exclude` (and `include`) only shape ordinary columns. The framework-managed columns (`datetime`, `portal_partition_*`, `portal_source_count`) are re-injected after bulk expansion, so listing one in a bulk `exclude` on its own leaves it in the output and raises a Problems-tab warning — except when the exclude is already effective: a finer partition grain a coarsened `datetime` drops (e.g. `portal_partition_hourly` under `interval: "day"`), or a column the dedicated flag already drops. To fully drop one, use its dedicated flag instead — `exclude_datetime`, `exclude_portal_partition_columns` (accepts an array to drop specific grains), or `exclude_portal_source_count`. To re-grain or re-express one (for example, aggregate `datetime` to a coarser interval), `exclude` it in the bulk **and** re-add it as a named select in the same list: the exclude then does real work — it lets your copy win over the raw inherited one — and does not warn.

Select only facts:

```json
{
  "model": "stg__sales_operations__orders__standardized_orders",
  "type": "fcts_from_model",
  "override_prefix": "order_"
}
```

### Column-Level Selection

Basic dimension column:

```json
{
  "name": "customer_id",
  "expr": "customer_id",
  "type": "dim"
}
```

Fact column with aggregation:

```json
{
  "name": "total_revenue",
  "expr": "order_total_cents",
  "type": "fct",
  "aggs": ["sum", "avg", "max"]
}
```

Calculated column:

```json
{
  "name": "order_size_category",
  "expr": "CASE WHEN order_total_cents < 500 THEN 'small' WHEN order_total_cents < 1500 THEN 'medium' ELSE 'large' END",
  "type": "dim"
}
```

## 9. Filtering with WHERE

### Simple condition

```json
"where": {
  "expr": "order_total_cents > 0"
}
```

### Multiple AND conditions

```json
"where": {
  "and": [
    {
      "expr": "ordered_at >= date_add('day', -30, CURRENT_DATE)"
    },
    {
      "expr": "order_total_cents > 0"
    }
  ]
}
```

### OR conditions

```json
"where": {
  "or": [
    {
      "expr": "store_id = '028d015b-0c1f-464e-b528-e13d1e0bafc5'"
    },
    {
      "expr": "store_id = 'd64217c9-2ba0-481f-b81d-06eac4322988'"
    }
  ]
}
```

## 10. Grouping with GROUP BY

### Group by all dimensions

```json
"group_by": [
  {
    "type": "dims"
  }
]
```

### Group by specific expression

```json
"group_by": [
  {
    "expr": "customer_id"
  },
  {
    "expr": "DATE_TRUNC('month', ordered_at)"
  }
]
```

### Combined grouping

```json
"group_by": [
  {
    "expr": "store_id"
  },
  {
    "type": "dims"
  }
]
```

## 11. Best Practices

### Performance Optimization

- **Use incremental materialization** for large datasets with regular updates
- **Pre-calculate expensive aggregations** to improve downstream query performance
- **Filter early** using WHERE clauses to reduce data volume
- **Consider partitioning** for time-series data

### Business Logic

- **Implement business rules** in intermediate models rather than mart models
- **Create reusable metrics** that can be used across multiple downstream models
- **Document complex calculations** clearly in descriptions
- **Use consistent naming** for similar metrics across models

### Data Quality

- **Handle null values** appropriately in aggregations
- **Validate aggregation logic** with known test cases
- **Use HAVING clauses** to filter out invalid aggregated results
- **Monitor data freshness** for incremental models

## 12. Common Patterns

### Customer Lifetime Value

```json
{
  "name": "customer_ltv_cents",
  "expr": "order_total_cents",
  "type": "fct",
  "aggs": ["sum"]
}
```

### Recency Analysis

```json
{
  "name": "days_since_last_order",
  "expr": "date_diff('day', MAX(ordered_at), CURRENT_DATE)",
  "type": "fct"
}
```

### Cohort Analysis

```json
{
  "name": "customer_cohort",
  "expr": "DATE_TRUNC('month', MIN(ordered_at))",
  "type": "dim"
}
```

### Product Affinity

```json
{
  "name": "product_pair_frequency",
  "expr": "COUNT(*)",
  "type": "fct"
}
```

## 13. Integration with Data Pipeline

The `int_select_model` serves as the core transformation layer:

1. **Staging models** → `int_select_model` → **Business logic and aggregations**
2. **Multiple int models** → `int_join_models` → **Combined business entities**
3. **Intermediate models** → `mart_*` models → **Analytics-ready data**

This model type is essential for implementing business logic, creating reusable metrics, and preparing data for analytical consumption while maintaining good performance and data quality.
