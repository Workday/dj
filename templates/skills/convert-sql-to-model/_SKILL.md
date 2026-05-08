---
name: convert-sql-to-model
description: >-
  Convert an existing SQL query into a DJ .model.json file. Use when the user
  has a working SQL query (often from a .draft.sql file) and wants to formalize
  it as a DJ/dbt model.
compatibility: DJ extension workspace with .dj/schemas/ and .agents/dj/AGENTS.md
metadata:
  dj-framework-skill: '1.0'
---

# Convert SQL to DJ Model

Convert a raw SQL query into a properly structured `.model.json` file. This skill analyzes the query structure and creates the appropriate DJ model type.

## Prerequisites

Before converting, ensure you have access to:

1. The SQL query to convert (usually from a `.draft.sql` file)
2. The `.dj/schemas/` directory for schema validation
3. The `.agents/dj/AGENTS.md` for model type conventions

## Analysis Steps

When analyzing the SQL query, identify:

### 1. Query Pattern Recognition

| SQL Pattern | DJ Model Type |
| --- | --- |
| `SELECT ... FROM source_table` (raw data) | `stg_select_source` |
| `SELECT ... FROM dbt_model` (single model) | `int_select_model` or `mart_select_model` |
| `SELECT ... FROM a JOIN b` | `int_join_models` or `mart_join_models` |
| `SELECT ... UNION ALL SELECT ...` | `stg_union_sources` or `int_union_models` |
| `SELECT ... FROM UNNEST(...)` | `int_join_column` |
| Time-windowed lookback patterns | `int_lookback_model` |

### 2. Column Classification

- **Dimensions (`dim`)**: Categorical, descriptive columns (IDs, names, dates, statuses)
- **Facts (`fct`)**: Numeric measures that can be aggregated (amounts, counts, quantities)

Default to `dim` unless the column is clearly a measure.

### 3. Aggregation Detection

Look for:

- `GROUP BY` clauses → `"group_by": "dims"` or explicit columns
- Aggregate functions (`SUM`, `COUNT`, `AVG`, etc.) → `agg` or `aggs` on select items
- Window functions → may need CTE restructuring

### 4. Source/Model References

- Map `FROM` and `JOIN` tables to:
  - `from.source` for raw tables (format: `database__schema.table`)
  - `from.model` for existing dbt models (format: `<layer>__<group>__<topic>__<name>`)

### 5. CTE Handling

If the SQL has `WITH` clauses:

- Convert each CTE to an entry in the `ctes` array
- CTEs must be ordered: a CTE can only reference CTEs defined before it
- Main query becomes the model's primary `from` and `select`

### 6. Filter Conditions

- `WHERE` clauses → `where` array in the model
- `HAVING` clauses → `having` array in the model
- Support for inline subqueries via the `subquery` key

## Workflow

1. **Read the SQL query** provided by the user
2. **Ask for model metadata** if not provided:
   - `group` (e.g., analytics, finops, sales)
   - `topic` (e.g., aws_cur, billing, salesforce)
   - `name` (e.g., daily_summary, accounts)
3. **Determine the model type** from the query pattern table above
4. **Read the relevant schema** at `.dj/schemas/model.type.<type>.schema.json`
5. **Read AGENTS.md** for examples and conventions
6. **Verify upstream sources/models exist** by reading their JSON files
7. **Create the `.model.json`** file at the correct path
8. **Validate** against the schema

## File Path Convention

```text
models/<layer>/<group>/<topic>/<layer>__<group>__<topic>__<name>.model.json
```

Where `<layer>` is derived from the type prefix:

- `stg_*` → `staging`
- `int_*` → `intermediate`
- `mart_*` → `mart`

## Example Conversion

### Input SQL

```sql
SELECT
  customer_id,
  customer_name,
  SUM(order_amount) as total_orders,
  COUNT(*) as order_count
FROM orders
JOIN customers USING (customer_id)
WHERE order_date >= DATE '2024-01-01'
GROUP BY customer_id, customer_name
```

### Output Model

```jsonc
{
  "type": "int_join_models",
  "group": "analytics",
  "topic": "orders",
  "name": "customer_order_summary",
  "from": {
    "model": "stg__analytics__orders__orders"
  },
  "select": [
    { "name": "customer_id" },
    { "name": "customer_name" },
    { "name": "total_orders", "type": "fct", "expr": "SUM(order_amount)" },
    { "name": "order_count", "type": "fct", "expr": "COUNT(*)" }
  ],
  "join": [
    {
      "model": "stg__analytics__customers__customers",
      "on": [{ "left": "customer_id", "op": "=", "right": "customer_id" }]
    }
  ],
  "where": [
    { "expr": "order_date >= DATE '2024-01-01'" }
  ],
  "group_by": "dims"
}
```

## Important Conventions

- **Never edit** generated `.sql` or `.yml` files — only edit `.model.json`
- Use **JSONC format**: trailing commas allowed, preserve comments
- Source references use `<database>__<schema>.<table>` format
- Column types are `dim` or `fct`, default is `dim`
- When using `agg`, always include `"group_by": "dims"` (or explicit columns)
- Verify upstream columns exist before referencing them
- Prefer `"materialization": "incremental"` over legacy `"materialized": "incremental"`

## Gotchas

- CTEs must be ordered: a CTE can only reference CTEs defined before it
- `topic` is not required for `int_join_models` but should still be set
- `mart_select_model` does not support `agg`/`aggs` — use only passthrough or expression columns
- Cross joins have no `on` property
- Subquery `column` is required for all operators except `exists`/`not_exists`

## Reference Skills

For detailed model creation conventions, also consult:

- `dj-create-new-model` skill for comprehensive model type documentation
- `.dj/schemas/` for exact JSON schema definitions
- `.agents/dj/AGENTS.md` for project-specific conventions
