# Python model review project defaults (example)

Copy to `.agents/project/skills/dj-review-python-model/project-defaults.md`.

Also read `.agents/project/skills/dj-create-python-model/project-defaults.md` for shared catalog/schema/authoring-mode defaults.

## authoring_mode

Must match create defaults: `hand-written` or `cells`.

When `hand-written`:

- F3: empty or absent `cells` in JSON is **not** a failure
- F7: `.python.py` is the code source of truth — hand edits are expected

## output convention

Expected FQN pattern: `<dev_catalog>.<python_output_schema>.<table_name>`

## upstream_sources format

| Format | Treatment |
| ------ | --------- |
| `catalog.schema.table` | Canonical — PASS |
| `schema.table` | Legacy — WARNING (LOW) |

## lineage properties

List any project-specific Iceberg `$properties` keys the review should validate.
