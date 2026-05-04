# Data Modeling Visual Editor

## Overview

The Data Modeling Visual Editor provides an interactive, node-based interface for creating and editing dbt models. It offers a visual alternative to JSON configuration while generating identical outputs.

<video width="100%" controls>
  <source src="https://github.com/Workday/dj/raw/main/assets/videos/visual-editor-intro.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

> Opening the visual editor, navigating the canvas (pan/zoom/fit), and performing basic node operations

## When to Use the Visual Editor

- **Complex Joins**: Visualize multi-model join relationships
- **Learning**: Understand data flow through your pipeline
- **Collaboration**: Team members can open the same `.model.json` files to see models visually
- **Rapid Prototyping**: Quickly experiment with model structures

## Accessing the Visual Editor

**From Model Creation Wizard:**

1. Run `DJ: Create Model` from Command Palette, or select "Create Model" under Actions in tree view
2. Step 1 - Basic Information: Select model type, enter group, topic, and name
3. Step 2 - Data Modeling: Use the visual editor to configure your model

**From Existing Model:**

1. Open any `.model.json` file
2. Click "Edit Model" in editor toolbar
3. Visual editor opens with current configuration loaded

## Canvas Navigation

### Navigation Controls

- **Pan**: Scroll or click and drag empty canvas area
- **Zoom**: Use Controls panel zoom buttons or pinch gesture
- **Fit View**: Click "Fit View" button in Controls panel
- **Mini-map**: Toggle mini-map button in Controls panel

> Note: The canvas uses auto-layout - nodes are positioned automatically and cannot be manually dragged. The layout updates automatically based on your model configuration.

### Wizard Header Actions

The wizard header (top of page) provides these actions:

- **Save draft**: Save current progress and continue later
- **Discard**: Abandon changes and close editor
- **Show/Hide preview**: Toggle visibility of live SQL/YAML/JSON preview panel
- **Help menu (?)**: Tutorials (Play Tutorial, Assist Me) and documentation access

> Note: Validation happens when clicking "Next" during model creation. After saving, any validation errors will be visible in the `.model.json` editor.

## Node Types Reference

### Select Node

**Purpose:** Select the FROM model or source for your transformation

**Configuration:**

- Choose upstream model or source table
- This defines where your data comes from

**Use Cases:**

- Starting point for any model
- Selecting which model/source to transform

### Column Selection Node

**Purpose:** Bulk column selection from upstream models or sources

**Configuration:**

- Select which columns to include
- Use bulk selection types:
  - `all_from_model` - All columns from a model
  - `dims_from_model` - Only dimension columns
  - `fcts_from_model` - Only fact/metric columns
- Include/exclude specific columns

**Example from jaffle_shop:**

```json
{
  "type": "int_select_model",
  "from": {
    "model": "stg__sales__items__order_details"
  },
  "select": [
    {
      "type": "dims_from_model",
      "model": "stg__sales__items__order_details",
      "include": ["product_sku", "product_type", "item_id"]
    }
  ]
}
```

_From: [int\_\_products\_\_analytics\_\_product_popularity.model.json](examples/jaffle_shop/models/intermediate/products/analytics/int__products__analytics__product_popularity.model.json)_

### Column Configuration Node

**Purpose:** Configure individual column transformations and metadata

**Configuration:**

- Apply transformations (rename, cast, expressions)
- Set column descriptions
- Configure data types
- Add AI hints for Lightdash

**Use Cases:**

- Creating calculated columns
- Renaming columns
- Type casting
- Adding documentation

**Example from jaffle_shop:**

```json
{
  "name": "order_date",
  "expr": "DATE(CAST(ordered_at AS TIMESTAMP))",
  "type": "dim",
  "description": "Date when order was placed"
}
```

_From: [stg\_\_sales\_\_orders\_\_standardized.model.json](examples/jaffle_shop/models/staging/sales/orders/stg__sales__orders__standardized.model.json)_

### Join Node

**Purpose:** Join multiple models together

**Configuration:**

- Add models to join (2+ models)
- Configure join types (left, inner, right, full, cross)
- Define join conditions
- Select columns from each model
- Configure join order and tests

**Join Types:**

- **Left Join**: Keep all rows from primary model
- **Inner Join**: Only matching rows
- **Right Join**: Keep all rows from joined model
- **Full Outer Join**: All rows from both models
- **Cross Join**: Cartesian product

