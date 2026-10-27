# Intermediate Join Column Model

## 1. Introduction

The `int_join_column` model is a specialized model type designed for unnesting and flattening complex column structures such as arrays, JSON objects, or other nested data types. It performs a cross join with an unnested column, creating separate rows for each element within the nested structure, making semi-structured data more accessible for analysis.

## 2. Creating with Visual Editor

You can create this model type using the visual canvas:

1. Run `DJ: Create Model` from Command Palette, or select "Create Model" under Actions in tree view
2. Step 1 - Basic Information: Select model type `int_join_column`, enter group, topic, and name
3. Step 2 - Data Modeling: Use the visual editor
4. Add Select node, add Join Column node for array unnesting

See [Visual Editor Guide](../VISUAL_EDITOR.md) for complete canvas documentation and workflow examples.

---

## 3. Purpose

The primary purposes of the `int_join_column` model are:

- **Data Unnesting:** Extract and flatten data from arrays, JSON objects, or other nested structures
- **Semi-structured Data Processing:** Convert complex data formats into tabular structures for analysis
- **Data Normalization:** Transform denormalized nested data into normalized relational format
- **Enhanced Analytics:** Make nested data accessible for standard SQL operations and reporting
- **Performance Optimization:** Pre-process complex data structures to improve downstream query performance

## 4. Model Configuration

An `int_join_column` requires the following configuration parameters:

- **`type`:** `int_join_column`
- **`group`:** A logical grouping for the model (e.g., `jaffle_shop`, `ecommerce`, `finance`)
- **`topic`:** A more specific categorization within the group (e.g., `products`, `orders`, `customers`)
- **`name`:** A unique name for the model following naming conventions
- **`materialized`:** Either `ephemeral` or `incremental`
- **`from`:** Specifies the source model and unnesting configuration:
  - **`model`:** The source model containing the nested column (string identifier)
  - **`join`:** Unnesting configuration:
    - **`type`:** `cross_join_unnest` (constant value)
    - **`column`:** The nested column to unnest (SQL expression)
    - **`fields`:** Array of field expressions to extract from the unnested data
- **`select`:** Array of column definitions (supports both simple names and complex objects)
- **`where`:** Optional filtering conditions
- **`group_by`:** Optional grouping for aggregations

## 5. Unnesting Process

The `int_join_column` model performs the following transformation:

1. **Source Data Retrieval:** Fetches data from the specified source model
2. **Cross Join Unnest:** Performs a cross join with the unnested column, creating new rows for each array element or object property
3. **Field Extraction:** Extracts specified fields from the unnested data structure
4. **Result Combination:** Combines extracted fields with other selected columns from the source model
5. **Output Generation:** Produces a flattened, tabular result set

## 6. Basic Example: Order Item Details Analysis

Let's create a realistic example where order items are stored as JSON objects and we need to unnest them for detailed analysis.

**Scenario:** Orders contain item details as JSON arrays, and we want to analyze individual items within each order.

**Source Data (`stg__sales__orders__enriched_orders`):**

```sql
-- Hypothetical source data structure with JSON items
| order_id | customer_id | store_id | order_items_json                                                    |
| -------- | ----------- | -------- | ------------------------------------------------------------------- |
| 1        | 1           | 1        | [{"sku":"JAF-001","qty":2,"price":850}, {"sku":"BEV-001","qty":1,"price":400}] |
| 2        | 2           | 1        | [{"sku":"JAF-002","qty":1,"price":950}]                           |
| 3        | 1           | 2        | [{"sku":"JAF-001","qty":1,"price":850}, {"sku":"JAF-003","qty":1,"price":750}] |
```

```json
{
  "type": "int_join_column",
  "group": "sales",
  "topic": "orders",
  "name": "order_items_detailed",
  "materialization": "ephemeral",
  "from": {
    "model": "stg__sales__orders__enriched_orders",
    "join": {
      "type": "cross_join_unnest",
      "column": "order_items_json",
      "fields": ["item_data"]
    }
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
      "name": "item_sku",
      "expr": "json_extract_scalar(item_data, '$.sku')",
      "type": "dim",
      "description": "Product SKU from unnested item"
    },
    {
      "name": "item_quantity",
      "expr": "CAST(json_extract_scalar(item_data, '$.qty') AS INTEGER)",
      "type": "fct",
      "description": "Quantity of this item in the order"
    },
    {
      "name": "item_price_cents",
      "expr": "CAST(json_extract_scalar(item_data, '$.price') AS INTEGER)",
      "type": "fct",
      "description": "Individual item price in cents"
    },
    {
      "name": "item_total_cents",
      "expr": "CAST(json_extract_scalar(item_data, '$.qty') AS INTEGER) * CAST(json_extract_scalar(item_data, '$.price') AS INTEGER)",
      "type": "fct",
      "description": "Total value for this item (quantity × price)"
    },
    {
      "name": "item_price_dollars",
      "expr": "CAST(json_extract_scalar(item_data, '$.price') AS DECIMAL(10,2)) / 100.0",
      "type": "fct",
      "description": "Individual item price in dollars"
    },
    {
      "name": "item_total_dollars",
      "expr": "(CAST(json_extract_scalar(item_data, '$.qty') AS INTEGER) * CAST(json_extract_scalar(item_data, '$.price') AS INTEGER)) / 100.0",
      "type": "fct",
      "description": "Total value for this item in dollars"
    }
  ]
}
```

This example demonstrates:

