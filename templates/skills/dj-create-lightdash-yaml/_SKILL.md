---
name: dj-create-lightdash-yaml
description: >-
  Create brand-new Lightdash chart and dashboard YAML (Dashboards-as-Code) from
  scratch for a dbt model/explore managed by the DJ extension. Use when the user
  wants to build, author, or scaffold a chart or dashboard that does not exist
  yet (no prior `lightdash download`) and then upload it. For tweaking an
  already-downloaded chart/dashboard, use `dj-edit-lightdash-yaml` instead.
compatibility: DJ (Data JSON) Framework extension workspace with .agents/dj/AGENTS.md, a deployed/preview Lightdash project, and the chart/dashboard JSON schemas bound in .vscode/settings.json
metadata:
  dj-skill: '1.0'
---

# Create Lightdash YAML (Dashboards as Code)

Author **net-new** `lightdash/charts/<slug>.yml` and `lightdash/dashboards/<slug>.yml`
files for an existing explore, then upload them with `--force`. This is the
"build me a dashboard from this model" path. To edit YAML that already exists
locally (downloaded), use `dj-edit-lightdash-yaml`.

The hard part is not the YAML shape (the bound schema guides that) -- it is using
the **exact** field IDs, honoring the model's **required filters**, and knowing
that the **schema cannot validate references**. The detailed, copy-pasteable
recipes live in `references/lightdash-as-code-authoring.md`; load it before
writing.

## Prerequisites (the explore must already exist)

A chart references field IDs that only exist once the model is deployed as a
Lightdash **explore**. Before authoring:

1. The dbt model has `tags: ["lightdash", "lightdash-explore"]` and a built
   relation (dev view is fine).
2. The model is deployed to a project you can target -- usually a **preview**.
   Create it through the DJ extension's Lightdash preview tooling, or **offer to
   run the command yourself** (after confirming with the user) -- do not tell the
   user to run it directly. The equivalent CLI is:
   `lightdash start-preview --name "<name>" --profiles-dir ~/.dbt --project-dir <dir> -s <model>`
   - Do NOT pass `--defer` to `start-preview` (it routes to `dbt ls`, which
     rejects `--defer`). Pass `-y` to skip the credential prompt so the preview
     stores warehouse creds that can read your dev relation.
   - The prod project is typically `block`ed in `dj.lightdash.restrictedProjects`
     (`.vscode/settings.json`); uploads must target the
     preview UUID.
3. Capture the **preview project UUID** (printed as `.../projects/<uuid>/tables`).

## Workflow

1. **Resolve the explore + exact field IDs.** This is read-only, so just run the
   helper yourself:
   `scripts/get_explore_fields.py --project <uuid> --explore <model_name>`.
   It needs the Lightdash base URL, an API token, and the project UUID -- pass
   them as `--url` / `--api-key` / `--project` flags, or rely on the standard
   `LIGHTDASH_URL` / `LIGHTDASH_API_KEY` / `LIGHTDASH_PROJECT` env vars (the same
   names the Lightdash CLI and DJ extension use). If those are not set, ask the
   user for the values rather than guessing. It prints the
   `baseTable` (= `exploreName`/`tableName`), every dimension/metric field ID
   (including per-interval date variants like `<explore>_<date_dim>_week`), and
   -- with `--spaces` -- valid `spaceSlug` values. If the API is unavailable, open the
   project Tables page and read IDs there. **Never guess IDs from labels.**
2. **Read** `references/lightdash-as-code-authoring.md` for required keys, the
   field-ID convention, the canonical date filter, the pivot recipe, the
   cartesian `chartConfig` skeleton, and dashboard tile types.
3. **Author the chart** at `lightdash/charts/<slug>.yml` with the
   `# yaml-language-server: $schema=...` header (the `yaml.schemas` binding in the
   workspace `.vscode/settings.json`). Include the model's **required date filter**.
4. **Author the dashboard** at `lightdash/dashboards/<slug>.yml`; reference the
   chart via a `saved_chart` tile's `properties.chartSlug`. Add a `markdown`
   tile for context if helpful.
5. **Upload.** Do not instruct the user to run the upload CLI directly. Offer one
   of two paths: (a) they upload from the `DJ: Lightdash - Dashboards as Code`
   webview Upload tab (paste the preview UUID, enable `--force`, and
   `--include-charts` for the dashboard), or (b) you **offer to run the command
   yourself** after confirming the target project UUID. The equivalent command is
   `lightdash upload --force --include-charts --validate --project <uuid> -c <chart-slug> -d <dashboard-slug>`.
   Always `--validate` -- it is the only thing that catches bad field IDs / missing
   chart slugs.

## Hard rules

- **Honor model-level required filters.** The DJ framework can auto-add a date
  `required_filters` (e.g. `<date_dim>: inThePast N days`) to the generated model
  YAML. Every chart on that explore MUST filter on that base field
  (`<explore>_<date_dim>`, not an interval variant) or the query errors.
- **`exploreName` and `tableName` are the dbt model name** (the explore
  `baseTable`), never the slugified `lightdash.table.label`.
- **Net-new files require `--force`.** Without it, upload silently skips files
  Lightdash has never seen.
- **The bound YAML schema validates structure, not meaning.** A clean editor
  does not prove field IDs exist -- only `lightdash upload --validate` does.
- **Never hand-edit `.sql`/`.yml` under `models/`** -- those are DJ's JSON-sync
  output. To add a metric/dimension a chart needs, edit the upstream
  `.model.json` first (use `dj-create-new-model`), let DJ regenerate, redeploy
  the explore, then reference it.
- **Don't tell the user to run `lightdash` commands directly.** For any CLI step
  (preview, upload), either point them to the matching DJ webview, or offer to run
  the command yourself after confirming the target project -- the webview keeps
  auth, cwd, and schema bindings in sync, and running it yourself keeps the user
  out of the terminal.

## References

- [references/lightdash-as-code-authoring.md](references/lightdash-as-code-authoring.md)
  -- required keys, field-ID rules, filter/pivot recipes, chartConfig skeleton,
  tile types, and upload flags.
- [scripts/get_explore_fields.py](scripts/get_explore_fields.py) -- read-only
  field-ID and space-slug lookup against the Lightdash API.
