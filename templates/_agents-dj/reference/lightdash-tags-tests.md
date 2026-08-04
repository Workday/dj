# Lightdash, Tags & Data Tests

Load this when configuring Lightdash (model or column BI config), editing dashboards-as-code YAML, adding AI hints, tagging models, or declaring data tests.

For authoring or editing the exported dashboards-as-code YAML (chart / dashboard files under the dashboards-as-code path — `lightdash/` by default, configurable via `dj.lightdash.dashboardsAsCodePath`), use the `dj-create-lightdash-yaml` and `dj-edit-lightdash-yaml` skills — they cover the YAML shapes, field-ID rules, and upload gotchas this reference does not.

## Lightdash Configuration

### Model-level Lightdash

```jsonc
{
  "lightdash": {
    "table": {
      "label": "Daily Cost Summary",
      "group_label": "Cost Analytics",
      "ai_hint": "Daily aggregated costs by account and region",
      "sql_filter": "cost_sum > 0",
      "required_filters": ["portal_partition_daily"],
    },
    "metrics": [
      {
        "name": "total_cost",
        "type": "sum",
        "label": "Total Cost",
        "group_label": "Cost Metrics",
        "sql": "${TABLE}.cost_sum",
        "round": 0,
        "format": "usd",
      },
    ],
  },
}
```

### Column-level Lightdash

```jsonc
{
  "name": "cost",
  "type": "fct",
  "lightdash": {
    "dimension": { "hidden": true, "label": "Raw Cost", "group_label": "Cost" },
    "metrics": [
      {
        "name": "total_cost",
        "type": "sum",
        "label": "Total Cost",
        "format": "usd",
        "round": 0,
      },
    ],
    "metrics_merge": {
      "format": "usd",
      "round": 0,
      "group_label": "Cost Metrics",
    },
  },
}
```

## Lightdash Dashboards as Code

The DJ extension also exposes Lightdash's [Dashboards as Code](https://docs.lightdash.com/guides/developer/dashboards-as-code) workflow via the `DJ: Lightdash — Dashboards as Code` command. This is **separate from** the model-level `lightdash` config above (which generates `meta.dimensions` / `meta.metrics` blocks in the dbt-managed YAML). Dashboards-as-Code lets you author the actual saved charts and dashboards (the things visible in the Lightdash UI) as version-control-friendly YAML files.

### Layout

By default, the extension's `lightdash download` writes:

```text
<workspace_root>/lightdash/
├── charts/
│   └── <chart-slug>.yml
└── dashboards/
    └── <dashboard-slug>.yml
```

The base path is configurable via the `dj.lightdash.dashboardsAsCodePath` extension setting. The slug in the filename is also the slug used by the Lightdash CLI's `-c` / `-d` flags.

### When to edit these files

These YAML files are **inputs to `lightdash upload`**. Edit them when the user wants to tweak a chart's filters, axis labels, dashboard tiles, etc. without clicking through the Lightdash UI. Typical workflow:

1. User runs the Download tab (entire project or specific charts/dashboards).
2. You edit `<workspace_root>/lightdash/charts/<slug>.yml` or `…/dashboards/<slug>.yml`.
3. User runs the Upload tab (selection-driven by default — only edited files get pushed).

### YAML shape

Both file types are validated by official Lightdash JSON schemas (the extension auto-registers them with the Red Hat YAML extension). Top-level keys:

- **Chart** (`charts/*.yml`): `version`, `slug`, `name`, `description?`, `chartConfig`, `tableConfig`, `metricQuery` (`exploreName`, `dimensions`, `metrics`, `filters`, `sorts`, `limit`, `tableCalculations`, `additionalMetrics`), `dashboardSlug?`, `spaceSlug?`, `tags?`.
- **Dashboard** (`dashboards/*.yml`): `version`, `slug`, `name`, `description?`, `tabs?`, `tiles[]` (each tile has `type`, `properties`, layout `x/y/w/h`), `filters?`, `spaceSlug?`, `tags?`.

Read the file's `# yaml-language-server: $schema=…` header (or the auto-installed `yaml.schemas` binding) for the authoritative shape — do not invent fields.

### Editing rules

