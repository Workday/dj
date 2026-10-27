# Intermediate Lookback Model

## 1. Introduction

The `int_lookback_model` is designed for time-based analysis that calculates aggregated values over a trailing time period (lookback window). This model type is essential for creating rolling metrics, trend analysis, and time-based business intelligence that considers historical data within a specified timeframe relative to each record's date.

## 2. Creating with Visual Editor

You can create this model type using the visual canvas:

1. Run `DJ: Create Model` from Command Palette, or select "Create Model" under Actions in tree view
2. Step 1 - Basic Information: Select model type `int_lookback_model`, enter group, topic, and name
3. Step 2 - Data Modeling: Use the visual editor
4. Add Select node, add Lookback node, configure time window and aggregations (see time-series workflow example in Visual Editor guide)

See [Visual Editor Guide](../VISUAL_EDITOR.md) for complete canvas documentation and workflow examples.

---

## 3. Purpose

The primary purposes of the `int_lookback_model` are:

- **Rolling Metrics:** Calculate rolling averages, sums, counts, and other aggregations over time windows
- **Trend Analysis:** Identify patterns and trends by examining data over trailing periods
- **Peak Value Detection:** Find maximum or minimum values within lookback windows
- **Time-Based Comparisons:** Compare current values against historical performance
- **Business Intelligence:** Create metrics that consider recent historical context
- **Seasonal Analysis:** Analyze patterns over specific time periods (7-day, 30-day, 90-day windows)

## 4. Model Configuration

An `int_lookback_model` requires the following configuration parameters:

- **`type`:** `int_lookback_model`
- **`group`:** A logical grouping for the model (e.g., `jaffle_shop`, `analytics`, `finance`)
- **`topic`:** A more specific categorization within the group (e.g., `customers`, `orders`, `products`)
- **`name`:** A unique name for the model following naming conventions
- **`materialized`:** Either `ephemeral` or `incremental`
- **`from`:** Specifies the source model and lookback configuration:
  - **`model`:** The source model containing time-series data (string identifier)
  - **`lookback`:** Lookback window configuration:
    - **`days`:** Number of days to look back (integer, minimum 1)
    - **`exclude_event_date`:** Optional boolean to exclude the current event date from lookback (defaults to false)
- **`select`:** Array of column definitions with aggregation support
- **`group_by`:** Optional grouping for aggregations

## 5. Lookback Process

The `int_lookback_model` performs the following transformation:

1. **Time Window Definition:** Establishes the lookback period based on the `days` parameter
2. **Date-based Filtering:** Filters source data to include only records within the lookback window
3. **Grouping:** Groups data by specified dimensions (typically excluding the date column)
4. **Aggregation:** Applies aggregation functions (sum, avg, max, min, count) over the time window
5. **Result Generation:** Produces aggregated metrics for each group over the trailing period

## 6. Basic Example: Store Performance Trends

Let's create a model that analyzes store performance over rolling 7-day windows to identify trends and patterns.

**Scenario:** Track store sales performance, customer traffic, and order patterns over rolling 7-day periods for operational insights.

**Source Data (`stg__sales__orders__enriched_orders`):**

```sql
| order_id | store_id | order_date | order_total_cents | customer_id | is_weekend_order |
|----------|----------|------------|-------------------|-------------|------------------|
| df811427-cdce-45d3-8067-78b53a4c98c2 | 028d015b-0c1f-464e-b528-e13d1e0bafc5 | 2016-09-15 | 2500 | 32488100-c957-4d6c-a64b-8d843106fcff | false |
| 0bd4144f-f79d-4586-86a8-f9243cdb4fe3 | d64217c9-2ba0-481f-b81d-06eac4322988 | 2016-09-16 | 1800 | 32488100-c957-4d6c-a64b-8d843106fcff | false |
| bc37afc0-c311-4e03-9310-2a6a3950871b | 059a0add-79fb-4a59-868e-6b8f31f3257b | 2016-09-16 | 3200 | 57868c0c-5a0d-4af7-b3cf-d573197a2e99 | false |
| 8cddd25d-132c-445c-a348-2a6ae328f4e9 | 028d015b-0c1f-464e-b528-e13d1e0bafc5 | 2016-09-17 | 2200 | 32488100-c957-4d6c-a64b-8d843106fcff | false |
| b43cb64f-36a9-4cba-965f-b0833cad5883 | 0afe8ad9-7bf3-44c1-a2e1-5409679dda1c | 2016-09-18 | 1500 | 57868c0c-5a0d-4af7-b3cf-d573197a2e99 | false |
```

