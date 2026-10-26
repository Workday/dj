# Fragments and templates

DJ lets you reuse **column definitions** and **model configuration** across many `.model.json` files without copy-paste. You author **shared files** (`*.fragment.json`, `*.template.json`) and reference them from models; sync generates SQL and YAML from the **resolved** model, not by rewriting your model file.

## Start here

- **[Full guide (table of contents)](fragments-and-templates/README.md)** — concepts, select/config fragments, templates, refactoring, tooling, and agents
- **[Copy-paste JSON examples](../examples/fragments-and-templates/README.md)** — FinOps-style fixtures you can drop into any dbt project
- **[Jaffle Shop Lightdash demo](../examples/jaffle_shop_lightdash/README.md#fragments--templates-in-this-project)** — working fragments and a template inside the example project

## Quick start

1. Create `my_columns.fragment.json` with `"kind": "select"` and a `select` array.
2. In a model `select` (or CTE `select`): `{ "type": "all_from_fragment", "fragment": "my_columns" }`.
3. Run **DJ: Sync to SQL and YML**.

For config shared across models, use `"kind": "config"` fragments and list them on the model: `"fragments": ["my_config"]`.

## Tips

- Keep **authored** `.model.json` as the source of truth; sync never flattens fragments into the file.
- Use **DJ: Preview Resolved Model JSON** on a model to inspect the merged result before compile.
- CLI `model.get` returns both `raw` (on disk) and `resolved` (used for SQL/YAML).
