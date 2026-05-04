# dbt Model Types Documentation

As models in dbt are intended to be reusable building blocks, instead of performing many different types of transformation in single SQL statements (e.g. nested joins and aggregations), each model in DJ is assigned a single type key which describes the primary operation it performs. This was, if two different downstream models need the same tranformation (e.g. an hourly aggregation), they can simply select from that aggregation building block.

Table of Contents

1. [Overview](#overview)
2. [Model Types](#model-types)
3. [Model Folder Structure](#model-folder-structure)
4. [Quick Start Guide](#quick-start-guide)
5. [Jaffle Shop Data Dictionary](#jaffle-shop-data-dictionary)
6. [Schema Validation](#schema-validation)
7. [Common Patterns](#common-patterns)
8. [Getting Help](#getting-help)
9. [Advanced Topics](#advanced-topics)
10. [Working Example Project](#working-example-project)

## Overview

This comprehensive documentation covers all 11 supported dbt model types with real-world examples using jaffle shop data. Each model type serves a specific purpose in the data pipeline, from initial data ingestion through final analytics-ready datasets.

All examples are validated against their corresponding JSON schemas and use consistent jaffle shop business scenarios to demonstrate practical applications.

## Model Types

### Staging Models (Data Ingestion & Initial Processing)

Staging models handle the initial ingestion and basic transformation of raw data sources.

- **[stg_select_source](01%20-%20stg_select_source.md)** - Source data ingestion and initial transformations

  - _Purpose_: Clean and standardize data directly from sources
  - _Use Case_: Converting raw customer data into standardized format
  - _Key Features_: Column selection, type conversion, basic transformations

- **[stg_union_sources](02%20-%20stg_union_sources.md)** - Multi-source data consolidation

  - _Purpose_: Combine similar data from multiple sources
  - _Use Case_: Unioning order data from different store systems
  - _Key Features_: Source consolidation, schema alignment, data lineage

- **[stg_select_model](03%20-%20stg_select_model.md)** - Staging model refinements
  - _Purpose_: Further refine and transform staging data
  - _Use Case_: Adding business logic to already-staged data
  - _Key Features_: Model-based selection, additional transformations

### Intermediate Models (Business Logic & Data Processing)

Intermediate models implement business logic, perform aggregations, and create enriched datasets.

- **[int_select_model](04%20-%20int_select_model.md)** - Aggregations and business logic

  - _Purpose_: Perform aggregations and implement business rules
  - _Use Case_: Customer order summaries with metrics
  - _Key Features_: Aggregations, grouping, filtering, business calculations

- **[int_join_models](05%20-%20int_join_models.md)** - Multi-model joins for data enrichment

  - _Purpose_: Combine data from multiple models through joins
  - _Use Case_: Orders enriched with customer and product information
  - _Key Features_: Multiple join types, complex relationships, data enrichment

- **[int_join_column](06%20-%20int_join_column.md)** - Column unnesting and normalization

  - _Purpose_: Unnest arrays and flatten complex data structures
  - _Use Case_: Product tags analysis from array columns
  - _Key Features_: Cross join unnest, data normalization, semi-structured data

- **[int_union_models](07%20-%20int_union_models.md)** - Model consolidation

  - _Purpose_: Combine processed data from multiple intermediate models
  - _Use Case_: Consolidating feedback from surveys, reviews, and support
  - _Key Features_: Model unioning, data standardization, multi-source integration

- **[int_lookback_model](08%20-%20int_lookback_model.md)** - Time-based trailing analysis

  - _Purpose_: Calculate metrics over trailing time periods
  - _Use Case_: 30-day customer behavior trends
  - _Key Features_: Rolling windows, time-based aggregations, trend analysis

- **[int_rollup_model](09%20-%20int_rollup_model.md)** - Time-based aggregations
  - _Purpose_: Roll up granular data to higher time intervals
  - _Use Case_: Daily sales rollups from hourly transaction data
  - _Key Features_: Time interval grouping, automatic aggregation, performance optimization

### Mart Models (Analytics-Ready Presentation Layer)

Mart models provide the final, business-ready datasets optimized for reporting and analytics.

- **[mart_select_model](10%20-%20mart_select_model.md)** - Business intelligence datasets

  - _Purpose_: Create analytics-ready datasets for BI tools
  - _Use Case_: Customer analytics dashboard with business-friendly metrics
  - _Key Features_: Business-friendly naming, unit conversion, executive metrics

- **[mart_join_models](11%20-%20mart_join_models.md)** - Comprehensive 360-degree views
  - _Purpose_: Create sophisticated datasets by joining multiple intermediate models
  - _Use Case_: Complete customer 360 view with orders, behavior, and preferences
  - _Key Features_: Multi-model joins, executive reporting, comprehensive business intelligence

## Model Folder Structure

### Naming Convention

**Pattern**: `<layer>__<dbt_group>__<model_topic>__<model_name>`

**Examples**:

- `stg__customers__profiles__clean`
- `stg__sales__orders__standardized`
- `int__customers__profiles__summary`
- `int__sales__orders__enriched`
- `mart__customers__dashboard__analytics`
- `mart__analytics__dashboard__comprehensive_analytics`

### Directory Organization

DJ automatically organizes your models into a logical folder structure:

```text
models/
├── staging/
│   ├── customers/
│   │   └── profiles/
│   │       └── stg__customers__profiles__clean.sql
│   ├── sales/
│   │   ├── orders/
│   │   │   └── stg__sales__orders__standardized.sql
│   │   ├── items/
│   │   │   └── stg__sales__items__order_details.sql
│   │   └── stores/
│   │       └── stg__sales__stores__locations.sql
│   ├── products/
│   │   └── catalog/
│   │       └── stg__products__catalog__catalog.sql
│   └── supply_chain/
│       └── supplies/
│           └── stg__supply_chain__supplies__inventory.sql
├── intermediate/
│   ├── customers/
│   │   └── profiles/
│   │       └── int__customers__profiles__summary.sql
│   ├── sales/
│   │   └── orders/
│   │       └── int__sales__orders__enriched.sql
│   ├── products/
│   │   └── analytics/
│   │       └── int__products__analytics__product_popularity.sql
│   └── supply_chain/
│       └── supplies/
│           └── int__supply_chain__supplies__cost_analysis.sql
└── marts/
    ├── customers/
    │   └── dashboard/
    │       └── mart__customers__dashboard__analytics.sql
    ├── sales/
    │   └── reporting/
    │       ├── mart__sales__reporting__revenue.sql
    │       └── mart__sales__reporting__profitability.sql
    ├── products/
    │   └── reporting/
    │       ├── mart__products__reporting__menu_analytics.sql
    │       └── mart__products__reporting__cost_efficiency.sql
    └── analytics/
        └── dashboard/
            └── mart__analytics__dashboard__comprehensive_analytics.sql
```

### Automatic File Management

- **Smart Placement**: DJ places models in appropriate folders based on their type and configuration
- **Auto-Migration**: When you update model configurations, DJ automatically moves files to maintain organization
- **Consistent Structure**: Maintains standardized folder hierarchy across your entire project

## Quick Start Guide

### 1. Choose Your Model Type

**For Raw Data Ingestion:**

- `stg_select_source` - Clean and standardize data from a single source
- `stg_union_sources` - Combine similar data from multiple sources
- `stg_select_model` - Refine already-staged data with additional transformations

**For Business Logic & Processing:**

- `int_select_model` - Perform aggregations and implement business rules
- `int_join_models` - Enrich data by joining multiple models
- `int_join_column` - Unnest arrays and flatten complex structures
- `int_union_models` - Consolidate data from multiple intermediate models
- `int_lookback_model` - Calculate metrics over trailing time periods
- `int_rollup_model` - Roll up granular data to higher time intervals

**For Analytics & Reporting:**

- `mart_select_model` - Create business-friendly datasets for BI tools
- `mart_join_models` - Build comprehensive 360-degree business views

### 2. Follow the Data Pipeline Flow

```text
Raw Sources → Staging Models → Intermediate Models → Mart Models → BI Tools
     ↓              ↓                    ↓                ↓           ↓
  Raw CSV      Clean & Prep        Business Logic    Analytics    Dashboards
  Database     Standardize         Aggregations      Ready Data   Reports
  APIs         Type Casting        Joins & Unions    Metrics      Analysis
```

**Common Pipeline Patterns:**

**Simple Pipeline:**

1. `stg_select_source` → Clean raw customer data
2. `int_select_model` → Calculate customer metrics
3. `mart_select_model` → Create customer analytics dataset

**Complex Pipeline:**

1. `stg_union_sources` → Combine order data from multiple stores
2. `int_join_models` → Enrich orders with customer & product data
3. `int_rollup_model` → Create daily sales summaries
4. `mart_join_models` → Build comprehensive sales analytics

### 3. Use Consistent Naming

**Naming Components:**

| Component | Purpose           | Examples                                                                                 |
| --------- | ----------------- | ---------------------------------------------------------------------------------------- |
| **Layer** | Model type prefix | `stg`, `int`, `mart`                                                                     |
| **Group** | Business domain   | `customers`, `sales`, `products`, `supply_chain`, `analytics`                            |
| **Topic** | Data subject area | `profiles`, `orders`, `items`, `stores`, `catalog`, `supplies`, `dashboard`, `reporting` |
| **Name**  | Specific purpose  | `clean`, `standardized`, `summary`, `enriched`, `analytics`, `comprehensive_analytics`   |

**Real Examples:**

- `stg__customers__profiles__clean` - Clean raw customer profile data
- `stg__sales__orders__standardized` - Standardized order data from raw sources
- `int__customers__profiles__summary` - Customer profile summaries with business logic
- `int__sales__orders__enriched` - Orders enriched with customer and store data
- `mart__customers__dashboard__analytics` - Customer analytics for dashboards
- `mart__analytics__dashboard__comprehensive_analytics` - Comprehensive business analytics

**Best Practices:**

- ✅ Use descriptive, business-friendly names
- ✅ Follow the `layer__group__topic__name` pattern consistently
- ✅ Keep names concise but meaningful
- ❌ Avoid abbreviations that aren't universally understood
- ❌ Don't use special characters or spaces

## Jaffle Shop Data Dictionary

Our examples use consistent test data representing a fictional Jaffle shop chain with the following data structure:

### Data Tables

#### raw_stores

Store locations across major US cities with tax rates and opening dates.

| Column      | Type      | Description                   |
| ----------- | --------- | ----------------------------- |
| `id`        | UUID      | Unique store identifier       |
| `name`      | String    | Store location city name      |
| `opened_at` | Timestamp | Store opening date (ISO 8601) |
| `tax_rate`  | Decimal   | Local tax rate (0.04 to 0.08) |

**Sample Stores:**

- **Philadelphia**: Opened 2016-09-01, 6% tax rate
- **Brooklyn**: Opened 2017-03-12, 4% tax rate
- **Chicago**: Opened 2018-04-29, 6.25% tax rate
- **San Francisco**: Opened 2018-05-09, 7.5% tax rate
- **New Orleans**: Opened 2019-03-10, 4% tax rate
- **Los Angeles**: Opened 2019-09-13, 8% tax rate

#### raw_customers

Customer profiles with UUID identifiers and names.

| Column | Type   | Description                |
| ------ | ------ | -------------------------- |
| `id`   | UUID   | Unique customer identifier |
| `name` | String | Customer full name         |

**Sample Customers:** Misty Reed, Brandon Hill, Brad Williamson, Andrea Moore, Wyatt Bates, Adam Rowe, Nicole Hall, Jeffrey Gutierrez, John Bennett, and 928 others.

#### raw_orders

Order transactions linking customers to stores with financial details.

| Column        | Type      | Description                     |
| ------------- | --------- | ------------------------------- |
| `id`          | UUID      | Unique order identifier         |
| `customer`    | UUID      | Foreign key to raw_customers.id |
| `ordered_at`  | Timestamp | Order timestamp (ISO 8601)      |
| `store_id`    | UUID      | Foreign key to raw_stores.id    |
| `subtotal`    | Integer   | Subtotal in cents               |
| `tax_paid`    | Integer   | Tax amount in cents             |
| `order_total` | Integer   | Total order amount in cents     |

#### raw_items

Individual line items for each order, linking to products.

| Column     | Type   | Description                      |
| ---------- | ------ | -------------------------------- |
| `id`       | UUID   | Unique line item identifier      |
| `order_id` | UUID   | Foreign key to raw_orders.id     |
| `sku`      | String | Product SKU (JAF-xxx or BEV-xxx) |

#### raw_products

Complete product catalog with pricing and descriptions.

| Column        | Type    | Description                           |
| ------------- | ------- | ------------------------------------- |
| `sku`         | String  | Product SKU identifier                |
| `name`        | String  | Product display name                  |
| `type`        | String  | Product category (jaffle or beverage) |
| `price`       | Integer | Product price in cents                |
| `description` | String  | Product description                   |

**Jaffle Products:**

- **JAF-001**: "nutellaphone who dis?" - $11.00 - Nutella and banana jaffle
- **JAF-002**: "doctor stew" - $11.00 - House-made beef stew jaffle
- **JAF-003**: "the krautback" - $12.00 - Lamb and pork bratwurst with sauerkraut
- **JAF-004**: "flame impala" - $14.00 - Pulled pork and pineapple with ghost pepper sauce
- **JAF-005**: "mel-bun" - $12.00 - Melon and minced beef bao in a jaffle

**Beverage Products:**

- **BEV-001**: "tangaroo" - $6.00 - Mango and tangerine smoothie
- **BEV-002**: "chai and mighty" - $5.00 - Oatmilk chai latte with protein boost
- **BEV-003**: "vanilla ice" - $6.00 - Iced coffee with french vanilla syrup
- **BEV-004**: "for richer or pourover" - $7.00 - Single estate beans pourover
- **BEV-005**: "adele-ade" - $4.00 - Kiwi and lime agua fresca

#### raw_supplies

Supply chain data linking ingredients and supplies to products.

| Column       | Type    | Description                      |
| ------------ | ------- | -------------------------------- |
| `id`         | String  | Supply item identifier (SUP-xxx) |
| `name`       | String  | Supply item name                 |
| `cost`       | Integer | Supply cost in cents             |
| `perishable` | Boolean | Whether item is perishable       |
| `sku`        | String  | Associated product SKU           |

### Business Metrics

- **Revenue**: All monetary values tracked in cents for precision, converted to dollars in marts
- **Dates**: Consistent ISO 8601 format (YYYY-MM-DDTHH:MM:SS)
- **Categories**: Products categorized as "jaffle" or "beverage"
- **Identifiers**: All primary keys use UUID format for realistic data modeling
- **Supply Chain**: Complete ingredient tracking from raw supplies to finished products

## Schema Validation

All configuration examples in this documentation are validated against their corresponding JSON schemas located in `/schemas/`. This ensures:

- **Technical Accuracy**: Every example can be used directly
- **Schema Compliance**: All required fields and constraints are met
- **Best Practices**: Examples follow recommended patterns

## Common Patterns

### Data Pipeline Stages

1. **Staging**: Clean, standardize, and prepare raw data
2. **Intermediate**: Apply business logic, perform joins and aggregations
3. **Mart**: Create analytics-ready, business-friendly datasets

### Model Selection Decision Tree

```text
Need to process raw sources? → Use stg_* models
Need business logic/aggregations? → Use int_* models
Need analytics-ready data? → Use mart_* models

Multiple sources to combine? → Use *_union_* models
Need to join related data? → Use *_join_* models
Need time-based analysis? → Use int_lookback_model or int_rollup_model
```

### Configuration Best Practices

- **Always specify `type`**: Identifies the model type
- **Use descriptive `name`**: Clear, business-oriented naming
- **Organize with `group` and `topic`**: Logical categorization
- **Document with `description`**: Business context and purpose

## Getting Help

1. **Check the specific model documentation** for detailed examples
2. **Validate against schemas** in `/schemas/` directory
3. **Review jaffle shop examples** for consistent patterns
4. **Test with sample data** before production deployment

## Advanced Topics

### Inline CTEs and Pre-Aggregation

See **[CTE Patterns](CTE_PATTERNS.md)** for conventions around inline CTEs
(`ctes` array), where Lightdash metrics belong when pre-aggregating in a CTE,
and the aggregation / auto-injection rules the framework enforces across the
CTE boundary.

### Model Dependencies

Understanding the relationship between model types:

- **Staging models** feed **intermediate models**
- **Intermediate models** feed **mart models**
- **Mart models** feed **BI tools and dashboards**

### Performance Optimization

- **Materialization**: Choose appropriate strategy for data volume
- **Incremental Processing**: Use for large, time-based datasets
- **Join Optimization**: Order joins by data volume (smallest first)
- **Aggregation Strategy**: Pre-aggregate in intermediate models

### Incremental Strategies (dbt-trino)

Set `materialization.strategy.type` to one of the following (or rely on the extension default via `dj.materialization.defaultIncrementalStrategy`):

| Strategy | Summary | Caveat |
| -------- | ------- | ------ |
| `append` | Inserts new rows with no de-duplication. Fastest. | Upstream must guarantee no duplicates in the new slice. |
| `delete+insert` | Partition-safe upsert. Safe default. | `unique_key` auto-derived from partition columns when omitted. Works on Delta Lake, Hive, and Iceberg. |
| `merge` | Row-level upsert on `unique_key`. | **dbt-trino requires Iceberg format** on the target table. On Delta Lake / Hive use `delete+insert` instead. |
| `overwrite_existing_partitions` | Drops and rewrites only the partitions present in the new slice. | **Requires a custom dbt macro in your project** (e.g. `get_incremental_overwrite_existing_partitions_sql`). The DJ extension does NOT ship this macro and dbt-trino does NOT provide it natively. If your project does not define it, use `delete+insert` with a partition column as `unique_key` \u2014 it produces equivalent behavior for daily/monthly partitioned models. |

### Data Quality

- **Validation**: Implement data quality checks at each stage
- **Testing**: Use dbt tests for critical business logic
- **Monitoring**: Track data freshness and completeness
- **Documentation**: Maintain clear business definitions

## Working Example Project

**Want to see these model types in action?** Check out the **[Jaffle Shop Example Project](../examples/jaffle_shop/README.md)** which demonstrates working models across a realistic business scenario.

---

_This documentation provides comprehensive coverage of all dbt model types supported by the DJ extension. Each model type includes detailed examples, best practices, and integration guidance to help you build effective data pipelines._
