---
name: dj-run-trino
description: >-
  Run a read-only Trino SQL query from the terminal to inspect warehouse data or
  schema in a DJ (Data JSON) Framework project. Use when the user asks to "query
  Trino", "preview rows", "DESCRIBE"/"SHOW" a table, check what data or columns a
  table has, or sanity-check a value. Not for diagnosing captured query
  performance JSON (-> dj-trino-analyzer) or registering a table as a source
  (-> dj-create-source).
compatibility: DJ (Data JSON) Framework workspace with a Trino CLI and .agents/dj/AGENTS.md
metadata:
  dj-skill: '1.0'
---

# Run a Trino query

Execute read-only Trino queries correctly in this project. The full mechanics — resolving the CLI from `dj.trinoPath`, the `TRINO_*` connection environment, the `--execute … --output-format=CSV_HEADER` invocation, and identifier quoting — live in `.agents/dj/reference/running-trino.md`. Read it before running anything.

Essentials:

1. **Resolve the CLI.** `dj.trinoPath` (default `trino-cli` on `PATH`). If it doesn't resolve, ask the user to install it or set the path.
2. **Confirm the connection.** The connection comes from `TRINO_HOST` / `TRINO_PORT` / `TRINO_USERNAME` / `TRINO_CATALOG` / `TRINO_SCHEMA` in the environment. If unset, ask for them and confirm the cluster is non-production before running.
3. **Read-only only.** Run `SELECT` / `SHOW` / `DESCRIBE` / `EXPLAIN`, always with a `LIMIT` and partition constraint. Any DDL/DML needs explicit confirmation and must never hit production. See **Command & Query Execution Safety** in `.agents/dj/AGENTS.md`.
4. **Prefer framework facilities.** Read `.source.json` / `.model.json` / `target/manifest.json` / `.dj/schemas/` before shelling out to the CLI.
