# Fragments and templates — copy-paste examples

These JSON files are a **FinOps billing** walkthrough aligned with [`composition.test.ts`](../../../src/shared/framework/__tests__/composition.test.ts). Copy them into your dbt project to experiment; they are not required for the Jaffle Shop example.

## Suggested layout in your project

```text
your_dbt_project/
├── fragments/
│   ├── focus_cost_columns.fragment.json
│   └── billing_daily_incremental.fragment.json
├── templates/
│   └── focus_monthly_cost.template.json
└── models/
    ├── staging/.../stg__billing__costs__aws.model.json
    └── marts/.../mart__billing__aws__monthly_cost.model.json
```

DJ discovers `*.fragment.json` and `*.template.json` anywhere under the project root.

## Files

| File | Role |
|------|------|
| [focus_cost_columns.fragment.json](focus_cost_columns.fragment.json) | Select fragment — shared cost columns |
| [billing_daily_incremental.fragment.json](billing_daily_incremental.fragment.json) | Config fragment — incremental Iceberg + tags |
| [focus_monthly_cost.template.json](focus_monthly_cost.template.json) | Template — monthly mart with `upstream` and `provider` params |
| [stg__billing__costs__aws.model.json](stg__billing__costs__aws.model.json) | Staging model using config + select fragment + overrides |
| [mart__billing__aws__monthly_cost.model.json](mart__billing__aws__monthly_cost.model.json) | Child mart extending the template |

## Try it

1. Copy files into a project that already has source `aws_billing.focus_export` (or edit `from.source` to match your sources).
2. Ensure upstream model name in the child `with.upstream` matches your staging model name.
3. Run **DJ: Sync to SQL and YML**.
4. CLI: `model.get` with the mart name — inspect `raw` vs `resolved`.

## Learn more

- [User guide](../../fragments-and-templates/README.md)
- [Select fragments](../../fragments-and-templates/02-select-fragments.md)
- [Templates](../../fragments-and-templates/04-templates.md)
