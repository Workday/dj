# Refactoring with fragments and templates

Use these recipes when cleaning up existing `.model.json` files—manually or with an AI agent.

## Before you start

1. Run **DJ: Sync to SQL and YML** so SQL/YAML match current JSON.
2. Note current behavior (compile, key columns, Lightdash explores).
3. Prefer small steps: one fragment or one template at a time.

## Recipe 1: Duplicate columns → select fragment

**When:** Three or more models share the same `select` entries (or the same FinOps column set).

**Steps:**

1. Create `shared_columns.fragment.json` with `"kind": "select"` and copy the shared `select` entries into `select`.
2. In each model, replace those entries with one include:

   ```jsonc
   { "type": "all_from_fragment", "fragment": "shared_columns" }
   ```

3. Use `overrides` where source `expr` differs per model.
4. Sync and compare `model.get` **resolved** output to the pre-refactor resolved shape (or compare compiled SQL).

**Agent skill:** [`dj-extract-shared-fragments`](../../templates/skills/dj-extract-shared-fragments/_SKILL.md)

## Recipe 2: Duplicate config → config fragment

**When:** Many models repeat the same `materialization`, `tags`, or `meta` block.

**Steps:**

1. Create `my_team_defaults.fragment.json` with `"kind": "config"`.
2. Move shared keys into the fragment.
3. On each model, add `"fragments": ["my_team_defaults"]` and remove duplicated keys from the model.
4. Sync; check generated YAML for tags and materialization.

**Jaffle example:** `jaffle_lightdash_explore` on reporting marts — see [project README](../../examples/jaffle_shop_lightdash/README.md#fragments--templates-in-this-project).

## Recipe 3: Model family → template + children

**When:** Several marts differ only by upstream model, provider label, or a few extra columns.

**Steps:**

1. Pick the most complete model as a reference; extract the common body into `my_mart.template.json` with `params` for what varies.
2. Replace `${placeholders}` in the template `model` section.
3. For each variant, create a child with identity fields + `extends` + `with` + only the delta `select` / `ctes`.
4. Delete or slim down the old monolithic JSON files.
5. Sync each child; fix composition errors in the Problems tab.

**Jaffle example:** `mart__sales__reporting__profitability` extends `jaffle_store_reporting_base`.

## Verification checklist

| Check | How |
|-------|-----|
| Authored file still small | Open `.model.json` — should still show `extends` / `*_from_fragment`, not expanded columns |
| Resolved shape correct | CLI `model.get` → compare `resolved` to pre-change baseline |
| SQL/YAML updated | Sync; diff `.sql` / `.yml` in git |
| Dependencies | `dbt compile` for template `model_ref` params |
| Lineage | Column lineage on a fragment-expanded column |

## Common mistakes

- Putting select columns in a **config** fragment — use `kind: "select"` instead.
- Using `extends` without `with` when the template declares required params — composition errors list missing params.
- Expecting sync to inline fragments into `.model.json` — it will not; use **Preview Resolved Model JSON** to inspect merge output.

## Next

[Tooling and agents](06-tooling-and-agents.md)