**Auto-Generated Tests:**

- `equal_row_count`: Validates row counts (inner joins)
- `equal_or_lower_row_count`: Validates row counts (left joins)

**Example from jaffle_shop:**

```json
{
  "type": "int_join_models",
  "from": {
    "model": "stg__sales__orders__standardized",
    "join": [
      {
        "model": "stg__customers__profiles__clean",
        "type": "left",
        "on": {
          "and": ["customer_id"]
        }
      },
      {
        "model": "stg__sales__stores__locations",
        "type": "left",
        "on": {
          "and": ["store_id"]
        }
      }
    ]
  },
  "select": [
    {
      "model": "stg__sales__orders__standardized",
      "type": "all_from_model"
    },
    {
      "type": "all_from_model",
      "model": "stg__customers__profiles__clean",
      "include": ["customer_name", "customer_first_name"]
    },
    {
      "type": "all_from_model",
      "model": "stg__sales__stores__locations",
      "include": ["store_name", "store_tax_rate"]
    }
  ]
}
```

_From: [int\_\_sales\_\_orders\_\_enriched.model.json](examples/jaffle_shop/models/intermediate/sales/orders/int__sales__orders__enriched.model.json)_

### Union Node

**Purpose:** Combine rows from multiple models with same schema

**Configuration:**

- Add models to union (2+ models)
- Configure column mapping
- Handle schema differences
- Order models

**Use Cases:**

- Combining regional tables
- Merging historical and current data
- Consolidating similar datasets

**Example from jaffle_shop:**

```json
{
  "type": "int_union_models",
  "from": {
    "model": "int__sales__orders__enriched",
    "union": {
      "type": "all",
      "models": ["int__sales__orders__enriched"]
    }
  },
  "select": [
    {
      "type": "all_from_model",
      "model": "int__sales__orders__enriched"
    },
    {
      "name": "region",
      "expr": "CASE WHEN store_name IN ('Philadelphia', 'Brooklyn') THEN 'East Coast' WHEN store_name IN ('San Francisco', 'Los Angeles') THEN 'West Coast' ELSE 'Other' END",
      "type": "dim",
      "description": "Geographic region classification"
    }
  ]
}
```

_From: [int\_\_sales\_\_orders\_\_regional_combined.model.json](examples/jaffle_shop/models/intermediate/sales/orders/int__sales__orders__regional_combined.model.json)_

### Rollup Node

**Purpose:** Roll up time-series data to higher time intervals

**Configuration:**

- Select time column
- Choose rollup interval (daily, weekly, monthly, quarterly, yearly)
- Configure aggregations for each column

**Example from jaffle_shop:**

```json
{
  "type": "int_rollup_model",
  "from": {
    "model": "int__sales__orders__enriched",
    "rollup": {
      "datetime_expr": "order_date",
      "interval": "month"
    }
  }
}
```

_From: [int\_\_sales\_\_analytics\_\_monthly_revenue.model.json](examples/jaffle_shop/models/intermediate/sales/analytics/int__sales__analytics__monthly_revenue.model.json)_

This rolls up daily order data to monthly totals, perfect for time-series analysis.

### Lookback Node

**Purpose:** Analyze trailing time windows

**Configuration:**

- Select time column
- Define lookback period (7 days, 30 days, 90 days, etc.)
- Configure aggregations
- Set partition columns (optional)

**Example from jaffle_shop:**

```json
{
  "type": "int_lookback_model",
  "from": {
    "model": "int__sales__orders__enriched",
    "lookback": {
      "days": 30
    }
  },
  "select": [
    "store_id",
    "store_name",
    "order_date",
    {
      "model": "int__sales__orders__enriched",
      "name": "order_total_dollars",
      "aggs": ["sum", "min", "max"],
      "type": "fct",
      "description": "Revenue metrics for the last 30 days (sum, min, max)"
    },
    {
      "model": "int__sales__orders__enriched",
      "name": "order_id",
      "agg": "count",
      "type": "fct",
      "description": "Number of orders in the last 30 days"
    }
  ],
  "group_by": ["store_id", "store_name", "order_date"]
}
```

_From: [int\_\_sales\_\_analytics\_\_rolling_30day.model.json](examples/jaffle_shop/models/intermediate/sales/analytics/int__sales__analytics__rolling_30day.model.json)_

