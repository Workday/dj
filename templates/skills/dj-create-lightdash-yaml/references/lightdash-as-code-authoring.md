# Lightdash Dashboards-as-Code: authoring reference

Detailed recipes for hand-authoring net-new chart/dashboard YAML in a DJ
workspace. Placeholders in `<angle brackets>` (e.g. `<explore>`, `<date_dim>`,
`<metric>`) stand in for your project's real names.

The chart/dashboard JSON schemas are bound via the `yaml.schemas` setting in the
workspace `.vscode/settings.json`:

- charts -> `chart-as-code-1.0.json`
- dashboards -> `dashboard-as-code-1.0.json`

Both schemas use `version: 1`.

## 1. Minimum required keys

Validate against the bound schema; do not invent fields.

- **Chart:** `name`, `slug`, `version: 1`, `spaceSlug`, `tableName`,
  `metricQuery`, `chartConfig`, `tableConfig.columnOrder`.
  `metricQuery` requires: `exploreName`, `dimensions`, `metrics`, `sorts`,
  `limit`, `tableCalculations`, `filters`.
- **Dashboard:** `name`, `slug`, `version: 1`, `spaceSlug`, `tabs` (use `[]` if
  untabbed), `tiles`, `filters`.
- Always start the file with the schema header so the editor validates as you
  type:
  `# yaml-language-server: $schema=https://raw.githubusercontent.com/lightdash/lightdash/refs/heads/main/packages/common/src/schemas/json/chart-as-code-1.0.json`

## 2. Field-ID convention (the #1 source of errors)

Lightdash field IDs are derived mechanically -- derive them, do not guess from
labels:

- **Dimension:** `<explore>_<column>`
- **Time-interval dimension:** append the granularity to the base time column:
  `<explore>_<date_dim>_day`, `_week`, `_month`, `_year`,
  `_day_of_week_name`. The bare `<explore>_<date_dim>` is the raw timestamp.
- **Metric:** `<explore>_<metric_name>` where `<metric_name>` is the `name`
  under the model's `lightdash.metrics` (custom) or the framework default (e.g.
  `metric_<column>_sum`).
- **`exploreName` and `tableName`** both equal the **dbt model name** (= the
  explore `baseTable`), NOT the slugified `lightdash.table.label`. The label is
  display-only.

Fastest lookup: `scripts/get_explore_fields.py --project <uuid> --explore <name>`
or `GET /api/v1/projects/{projectUuid}/explores/{exploreName}` (read
`results.baseTable` and `results.tables[baseTable].dimensions|metrics`).

## 3. Required filters (do not skip)

The DJ framework can auto-add a date `required_filters` to the generated model
YAML, e.g.:

```yaml
meta:
  required_filters:
    - <date_dim>: inThePast 14 days
```

Any chart on that explore MUST include a filter on that base field
(`<explore>_<date_dim>`), or the query errors. Target the base timestamp, not an
interval variant.

## 4. Canonical date filter ("in the last N days")

```yaml
metricQuery:
  filters:
    dimensions:
      id: <group-uuid>
      and:
        - id: <rule-uuid>
          target:
            fieldId: <explore>_<date_dim>
          operator: inThePast
          values:
            - 30
          settings:
            unitOfTime: days
            completed: false
```

- Generate fresh UUIDs for brand-new rules; preserve them when editing later
  (the edit skill matches rules by `id`).
- Widening the window (e.g. 30 -> 90) is purely a filter change; no dbt rebuild
  is needed when the model is a view over a full-history upstream.

## 5. Cartesian chart (bars/lines)

`chartConfig.type: cartesian`. Required: `config.layout` and
`config.eChartsConfig`. Each series needs `type` and `encode` (with `xRef.field`
and `yRef.field`).

```yaml
chartConfig:
  type: cartesian
  config:
    layout:
      xField: <explore>_<category_dim>
      yField:
        - <explore>_<metric>
      showGridY: true
    eChartsConfig:
      series:
        - type: bar           # line | bar | scatter | area
          encode:
            xRef:
              field: <explore>_<category_dim>
            yRef:
              field: <explore>_<metric>
```