```json
{
  "type": "int_lookback_model",
  "group": "sales",
  "topic": "stores",
  "name": "store_7day_performance",
  "materialization": "incremental",
  "from": {
    "model": "stg__sales__orders__enriched_orders",
    "lookback": {
      "days": 7,
      "exclude_event_date": false
    }
  },
  "select": [
    {
      "name": "store_id",
      "expr": "store_id",
      "type": "dim",
      "description": "Store identifier"
    },
    {
      "name": "analysis_date",
      "expr": "order_date",
      "type": "dim",
      "description": "Date of analysis"
    },
    {
      "name": "orders_7d",
      "expr": "COUNT(*)",
      "type": "fct",
      "description": "Number of orders in last 7 days"
    },
    {
      "name": "revenue_7d_cents",
      "expr": "SUM(order_total_cents)",
      "type": "fct",
      "description": "Total revenue in last 7 days (cents)"
    },
    {
      "name": "revenue_7d_dollars",
      "expr": "SUM(order_total_cents) / 100.0",
      "type": "fct",
      "description": "Total revenue in last 7 days (dollars)"
    },
    {
      "name": "unique_customers_7d",
      "expr": "COUNT(DISTINCT customer_id)",
      "type": "fct",
      "description": "Number of unique customers in last 7 days"
    },
    {
      "name": "avg_order_value_7d_cents",
      "expr": "AVG(order_total_cents)",
      "type": "fct",
      "description": "Average order value in last 7 days (cents)"
    },
    {
      "name": "max_order_value_7d_cents",
      "expr": "MAX(order_total_cents)",
      "type": "fct",
      "description": "Maximum order value in last 7 days (cents)"
    },
    {
      "name": "weekend_orders_7d",
      "expr": "SUM(CASE WHEN is_weekend_order THEN 1 ELSE 0 END)",
      "type": "fct",
      "description": "Number of weekend orders in last 7 days"
    },
    {
      "name": "weekend_order_pct_7d",
      "expr": "SUM(CASE WHEN is_weekend_order THEN 1 ELSE 0 END) * 100.0 / COUNT(*)",
      "type": "fct",
      "description": "Percentage of weekend orders in last 7 days"
    }
  ],
  "group_by": [
    {
      "expr": "store_id"
    },
    {
      "expr": "order_date"
    }
  ]
}
```

This example demonstrates:

- **Rolling window analysis:** 7-day lookback for operational insights
- **Store performance metrics:** Revenue, order count, customer traffic
- **Statistical aggregations:** COUNT, SUM, AVG, MAX functions
- **Business intelligence:** Weekend vs weekday patterns
- **Unit conversions:** Cents to dollars for business-friendly reporting
- **Percentage calculations:** Weekend order percentage for trend analysis

## 7. Advanced Example: Customer Behavior Analysis

Let's create a more complex example that analyzes customer behavior patterns over 30-day rolling windows with advanced business logic.

**Scenario:** Track customer engagement, loyalty, and spending patterns over 30-day periods to identify high-value customers and churn risks.

**Source Data (`int__customers__profiles__summary`):**

```sql
| customer_id | analysis_date | order_total_cents | customer_segment | has_last_name |
|-------------|---------------|-------------------|------------------|---------------|
| 32488100-c957-4d6c-a64b-8d843106fcff | 2016-09-15 | 2500 | VIP | true |
| 32488100-c957-4d6c-a64b-8d843106fcff | 2016-09-20 | 1800 | VIP | true |
| 57868c0c-5a0d-4af7-b3cf-d573197a2e99 | 2016-09-18 | 3200 | Regular | true |
| 32488100-c957-4d6c-a64b-8d843106fcff | 2016-10-01 | 2200 | VIP | true |
| 29bbd42e-6c52-4b2e-8e92-394306d4ac3c | 2016-10-05 | 1500 | New | true |
```

