---
name: dj-edit-lightdash-yaml
description: >-
  Edit existing Lightdash chart or dashboard YAML files managed by the DJ
  extension's Dashboards-as-Code workflow. Use when the user wants to tweak a
  chart's filters, sorts, axes, table config, or dashboard tiles/filters in YAML
  that already exists locally (downloaded or previously authored) before
  re-uploading via the `DJ: Lightdash - Dashboards as Code` webview. To create a
  brand-new chart/dashboard from scratch, use `dj-create-lightdash-yaml` instead.
compatibility: DJ (Data JSON) Framework extension workspace with .agents/dj/AGENTS.md and a populated `lightdash/` directory
metadata:
  dj-skill: '1.0'
---

# Edit Lightdash YAML (Dashboards as Code)

Modify chart and dashboard YAML files that already exist locally (written by a
download step, or previously authored) so they can be re-uploaded. Don't tell the
user to run the upload CLI directly: either point them to the
`DJ: Lightdash - Dashboards as Code` webview (which keeps auth and YAML schema
bindings in sync), or **offer to run the command yourself** after confirming the
target project.

## When this skill applies

- The user wants to change a saved chart's filters, sorts, limit, axis labels,
  custom metrics, or table calculations.
- The user wants to add/remove/rearrange tiles on a dashboard, or change
  dashboard-level filters.
- The user has already downloaded YAML for the asset (`lightdash/charts/<slug>.yml`
  or `lightdash/dashboards/<slug>.yml`). If the file does not yet exist, either
  point them to the webview's Download tab (or offer to fetch it yourself) first,
  or — for a genuinely new asset — switch to the **`dj-create-lightdash-yaml`**
  skill.

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
   the chart YAML. For exact field-ID derivation, see
   `references/lightdash-as-code-fields.md`.
5. **For dashboard edits referencing charts**, ensure every
   `properties.chartSlug` (or equivalent) matches a chart slug that exists
   locally under `charts/` or already exists on Lightdash.
6. **Make the smallest possible diff.** Edit only the fields the user asked
   about and leave everything else byte-identical.
7. **Re-upload — but don't tell the user to run the CLI directly.** Either point
   them to the Upload tab of the `DJ: Lightdash - Dashboards as Code` webview
   (selection-driven upload sends only the files they pick; selecting all or
   nothing runs an entire-project upload), or **offer to run the upload command
   yourself** after confirming the target project.

## Hard rules

- **Never change `slug`.** The slug is the primary key Lightdash uses to match
  the local file to the remote resource. Renaming creates a duplicate on upload.
- **Never change `version`.** It pins the schema; bumping by hand breaks upload.
- **Never delete a top-level key you do not recognize.** Preserve it.
- **Don't instruct the user to run `lightdash download` / `lightdash upload`
  directly.** Either point them to the extension's webview (so auth, working
  directory, and YAML schema bindings stay in sync), or offer to run the command
  yourself after confirming the target project.
- **Confirm the target project before uploading; never assume prod.** State the
  project UUID/name you will upload to and get explicit confirmation. If it is a
  production project or listed in `dj.lightdash.restrictedProjects`, call that out
  and confirm again — the restriction only guards the webview Upload tab, not a
  direct `lightdash upload`. Prefer a preview project unless the user chose prod.
- **Never edit `.sql` or `.yml` files under `models/`** as part of this skill —
  those belong to DJ's JSON-sync flow, not Dashboards-as-Code.

## Common edits

| Intent                                         | Where in the YAML                                                                      |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| Change a chart's row limit                     | `metricQuery.limit`                                                                    |
| Change a date window (e.g. last 30 -> 90 days) | `metricQuery.filters.dimensions.and[].values` (keep the rule `id` UUID)                |
| Add/remove a chart filter                      | `metricQuery.filters` (preserve `id` UUIDs on existing filter rules)                   |
| Re-order chart sorts                           | `metricQuery.sorts` (each entry has `fieldId` and `descending`)                        |
| Add a custom table calc                        | `metricQuery.tableCalculations`                                                        |
| Toggle column visibility                       | `tableConfig.columnOrder` and the chart's `chartConfig`                                |
| Add a tile to a dashboard                      | append to `tiles`, set `type`, `properties`, and a non-overlapping `x/y/w/h`           |
| Add a dashboard-level filter                   | `filters.dimensions` / `filters.metrics` / `filters.tableCalculations`                 |
| Rename what's shown in the UI                  | `name`, `description`, axis `label` fields, dimension `label` overrides — never `slug` |

## Gotchas

- **Filter `id` is a stable UUID.** When editing an existing filter rule, keep
  its `id`. Generate a new UUID only for brand-new rules.
- **Tile layout is grid-based.** Lightdash dashboards use a 36-column grid.
  Overlapping `x/y/w/h` rectangles will render in unexpected stacking order;
  shift other tiles before adding a new one.
- **`exploreName` and `tableName` are the dbt model name** - i.e. the explore's
  `baseTable`, NOT the slugified `lightdash.table.label`. The `label` is only the display name shown
  in the UI; it never appears in field IDs or `exploreName`. When in doubt, read
  the explore's `baseTable` from
  `GET /api/v1/projects/{projectUuid}/explores/{exploreName}` (or the Tables
  page URL), not the model's label.
- **`additionalMetrics` is local to the chart.** If the user wants this metric
  available across multiple charts, add it to the model's `lightdash` block
  instead and reference it from `metricQuery.metrics`.
- **Editing a value vs editing references.** Changing filter `values`, `limit`,
  `sorts`, labels, or tile layout is safe in-place. Changing any `fieldId`
  requires a real field ID — see `references/lightdash-as-code-fields.md`.
- **The bound YAML schema catches structure, not meaning.** It flags unknown
  keys, wrong types, and missing required fields in-editor, but it cannot know
  whether a `fieldId` exists in the explore, whether a `chartSlug` resolves, or
  whether filter UUIDs are consistent. Those only fail at upload - always upload
  with `--validate` and treat a clean editor as necessary, not sufficient.
- **Sort YAML keys alphabetically.** `lightdash upload` warns
  `<file> has unsorted YAML keys`. Keep mapping keys sorted at every level when you
  edit (this matches what `lightdash download` emits). Sort **mapping keys only --
  never reorder list items** (`tiles`, `dimensions`, `sorts`, `series`,
  `columnOrder` are order-sensitive). Keep the `# yaml-language-server` header on
  top. Use a key sorter if available (e.g. `yq 'sort_keys(..)'` / your editor's
  formatter), else keep keys in alphabetical order.
- **A round-tripped file is normalized.** After `lightdash upload`/`download` the
  local file is rewritten: mapping keys alphabetized, server fields added
  (`contentType`, `chartName`, `tileSlug`, `verification`, `hideFrame`, ...), the
  `# yaml-language-server` header stripped, and block scalars reflowed (`|` ->
  `>`). Re-read the file before each edit (it won't match what you last authored)
  and match on minimal unique substrings. The missing header is harmless -- the
  workspace `yaml.schemas` path binding still validates.

## References

- [references/lightdash-as-code-fields.md](references/lightdash-as-code-fields.md)
  -- field-ID derivation, the canonical filter-rule shape, and upload flags
  (shared with `dj-create-lightdash-yaml`).
