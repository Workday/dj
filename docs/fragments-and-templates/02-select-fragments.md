# Select fragments

A **select fragment** is a `*.fragment.json` file with `"kind": "select"` and a `select` array—the same column shapes you would put on a model (`name`/`expr`, types, Lightdash, etc.).

## Create a fragment

```jsonc
{
  "kind": "select",
  "name": "focus_cost_columns",
  "description": "Standard FinOps cost columns",
  "select": [
    {
      "name": "billed_cost",
      "type": "fct",
      "expr": "cast(billed_cost as decimal(38,10))",
      "description": "Billed cost",
      "lightdash": { "metrics": ["sum"] }
    },
    { "name": "charge_period_start", "type": "dim" }
  ]
}
```

The `name` field must match the file basename: `focus_cost_columns.fragment.json` → `"name": "focus_cost_columns"`.

## Reference from a model

In the model `select` array (or a CTE `select`):

```jsonc
{
  "type": "all_from_fragment",
  "fragment": "focus_cost_columns"
}
```

### Variants

| `type` | Includes |
|--------|----------|
| `all_from_fragment` | Every column in the fragment |
| `dims_from_fragment` | Only `type: "dim"` columns |
| `fcts_from_fragment` | Only `type: "fct"` columns |

### Filter columns

```jsonc
{
  "type": "dims_from_fragment",
  "fragment": "focus_cost_columns",
  "include": ["charge_period_start"]
}
```

```jsonc
{
  "type": "all_from_fragment",
  "fragment": "focus_cost_columns",
  "exclude": ["effective_cost"]
}
```

## Overrides (source-specific expressions)

When the fragment’s default `expr` does not match your source column names, override per column:

```jsonc
{
  "type": "all_from_fragment",
  "fragment": "focus_cost_columns",
  "overrides": {
    "billed_cost": { "expr": "cast(billedcost as decimal(38,10))" }
  }
}
```

`name` cannot be overridden. Other properties merge into the fragment column.

See the [Jaffle item line demo](../../examples/jaffle_shop_lightdash/README.md#fragments--templates-in-this-project) for a staging model that uses a fragment plus overrides for `id` → `item_id`.

## Combine with manual columns

Fragment includes and normal `select` entries can coexist:

```jsonc
"select": [
  { "type": "all_from_fragment", "fragment": "focus_cost_columns", "overrides": { ... } },
  { "name": "provider", "type": "dim", "expr": "'aws'" }
]
```

## CTEs

Put `*_from_fragment` inside a CTE’s `select` the same way as model-level `select`. Column lineage and CTE analysis resolve the fragment before validation.

## Union staging pattern

For `stg_union_sources`, when each leg shares the same column list, define the list once in a select fragment and reference it from each leg’s model (or from a template). See [Staging union sources](../models/02%20-%20stg_union_sources.md).

## FinOps walkthrough

Full files: [examples/fragments-and-templates](../../examples/fragments-and-templates/README.md).

## Next

- [Config fragments](03-config-fragments.md) — shared materialization and tags
- [Refactoring](05-refactoring.md) — extract duplicate columns into a fragment
