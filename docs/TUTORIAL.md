# Tutorial: Your First dbt Models with DJ

Learn to build dbt models using DJ's JSON-first approach in just 15 minutes. We'll use the included jaffle shop example project to create your first staging, intermediate, and mart models.

## What You'll Build

A simple customer analytics pipeline:

```text
Raw Customer Data → Clean Data → Customer Metrics → Analytics Dashboard
```

**Prerequisites**: Complete the [Setup Guide](setup/setup.md) first.

## Tutorial Modes

DJ offers two ways to experience this tutorial, both accessible from within the Model Create wizard:

### Play Tutorial (Recommended for First-Time Users)

Interactive guided mode that walks you through creating specific model types:

1. Open the Model Create wizard (`DJ: Create Model` from Command Palette, or "Create Model" in Actions tree view)
2. Click the help icon (?) in the wizard header
3. Select **"Play Tutorial"**
4. Choose a tutorial: Select, Join, Union, Rollup, or Lookback
5. Follow on-screen prompts and highlights
6. Tutorial automatically fills in example data and advances through steps

<video width="100%" controls>
  <source src="https://github.com/Workday/dj/raw/main/assets/videos/tutorial-modes.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

> Demonstrating the "Play Tutorial" mode: accessing the tutorial, selecting a model type, and watching the guided walkthrough

**Benefits:**

- Pre-filled example data for each model type
- Step-by-step guided walkthrough
- Automatic navigation through wizard steps
- Highlighted UI elements
- No risk of getting lost

### Assist Me Mode

Contextual help while you work on any model:

1. Open the Model Create wizard
2. Click the help icon (?) in the wizard header
3. Select **"Assist Me"** to toggle on
4. Work at your own pace following this guide
5. Get contextual hints and guidance for each step
6. Access on-demand help for complex features

**Benefits:**

- Work at your own pace
- Non-intrusive contextual guidance
- Builds muscle memory
- Easy to experiment
- Toggle on/off as needed

### Manual Mode

Follow this guide without interactive assistance (current experience).

---

## Step 1: Set Up the Example Project

Let's start with the example project that has all the jaffle shop data ready.

1. **Navigate to the example project**:

```bash
cd docs/examples/jaffle_shop/
# This folder contains everything you need
```

2. **Install python dependencies**:

Create a virtual environment and install the dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

3. **Check the seed data**:

   - Look in `seeds/` folder - you'll see CSV files with customer, order, and product data
   - This is the jaffle shop dataset that all our documentation examples use

4. **Set up dbt with Trino connection**:

```bash
dbt deps
dbt seed
```

5. **Generate manifest.json** (required for the extension):

```bash
dbt parse
```

This creates `target/manifest.json` that the DJ (Data JSON) Framework needs to provide IntelliSense and validation.

Now you have real data and the extension is ready to work!

## Step 2: Create Sources for Raw Data

Before creating models, we need to define sources for our raw data.

1. **Use the DJ (Data JSON) Framework extension** to create sources incrementally:

   - Look for the DJ (Data JSON) Framework extension panel in the sidebar and click on it.
   - Under "Actions", click on "Create Source".
   - In the extension UI, fill the form:
     - **Select Project**: `jaffle_shop`
     - **Select Trino Catalog**: `development`
     - **Select Trino Schema**: `jaffle_shop_dev_seeds`
     - **Select Trino Table**: `raw_customers`

2. **Incremental source building**:

   - **First table**: Creates `development__jaffle_shop_dev_seeds.source.json` with `raw_customers` details
   - **Same schema, different table**: Updates the same JSON file, adds `raw_orders` details
   - **Different schema**: Creates a new `development__other_schema.source.json` file
   - Each save regenerates the corresponding `.yml` file

3. **Extension workflow**:

   - **Step 1**: Create source for `raw_customers` → Creates JSON file
   - **Step 2**: Create source for `raw_orders` → Updates same JSON file
   - **Step 3**: Create source for `raw_products` → Updates same JSON file
   - **Step 4**: Continue for other tables in the schema
   - **Each save**: Regenerates `development__jaffle_shop_dev_seeds.source.yml`

   > **Note**: One source file per schema, built incrementally table by table.
   >
   > For this tutorial, the example project already has all tables added to `development__jaffle_shop_dev_seeds.source.json`, so you can proceed directly to creating models.

4. **Update manifest** after creating sources:

```bash
dbt parse
```

Now the extension can provide IntelliSense for your sources!

## Step 3: Configure Groups for Model Organization

Before creating models, we need to define groups that will be available in the DJ (Data JSON) Framework extension UI.

