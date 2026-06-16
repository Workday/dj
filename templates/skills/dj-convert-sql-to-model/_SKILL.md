---
name: dj-convert-sql-to-model
description: >-
  Convert an existing SQL query into a DJ .model.json file. Use when the user
  has a working SQL query (often from a .draft.sql file) and wants to formalize
  it as a DJ/dbt model.
compatibility: DJ (Data JSON) Framework extension workspace with .dj/schemas/ and .agents/dj/AGENTS.md
metadata:
  dj-skill: '1.0'
---

# Convert SQL to DJ Model

Convert a raw SQL query into a **new** `.model.json` file following the DJ (Data JSON) Framework schema exactly.

**CRITICAL: This skill ONLY creates new `.model.json` files. NEVER modify, update, or overwrite existing `.model.json`, `.source.json`, `.sql`, or `.yml` files. If an upstream model or source already exists, reference it by name — do not edit it.**

**Reading order:** `.dj/schemas/model.type.<type>.schema.json` (follow `$ref`s) → `.agents/dj/AGENTS.md` **Model Types** section → this skill's SQL mapping rules. Always read the schema **before** writing any JSON.

## Output structure (mandatory)

The generated `.model.json` MUST use these DJ fields — no other structure is valid:

```jsonc
{
  "type": "<model_type>", // from decision table below
  "group": "<group>", // ask the user
  "topic": "<topic>", // ask the user
  "name": "<name>", // ask the user
  "from": {
    "source": "<db>__<schema>.<table>", // OR "model": "<layer>__<group>__<topic>__<name>"
  },
  "select": [
    { "name": "col_a" }, // dim (default)
    { "name": "col_b", "type": "fct", "expr": "SUM(amount)" }, // fact with expression
  ],
}
```

**NEVER use**: `$schema`, `dimensions`, `measures`, `source.catalog`, `source.schema`, `source.table`, `expression`, `data_type` as a top-level field, or any field not defined in the DJ schemas. If unsure, read the schema file first.

## SQL pattern → model `type`

| SQL Pattern                                  | DJ Model Type                             |
| -------------------------------------------- | ----------------------------------------- |
| `SELECT ... FROM <raw_table>` (source data)  | `stg_select_source`                       |
| `SELECT ... FROM <dbt_model>` (single model) | `int_select_model` or `mart_select_model` |
| `SELECT ... FROM a JOIN b`                   | `int_join_models` or `mart_join_models`   |
| `SELECT ... UNION ALL SELECT ...` (sources)  | `stg_union_sources`                       |
| `SELECT ... UNION ALL SELECT ...` (models)   | `int_union_models`                        |
| `SELECT ... FROM UNNEST(...)`                | `int_join_column`                         |
| Time-windowed lookback patterns              | `int_lookback_model`                      |

## Column mapping (SQL → DJ `select`)

- **`dim`** (default): categorical, descriptive — IDs, names, dates, statuses, strings
- **`fct`**: numeric measures that can be aggregated — amounts, counts, quantities

| SQL column               | DJ `select` entry                                      |
| ------------------------ | ------------------------------------------------------ |
| `col_name` (passthrough) | `{ "name": "col_name" }`                               |
| `col_name` (with type)   | `{ "name": "col_name", "type": "fct" }`                |
| `expr AS alias`          | `{ "name": "alias", "expr": "expr" }`                  |
| `SUM(x) AS total`        | `{ "name": "total", "type": "fct", "expr": "SUM(x)" }` |
| `CAST(x AS DATE) AS d`   | `{ "name": "d", "expr": "CAST(x AS DATE)" }`           |
| `COALESCE(...)`          | `{ "name": "alias", "expr": "COALESCE(...)" }`         |

Use `expr` only when the column is transformed, renamed, or aggregated. Plain passthrough columns need only `name`.

## Aggregation → `group_by`

When the SQL has `GROUP BY`, add `"group_by": "dims"` to the model. Every `fct` column must have an aggregate in `expr` (e.g., `SUM(x)`, `COUNT(*)`, `MAX(y)`).

## Source/model references in `from`

- **Raw tables** → `"from": { "source": "<database>__<schema>.<table>" }` (double underscore `__` between catalog and schema, dot `.` between schema and table)
- **Existing dbt models** → `"from": { "model": "<layer>__<group>__<topic>__<name>" }`

## CTE handling

If the SQL has `WITH` clauses, convert to the `ctes` array. CTEs must be ordered: a CTE can only reference CTEs defined before it. The main query becomes the model's primary `from` and `select`. Read `model.cte.schema.json` for the exact shape.

Before writing CTEs, search for existing `.model.json` files in the project that use `"ctes"` and study their structure — they are the best reference for how CTEs are applied in this project (bulk selects, `group_by`, `from.cte` chaining, rollup, exclude flags).

## Filter conditions

- `WHERE` → `"where": [{ "expr": "..." }]` or `"where": { "and": [{ "expr": "..." }] }`
- `HAVING` → `"having": [{ "expr": "..." }]`

## Workflow

1. **Read the SQL query** provided by the user
2. **Always ask the user** for the new model's naming before creating anything:
   - `group` — must be one of the groups defined in your project (e.g., `analytics`, `finops`, `marketing`, `engineering`, `sales`, `platform`)
   - `topic` (e.g., aws_cur, billing, salesforce)
   - `name` (e.g., daily_summary, accounts)
     Do NOT infer or reuse names from the SQL query — the user must confirm the name.