- **JSON unnesting:** Extracting individual items from JSON arrays in order data
- **Cross join unnest:** Creating separate rows for each item within an order
- **JSON field extraction:** Using json_extract_scalar to pull specific fields
- **Data type conversion:** Converting JSON strings to appropriate data types
- **Calculated fields:** Computing item totals from quantity and price
- **Unit conversion:** Converting cents to dollars for business-friendly reporting

## 7. Advanced Example: Customer Preferences Analysis

Let's create a more complex example where customer preferences are stored as nested JSON objects with multiple levels.

**Scenario:** Customer profiles contain preference data as nested JSON, and we want to analyze individual preferences and their values.

**Source Data (`int__customers__profiles__summary`):**

```sql
-- Hypothetical source data with nested preferences
| customer_id | customer_name | preferences_json                                                           |
| ----------- | ------------- | -------------------------------------------------------------------------- |
| 1           | Alice Johnson | {"dietary":["vegetarian","gluten-free"],"flavors":["sweet","fruity"],"temp":"hot"} |
| 2           | Bob Smith     | {"dietary":["none"],"flavors":["savory","spicy"],"temp":"cold"}           |
| 3           | Carol Davis   | {"dietary":["vegan","organic"],"flavors":["nutty","sweet"],"temp":"hot"}  |
```

```json
{
  "type": "int_join_column",
  "group": "customers",
  "topic": "preferences",
  "name": "dietary_preferences_unnested",
  "materialization": "ephemeral",
  "from": {
    "model": "int__customers__profiles__summary",
    "join": {
      "type": "cross_join_unnest",
      "column": "json_extract(preferences_json, '$.dietary')",
      "fields": ["dietary_preference"]
    }
  },
  "select": [
    {
      "name": "customer_id",
      "expr": "customer_id",
      "type": "dim",
      "description": "Customer identifier"
    },
    {
      "name": "customer_name",
      "expr": "customer_name",
      "type": "dim",
      "description": "Customer name"
    },
    {
      "name": "dietary_preference",
      "expr": "json_extract_scalar(dietary_preference, '$')",
      "type": "dim",
      "description": "Individual dietary preference"
    },
    {
      "name": "preference_category",
      "expr": "'dietary'",
      "type": "dim",
      "description": "Category of preference"
    },
    {
      "name": "is_restrictive_diet",
      "expr": "json_extract_scalar(dietary_preference, '$') IN ('vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'nut-free')",
      "type": "dim",
      "description": "Whether this is a restrictive dietary preference"
    },
    {
      "name": "preference_complexity_score",
      "expr": "CASE WHEN json_extract_scalar(dietary_preference, '$') = 'none' THEN 1 WHEN json_extract_scalar(dietary_preference, '$') IN ('vegetarian', 'gluten-free') THEN 2 WHEN json_extract_scalar(dietary_preference, '$') IN ('vegan', 'organic') THEN 3 ELSE 1 END",
      "type": "fct",
      "description": "Complexity score for accommodating this preference"
    },
    {
      "name": "temperature_preference",
      "expr": "json_extract_scalar(preferences_json, '$.temp')",
      "type": "dim",
      "description": "Customer temperature preference"
    },
    {
      "name": "has_multiple_dietary_restrictions",
      "expr": "json_array_length(json_extract(preferences_json, '$.dietary')) > 1",
      "type": "dim",
      "description": "Whether customer has multiple dietary restrictions"
    }
  ]
}
```

This example demonstrates:

- **Nested JSON processing:** Extracting arrays from within JSON objects
- **Complex field extraction:** Using json_extract and json_extract_scalar
- **Business logic integration:** Adding complexity scores and restriction classifications
- **Multi-level analysis:** Combining unnested data with other JSON fields
- **Advanced calculations:** Using json_array_length for array-based logic
- **Customer intelligence:** Creating actionable insights from preference data

## 8. Best Practices

### JSON and Array Processing

- **Validate data structure:** Ensure JSON is well-formed before unnesting
- **Handle null values:** Use COALESCE or CASE statements for missing nested data
- **Data type consistency:** Cast extracted values to appropriate data types
- **Performance considerations:** Be mindful of the data explosion from unnesting

### Business Logic Integration

- **Add context:** Include relevant business logic and categorizations
- **Maintain relationships:** Preserve connections to parent records
- **Create meaningful metrics:** Add calculated fields that provide business value
- **Document transformations:** Clearly explain complex JSON extraction logic

### Performance Optimization

- **Materialization strategy:** Use `ephemeral` for small datasets, consider `incremental` for large ones
- **Filter early:** Apply WHERE clauses to reduce data volume before unnesting
- **Index considerations:** Ensure parent models have appropriate indexes
- **Monitor performance:** Track query execution times for complex unnesting operations

## 9. Integration with Data Pipeline

The `int_join_column` model serves as a data normalization layer:

1. **Staging models with nested data** → `int_join_column` → **Normalized intermediate data**
2. **JSON/Array columns** → `int_join_column` → **Tabular analysis-ready data**
3. **Semi-structured data** → `int_join_column` → **Relational format**
4. **Complex nested structures** → `int_join_column` → **Flattened business views**

**Example Pipeline Flow:**

```text
stg__sales__orders__enriched_orders (with JSON items)
                    ↓
        int__sales__orders__order_items_detailed
                    ↓
            Downstream Analysis Models
```

---

_This documentation provides comprehensive coverage of `int_join_column` with realistic examples from the jaffle shop business scenario. Each example demonstrates practical applications for unnesting and analyzing semi-structured data._