This calculates 30-day rolling metrics partitioned by store for trend analysis.

### GroupBy Node

**Purpose:** Add GROUP BY clause and aggregations

**Configuration:**

- Select grouping columns
- Configure aggregations
- Add HAVING clause (optional)

**Use Cases:**

- Customer-level aggregations
- Product summaries
- Time-based rollups

**Example - GROUP BY is implicit from dimensions:**

When you select dimension columns and add aggregated fact columns, the GROUP BY clause is automatically generated based on the dimensions.

```json
{
  "type": "int_select_model",
  "from": {
    "model": "stg__sales__items__order_details"
  },
  "select": [
    {
      "type": "dims_from_model",
      "model": "stg__sales__items__order_details",
      "include": ["product_sku", "product_type", "item_id"]
    },
    {
      "name": "total_orders",
      "expr": "COUNT(DISTINCT order_id)",
      "type": "fct",
      "description": "Number of unique orders containing this product"
    }
  ]
}
```

This groups by `product_sku`, `product_type`, and `item_id` automatically.

_From: [int\_\_products\_\_analytics\_\_product_popularity.model.json](examples/jaffle_shop/models/intermediate/products/analytics/int__products__analytics__product_popularity.model.json)_

### Where Node

**Purpose:** Filter rows with WHERE clause

**Configuration:**

- Build filter conditions
- Combine with AND/OR
- Use comparison operators
- Reference columns and values

**Examples:**

- `status = 'completed'`
- `order_date >= '2024-01-01'`
- `amount > 100 AND region = 'US'`

### Lightdash Node

**Purpose:** Configure Lightdash metrics and dimensions

**Configuration:**

- Define metrics (counts, sums, averages)
- Configure dimensions
- Set AI hints for semantic layer
- Configure metric merges

**Example from jaffle_shop_lightdash:**

```json
{
  "name": "total_revenue_dollars",
  "expr": "SUM(order_total_dollars)",
  "type": "fct",
  "description": "Total revenue in dollars",
  "lightdash": {
    "metrics": [
      {
        "name": "metric_aggregated_revenue",
        "type": "sum",
        "group_label": "Profitability Metrics",
        "label": "Aggregated Revenue",
        "ai_hint": "Use this for store-level or time-based revenue aggregation and profitability analysis"
      }
    ]
  }
}
```

_From: [mart\_\_sales\_\_reporting\_\_profitability.model.json](examples/jaffle_shop_lightdash/models/marts/sales/reporting/mart__sales__reporting__profitability.model.json)_

See [Lightdash Integration](integrations/lightdash-integration.md) for complete Lightdash configuration examples.

## Visual Editor Workflows

### Creating a Join Model

<video width="100%" controls>
  <source src="https://github.com/Workday/dj/raw/main/assets/videos/visual-editor-join-workflow.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

> Complete workflow: creating a join model with Select and Join nodes

**Steps:**

1. **Add Primary Model**

   - Click to add Select node
   - Choose base model (e.g., `stg__sales__orders__standardized`)
   - Select columns to include

2. **Add Joined Models**

   - Click to add Join node
   - Connect to Select node
   - Configure join type (left, inner, etc.)
   - Define join conditions (`customer_id`, `store_id`)
   - Select columns from joined model

3. **Add Filters (Optional)**

   - Click to add Where node
   - Define filter conditions

4. **Configure Output**

   - Click to add Column Configuration node
   - Set descriptions and metadata

5. **Save and Generate**
   - Click "Next" through wizard steps
   - Review generated SQL, YAML, and JSON in preview panel
   - Click "Create Model" or "Update Model" to finalize
   - Compile with dbt

**Result:** Creates an enriched orders model like [int\_\_sales\_\_orders\_\_enriched.model.json](examples/jaffle_shop/models/intermediate/sales/orders/int__sales__orders__enriched.model.json)

### Creating Time-Series Analysis Models

DJ supports two types of time-series analysis models: **Rollup** and **Lookback**. These are separate model types that serve different analytical purposes.

#### Example: Rollup Model (Time Bucketing)

<video width="100%" controls>
  <source src="https://github.com/Workday/dj/raw/main/assets/videos/visual-editor-timeseries-workflow.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

> Complete workflow: creating a Rollup model for monthly time-series aggregation

**Steps:**

