# Marts that back a Lightdash explore: recipes

Recipes for `.model.json` marts that surface as a Lightdash explore/dashboard.
Placeholders in `<angle brackets>` (e.g. `<date_dim>`, `<fct_col>`,
`<metric_name>`) stand in for your project's real names. Author everything in the
`.model.json` source of truth -- DJ regenerates the `.sql`/`.yml`.

## 1. Default time window for dashboard-facing marts (`required_filters`)

If an explore should default to a recent window (e.g. "last 30 days" in every
chart), declare a **model-level required date filter**. Author it under
`lightdash.table.required_filters` in the `.model.json` -- NOT under `meta`. (The
`meta.required_filters` you may see in generated dbt YAML is the compiled output;
the source of truth is `lightdash.table.required_filters`.)

```json
{
  "lightdash": {
    "table": {
      "label": "<Explore Label>",
      "required_filters": [
        { "<date_dim>": "inThePast 30 days" }
      ]
    }
  }
}
```

- Every chart on the explore inherits a filter on `<date_dim>`, so you do not
  have to re-add it per chart (individual charts may still narrow the window).
- Schema: `.dj/schemas/lightdash.required_filters.schema.json` (an array of
  `{ "<dim>": "<filter expression>" }`), referenced from
  `.dj/schemas/lightdash.table.schema.json`.

## 2. Summable metric on a passthrough mart (`mart_select_model`)

`mart_select_model` (and `int_union_models`) cannot use `agg`/`aggs` in `select`.
To expose a summable measure, keep the fact column as a passthrough/`expr` column
and define the metric under that column's `lightdash.metrics`:

```json
{
  "name": "<fct_col>",
  "type": "fct",
  "data_type": "number",
  "expr": "<fct_col>",
  "description": "<what this measures>",
  "lightdash": {
    "dimension": { "hidden": true },
    "metrics": [
      {
        "name": "<metric_name>",
        "type": "sum",
        "label": "<Metric Label>",
        "format": "usd",
        "round": 0,
        "sql": "coalesce(<fct_col>, 0)"
      }
    ]
  }
}
```

- Hide the raw fact dimension (`dimension.hidden: true`) so only the metric shows
  in the explore.
- The metric's Lightdash field ID becomes `<explore>_<metric_name>` (used when
  authoring charts -- see the `dj-create-lightdash-yaml` skill).

## 3. Framework columns on a Lightdash mart (which exclude flag to use)

- **Time-series mart** (keeps a `datetime`/date dimension): set only the
  individual flags you want, e.g. `exclude_portal_source_count` and/or
  `exclude_portal_partition_columns`. Do **not** use the
  `exclude_framework_artifacts` bundle here -- `"columns"`/`"all"` also drop
  `datetime`, which you need as the date dimension.
- **Pure lookup / dimension mart** (no time grain): the
  `exclude_framework_artifacts: "columns"` (or `"all"`) shortcut is the clean way
  to drop all framework columns at once.

## 4. How validation works (do not assume external validators)

- **Structure** is checked by the editor's bound JSON schema -- a DJ workspace
  binds `*.model.json` to `.dj/schemas/model.schema.json` -- and by the DJ
  extension regenerating the `.sql`/`.yml` and surfacing diagnostics in the
  Problems tab on save.
- **Do not assume** standalone validators (`jsonschema`, `pyyaml`, `pip`) are
  installed in your environment; they often are not. If you need to inspect a
  file from the shell, use a tool you have confirmed is present.
- Lightdash field-ID/semantic validation happens later, at
  `lightdash upload --validate` (see the Lightdash skills).