3. **Determine the model type** from the SQL pattern table above
4. **Read the schema** at `.dj/schemas/model.type.<type>.schema.json` — follow all `$ref` links
5. **Read `.agents/dj/AGENTS.md`** Model Types section for the selected type's example
6. **Scan existing `.model.json` files** in the project's `models/` directory — especially models of the same type — to learn naming conventions, CTE patterns, `select` structure, `group_by` usage, and other structural patterns. Use these as reference when creating the new model. Pay particular attention to models that use `ctes`, `join`, `where`, and `group_by` to understand how the project applies these features
7. **Verify upstream sources/models exist** by reading their JSON files (read-only — do NOT modify them)
8. **Confirm the target file path does not already exist** — if it does, ask the user for a different name
9. **Create a new `.model.json`** file at the correct path — never overwrite an existing file
10. **Validate** the output against the schema

## File path convention

```text
models/<layer>/<group>/<topic>/<layer>__<group>__<topic>__<name>.model.json
```

Layer is derived from the type prefix: `stg_*` → `staging`, `int_*` → `intermediate`, `mart_*` → `mart`.

## Example: staging model with expressions

### Input SQL

```sql
SELECT
  fiscal_year,
  quarter_number,
  CAST(fy_year_month AS DATE) AS fy_year_month,
  fy_qtr,
  COALESCE(CAST(REGEXP_REPLACE(annual_target, '[^0-9.]', '') AS DOUBLE), 0) AS annual_target,
  COALESCE(CAST(REGEXP_REPLACE(actual_amount, '[^0-9.]', '') AS DOUBLE), 0) AS actual_amount
FROM gsheets_opus.default.savings_tracker
```

### Output `.model.json`

```jsonc
{
  "type": "stg_select_source",
  "group": "finops",
  "topic": "savings_tracker",
  "name": "costs",
  "from": {
    "source": "gsheets_opus__default.savings_tracker",
  },
  "select": [
    { "name": "fiscal_year" },
    { "name": "quarter_number" },
    { "name": "fy_year_month", "expr": "CAST(fy_year_month AS DATE)" },
    { "name": "fy_qtr" },
    {
      "name": "annual_target",
      "type": "fct",
      "expr": "COALESCE(CAST(REGEXP_REPLACE(annual_target, '[^0-9.]', '') AS DOUBLE), 0)",
    },
    {
      "name": "actual_amount",
      "type": "fct",
      "expr": "COALESCE(CAST(REGEXP_REPLACE(actual_amount, '[^0-9.]', '') AS DOUBLE), 0)",
    },
  ],
}
```

## Example: intermediate model with aggregation

### Input SQL

```sql
SELECT
  customer_id,
  customer_name,
  SUM(order_amount) AS total_orders,
  COUNT(*) AS order_count
FROM int__analytics__orders__details
JOIN int__analytics__customers__base USING (customer_id)
WHERE order_date >= DATE '2024-01-01'
GROUP BY customer_id, customer_name
```

### Output `.model.json`

```jsonc
{
  "type": "int_join_models",
  "group": "analytics",
  "topic": "orders",
  "name": "customer_order_summary",
  "from": {
    "model": "int__analytics__orders__details",
  },
  "select": [
    { "name": "customer_id" },
    { "name": "customer_name" },
    { "name": "total_orders", "type": "fct", "expr": "SUM(order_amount)" },
    { "name": "order_count", "type": "fct", "expr": "COUNT(*)" },
  ],
  "join": [
    {
      "model": "int__analytics__customers__base",
      "on": [{ "left": "customer_id", "op": "=", "right": "customer_id" }],
    },
  ],
  "where": [{ "expr": "order_date >= DATE '2024-01-01'" }],
  "group_by": "dims",
}
```

## Conventions

- **Always create a new file** — never update or overwrite existing `.model.json` files
- **Never edit** generated `.sql` or `.yml` files — only create new `.model.json`
- **Never modify upstream models or sources** — read them for column/reference info only
- Use **JSONC format**: trailing commas allowed, preserve comments
- Source references use `<database>__<schema>.<table>` format (double underscore, then dot)
- Column types are `dim` or `fct`, default is `dim` — do NOT use `"dimension"` or `"measure"`
- `expr` holds the SQL expression — do NOT use `"expression"`
- When using aggregates, always include `"group_by": "dims"`
- Verify upstream columns exist before referencing them
- Prefer `"materialization": "incremental"` over legacy `"materialized": "incremental"`
- For all conventions, gotchas, and advanced features (CTEs, rollup, subqueries, Lightdash), follow the `dj-create-new-model` skill — it is the authoritative reference

## Gotchas

- **Never modify existing files** — this skill creates one new `.model.json` only
- **Never invent fields** — if a field isn't in `.dj/schemas/`, don't use it
- CTEs must be ordered: a CTE can only reference CTEs defined before it
- `topic` is not required for `int_join_models` but should still be set
- `mart_select_model` does not support `agg`/`aggs` — use only passthrough or expression columns
- Cross joins have no `on` property
- Subquery `column` is required for all operators except `exists`/`not_exists`

## Reference

For comprehensive model creation conventions, always consult:

- `dj-create-new-model` skill — authoritative reference for all model types, conventions, and gotchas
- `.dj/schemas/` — exact JSON schema definitions (read these before writing)
- `.agents/dj/AGENTS.md` — project-specific conventions and examples