- **Do not change `slug`.** The slug is the primary key the upload uses to match local files to remote charts/dashboards. Renaming the slug creates a new resource on upload.
- **Do not change `version`.** It pins the schema; bumping it by hand will break the upload.
- **Preserve unfamiliar keys.** The schemas evolve; keep any field you do not recognize as-is so downloads stay round-trippable.
- **Reference existing dbt models, not raw tables.** `metricQuery.exploreName` and `metrics`/`dimensions` reference the model's Lightdash `table` / dimension / metric names — confirm they exist by reading the model's `.model.json` `lightdash` block. If a metric the user wants does not exist on the model, add it to the `.model.json` (regenerates the dbt YAML) before referencing it from the chart YAML.
- **Dashboard tiles must reference real chart slugs.** A dashboard tile's `properties.savedChartSlug` (or equivalent) must match a chart slug that exists either locally under `charts/` or already on Lightdash.
- **Use the extension's webview to invoke the CLI.** Do not shell out to `lightdash download` / `lightdash upload` directly — the webview handles auth, working directory, and YAML schema sync.

---

## AI Hints

`ai_hint` provides context to Lightdash's AI assistant. Can be placed at `lightdash.table.schema.json`, `lightdash.dimension.schema.json`, or `lightdash.metric.schema.json` level. Value can be a string or array.

To auto-tag columns with `ai_hint`, use: `"tags": [{ "tag": "cost_analysis", "type": "ai_hints" }]`

---

## Tags

Tags are used for model categorization, filtering, and Lightdash integration.

### Default Tags by Layer

The framework automatically assigns tags based on model layer:

| Layer  | Auto-Assigned Tag | Auto-Excluded Tags                                       |
| ------ | ----------------- | -------------------------------------------------------- |
| `stg`  | `staging`         | `intermediate`, `lightdash`, `lightdash-explore`, `mart` |
| `int`  | (none)            | `lightdash`, `lightdash-explore`, `staging`, `mart`      |
| `mart` | `mart`            | `staging`, `intermediate`                                |

This means:

- **Mart models automatically get the `mart` tag** — you don't need to add it manually
- Staging models won't appear in Lightdash by default (excluded from `lightdash` tag)
- To make a model appear in Lightdash, add the `lightdash` tag explicitly

### Tag Types

Tags can be simple strings or objects with a `type`:

```jsonc
{
  "tags": [
    "my_tag", // simple string — inherited by downstream models
    { "tag": "local_only", "type": "local" }, // NOT inherited downstream
    { "tag": "staging", "type": "exclude" }, // removes inherited tag
    { "tag": "cost_analysis", "type": "ai_hints" }, // auto-adds 'ai' tag to columns with ai_hint
  ],
}
```

| Type       | Behavior                                                           |
| ---------- | ------------------------------------------------------------------ |
| (string)   | Inherited by all downstream models                                 |
| `inherit`  | Explicitly inherit a tag from upstream models                      |
| `local`    | Applied only to this model, not inherited                          |
| `exclude`  | Removes a tag that would otherwise be inherited                    |
| `ai_hints` | Auto-adds `ai` tag to metrics/dimensions that have `ai_hint` field |

### Tag Inheritance

Tags flow downstream through the model DAG:

```text
stg model (tags: ["my_project"])
  → int model (inherits "my_project", adds "aggregated")
    → mart model (inherits "my_project", "aggregated", auto-adds "mart")
```

To prevent a tag from flowing downstream, use `"type": "local"`.

To remove an inherited tag, use `"type": "exclude"`.

---

## Data Tests

| Test                       | Use Case                                                          |
| -------------------------- | ----------------------------------------------------------------- |
| `equal_row_count`          | Joins where row count should stay the same (1-to-1 relationships) |
| `equal_or_lower_row_count` | Joins with filtering that may reduce rows                         |
| `no_null_aggregates`       | Ensure aggregation columns aren't null                            |
| `not_null`                 | Required columns that should never be null                        |
| `unique`                   | Primary key or unique identifier columns                          |

```jsonc
{
  "data_tests": [
    { "type": "equal_row_count", "column_name": "portal_partition_daily" },
  ],
}
```
