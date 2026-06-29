# Lightdash Dashboards-as-Code: field IDs, filters, upload

Shared reference for editing chart/dashboard YAML in a DJ workspace.
Placeholders in `<angle brackets>` stand in for your project's real names. (The
full authoring guide, including chartConfig and pivot recipes, lives in
`dj-create-lightdash-yaml`.)

## Field-ID convention

Lightdash field IDs are derived mechanically. Derive them; do not guess from
labels.

- **Dimension:** `<explore>_<column>`
- **Time-interval dimension:** append the granularity to the base time column:
  `<explore>_<date_dim>_day`, `_week`, `_month`, `_year`, `_day_of_week_name`.
  The bare `<explore>_<date_dim>` is the raw timestamp.
- **Metric:** `<explore>_<metric_name>` where `<metric_name>` is the `name`
  under the model's `lightdash.metrics` (custom) or the framework default (e.g.
  `metric_<column>_sum`).
- **`exploreName` / `tableName`** = the dbt model name (= explore `baseTable`),
  never the slugified `lightdash.table.label`.

Lookup (read-only): `GET /api/v1/projects/{projectUuid}/explores/{exploreName}`
and read `results.baseTable` + `results.tables[baseTable].dimensions|metrics`.
The `dj-create-lightdash-yaml` skill ships `scripts/get_explore_fields.py` for
this.

## Canonical date filter ("in the last N days")

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

- **Keep the `id` UUIDs** when editing an existing rule (Lightdash matches rules
  by `id`). Only generate new UUIDs for brand-new rules.
- To change the window, edit only `values` (e.g. `30` -> `90`). No dbt rebuild is
  needed when the model is a view over full-history upstream data -- the filter is
  applied at query time.
- Honor the model's required date filter: a chart must keep a filter on that base
  field or its query errors. The source is the mart's `.model.json` under
  `lightdash.table.required_filters` (authored via `dj-create-new-model`);
  `meta.required_filters` is only the generated dbt-YAML view -- change it in the
  model, not here.

## Upload flags

Don't tell the user to run the upload CLI directly: either point them to the
`DJ: Lightdash - Dashboards as Code` webview, or offer to run it yourself after
confirming the target project. The equivalent command:

```bash
lightdash upload --force --include-charts --validate \
  --project <project-uuid> -c <chart-slug> -d <dashboard-slug>
```

- `--force`: needed for files Lightdash has not seen before (net-new).
- `--include-charts`: when a dashboard references newly-added local charts.
- `--validate`: runs the content validator against the live explore -- the only
  check for bad field IDs / missing chart slugs.
- Spaces are auto-created unless `--skip-space-create`; use an existing
  `spaceSlug` to avoid creating one.
- A `mode: block` entry in `dj.lightdash.restrictedProjects` (workspace
  `.vscode/settings.json`) only makes the DJ **Upload tab** refuse the push -- a
  guardrail against editing prod by mistake. A direct `lightdash upload` still
  works if you have Lightdash access, so target the intended (usually preview)
  project UUID deliberately.