1. **Business-focused groups** in the example project:

   The example project has 5 optimized business groups that reflect real-world jaffle shop operations:

   - **`sales`** - Order processing, revenue tracking, and profitability analysis
   - **`products`** - Menu optimization, product performance, and cost efficiency
   - **`customers`** - Customer behavior analysis and segmentation
   - **`supply_chain`** - Inventory management and supplier performance
   - **`analytics`** - Cross-functional business intelligence

2. **Groups are defined in `models/groups.yml`**:

   ```yaml
   version: 2

   groups:
     - name: sales
       owner:
         name: Sales Team
         email: sales@example.com
       description: 'Order processing, revenue tracking, profitability analysis, and sales performance metrics'

     - name: products
       owner:
         name: Product Team
         email: product@example.com
       description: 'Product catalog management, menu analytics, cost efficiency analysis, and supply chain optimization'

     - name: customers
       owner:
         name: Customer Team
         email: customers@example.com
       description: 'Customer profiles, behavior analysis, segmentation, and customer-focused dashboards'

     - name: supply_chain
       owner:
         name: Supply Chain Team
         email: supply-chain@example.com
       description: 'Supply cost analysis, inventory management, and supplier performance tracking'

     - name: analytics
       owner:
         name: Analytics Team
         email: analytics@example.com
       description: 'Cross-functional business intelligence, comprehensive analytics, and strategic insights across all business areas'
   ```

3. **Update manifest** after configuring groups:

```bash
dbt parse
```

> **Important**: Without groups configured and `dbt parse` run, the DJ (Data JSON) Framework extension UI won't populate the Group dropdown, and you cannot create models.

## Step 4: Create Your First Staging Model

Let's clean up the raw customer data using the DJ (Data JSON) Framework extension's UI.

1. **Use the DJ (Data JSON) Framework extension** to create a new model:

   - Use the DJ (Data JSON) Framework extension UI (available through the extension panel)
   - The extension UI will show:
     - **Select Project**: `jaffle_shop`
     - **Select Model Type**: `Staging Select Source`
     - **Select Group**: `customers` (from the business groups)
     - **Enter Topic**: `profiles`
     - **Enter Name**: `clean`

2. **Model file creation**:

   - **File created**: `stg__customers__profiles__clean.model.json`
   - **Location**: `models/staging/customers/profiles/`
   - **Auto-generated**: Corresponding `.yml` file after saving JSON
   - **Edit JSON** for source selection and column configuration

3. **Configure the model** by editing the generated JSON file:

   ```json
   {
     "type": "stg_select_source",
     "group": "customers",
     "topic": "profiles",
     "name": "clean",
     "materialized": "ephemeral",
     "from": {
       "source": "development__jaffle_shop_dev_seeds.raw_customers"
     },
     "select": [
       {
         "name": "customer_id",
         "expr": "id",
         "type": "dim"
       },
       {
         "name": "customer_name",
         "expr": "name",
         "type": "dim"
       }
     ]
   }
   ```

4. **Run the model**:

   ```bash
   dbt run --select stg__customers__profiles__clean
   ```

**What happened?** The DJ (Data JSON) Framework:

- Used the manifest.json to provide IntelliSense for available sources
- Showed `development__jaffle_shop_dev_seeds.raw_customers` as an available source option
- Converted your JSON configuration into proper dbt SQL
- Selected data from the raw_customers source with renamed columns
- Created a clean staging table ready for downstream use

> **Learn more**: Check out [stg_select_source documentation](models/01%20-%20stg_select_source.md) for advanced examples.

## Step 5: Add Business Logic with Intermediate Models

Now let's calculate customer order summaries.

1. **Use the DJ (Data JSON) Framework extension** to create an intermediate model:

   - Look for the DJ (Data JSON) Framework extension panel in the sidebar and click on it.
   - Under "Actions", click on "Create Model".
   - In the extension UI, fill the form:
     - **Select Project**: `jaffle_shop`
     - **Select Model Type**: `Intermediate Select Model`
     - **Select Group**: `sales`
     - **Enter Topic**: `orders`
     - **Enter Name**: `enriched`

2. **Model file creation**:

   - **File created**: `int__sales__orders__enriched.model.json`
   - **Location**: `models/intermediate/sales/orders/`
   - **Edit JSON** in editor for model selection and aggregation configuration

3. **Update the model** by editing the generated JSON file in the editor. Save to auto-generate SQL and YAML files.

   ```json
   {
     "type": "int_join_models",
     "group": "sales",
     "topic": "orders",
     "name": "enriched",
     "from": {
       "model": "stg__sales__orders__standardized",
       "join": [
         {
           "model": "stg__customers__profiles__clean",
           "type": "left",
           "on": {
             "and": [
               {
                 "expr": "stg__sales__orders__standardized.customer_id = stg__customers__profiles__clean.customer_id"
               }
             ]
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
         "name": "customer_name",
         "expr": "stg__customers__profiles__clean.customer_name",
         "type": "dim"
       },
       {
         "name": "customer_first_name",
         "expr": "stg__customers__profiles__clean.first_name",
         "type": "dim"
       }
     ],
     "group_by": [
       {
         "expr": "customer_id"
       }
     ]
   }
   ```