## 6. Time series stacked/split by a category (pivot)

To put time on the x-axis and split a metric by a category -- a great
"filter change is obvious" visual because widening the date window visibly
extends the axis:

```yaml
metricQuery:
  dimensions:
    - <explore>_<date_dim>_week
    - <explore>_<category_dim>
  metrics:
    - <explore>_<metric>
  pivotDimensions:
    - <explore>_<category_dim>
  # ... sorts (by the time field, ascending), limit (high enough for periods x categories), filters ...
pivotConfig:
  columns:
    - <explore>_<category_dim>
chartConfig:
  type: cartesian
  config:
    layout:
      xField: <explore>_<date_dim>_week
      yField:
        - <explore>_<metric>
    eChartsConfig:
      series:
        - type: bar
          stack: <stack-group>               # shared string -> stacked
          encode:
            xRef:
              field: <explore>_<date_dim>_week
            yRef:
              field: <explore>_<metric>
              pivotValues:
                - field: <explore>_<category_dim>
                  value: <category value>     # one series per enumerated value
```

Notes:
- Enumerate one series per pivot value you want to style/stack; values not listed
  still render with default styling. Enumerating only the top N is a clean way to
  highlight the biggest contributors.
- `pivotDimensions` (in `metricQuery`) and `pivotConfig.columns` (top-level) must
  both name the category field.

## 7. Dashboard tiles

Tiles need `type`, `x`, `y`, `w`, `h` (36-column grid) and `properties`. Common
types:

```yaml
tiles:
  - type: markdown          # context / titles
    x: 0
    y: 0
    w: 36
    h: 4
    tabUuid: null
    properties:
      title: "<dashboard title>"
      content: |
        ### <heading>
        <free-form markdown context>
  - type: saved_chart
    x: 0
    y: 4
    w: 36
    h: 12
    tabUuid: null
    properties:
      chartSlug: <chart-slug>     # must match a local chart slug or an existing chart
      title: "<tile title>"
```

Other tile types: `sql_chart`, `loom`, `heading`, `data_app`. Keep `x/y/w/h`
rectangles non-overlapping.

## 8. Uploading

Don't tell the user to run the upload CLI directly. Either point them to the
`DJ: Lightdash - Dashboards as Code` webview (paste the project UUID in the
required Project UUID field), or offer to run the command yourself after
confirming the target project. The equivalent command:

```
lightdash upload --force --include-charts --validate \
  --project <project-uuid> \
  -c <chart-slug> -d <dashboard-slug>
```

- `--force`: required for files Lightdash has not seen before (net-new).
- `--include-charts`: when uploading a dashboard that references newly-added
  local charts.
- `--validate`: runs Lightdash's content validator against the live explore
  (catches bad field IDs, missing chart slugs). The YAML schema cannot do this.
- Missing spaces are auto-created unless `--skip-space-create`; pass an existing
  `spaceSlug` (from `get_explore_fields.py --spaces`) to avoid creating one.

## 9. Gotchas

- **Schema validates structure, not meaning.** Clean lint != valid chart. Always
  `--validate`.
- **"unsorted YAML keys" warning is cosmetic.** Hand-authored files trigger it;
  upload still succeeds. Sort keys alphabetically only to silence it.
- **`lightdash download -c <slug>` can return 0 files** for some slugs; do not
  rely on it to fetch a template. Author from this reference + the explore API
  instead.
- **Prod is often blocked.** If a project is listed in
  `dj.lightdash.restrictedProjects` (workspace `.vscode/settings.json`) with
  `mode: block`, as-code uploads to it are rejected; target a preview project
  UUID instead.
- **Verify data before relying on a chart.** Confirm the chart returns rows with
  `POST /api/v1/projects/{uuid}/explores/{exploreName}/runQuery` (same
  dimensions/metrics/filters as the chart) so the rendered view is not empty.
