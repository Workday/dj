# Intermediate Rollup Model

## 1. Introduction

The `int_rollup_model` is designed for creating time-based aggregations that roll up granular data to higher-level time intervals. This model type is essential for creating summary tables, performance dashboards, and time-series analytics by aggregating detailed transactional data into meaningful time periods (hourly, daily, monthly, yearly).

## 2. Creating with Visual Editor

You can create this model type using the visual canvas:

1. Run `DJ: Create Model` from Command Palette, or select "Create Model" under Actions in tree view
2. Step 1 - Basic Information: Select model type `int_rollup_model`, enter group, topic, and name
3. Step 2 - Data Modeling: Use the visual editor
4. Add Select node, add Rollup node, configure time interval (see time-series workflow example in Visual Editor guide)

See [Visual Editor Guide](../VISUAL_EDITOR.md) for complete canvas documentation and workflow examples.

---

## 3. Purpose

The primary purposes of the `int_rollup_model` are:

- **Time-based Aggregation:** Roll up granular data (e.g., hourly) to higher intervals (daily, monthly, yearly)
- **Performance Optimization:** Pre-aggregate data for faster query performance in reporting and analytics
- **Summary Table Creation:** Generate summary views for business intelligence and dashboards
- **Data Warehouse Optimization:** Create efficient aggregated tables for analytical workloads
- **Trend Analysis:** Enable time-series analysis at different granularities
- **Reporting Efficiency:** Provide ready-to-use aggregated data for business reports

## 4. Model Configuration

An `int_rollup_model` requires the following configuration parameters:

- **`type`:** `int_rollup_model`
- **`group`:** A logical grouping for the model (e.g., `jaffle_shop`, `analytics`, `finance`)
- **`topic`:** A more specific categorization within the group (e.g., `orders`, `customers`, `products`)
- **`name`:** A unique name for the model following naming conventions
- **`materialized`:** Either `ephemeral` or `incremental`
- **`from`:** Specifies the source model and rollup configuration:
  - **`model`:** The source model containing granular time-series data (string identifier)
  - **`rollup`:** Rollup configuration:
    - **`interval`:** Time interval for aggregation (enum: `"day"`, `"hour"`, `"month"`, `"year"`)
    - **`datetime_expr`:** Optional SQL expression for the datetime column to rollup by

## 5. Rollup Process

The `int_rollup_model` performs the following transformation:

1. **Time Interval Grouping:** Groups source data by the specified time interval (hour, day, month, year)
2. **Dimension Preservation:** Maintains all dimensional attributes from the source model
3. **Metric Aggregation:** Aggregates fact columns using appropriate functions (SUM, COUNT, AVG, etc.)
4. **Time Truncation:** Truncates timestamps to the specified interval boundary
5. **Result Generation:** Produces aggregated data at the target time granularity

## 6. Basic Example: Daily Store Performance Rollup

Let's create a daily rollup of detailed order data to analyze store performance patterns.

**Scenario:** Roll up individual order transactions to daily store summaries for operational reporting and trend analysis.

**Source Data (`stg__sales__orders__enriched_orders`):**

```sql
| order_id | store_id | order_datetime      | order_total_cents | customer_id | is_weekend_order |
|----------|----------|---------------------|-------------------|-------------|------------------|
| df811427-cdce-45d3-8067-78b53a4c98c2 | 028d015b-0c1f-464e-b528-e13d1e0bafc5 | 2016-09-01T08:30:00 | 2500 | 32488100-c957-4d6c-a64b-8d843106fcff | false |
| 0bd4144f-f79d-4586-86a8-f9243cdb4fe3 | 028d015b-0c1f-464e-b528-e13d1e0bafc5 | 2016-09-01T09:15:00 | 1800 | 57868c0c-5a0d-4af7-b3cf-d573197a2e99 | false |
| bc37afc0-c311-4e03-9310-2a6a3950871b | d64217c9-2ba0-481f-b81d-06eac4322988 | 2016-09-01T10:45:00 | 3200 | 29bbd42e-6c52-4b2e-8e92-394306d4ac3c | false |
| 8cddd25d-132c-445c-a348-2a6ae328f4e9 | 028d015b-0c1f-464e-b528-e13d1e0bafc5 | 2016-09-01T11:20:00 | 2200 | 32488100-c957-4d6c-a64b-8d843106fcff | false |
| b43cb64f-36a9-4cba-965f-b0833cad5883 | d64217c9-2ba0-481f-b81d-06eac4322988 | 2016-09-01T14:30:00 | 1500 | 09b17f11-05f6-4807-bf69-716295a3fd05 | false |
```

