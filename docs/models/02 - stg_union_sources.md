# Staging Union Sources Model

## 1. Introduction

The `stg_union_sources` model is designed to combine data from multiple similar source tables into a single unified staging model. This model type performs a SQL `UNION ALL` operation on the specified sources, making it ideal for scenarios where related data is split across multiple tables or systems but needs to be analyzed together.

## 2. Creating with Visual Editor

You can create this model type using the visual canvas:

1. Run `DJ: Create Model` from Command Palette, or select "Create Model" under Actions in tree view
2. Step 1 - Basic Information: Select model type `stg_union_sources`, enter group, topic, and name
3. Step 2 - Data Modeling: Use the visual editor
4. Add Select nodes for each source, add Union node, connect and configure

See [Visual Editor Guide](../VISUAL_EDITOR.md) for complete canvas documentation and workflow examples.

---

## 3. Purpose

The primary purposes of the `stg_union_sources` model are:

- **Data Consolidation:** Combine similar data from multiple source systems into one unified view
- **Historical Data Integration:** Merge current and archived data tables that have the same structure
- **Multi-System Integration:** Unite data from different systems that track the same entities
- **Simplified Downstream Processing:** Create a single source of truth from fragmented data sources
- **Performance Optimization:** Reduce the need for complex joins in downstream models

## 4. Model Configuration

A `stg_union_sources` model requires the following configuration parameters:

- **`type`:** `stg_union_sources`
- **`group`:** A logical grouping for the model (e.g., `jaffle_shop`, `ecommerce`, `finance`)
- **`topic`:** A more specific categorization within the group (e.g., `customers`, `orders`, `products`)
- **`name`:** A unique name for the model following naming conventions
- **`materialized`:** Either `ephemeral` or `incremental`
- **`from`:** Specifies the sources to union:
  - **`source`:** The primary source table (string identifier)
  - **`union`:** Union configuration:
    - **`type`:** Optional, can be `"all"` (defaults to UNION ALL behavior)
    - **`sources`:** Array of additional source table identifiers to union with the primary source
- **`select`:** Array of column definitions (same as `stg_select_source`)

## 5. When to Use stg_union_sources

### Ideal Use Cases

1. **Multi-Store Data:** When you have separate tables for different store locations
2. **Historical Archives:** Combining current data with archived historical tables
3. **System Migrations:** Merging data from old and new systems during transitions
4. **Regional Data:** Uniting data from different geographical regions
5. **Time-Based Partitions:** Combining monthly or yearly data tables

### Schema Requirements

- All source tables must have **compatible schemas**
- Column names and data types must match across all sources
- If schemas differ, use intermediate `stg_select_source` models to standardize them first

## 6. Basic Example: Multi-Region Store Data

Let's create a unified view of store locations from different regional databases following our jaffle shop patterns.

**Scenario:** The jaffle shop has expanded and now has separate store tables for different regions that need to be combined for unified reporting.

**Source Tables:**

- `raw_stores_north`: Northern region stores
- `raw_stores_south`: Southern region stores
- Both tables have identical schemas

```json
{
  "type": "stg_union_sources",
  "group": "sales",
  "topic": "stores",
  "name": "all_locations",
  "materialization": "ephemeral",
  "from": {
    "source": "development__jaffle_shop_north.raw_stores",
    "union": {
      "sources": ["development__jaffle_shop_south.raw_stores"]
    }
  },
  "select": [
    {
      "name": "store_id",
      "expr": "id",
      "type": "dim",
      "description": "Unique store identifier"
    },
    {
      "name": "store_name",
      "expr": "TRIM(name)",
      "type": "dim",
      "description": "Store location name"
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
      "name": "opened_date",
      "expr": "CAST(opened_at AS DATE)",
      "type": "dim",
      "description": "Store opening date"
    },
    {
      "name": "is_active",
      "expr": "status = 'active'",
      "type": "dim",
      "description": "Whether store is currently active"
    }
  ]
}
```

This example demonstrates:

- **Regional data consolidation:** Combining store data from multiple geographic regions
- **Schema standardization:** Applying consistent transformations across all sources
- **Data type conversion:** Converting dates and creating boolean flags
- **Business logic:** Determining active status from raw status values
- **Unified naming:** Following established naming conventions

## 7. Advanced Example: Multi-System Order Integration

A more complex scenario involves combining order data from different systems that have been integrated over time.

**Scenario:** The jaffle shop has migrated from an old POS system to a new one, and we need to combine historical orders with current orders for complete analytics.

**Source Tables:**

- `raw_orders_legacy`: Orders from the old POS system (2022-2023)
- `raw_orders_current`: Orders from the new POS system (2024+)
- Both systems track the same data but with slightly different formats

