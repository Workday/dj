# Config fragments

A **config fragment** is a `*.fragment.json` with `"kind": "config"`. It carries model-level settings you want to reuse: `materialization`, `tags`, `meta`, `lightdash`, `sql_hooks`, partition exclusions, and related fields—not a `select` array.

## Create a fragment

```jsonc
{
  "kind": "config",
  "name": "billing_daily_incremental",
  "materialization": {
    "type": "incremental",
    "format": "iceberg",
    "strategy": { "type": "delete+insert" }
  },
  "tags": ["billing"],
  "meta": { "owner": "finops", "sla": { "hours": 24 } }
}
```

## Apply on a model

List fragment names at the **root** of `.model.json` (order matters):

```jsonc
{
  "type": "stg_select_source",
  "group": "billing",
  "topic": "costs",
  "name": "aws",
  "fragments": ["billing_daily_incremental"],
  "from": { "source": "..." },
  "select": [ ... ]
}
```

You can stack multiple config fragments:

```jsonc
"fragments": ["shared_tags", "billing_daily_incremental"]
```

Config fragments may themselves list `"fragments"` (nested config fragments resolve in order).

## Merge rules

| Key | Behavior |
|-----|----------|
| Most scalar / object keys | Later fragment overrides earlier; **model-authored values win** over all fragments |
| `tags` | Union / merge across fragments and model |
| `meta` | Deep-merge key by key; model wins on conflict |

Select fragments are **not** listed in root `fragments`—use `*_from_fragment` in `select` instead.

## With select fragments on one model

A single model often uses both:

```jsonc
{
  "fragments": ["billing_daily_incremental"],
  "select": [
    { "type": "all_from_fragment", "fragment": "focus_cost_columns" }
  ]
}
```

Config applies to the whole model; select fragments only affect `select`.

## Example

- Fragment file: [billing_daily_incremental.fragment.json](../../examples/fragments-and-templates/billing_daily_incremental.fragment.json)
- Jaffle demo: [jaffle_lightdash_explore.fragment.json](../../examples/jaffle_shop_lightdash/fragments/jaffle_lightdash_explore.fragment.json) on reporting marts

## Next

- [Templates](04-templates.md)
- [Refactoring](05-refactoring.md)
