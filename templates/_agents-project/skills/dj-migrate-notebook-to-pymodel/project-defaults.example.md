# Notebook migration project defaults (example)

Copy to `.agents/project/skills/dj-migrate-notebook-to-pymodel/project-defaults.md`.

Also read `.agents/project/skills/dj-create-python-model/project-defaults.md` for shared schema/catalog/authoring defaults.

## default authoring shape

`hand-written` | `cells`

Inspect `dags/python_models/` siblings when unsure — match the dominant pattern.

## SQL discovery (project-specific)

Document any legacy SQL sources in this project (saved-query IDs, BI tools, commented SQL blocks). Example:

- When `query_id = 'saved-query:…'` appears, ask the user for the **current** live query text before porting.
- Do not treat commented SQL as authoritative when a live query reference exists.

## dialect cheatsheet

If present, read sibling file `trino-dialect-cheatsheet.md` in this same folder for legacy SQL → Trino rewrites.

## downstream registration

After migration, register output in: `<path/to/source>.source.json`

## incremental / backfill

| Mode | Mechanism |
| ---- | --------- |
| Incremental | Watermark + `context["ds"]` |
| Backfill | `context["dates"]` from Airflow topic `dates_in` |

## legacy idioms to flag

List project-specific patterns to drop or rewrite (e.g. Jenkins helpers, `df.to_sql` to non-Iceberg targets, hard-coded CLI date args).
