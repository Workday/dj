---
name: dj-create-source
description: >-
  Register a raw Trino table as a DJ .source.json so models can read it via
  from.source. Use when a model needs a raw catalog.schema.table that is not
  defined as a source yet, or to add a table/columns to an existing source. Not
  for authoring models (-> dj-create-new-model), converting SQL text (->
  dj-convert-sql-to-model), or Python ETL (-> dj-create-python-model).
compatibility: DJ (Data JSON) Framework extension workspace with .dj/schemas/ and .agents/dj/AGENTS.md
metadata:
  dj-skill: '1.0'
---

# Create DJ source

Register a raw Trino table as a DJ **`.source.json`** so `.model.json` files can read it
via `"from": { "source": "<database>__<schema>.<table>" }`. Use this when a model needs a raw
`catalog.schema.table` that has no source definition yet, or to add a new table (or new columns)
to an existing source file.

**The one hard rule: never guess column data types.** A source's `columns[].data_type` must be the
**exact** Trino type (`varchar`, `timestamp(3)`, `decimal(38,9)`, `array(varchar)`, `row(...)`, …).
Get them from a live `SHOW COLUMNS` introspection — do not infer them from the SQL, the column name,
or a sample value. Everything else in a source file is simple; this is the part that must be exact.

**Never** hand-edit the generated **`<database>__<schema>.yml`** — DJ regenerates it from the
`.source.json` on sync. You author only the `.source.json`.

**Reading order:** `.dj/schemas/source.schema.json` (follow `$ref`s — `source.table`, `column.name`,
`column.type`) for the exact shape → an existing `*.source.json` in the project (best example of local
conventions) → this skill.

## Workflow

1. **Resolve the raw table identity.** Determine the Trino **catalog**, **schema**, and **table** to
   register — do not blindly pick or invent one:

   - **Prefer context.** When this skill is triggered from a SQL query (`FROM catalog.schema.table`)
     or the user already names the table, use that directly — don't re-ask what you already know.
   - **Browse only when it's unknown or ambiguous.** Discover it the same way the webview does, with
     read-only introspection — `SHOW CATALOGS` → `SHOW SCHEMAS FROM "<catalog>"` →
     `SHOW TABLES FROM "<catalog>"."<schema>"` — and let the **user pick**. Never guess a name.
   - **Confirm before writing** whenever there's any doubt about which table the user means.

   Also locate the dbt project first — it may be nested, not the workspace root: find its
   `dbt_project.yml` and treat `models/...` as relative to that directory. **If more than one dbt
   project exists, ask which to target — do not silently pick a default.**

2. **Introspect columns from Trino (mandatory, read-only).** Run:

   ```sql
   SHOW COLUMNS FROM "<catalog>"."<schema>"."<table>"
   ```

   through the Trino access described in `.agents/dj/AGENTS.md` **Command & Query Execution Safety**
   (read-only metadata query; confirm the catalog/schema first; never target production writes). Use
   the returned **Column** and **Type** values verbatim for `name` and `data_type`. If the table does
   not exist or you cannot reach Trino, stop and tell the user — do not fabricate a source.

3. **Derive the file path (never chosen).** The source **name** is `<database>__<schema>` where
   `database` is the Trino catalog and `schema` is the Trino schema. The file lives at:

   ```text
   models/sources/<database>/<database>__<schema>.source.json
   ```

   `database` and `schema` must match `^([a-z]|[0-9]|_)+$` (lowercase alphanumeric + underscore).

4. **Merge or create.**

   - **File exists** → read it as **JSONC** (preserve comments), append the new table to `tables[]`,
     and keep `tables` sorted by `name`. **If a table with that `name` already exists, do not
     duplicate it** — the source already covers it; add only missing columns if that was the intent.
   - **File does not exist** → create it with top-level `database`, `schema`, and `tables[]`.

5. **Write the table.** Each table is `{ "name": "<table>", "columns": [ … ] }`; each column is
   `{ "name": "<col>", "data_type": "<exact Trino type>", "description": "" }`. Set `"type": "dim"`
   or `"type": "fct"` only when the role is known (default is `dim` at model level; sources usually
   omit it). Do not add fields that are not in `source.schema.json`.

6. **Refresh the manifest.** A new `.source.json` is not resolvable by a downstream model until the
   dbt manifest registers it. After writing, ask the user to run **`DJ: Sync to SQL and YML`** (it
   regenerates the `.yml` and reparses the manifest on demand) before any model references the source.
   The agent cannot run VS Code commands itself, so this is a user action.

## Manual alternative (the extension does this deterministically)

The DJ extension ships the same flow as a GUI. The user can run the **`DJ: Create Source`** command,
pick **project → catalog → schema → table**, and the extension introspects the columns and writes the
exact same `.source.json` (merging into an existing file, sorted, dup-safe). Offer this path when the
Trino CLI is not available in the terminal or the user prefers to do it by hand — the result is
identical, so a model authored against it is safe either way.

## Source file shape

```jsonc
{
  "database": "gsheets_opus", // Trino catalog (lowercase, matches folder + name prefix)
  "schema": "default", // Trino schema
  // "freshness": null,          // optional — null disables dbt freshness checks
  "tables": [
    {
      "name": "savings_tracker",
      "columns": [
        { "name": "fiscal_year", "data_type": "varchar", "description": "" },
        { "name": "actual_amount", "data_type": "double", "description": "" },
      ],
    },
  ],
}
```

- **Required:** `database`, `schema`, `tables[]`; each table needs `name` + `columns[]`; each column
  needs `name` + `data_type`.
- **Optional:** source/table `description`, `freshness` (or `null` to disable), `loaded_at_field`,
  `meta`; column `type` (`dim`/`fct`), `lightdash`, `meta`.

## Gotchas

- **`data_type` is never guessed** — it comes from `SHOW COLUMNS`. A wrong type surfaces later as a
  cast/compile error in the downstream model, far from the cause.
- **One source file per `<catalog>__<schema>`** — every table from the same catalog+schema lives in
  the same `.source.json`; add tables to it rather than creating parallel files.
- **Do not duplicate an existing table** — merge into `tables[]`; a repeated `name` is invalid.
- **Never edit the generated `<database>__<schema>.yml`** — it is regenerated from the JSON on sync.
- **A model can't reference the source until it's synced** — remind the user to run
  `DJ: Sync to SQL and YML` before authoring the downstream model.