```json
{
  "type": "int_rollup_model",
  "group": "sales",
  "topic": "stores",
  "name": "store_daily_performance",
  "materialization": "incremental",
  "from": {
    "model": "stg__sales__orders__enriched_orders",
    "rollup": {
      "interval": "day",
      "datetime_expr": "order_datetime"
    }
  }
}
```

This example demonstrates:

- **Daily time aggregation:** Individual order transactions rolled up to daily intervals
- **Store-level grouping:** Aggregation by store_id for location-based analysis
- **Automatic column aggregation:** The rollup process automatically aggregates all numeric columns using appropriate functions (SUM, COUNT, AVG, etc.)
- **Date truncation:** order_datetime is truncated to day boundaries for daily summaries
- **Incremental processing:** Efficient processing of new data as it arrives

## 7. Advanced Example: Monthly Customer Analytics

Let's create a comprehensive monthly rollup for customer analytics and retention analysis.

**Scenario:** Roll up daily customer activity to monthly summaries for customer lifecycle analysis and business intelligence.

**Source Data (`int__customers__profiles__summary`):**

```sql
| customer_id | analysis_date | order_total_cents | customer_segment | has_last_name |
|-------------|---------------|-------------------|------------------|---------------|
| 32488100-c957-4d6c-a64b-8d843106fcff | 2016-09-01 | 2500 | VIP | true |
| 32488100-c957-4d6c-a64b-8d843106fcff | 2016-09-20 | 1800 | VIP | true |
| 57868c0c-5a0d-4af7-b3cf-d573197a2e99 | 2016-09-18 | 3200 | Regular | true |
| 32488100-c957-4d6c-a64b-8d843106fcff | 2016-10-01 | 2200 | VIP | true |
| 29bbd42e-6c52-4b2e-8e92-394306d4ac3c | 2016-10-05 | 1500 | New | true |
```

```json
{
  "type": "int_rollup_model",
  "group": "customers",
  "topic": "analytics",
  "name": "customer_monthly_summary",
  "materialization": "incremental",
  "from": {
    "model": "int__customers__profiles__summary",
    "rollup": {
      "interval": "month",
      "datetime_expr": "analysis_date"
    }
  }
}
```

This example demonstrates:

- **Monthly time aggregation:** Daily customer activity rolled up to monthly intervals
- **Customer-level grouping:** Aggregation by customer_id for individual customer analysis
- **Automatic metric calculation:** The rollup process automatically calculates monthly totals, averages, and counts
- **Date truncation:** analysis_date is truncated to month boundaries for monthly summaries
- **Customer analytics:** Enables monthly customer behavior analysis and retention tracking

## 8. Best Practices

### Time Interval Selection

- **Choose appropriate granularity:** Daily for operational reporting, monthly for strategic analysis, yearly for long-term trends
- **Consider data volume:** Higher granularity (hourly) creates more records but provides detailed insights
- **Align with business cycles:** Match rollup intervals to business reporting periods
- **Balance performance vs detail:** More granular rollups require more storage and processing power

### Aggregation Strategy

- **Use appropriate functions:** SUM for additive metrics, AVG for rates, COUNT for frequencies, MIN/MAX for ranges
- **Handle NULL values:** Consider how NULL values should be treated in aggregations
- **Preserve important dimensions:** Keep key business dimensions that are needed for analysis
- **Calculate derived metrics:** Create business-friendly metrics like percentages and ratios

### Performance Optimization

- **Use incremental materialization:** Essential for large time-series datasets
- **Implement proper partitioning:** Partition by time intervals for better query performance
- **Create appropriate indexes:** Index on time columns and frequently filtered dimensions
- **Monitor resource usage:** Rollup models can be resource-intensive, especially for large datasets

### Data Quality Management

- **Validate time boundaries:** Ensure rollup intervals align correctly with source data timestamps
- **Handle timezone considerations:** Standardize timezone handling across all time-based calculations
- **Test aggregation accuracy:** Validate rollup results against manual calculations
- **Monitor data completeness:** Ensure all source records are included in rollups

## 9. Integration with Data Pipeline

The `int_rollup_model` serves as an aggregation layer in the data pipeline:

1. **Granular staging data** → `int_rollup_model` → **Aggregated summaries**
2. **Detailed intermediate models** → `int_rollup_model` → **Time-based analytics**
3. **Transactional data** → `int_rollup_model` → **Performance dashboards**
4. **Rollup intermediate models** → `mart_*` models → **Business intelligence**

**Example Pipeline Flow:**

```text
stg__sales__orders__enriched_orders
                ↓
    int__sales__stores__store_daily_performance
                ↓
        mart__sales__reporting__daily_performance
                ↓
            Business Dashboards
```

---

_This documentation provides comprehensive coverage of `int_rollup_model` with realistic examples from the jaffle shop business scenario. Each example demonstrates practical applications for time-based aggregation and performance optimization._
