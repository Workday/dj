# Staging Select Source Model

## 1. Introduction

The `stg_select_source` model is the foundational building block of any dbt project using DJ. It represents the first transformation layer where raw source data is cleaned, standardized, and prepared for downstream consumption. This model type follows dbt best practices by performing initial data transformations without aggregations or joins.

## 2. Creating with Visual Editor

You can create this model type using the visual canvas:

1. Run `DJ: Create Model` from Command Palette, or select "Create Model" under Actions in tree view
2. Step 1 - Basic Information: Select model type `stg_select_source`, enter group, topic, and name
3. Step 2 - Data Modeling: Use the visual editor
4. Add Select node, choose source table, configure columns

See [Visual Editor Guide](../VISUAL_EDITOR.md) for complete canvas documentation and workflow examples.

---

## 3. Purpose

The primary purposes of the `stg_select_source` model are:

- **Data Standardization:** Convert raw data types, formats, and naming conventions to consistent standards
- **Column Selection:** Choose only the columns needed for downstream analysis
- **Basic Transformations:** Apply simple transformations like data type conversions, case changes, and basic calculations
- **Data Quality:** Add basic data validation and cleaning rules
- **Documentation Foundation:** Establish the first layer of documented, tested data models

## 4. Model Configuration

A `stg_select_source` model requires the following configuration parameters:

- **`type`:** `stg_select_source`
- **`group`:** A logical grouping for the model (e.g., `jaffle_shop`, `ecommerce`, `finance`)
- **`topic`:** A more specific categorization within the group (e.g., `customers`, `orders`, `products`)
- **`name`:** A unique name for the model following naming conventions (e.g., `customers`, `orders`, `products`)
- **`materialized`:** Either `ephemeral` or `incremental` (note: `view` is not supported)
- **`from`:** Specifies the source data:
  - **`source`:** Reference to a source table (string identifier)
- **`select`:** Array of column definitions specifying which columns to include and how to transform them

## 5. Column Types

DJ supports two main column types for analytical purposes:

- **`dim`:** Dimension columns (categorical data, IDs, text fields, timestamps)
- **`fct`:** Fact columns (numeric measures that can be aggregated)

**Note:** The `type` field is required for `fct` columns but optional for `dim` columns (defaults to `dim` if not specified).

## 6. Basic Example: Customer Data

Let's start with a simple example using the jaffle shop customer data. Our raw customer data looks like this:

**Raw Customers Data (`raw_customers`):**

```csv
id,name
32488100-c957-4d6c-a64b-8d843106fcff,Misty Reed
57868c0c-5a0d-4af7-b3cf-d573197a2e99,Brandon Hill
29bbd42e-6c52-4b2e-8e92-394306d4ac3c,Brad Williamson
```

Here's how to create a staging model for this data:

```json
{
  "type": "stg_select_source",
  "group": "customers",
  "topic": "profiles",
  "name": "clean",
  "materialization": "ephemeral",
  "from": {
    "source": "development__jaffle_shop_dev_seeds.raw_customers"
  },
  "select": [
    {
      "name": "customer_id",
      "expr": "id",
      "type": "dim",
      "description": "Unique identifier for each customer"
    },
    {
      "name": "customer_name",
      "expr": "TRIM(name)",
      "type": "dim",
      "description": "Customer full name, trimmed of whitespace"
    },
    {
      "name": "first_name",
      "expr": "split(TRIM(name), ' ')[1]",
      "type": "dim",
      "description": "Customer first name"
    },
    {
      "name": "last_name",
      "expr": "CASE WHEN cardinality(split(TRIM(name), ' ')) > 1 THEN split(TRIM(name), ' ')[cardinality(split(TRIM(name), ' '))] ELSE NULL END",
      "type": "dim",
      "description": "Customer last name"
    }
  ]
}
```

This configuration:

- Renames `id` to `customer_id` for clarity
- Cleans the `name` field by trimming whitespace and stores as `customer_name`
- Extracts `first_name` using string splitting
- Extracts `last_name` with logic to handle single names
- Includes descriptive documentation for each column
- Marks all columns as dimensions since they're descriptive attributes

