# Fragments and templates

DJ supports reusable **fragments** (`*.fragment.json`) and **templates** (`*.template.json`) so teams can share column sets and model shapes without copy-paste. Place shared files anywhere under the dbt project; DJ discovers them on sync.

## Raw vs resolved

| | **Raw (on disk)** | **Resolved (in memory)** |
|---|-------------------|---------------------------|
| Purpose | What you commit in `.model.json` | What sync, validation, lineage, and preview use |
| Contains | `extends`, `with`, `fragments`, `*_from_fragment`, your deltas | Fragments expanded; templates merged; `${param}` substituted |
| Persistence | Always keep authored JSON | Never written back to the model file |

Generated `.sql` / `.yml` come from the resolved model. Do not edit generated files.

## Select fragments

`kind: "select"` plus a `select` array (same column shapes as on a model). File basename must match `"name"` (`focus_cost_columns.fragment.json` → `"name": "focus_cost_columns"`).

**Reference in model or CTE `select`:**

```jsonc
{ "type": "all_from_fragment", "fragment": "focus_cost_columns" }
```

| `type` | Includes |
|--------|----------|
| `all_from_fragment` | All columns |
| `dims_from_fragment` | `type: "dim"` only |
| `fcts_from_fragment` | `type: "fct"` only |

Optional `include` / `exclude` on the bulk row. **Overrides** when source column names differ:

```jsonc
{
  "type": "all_from_fragment",
  "fragment": "jaffle_item_line_dims",
  "overrides": {
    "item_id": { "expr": "id" },
    "product_sku": { "expr": "sku" }
  }
}
```

**Union legs:** when each `stg_union_sources` leg shares the same columns, define them once in a select fragment and use `all_from_fragment` per leg (or via a template).

## Config fragments

`kind: "config"` — shared `materialization`, `tags`, `meta`, `lightdash`, hooks, etc. (no `select` array).

```jsonc
"fragments": ["billing_daily_incremental", "shared_tags"]
```

| Merge | Behavior |
|-------|----------|
| Scalars / most objects | Later fragment wins; **model-authored values beat all fragments** |
| `tags` | Merged across fragments and model |
| `meta` | Deep-merge; model wins on conflict |

Select columns use `*_from_fragment` in `select`, not root `fragments`.

## Templates

`*.template.json` holds `params` plus a `model` body. Templates do not emit their own SQL/YAML — only child `.model.json` files do.

**Parameter types:** `model_ref` (must name an existing model) and `string`. Substitute with `${param}` in strings; literal `${` → `$${` in the template.

**Child model** keeps identity (`type`, `group`, `topic`, `name`):

```jsonc
"extends": "focus_monthly_cost",
"with": { "upstream": "stg__billing__costs__aws", "provider": "aws" }
```

| Field | Behavior |
|-------|----------|
| `select` / `ctes` | Default **merge** with template; `select_mode` / `ctes_mode`: `"replace"` to replace entirely |
| `select_exclude` / `ctes_exclude` | Drop inherited items by name |
| `fragments` on child | Extra config fragments |

The wizard loads the **merged** model for template children; save keeps a **minimal** child (deltas + `extends` / `with`) when possible.

## Agent workflow

1. `fragment.list` / `template.list` — discover shared files and `usedBy`.
2. `model.get` — compare **`raw`** (file) vs **`resolved`** (pre-SQL shape).
3. Edit `.model.json` / shared JSONC; preserve comments.
4. Sync (**DJ: Sync to SQL and YML** or CLI). Fix Problems-tab composition errors.
5. After refactors, confirm **`resolved`** matches the intended shape; **`raw`** should stay authored (references, not flattened columns).

**Extract duplicates:** skill `dj-extract-shared-fragments` under `.agents/skills/`.

## CLI and IDE

- `fragment.get`, `template.get`, `model.get` (`raw` + `resolved`)
- JSON Schema for `*.fragment.json` / `*.template.json`
- Go to definition on fragment/template names; CodeLens “Used by N models” on shared files
- **DJ: Preview Resolved Model JSON** on `.model.json`