4. **Run the model**:

```bash
dbt run --select int__sales__orders__enriched
```

**What happened?** The DJ (Data JSON) Framework:

- Used manifest.json to provide IntelliSense for available models
- Generated SQL with proper JOIN syntax and column selection
- Validated your JSON configuration against the schema
- Created an enriched intermediate model with customer data joined to orders

> **Learn more**: See [int_join_models documentation](models/05%20-%20int_join_models.md) for join patterns.

## Step 6: Create Analytics-Ready Mart

Finally, let's create a business-friendly customer analytics table.

1. **Use the DJ (Data JSON) Framework extension** to create a mart model:

   - Look for the DJ (Data JSON) Framework extension panel in the sidebar and click on it.
   - Under "Actions", click on "Create Model".
   - In the extension UI, fill the form:
     - **Select Project**: `jaffle_shop`
     - **Select Model Type**: `Mart Select Model`
     - **Select Group**: `sales`
     - **Enter Topic**: `reporting`
     - **Enter Name**: `revenue`

2. **Model file creation**:

   - **File created**: `mart__sales__reporting__revenue.model.json`
   - **Location**: `models/marts/sales/reporting/`
   - **Edit JSON** in editor for model selection and business-friendly transformations

3. **Update the model** by editing the generated JSON file in the editor. Save to auto-generate SQL and YAML files.

   ```json
   {
     "type": "mart_select_model",
     "group": "sales",
     "topic": "reporting",
     "name": "revenue",
     "from": {
       "model": "int__sales__orders__enriched"
     },
     "select": [
       {
         "name": "customer_id",
         "expr": "customer_id",
         "type": "dim"
       },
       {
         "name": "total_orders",
         "expr": "total_orders",
         "type": "fct"
       },
       {
         "name": "lifetime_value_dollars",
         "expr": "total_spent_cents / 100.0",
         "type": "fct"
       },
       {
         "name": "avg_order_value_dollars",
         "expr": "avg_order_value_cents / 100.0",
         "type": "fct"
       },
       {
         "name": "customer_segment",
         "expr": "CASE WHEN total_spent_cents >= 10000 THEN 'VIP' WHEN total_spent_cents >= 5000 THEN 'Premium' ELSE 'Standard' END",
         "type": "dim"
       }
     ]
   }
   ```

4. **Run the model**:

```bash
dbt run --select mart__sales__reporting__revenue
```

**What happened?** The DJ (Data JSON) Framework:

- Provided IntelliSense for available intermediate models
- Validated your mart configuration against the schema
- Generated business-friendly SQL with revenue calculations and time dimensions
- Created an analytics-ready table for BI tools

> **Learn more**: Explore [mart_select_model documentation](models/10%20-%20mart_select_model.md) for BI-ready patterns.

## Step 7: See Your Results

Let's check what we built:

```bash
dbt run --select +mart__sales__reporting__revenue
```

This runs all models needed for your mart. Query your database to see:

- Clean customer data (staging)
- Enriched order data with customer info (intermediate)
- Business-ready analytics (mart)

## Congratulations

You've built a complete data pipeline using DJ:

1. **Staging model** - Cleaned raw data
2. **Intermediate model** - Added business logic and aggregations
3. **Mart model** - Created analytics-ready dataset

## What's Next?

### Complete Reference

Browse the **[Model Types Documentation](models/README.md)** for:

- All 11 model types with examples
- Best practices and patterns
- Troubleshooting guides
- Advanced configurations

### Advanced Features

- **UI-driven model creation**: Use the DJ (Data JSON) Framework extension UI for guided setup
- **IntelliSense**: Get autocomplete for models, sources, and columns from manifest.json
- **Schema validation**: Real-time validation against JSON schemas
- **Trino integration**: Browse data catalog and get column suggestions
- **Documentation**: All model types have comprehensive examples

## Pro Tips

- **Start simple**: Begin with staging models, then add complexity
- **Use the examples**: All documentation uses the same jaffle shop data you just worked with
- **Validate early**: DJ's schema validation catches schema errors before you run dbt
- **Follow the pattern**: Staging → Intermediate → Mart is the recommended flow

## Need Help?

- **Model-specific questions**: Check the [Model Types Documentation](models/README.md)
- **Setup issues**: Review the [Setup Guide](setup/setup.md)

---

**Ready to build more?** → [Model Types Documentation](models/README.md) | **Having issues?** → [Setup Guide](setup/setup.md)