## 7. Advanced Example: Order Data with Transformations

For more complex data like orders, we often need additional transformations:

**Raw Orders Data (`raw_orders`):**

```csv
id,customer,ordered_at,store_id,subtotal,tax_paid,order_total
df811427-cdce-45d3-8067-78b53a4c98c2,32488100-c957-4d6c-a64b-8d843106fcff,2016-09-01T15:13:00,028d015b-0c1f-464e-b528-e13d1e0bafc5,600,36,636
```

```json
{
  "type": "stg_select_source",
  "group": "sales",
  "topic": "orders",
  "name": "standardized",
  "materialization": "ephemeral",
  "from": {
    "source": "development__jaffle_shop_dev_seeds.raw_orders"
  },
  "select": [
    {
      "name": "order_id",
      "expr": "id",
      "type": "dim",
      "description": "Unique identifier for each order"
    },
    {
      "name": "customer_id",
      "expr": "customer",
      "type": "dim",
      "description": "Foreign key to customer"
    },
    {
      "name": "store_id",
      "expr": "store_id",
      "type": "dim",
      "description": "Foreign key to store"
    },
    {
      "name": "ordered_at",
      "expr": "CAST(ordered_at AS TIMESTAMP)",
      "type": "dim",
      "description": "Timestamp when order was placed"
    },
    {
      "name": "order_date",
      "expr": "DATE(CAST(ordered_at AS TIMESTAMP))",
      "type": "dim",
      "description": "Date when order was placed"
    },
    {
      "name": "subtotal_cents",
      "expr": "subtotal",
      "type": "fct",
      "description": "Order subtotal in cents"
    },
    {
      "name": "tax_paid_cents",
      "expr": "tax_paid",
      "type": "fct",
      "description": "Tax amount paid in cents"
    },
    {
      "name": "order_total_cents",
      "expr": "order_total",
      "type": "fct",
      "description": "Total order amount in cents"
    }
  ]
}
```

This example demonstrates:

- **Column renaming** for clarity (`id` → `order_id`, `customer` → `customer_id`)
- **Data type casting** (`ordered_at` converted to proper TIMESTAMP)
- **Derived columns** (`order_date` extracted from timestamp)
- **Proper typing** (timestamps and IDs as dimensions, monetary values as facts)
- **Consistent naming** (adding `_cents` suffix to clarify currency units)
- **Comprehensive documentation** for each column

## 8. Best Practices

### Naming Conventions

- Use descriptive, consistent column names
- Add suffixes to clarify units (`_cents`, `_date`, `_id`)
- Use snake_case for all column names
- Prefix with entity name when helpful (`customer_id`, `order_id`)

### Data Types

- Use `dim` for categorical data, IDs, and descriptive fields
- Use `fct` for numeric measures that will be aggregated
- Use `dim` for timestamp fields (timestamps are treated as dimensions in DJ)

### Transformations

- Keep transformations simple in staging models
- Focus on standardization rather than business logic
- Document any business rules applied in transformations
- Consider downstream usage when designing column structure

### Performance

- Use `ephemeral` materialization for lightweight staging models that are used by few downstream models
- Use `incremental` materialization for staging models with large datasets or many downstream dependencies
- Avoid complex calculations that can be done in intermediate models

## 9. Common Patterns

### ID Standardization

```json
{
  "name": "customer_id",
  "expr": "LOWER(TRIM(id))",
  "type": "dim"
}
```

### Date Extraction

```json
{
  "name": "order_date",
  "expr": "DATE(ordered_at)",
  "type": "dim"
}
```

### Currency Conversion

```json
{
  "name": "price_dollars",
  "expr": "price_cents / 100.0",
  "type": "fct"
}
```

### Text Standardization

```json
{
  "name": "product_name_clean",
  "expr": "TRIM(UPPER(name))",
  "type": "dim"
}
```

## 10. Testing and Validation

Staging models should include basic tests to ensure data quality:

- **Uniqueness tests** on primary keys
- **Not null tests** on required fields
- **Accepted values tests** for categorical columns
- **Relationship tests** to validate foreign keys

This foundation ensures that downstream models can rely on clean, consistent data from your staging layer.
