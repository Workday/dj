# Example Project: Jaffle Shop Analytics

Welcome to the DJ example project! This is a complete dbt implementation using the popular Jaffle Shop dataset, showcasing real-world data modeling patterns and DJ's JSON-first approach.

## Ready to Learn?

**[Start the Tutorial](../../TUTORIAL.md)** - Build your first models step-by-step with this project

## What This Example Demonstrates

This project showcases a complete analytics pipeline with:

- **6 CSV datasets** from the Jaffle Shop (customers, orders, products, stores, items, supplies)
- **5 business groups** reflecting real-world data team organization
- **Real-world patterns** for data cleaning, joins, aggregations, and business logic
- **16 working models** across 3 layers (staging → intermediate → marts)
- **4 core DJ model types** with practical examples

## Project Structure

```text
docs/examples/jaffle_shop/    # You are here!
├── ../../TUTORIAL.md                   # Step-by-step learning guide
├── dbt_project.yml                     # dbt project configuration
├── profiles.yml                        # Trino connection settings
├── models/                             # All dbt models (16 total)
│   ├── groups.yml                      # Business group definitions
│   ├── sources/development/            # Raw data source definitions
│   ├── staging/                        # Clean & standardize (6 models)
│   ├── intermediate/                   # Business logic (4 models)
│   └── marts/                          # Analytics ready (6 models)
└── seeds/                              # Sample CSV data (6 files)
    ├── raw_customers.csv
    ├── raw_orders.csv
    ├── raw_items.csv
    ├── raw_products.csv
    ├── raw_stores.csv
    └── raw_supplies.csv
```

## Data Pipeline Flow

**Naming Convention**: `<layer>__<dbt_group>__<model_topic>__<model_name>`

```text
Raw Data (6 CSV files)
    ↓
Staging Models (6 models - Clean & Standardize)
    ├── stg__customers__profiles__clean      → Customer data with name parsing
    ├── stg__sales__orders__standardized     → Order data with date standardization
    ├── stg__sales__items__order_details     → Order item details with product info
    ├── stg__sales__stores__locations        → Store location data with tax rates
    ├── stg__products__catalog__catalog      → Product catalog with price conversions
    └── stg__supply_chain__supplies__inventory → Supply inventory with cost analysis
         ↓
Intermediate Models (4 models - Business Logic)
    ├── int__customers__profiles__summary    → Customer segmentation & metrics
    ├── int__sales__orders__enriched         → Orders joined with customer & store data
    ├── int__products__analytics__product_popularity → Product performance analysis
    └── int__supply_chain__supplies__cost_analysis  → Supply cost & efficiency metrics
         ↓
Mart Models (6 models - Analytics Ready)
    ├── mart__customers__dashboard__analytics        → Customer 360° view & segments
    ├── mart__sales__reporting__revenue              → Revenue reporting with time dimensions
    ├── mart__sales__reporting__profitability        → Store profitability analysis
    ├── mart__products__reporting__menu_analytics    → Menu performance & rankings
    ├── mart__products__reporting__cost_efficiency   → Supply cost efficiency analysis
    └── mart__analytics__dashboard__comprehensive_analytics → Cross-functional BI dashboard
```

## Complete Model Reference

This project demonstrates **4 core DJ model types** with **16 working models** across **5 business groups**, using **6 CSV datasets** (customers, orders, items, products, stores, supplies):

### **Sales Group** (6 models total)

**Purpose**: Order processing, revenue tracking, and profitability analysis

- **Staging**: `stg__sales__orders__standardized`, `stg__sales__items__order_details`, `stg__sales__stores__locations`
- **Intermediate**: `int__sales__orders__enriched`
- **Mart**: `mart__sales__reporting__revenue`, `mart__sales__reporting__profitability`

### **Products Group** (4 models total)

**Purpose**: Menu optimization, product performance, and cost efficiency

- **Staging**: `stg__products__catalog__catalog`
- **Intermediate**: `int__products__analytics__product_popularity`
- **Mart**: `mart__products__reporting__menu_analytics`, `mart__products__reporting__cost_efficiency`

### **Customers Group** (3 models total)

**Purpose**: Customer behavior analysis and segmentation

- **Staging**: `stg__customers__profiles__clean`
- **Intermediate**: `int__customers__profiles__summary`
- **Mart**: `mart__customers__dashboard__analytics`

### **Supply Chain Group** (2 models total)

**Purpose**: Inventory management and supplier performance

- **Staging**: `stg__supply_chain__supplies__inventory`
- **Intermediate**: `int__supply_chain__supplies__cost_analysis`

### **Analytics Group** (1 model total)

**Purpose**: Cross-functional business intelligence

- **Mart**: `mart__analytics__dashboard__comprehensive_analytics`

## Model Types Demonstrated

### Staging Layer

- **`stg_select_source`** (6 models) - Clean and standardize raw data from all source systems

### Intermediate Layer

- **`int_select_model`** (2 models) - Business logic and aggregations
- **`int_join_models`** (2 models) - Multi-model joins for data enrichment

### Mart Layer

- **`mart_select_model`** (5 models) - Analytics-ready datasets for reporting
- **`mart_join_models`** (1 model) - Comprehensive 360-degree business views

## Running the Models

### Prerequisites

This project uses a `development` catalog in Trino. Make sure it's configured before running. See the [Trino Local Setup Guide](../../setup/trino-local-setup.md) for detailed instructions.

### Commands

```bash
# Run all models
dbt run

# Run by layer
dbt run --select models/staging
dbt run --select models/intermediate
dbt run --select models/marts

# Run by group
dbt run --select group:sales
dbt run --select group:products
dbt run --select group:customers
dbt run --select group:supply_chain
dbt run --select group:analytics

# Run specific models
dbt run --select stg__sales__orders__standardized
dbt run --select mart__sales__reporting__revenue

# Development commands
dbt parse                         # Validate models
```

## What's Next?

### **New to DJ?**

**[Setup Guide](../../setup/setup.md)** - Install the extension and configure Trino
**[Start the Tutorial](../../TUTORIAL.md)** - Learn by building models with this project

### **Want to Understand Model Types?**

**[Model Types Reference](../models/README.md)** - Complete guide to all 11 model types

### **Ready to Build Your Own Project?**

Use this example as a template and adapt the patterns to your own data and business logic.

---

**Let's build something amazing!** → [Start Tutorial](../../TUTORIAL.md) | **Questions?** → [Model Reference](../models/README.md)
