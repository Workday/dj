---
name: dj-edit-lightdash-yaml
description: >-
  Edit Lightdash chart or dashboard YAML files managed by the DJ extension's
  Dashboards-as-Code workflow. Use when the user wants to tweak a chart's
  filters, sorts, axes, table config, or dashboard tiles/filters locally before
  re-uploading to Lightdash via the `DJ: Lightdash — Dashboards as Code`
  webview.
compatibility: DJ (Data JSON) Framework extension workspace with .agents/dj/AGENTS.md and a populated `lightdash/` directory
metadata:
  dj-skill: '1.0'
---

# Edit Lightdash YAML (Dashboards as Code)

Modify chart and dashboard YAML files written by `lightdash download` so the
user can re-`lightdash upload` them. Do **not** run the CLI yourself — the user
runs it from the `DJ: Lightdash — Dashboards as Code` webview, which also keeps
the YAML schema bindings in sync.

## When this skill applies

- The user wants to change a saved chart's filters, sorts, limit, axis labels,
  custom metrics, or table calculations.
- The user wants to add/remove/rearrange tiles on a dashboard, or change
  dashboard-level filters.
- The user has already downloaded YAML for the asset (`lightdash/charts/<slug>.yml`
  or `lightdash/dashboards/<slug>.yml`). If the file does not yet exist, ask
  them to run the Download tab (entire project, or specific assets) first.

## Workflow

1. **Locate the file.** Charts live at `<dashboardsAsCodePath>/charts/<slug>.yml`,
   dashboards at `<dashboardsAsCodePath>/dashboards/<slug>.yml`. The base path
   defaults to `lightdash` and is exposed via the
   `dj.lightdash.dashboardsAsCodePath` setting; if unsure, read it or ask.
2. **Read the file in full** before editing. The Lightdash YAML schemas evolve;
   preserving unfamiliar keys is critical for round-trip safety.
3. **Confirm the schema.** Check the `# yaml-language-server: $schema=…` header
   (or the workspace's `yaml.schemas` binding) for the chart-as-code or
   dashboard-as-code schema URL before adding or renaming fields.
4. **For chart edits referencing dbt models**, open the upstream `.model.json`
   and verify the `lightdash` block exposes the dimensions/metrics the chart
   references. If the chart needs a new metric or dimension, add it to the
   `.model.json` first (so DJ regenerates the dbt YAML), then reference it from
   the chart YAML.
5. **For dashboard edits referencing charts**, ensure every
   `properties.savedChartSlug` (or equivalent) matches a chart slug that exists
   locally under `charts/` or already exists on Lightdash.
6. **Make the smallest possible diff.** Edit only the fields the user asked
   about and leave everything else byte-identical.
7. **Tell the user to re-upload via the Upload tab** of the
   `DJ: Lightdash — Dashboards as Code` webview. Selection-driven upload sends
   only the files they pick (the edited ones); selecting all (or nothing) runs
   an entire-project upload.

## Hard rules

- **Never change `slug`.** The slug is the primary key Lightdash uses to match
  the local file to the remote resource. Renaming creates a duplicate on upload.
- **Never change `version`.** It pins the schema; bumping by hand breaks upload.
- **Never delete a top-level key you do not recognize.** Preserve it.
- **Never run `lightdash download` / `lightdash upload` directly.** Use the
  extension's webview command so auth, working directory, and YAML schema
  bindings stay in sync.
- **Never edit `.sql` or `.yml` files under `models/`** as part of this skill —
  those belong to DJ's JSON-sync flow, not Dashboards-as-Code.

## Common edits

| Intent | Where in the YAML |
| --- | --- |
| Change a chart's row limit | `metricQuery.limit` |
| Add/remove a chart filter | `metricQuery.filters` (preserve `id` UUIDs on existing filter rules) |
| Re-order chart sorts | `metricQuery.sorts` (each entry has `fieldId` and `descending`) |
| Add a custom table calc | `metricQuery.tableCalculations` |
| Toggle column visibility | `tableConfig.columnOrder` and the chart's `chartConfig` |
| Add a tile to a dashboard | append to `tiles`, set `type`, `properties`, and a non-overlapping `x/y/w/h` |
| Add a dashboard-level filter | `filters.dimensions` / `filters.metrics` / `filters.tableCalculations` |
| Rename what's shown in the UI | `name`, `description`, axis `label` fields, dimension `label` overrides — never `slug` |

## Gotchas

- **Filter `id` is a stable UUID.** When editing an existing filter rule, keep
  its `id`. Generate a new UUID only for brand-new rules.
- **Tile layout is grid-based.** Lightdash dashboards use a 36-column grid.
  Overlapping `x/y/w/h` rectangles will render in unexpected stacking order;
  shift other tiles before adding a new one.
- **`exploreName` is the dbt model's Lightdash table name**, not the
  `<group>__<topic>__<name>` model name. It usually maps to the model's
  `lightdash.table.label` slugified, but confirm via the model's generated YAML
  if uncertain.
- **`additionalMetrics` is local to the chart.** If the user wants this metric
  available across multiple charts, add it to the model's `lightdash` block
  instead and reference it from `metricQuery.metrics`.
- **`--force` is required for net-new files.** If the user authored a chart or
  dashboard YAML by hand (rather than downloading), they must enable the
  `--force` toggle in the Upload tab so Lightdash creates the new resource.
- **`--include-charts` only matters for dashboard uploads.** It tells Lightdash
  to also upload any charts referenced by the selected dashboard. Mention it
  if the user is uploading a dashboard that references newly-added local
  charts.