```json
{
  "type": "stg_union_sources",
  "group": "sales",
  "topic": "orders",
  "name": "unified_orders",
  "materialization": "incremental",
  "from": {
    "source": "development__jaffle_shop_current.raw_orders",
    "union": {
      "sources": ["development__jaffle_shop_legacy.raw_orders"]
    }
  },
  "select": [
    {
      "name": "order_id",
      "expr": "CAST(id AS VARCHAR)",
      "type": "dim",
      "description": "Unique order identifier (standardized as string)"
    },
    {
      "name": "customer_id",
      "expr": "CAST(customer AS VARCHAR)",
      "type": "dim",
      "description": "Customer identifier (standardized as string)"
    },
    {
      "name": "store_id",
      "expr": "COALESCE(store_id, location_id)",
      "type": "dim",
      "description": "Store identifier (handles legacy location_id field)"
    },
    {
      "name": "order_date",
      "expr": "CAST(COALESCE(ordered_at, order_timestamp) AS DATE)",
      "type": "dim",
      "description": "Order date (handles different timestamp fields)"
    },
    {
      "name": "order_datetime",
      "expr": "CAST(COALESCE(ordered_at, order_timestamp) AS TIMESTAMP)",
      "type": "dim",
      "description": "Order timestamp"
    },
    {
      "name": "subtotal_cents",
      "expr": "CASE WHEN subtotal_dollars IS NOT NULL THEN CAST(subtotal_dollars * 100 AS INTEGER) ELSE subtotal_cents END",
      "type": "fct",
      "description": "Order subtotal in cents (converts legacy dollar amounts)"
    },
    {
      "name": "tax_paid_cents",
      "expr": "CASE WHEN tax_dollars IS NOT NULL THEN CAST(tax_dollars * 100 AS INTEGER) ELSE tax_paid_cents END",
      "type": "fct",
      "description": "Tax amount in cents (converts legacy dollar amounts)"
    },
    {
      "name": "order_total_cents",
      "expr": "CASE WHEN total_dollars IS NOT NULL THEN CAST(total_dollars * 100 AS INTEGER) ELSE order_total_cents END",
      "type": "fct",
      "description": "Total order amount in cents (converts legacy dollar amounts)"
    },
    {
      "name": "data_source",
      "expr": "CASE WHEN total_dollars IS NOT NULL THEN 'legacy_pos' ELSE 'current_pos' END",
      "type": "dim",
      "description": "Source system identifier"
    },
    {
      "name": "order_status",
      "expr": "COALESCE(status, 'completed')",
      "type": "dim",
      "description": "Order status (defaults to completed for legacy records)"
    }
  ]
}
```

This example demonstrates:

- **System migration handling:** Combining data from old and new systems
- **Schema reconciliation:** Using COALESCE to handle different field names
- **Data type standardization:** Converting between different formats (dollars to cents)
- **Data source tracking:** Adding metadata to identify the source system
- **Incremental processing:** Using incremental materialization for large datasets
- **Complex transformations:** Handling multiple data format differences in a single model

## 8. Best Practices

### Schema Compatibility

- **Validate schemas:** Ensure all source tables have compatible column structures
- **Standardize data types:** Use CAST functions to ensure consistent data types across sources
- **Handle missing columns:** Use COALESCE or default values for columns that don't exist in all sources
- **Document differences:** Clearly document any schema variations between sources

### Performance Optimization

- **Use appropriate materialization:** `ephemeral` for small datasets, `incremental` for large ones
- **Consider partitioning:** For time-based unions, consider date-based partitioning
- **Optimize union order:** Place the largest table first in the union for better performance
- **Monitor query performance:** Track execution times and optimize as needed

### Data Quality

- **Add source tracking:** Include metadata to identify which source each record came from
- **Implement validation:** Add data quality checks to ensure union results are as expected
- **Handle duplicates:** Consider deduplication strategies if sources might overlap
- **Test thoroughly:** Validate that all expected data appears in the union result

## 9. Integration with Data Pipeline

The `stg_union_sources` model serves as a consolidation layer:

1. **Multiple source systems** → `stg_union_sources` → **Unified staging data**
2. **Regional databases** → `stg_union_sources` → **Centralized reporting**
3. **Historical + current data** → `stg_union_sources` → **Complete time series**
4. **System migrations** → `stg_union_sources` → **Seamless data continuity**

**Example Pipeline Flow:**

```text
raw_stores_north + raw_stores_south
                ↓
    stg__sales__stores__all_locations
                ↓
        Downstream Models
```

---

_This documentation provides comprehensive coverage of `stg_union_sources` with realistic examples from the jaffle shop business scenario. Each example demonstrates practical applications for consolidating data from multiple similar sources._
