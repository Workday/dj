# Templates

A **template** (`*.template.json`) stores a reusable **model body** plus **parameters**. Child models set identity fields (`group`, `topic`, `name`, `type`) and point at the template with `extends` and `with`.

Templates do not generate their own SQL/YAML—only child `.model.json` files do.

## Template file shape

```jsonc
{
  "name": "focus_monthly_cost",
  "description": "Monthly cost mart from an upstream staging model",
  "params": {
    "upstream": { "type": "model_ref", "description": "Staging model with cost columns" },
    "provider": { "type": "string", "description": "Provider label column" }
  },
  "model": {
    "type": "mart_select_model",
    "fragments": ["billing_daily_incremental"],
    "tags": ["mart"],
    "ctes": [
      {
        "name": "monthly",
        "from": { "model": "${upstream}", "rollup": { "interval": "month" } },
        "select": [{ "type": "all_from_model", "model": "${upstream}" }]
      }
    ],
    "from": { "cte": "monthly" },
    "select": [
      { "type": "dims_from_cte", "cte": "monthly" },
      { "name": "billed_cost", "type": "fct", "expr": "sum(billed_cost)" },
      { "name": "provider", "type": "dim", "expr": "'${provider}'" }
    ],
    "group_by": "dims"
  }
}
```

### Parameter types

| `params.*.type` | Meaning |
|-----------------|--------|
| `model_ref` | Must name an existing model; creates a dbt dependency |
| `string` | Substituted into string values in the template body |

Substitution uses `${param_name}` in strings. For a literal `${` in output, write `$${` in the template.

Identity fields (`group`, `topic`, `name`) belong on the **child** model, not inside `template.model`.

## Child model

```jsonc
{
  "type": "mart_select_model",
  "group": "billing",
  "topic": "aws",
  "name": "monthly_cost",
  "extends": "focus_monthly_cost",
  "with": {
    "upstream": "stg__billing__costs__aws",
    "provider": "aws"
  },
  "select": [
    { "name": "aws_operation", "type": "dim" }
  ]
}
```

At sync time DJ **resolves** template + child into one model for SQL/YAML. On disk you keep the small child file.

## Merging child changes

| Field | Purpose |
|-------|---------|
| `select` | Default **merge** by column identity; add `select_mode: "replace"` to replace the whole list |
| `ctes` | Same with `ctes_mode` / `ctes_exclude` |
| `select_exclude` | Drop inherited select items by name or bulk key |
| `ctes_exclude` | Drop inherited CTEs by name |
| `fragments` | Extra config fragments on the child |

The visual editor loads the **merged** model for editing. On save, DJ stores a **minimal** child (only your deltas plus `extends` / `with`) when possible.

## Visual wizard

On **Create model**, Basic Information includes **Template**: pick a template and fill `with` parameters. On **Edit**, `extends` is fixed; parameters remain editable.

## Examples

- [focus_monthly_cost.template.json](../../examples/fragments-and-templates/focus_monthly_cost.template.json) + [child model](../../examples/fragments-and-templates/mart__billing__aws__monthly_cost.model.json)
- [Jaffle store reporting base](../../examples/jaffle_shop_lightdash/templates/jaffle_store_reporting_base.template.json)

## Next

- [Refactoring](05-refactoring.md)
- [Tooling](06-tooling-and-agents.md)
