# Running Trino queries

Load this when you need to run a Trino query from a terminal to inspect warehouse data or schema. First read **Command & Query Execution Safety** in `.agents/dj/AGENTS.md`; the rules below are the mechanics, that section is the policy.

## Resolve the CLI executable

DJ resolves the Trino CLI from the `dj.trinoPath` setting (in `.vscode/settings.json`), defaulting to `trino-cli` on `PATH`:

- **Command name** (no path separators, e.g. `trino-cli` or `trino`) → used as-is, resolved from `PATH`.
- **Full path** ending in `trino` or `trino-cli` → used directly.
- **Directory path** → `${dir}/trino-cli` is tried first, then `${dir}/trino`.
- **Unset** → `trino-cli` on `PATH`.

If neither `trino-cli` nor `trino` resolves, ask the user to install the Trino CLI or set `dj.trinoPath` — do not guess a path.

## Connection comes from the environment

DJ invokes the CLI with only the query and output format — it does **not** pass `--server` / `--catalog` / `--schema` / `--user` flags. The connection is read from the process environment, so the CLI (or the site's `trino-cli` wrapper) resolves it from these variables:

`TRINO_HOST`, `TRINO_PORT`, `TRINO_USERNAME`, `TRINO_CATALOG`, `TRINO_SCHEMA`

These usually live in the user's shell profile. If they are not set in your terminal:

- Ask the user for the cluster host/port, catalog, and schema, and **confirm it is the intended, non-production cluster** before running anything.
- When using the open-source `trino` CLI (not a wrapper), pass the values as flags: `--server <host>:<port> --user <user> --catalog <catalog> --schema <schema>`.

There is no password flag — authentication comes from the environment or the user's profile.

## Invocation

Mirror how DJ runs the CLI:

```bash
trino-cli --execute "SHOW COLUMNS FROM \"<catalog>\".\"<schema>\".\"<table>\"" --output-format=CSV_HEADER
```

- `--execute "<sql>"` runs one statement; `--file <path>` runs a file.
- `--output-format=CSV_HEADER` returns RFC-4180 CSV with a header row and handles complex Trino types (arrays, maps, rows) that the CLI's JSON format cannot serialize.
- **Quote every identifier** with double quotes (`"<catalog>"."<schema>"."<table>"`) so mixed-case or reserved names resolve.

## Read-only by default

Run only `SELECT` / `SHOW` / `DESCRIBE` / `EXPLAIN`. Add a `LIMIT` and constrain by partition on every ad-hoc `SELECT` — never trigger a full-history or unpartitioned scan just to check a shape. Any DDL/DML requires explicit per-command confirmation and must never target production.

Before shelling out, prefer framework facilities: read `.source.json` / `.model.json` / `target/manifest.json` / `.dj/schemas/`, or use DJ's **Create Source** flow to browse catalogs, schemas, tables, and columns. Run the CLI only after the user confirms the connection and that the statement is read-only.
