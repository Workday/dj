# Lightdash Integration

DJ integrates with Lightdash CLI to provide instant BI dashboard previews directly from your dbt models.

**Before you begin:** This guide assumes you have completed Lightdash setup. See the [Lightdash Setup Guide](../setup/setup.md#7-optional-lightdash-integration) first.

**Related Documentation:**

- [Lightdash Setup Guide](../setup/setup.md#7-optional-lightdash-integration) - Initial CLI installation and environment variables
- [Lightdash Local Setup](../setup/lightdash-local-setup.md) - Docker setup for local development
- [Lightdash Configuration](../setup/lightdash-configuration.md) - Advanced configuration options
- [dbt Integration](dbt-integration.md) - Running dbt commands
- [Trino Integration](trino-integration.md) - Query execution and catalog browsing

---

## Table of Contents

1. [Starting Preview Server](#starting-preview-server)
2. [Managing Previews](#managing-previews)
3. [Configuring Lightdash Metadata](#configuring-lightdash-metadata)
4. [Lightdash Configuration](#lightdash-configuration)
5. [Development Workflows](#development-workflows)
6. [Troubleshooting](#troubleshooting)

## Starting Preview Server

DJ integrates with Lightdash CLI to provide instant BI previews.

### Start Lightdash Preview

Opens an interactive UI for managing Lightdash preview servers.

**Method 1: Command Palette**

1. Run "DJ: Start Lightdash Preview" from Command Palette

**Method 2: Actions Tree View**

1. Open "Actions" view in left sidebar
2. Click "Lightdash Preview" item

<video width="100%" controls>
  <source src="https://github.com/Workday/dj/raw/main/assets/videos/lightdash-preview-ui.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

> Opening the Lightdash Preview Manager UI, starting a preview, and viewing active previews

**What the UI provides:**

- **Preview Management Dashboard**:
  - List all active previews
  - Start new preview with custom name
  - Stop running previews
  - Delete previews from server
  - Copy preview URLs to clipboard
  - Open previews in browser
- **Preview Configuration**:
  - Select models
  - Enter suffix for preview name (optional)
- **Status Monitoring**:
  - See which previews are active
  - View preview URLs
  - Track preview creation progress

**Example workflow:**

1. Open Lightdash Preview Manager UI
2. Enter optional preview suffix name
3. Select [mart\_\_sales\_\_reporting\_\_revenue.model.json](../examples/jaffle_shop/models/marts/sales/reporting/mart__sales__reporting__revenue.model.json)
4. Click "Start Preview"
5. View progress in UI
6. Click "Open in Browser" when ready
7. Explore revenue metrics in Lightdash with dimensions like order_year, order_month, and revenue_tier

**Sharing Previews:**

- Preview persists until deleted
- Share URL with team members
- Access requires Lightdash authentication

## Managing Previews

Preview management is handled through the Lightdash Preview Manager UI (described above).

**From the UI, you can:**

- **View all active previews** - See list of running preview servers
- **Delete a preview** - Click "Delete" button to stop preview from server
- **Copy preview URL** - Click "Copy URL" to share with team
- **Open in browser** - Click "Open" to launch Lightdash preview

## Configuring Lightdash Metadata

DJ models support rich Lightdash metadata for semantic layer:

### Dimensions

Define dimensions on columns:

```json
{
  "columns": [
    {
      "name": "customer_id",
      "type": "dim",
      "lightdash": {
        "dimension": {
          "type": "string"
        }
      }
    },
    {
      "name": "order_date",
      "type": "dim",
      "lightdash": {
        "dimension": {
          "type": "timestamp",
          "timeIntervals": ["day", "week", "month", "year"]
        }
      }
    }
  ]
}
```

**Dimension Types:**

- `string` - Text dimensions
- `number` - Numeric dimensions
- `timestamp` - Date/time dimensions with intervals
- `boolean` - True/false dimensions

### Metrics

Define metrics for aggregations:

```json
{
  "lightdash": {
    "metrics": [
      {
        "name": "total_revenue",
        "type": "sum",
        "sql": "${TABLE}.amount",
        "description": "Sum of all order amounts"
      },
      {
        "name": "unique_customers",
        "type": "count_distinct",
        "sql": "${TABLE}.customer_id"
      }
    ]
  }
}
```

**Metric Types:**

- `count` - Row count
- `count_distinct` - Unique value count
- `sum` - Sum of values
- `average` - Average value
- `min` / `max` - Min/max values

**Example from jaffle_shop_lightdash:**

In [mart\_\_sales\_\_reporting\_\_profitability.model.json](../examples/jaffle_shop_lightdash/models/marts/sales/reporting/mart__sales__reporting__profitability.model.json):

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

### AI Hints

Add AI hints for natural language queries by including them in your model JSON:

```json
{
  "columns": [
    {
      "name": "revenue",
      "type": "fct",
      "lightdash": {
        "ai_hint": "Total revenue in USD from completed orders"
      }
    }
  ],
  "lightdash": {
    "ai_hint": "This model contains order-level revenue data with customer and product dimensions"
  }
}
```

AI hints help Lightdash's natural language query feature understand your data better.

## Lightdash Configuration

For initial Lightdash CLI installation and environment variables setup, see [Setup Guide - Lightdash Integration](../setup/setup.md#7-optional-lightdash-integration).

For advanced configuration options including auto-detection, custom project paths, and multiple project support, see [Lightdash Configuration Guide](../setup/lightdash-configuration.md).

For local Lightdash development setup with Docker, see [Lightdash Local Setup Guide](../setup/lightdash-local-setup.md).

## Development Workflows

### End-to-End Development Flow

1. **Create Model** (Visual Editor or JSON)
2. **Compile** (`Cmd+Shift+C`) - Generate SQL
3. **Run** (DJ: Run Model) - Execute in Trino
4. **Preview** (DJ: Start Lightdash Preview) - Explore in BI tool
5. **Iterate** - Edit, compile, run, preview

**Example with jaffle_shop:**

Create [int\_\_sales\_\_orders\_\_enriched.model.json](../examples/jaffle_shop/models/intermediate/sales/orders/int__sales__orders__enriched.model.json) → Compile to see join SQL → Run to materialize → Preview in Lightdash to explore customer and store dimensions.

## Troubleshooting

### Lightdash Preview Not Starting

**Check configuration:**

- Verify LIGHTDASH_URL is set
- Ensure Lightdash CLI installed:

  ```bash
  lightdash --version
  ```

**Check project configuration:**

- Verify project UUID is correct
- Ensure dbt project path is configured

**View Lightdash logs:**

1. View → Output
2. Select "DJ" from dropdown
3. Look for Lightdash CLI output

**Common Issues:**

- Lightdash CLI not in PATH
- Invalid LIGHTDASH_PROJECT UUID
- Trino connection issues (Lightdash needs Trino access)
- dbt manifest not up to date (run `dbt parse`)

## Next Steps

- [dbt Integration](dbt-integration.md) - Running dbt commands
- [Trino Integration](trino-integration.md) - Query execution and catalog browsing
- [Tutorial](../TUTORIAL.md) - Hands-on walkthrough
- [Visual Editor](../VISUAL_EDITOR.md) - Create models visually
- [Lineage Visualization](../LINEAGE.md) - Explore model dependencies