```json
{
  "type": "int_lookback_model",
  "group": "customers",
  "topic": "behavior",
  "name": "customer_30day_insights",
  "materialization": "incremental",
  "from": {
    "model": "int__customers__profiles__summary",
    "lookback": {
      "days": 30,
      "exclude_event_date": false
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
      "name": "analysis_date",
      "expr": "analysis_date",
      "type": "dim",
      "description": "Date of analysis"
    },
    {
      "name": "orders_30d",
      "expr": "COUNT(*)",
      "type": "fct",
      "description": "Number of orders in last 30 days"
    },
    {
      "name": "revenue_30d_cents",
      "expr": "SUM(order_total_cents)",
      "type": "fct",
      "description": "Total revenue in last 30 days (cents)"
    },
    {
      "name": "avg_order_value_30d_cents",
      "expr": "AVG(order_total_cents)",
      "type": "fct",
      "description": "Average order value in last 30 days (cents)"
    },
    {
      "name": "max_order_value_30d_cents",
      "expr": "MAX(order_total_cents)",
      "type": "fct",
      "description": "Maximum order value in last 30 days (cents)"
    },
    {
      "name": "min_order_value_30d_cents",
      "expr": "MIN(order_total_cents)",
      "type": "fct",
      "description": "Minimum order value in last 30 days (cents)"
    },
    {
      "name": "days_since_first_order_30d",
      "expr": "date_diff('day', MIN(analysis_date), MAX(analysis_date))",
      "type": "fct",
      "description": "Days between first and last order in 30-day window"
    },
    {
      "name": "order_frequency_30d",
      "expr": "COUNT(*) * 30.0 / greatest(date_diff('day', MIN(analysis_date), MAX(analysis_date)), 1)",
      "type": "fct",
      "description": "Average orders per 30-day period"
    },
    {
      "name": "customer_segment_consistency",
      "expr": "CASE WHEN COUNT(DISTINCT customer_segment) = 1 THEN 'consistent' ELSE 'changing' END",
      "type": "dim",
      "description": "Whether customer segment remained consistent"
    },
    {
      "name": "is_high_value_customer_30d",
      "expr": "SUM(order_total_cents) >= 5000",
      "type": "dim",
      "description": "Whether customer spent $50+ in last 30 days"
    },
    {
      "name": "is_frequent_customer_30d",
      "expr": "COUNT(*) >= 3",
      "type": "dim",
      "description": "Whether customer placed 3+ orders in last 30 days"
    }
  ],
  "group_by": [
    {
      "expr": "customer_id"
    },
    {
      "expr": "analysis_date"
    }
  ]
}
```

This example demonstrates:

- **Customer behavior analysis:** 30-day rolling window for loyalty insights
- **Advanced aggregations:** MIN, MAX, AVG, COUNT with complex calculations
- **Business intelligence:** High-value and frequent customer identification
- **Temporal analysis:** Order frequency and time span calculations
- **Segment consistency:** Tracking customer segment stability over time
- **Boolean indicators:** Binary flags for customer classification

## 8. Best Practices

### Time Window Selection

- **Choose appropriate lookback periods:** 7-day for operational metrics, 30-day for monthly trends, 90-day for seasonal patterns
- **Consider business cycles:** Align lookback windows with business reporting periods
- **Balance recency vs stability:** Shorter windows are more responsive, longer windows are more stable
- **Document window rationale:** Clearly explain why specific lookback periods were chosen

### Performance Optimization

- **Use incremental materialization:** Essential for large datasets with frequent updates
- **Optimize date filtering:** Ensure efficient date-based filtering in the source model
- **Consider partitioning:** Use date-based partitioning for very large datasets
- **Monitor query performance:** Track execution times as lookback models can be resource-intensive

### Data Quality Management

- **Handle missing dates:** Consider how gaps in data affect rolling calculations
- **Validate time series continuity:** Ensure consistent date ranges in source data
- **Account for seasonality:** Be aware of seasonal patterns that might affect rolling metrics
- **Test edge cases:** Validate behavior at the beginning and end of date ranges

## 9. Integration with Data Pipeline

The `int_lookback_model` serves as a time-based analytics layer:

1. **Time-series staging data** → `int_lookback_model` → **Rolling metrics**
2. **Event-based models** → `int_lookback_model` → **Trend analysis**
3. **Transactional data** → `int_lookback_model` → **Performance indicators**
4. **Rolling intermediate models** → `mart_*` models → **Business dashboards**

**Example Pipeline Flow:**

```text
stg__sales__orders__enriched_orders
                ↓
    int__sales__stores__store_7day_performance
                ↓
        Mart Models & Dashboards
```

---

_This documentation provides comprehensive coverage of `int_lookback_model` with realistic examples from the jaffle shop business scenario. Each example demonstrates practical applications for time-based rolling analysis and trend detection._