1. **Create New Model**

   - Run `DJ: Create Model` from Command Palette
   - Model Type: Select **`Rollup`**
   - Group: `sales`, Topic: `analytics`, Name: `monthly_revenue`
   - Click "Next"

2. **Configure Rollup**

   - From Model: Choose `int__sales__orders__enriched`
   - Time Interval: Select `month`
   - Datetime Column: `order_date`

3. **Select Columns and Aggregations**

   - Select columns to include in the rollup
   - Configure aggregations (sum, count, avg) for metrics
   - The model automatically groups by the time interval

4. **Preview and Create**
   - Review generated SQL with `DATE_TRUNC` for time bucketing
   - Click "Create Model"

**Result:** Creates [int\_\_sales\_\_analytics\_\_monthly_revenue.model.json](examples/jaffle_shop/models/intermediate/sales/analytics/int__sales__analytics__monthly_revenue.model.json) with monthly aggregated data.

#### Example: Lookback Model (Rolling Window Analysis)

**Steps:**

1. **Create New Model**

   - Run `DJ: Create Model` from Command Palette
   - Model Type: Select **`Lookback`**
   - Group: `sales`, Topic: `analytics`, Name: `rolling_30day`
   - Click "Next"

2. **Configure Base Model**

   - From Model: Choose `int__sales__orders__enriched`
   - Lookback Period: Set to `30` days

3. **Select Columns with Aggregations**

   - Select `order_total_dollars` (or `amount`)
     - Enable aggregations: `sum`, `min`, `max`
   - Select `order_id`
     - Enable aggregation: `count`

4. **Set Group By**

   - Add columns: `store_id`, `store_name`, `order_date`
   - These define the window partitioning

5. **Preview and Create**
   - Review generated SQL with window functions (`OVER`, `PARTITION BY`, `ROWS BETWEEN`)
   - Click "Create Model"

**Result:** Creates [int\_\_sales\_\_analytics\_\_rolling_30day.model.json](examples/jaffle_shop/models/intermediate/sales/analytics/int__sales__analytics__rolling_30day.model.json) with rolling 30-day window aggregations.

**Key Differences:**

| Feature                | Rollup Model                                 | Lookback Model                                     |
| ---------------------- | -------------------------------------------- | -------------------------------------------------- |
| **Purpose**            | Time bucketing (monthly, daily aggregations) | Rolling window analysis (trailing N days)          |
| **Use Case**           | Monthly reports, period comparisons          | Trend analysis, moving averages                    |
| **Output Granularity** | One row per time bucket                      | Maintains original granularity with window metrics |

## Visual Editor vs Direct JSON Editing

Both approaches work with the same `.model.json` files - you can switch between them at any time!

| Aspect              | Visual Editor                 | JSON Editing                       |
| ------------------- | ----------------------------- | ---------------------------------- |
| **Learning Curve**  | Gentler, guided by UI         | Steeper, requires schema knowledge |
| **Speed**           | Faster for complex joins      | Faster for simple models           |
| **Precision**       | Visual relationships          | Direct control                     |
| **Version Control** | Same JSON output              | Native                             |
| **Accessibility**   | Available to all team members | Available to all team members      |

**Key Points:**

- Both work with the same `.model.json` files
- Changes in one are immediately reflected in the other
- Team members can choose their preferred method
- No lock-in - switch anytime based on the task
- Generate identical SQL and YAML
- Support all 11 model types

## Troubleshooting

### Node Configuration Missing

- Ensure upstream model exists and is compiled
- Check dbt manifest is up to date: Reload the extension or restart VS Code
- Verify model dependencies in Project Navigator

## Best Practices

1. **Start Simple**: Begin with Select node, add complexity gradually
2. **Use Preview Panel**: Toggle "Show preview" to view generated SQL, YAML, and JSON as you work
3. **Review Errors**: After creating/updating the model, check the `.model.json` editor for any validation errors
4. **Organize Visually**: The auto-layout shows logical flow of your data transformations
5. **Document Intent**: Add descriptions in Column Configuration node
6. **Test Changes**: Compile model after significant changes
7. **Switch Views**: Use both visual editor and JSON editing based on the task

## Next Steps

- [Complete Tutorial](TUTORIAL.md) - Build models step-by-step
- [Model Types Reference](models/README.md) - Understand all 11 model types
- [Lineage Visualization](LINEAGE.md) - Explore model dependencies
