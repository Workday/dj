# DJ CLI — Agent Verification Prompts

Copy-paste prompts to hand an AI agent (Claude Code, etc.) to exercise **every** DJ CLI command
directly against a running DJ extension. Each prompt is written so the agent runs `.dj/bin/dj …`
itself; every command lists what a passing result looks like so you can verify by eye.

> These are **manual/agent** verification prompts, not automated tests. The unit tests live in
> `src/services/cliBridge/__tests__/operationRegistry.test.ts`.

---

## Prerequisites

1. **VS Code is running** with the DJ extension active on a workspace that has a dbt project.
   The examples below assume the **`opus`** project; substitute your own project name.
2. `.dj/bin/dj` exists and is executable (the extension deploys it on activation). Verify:
   ```bash
   .dj/bin/dj system.ping
   ```
   Expect `{ "ok": true, "version": "…", "pid": … }` and exit code `0`.
3. The agent should prefer `--file` for anything non-trivial (no shell-quoting pitfalls). Inline
   `--json '…'` is fine for one-liners. Piped stdin (`… | .dj/bin/dj <op>`) also works.
4. **Exit codes:** `0` ok · `1` operation error · `2` bad input · `3` no live endpoint · `4` timeout.
   After each run the agent should report the exit code (`echo $?`).

### Placeholders to substitute

| Placeholder | Example (opus) |
|---|---|
| `<project>` | `opus` |
| `<catalog>` | `opus_raw_dl` |
| `<schema>` | `pharos_metrics_views` |
| `<table>` | `node_cpu_hourly_cost_view` |
| `<model>` | `stg__mlde__pharos__node_cpu_daily_cost` |

Tell the agent: **discover real values first** (catalogs → schemas → tables → columns; projects →
models) and reuse them in later commands instead of guessing.

---

## 0 · System & discovery

**Prompt:**
> Run `.dj/bin/dj system.ping`, then `.dj/bin/dj system.capabilities`. List every operation the
> bridge exposes with its `sideEffect`, and confirm the count matches the number of operations.

**Expect:** `system.capabilities` returns an `operations[]` array. There should be **27** ops:
2 system, 10 read, 6 authoring, 4 mutate, 5 query/data. Mutating ops (`model.create`, `model.update`,
`source.create`, `dbt.compile`, `dbt.compile-logs`, `dbt.parse`, `dbt.run`) report
`"sideEffect": "mutate"`; everything else is `"read"`.

---

## 1 · Read tier (introspection, side-effect-free)

**Prompt:**
> Using `.dj/bin/dj`, discover the workspace top-down and print each result:
> 1. `dbt.projects` — list the dbt projects.
> 2. `dbt.models` for `<project>` — list model names. (Try it with **no** `projectName` too; if
>    there's a single project it should be inferred, otherwise it should error listing the projects.)
> 3. `dbt.sources` — list declared dbt sources.
> 4. `dbt.modified-models --json '{"projectName":"<project>"}'` — models changed vs the base ref.
> 5. `trino.catalogs`, then `trino.schemas` for one catalog, `trino.tables` for one schema, and
>    `trino.columns` for one table — chaining each result into the next.
> 6. `dbt.compiled-status` and `dbt.model-outdated` for `<model>`.
> Report the exit code for each.

**Expect (each exits `0`):**
- `dbt.projects` → array including `<project>` (with parsed manifest).
- `dbt.models` → array of model names; omitting `projectName` in a single-project workspace succeeds,
  in a multi-project workspace errors with `Multiple dbt projects found; set request.projectName to …`.
- `dbt.sources` → array of source names.
- `dbt.modified-models` → array (possibly empty).
- `trino.*` chain → catalogs[] → schemas[] → tables[] → columns[] (each grounded in the previous).
- `dbt.compiled-status` → `{ isCompiled, compiledPath?, lastCompiled? }`;
  `dbt.model-outdated` → `{ isOutdated, hasCompiledFile, reason? }`.

Individual command cheatsheet:
```bash
.dj/bin/dj dbt.projects
.dj/bin/dj dbt.models          --json '{"projectName":"<project>"}'
.dj/bin/dj dbt.sources
.dj/bin/dj dbt.modified-models --json '{"projectName":"<project>"}'
.dj/bin/dj trino.catalogs
.dj/bin/dj trino.schemas       --json '{"catalog":"<catalog>"}'
.dj/bin/dj trino.tables        --json '{"catalog":"<catalog>","schema":"<schema>"}'
.dj/bin/dj trino.columns       --json '{"catalog":"<catalog>","schema":"<schema>","table":"<table>"}'
.dj/bin/dj dbt.compiled-status --json '{"modelName":"<model>","projectName":"<project>"}'
.dj/bin/dj dbt.model-outdated  --json '{"modelName":"<model>","projectName":"<project>"}'
```

---

## 2 · Authoring tier (create / refine models & sources)

**Prompt (source):**
> Pick a real Trino table (use the `trino.*` commands to find one). Run
> `source.create --json '{"projectName":"<project>","trinoCatalog":"<catalog>","trinoSchema":"<schema>","trinoTable":"<table>"}'`.
> Confirm a `.source.json` file was written and report its path.

**Expect:** exit `0`; a source definition file is created (columns auto-introspected via `SHOW
COLUMNS`). Re-running for the same table should surface a downstream "already exists" style error
(exit `1`).

**Prompt (preview → exists → create — the dry-run-before-write loop):**
> Write this model payload to `/tmp/model.json`, then:
> 1. `model.preview --file /tmp/model.json` — show the generated SQL / YAML / columns **without
>    writing**.
> 2. `model.exists --file /tmp/model.json` — confirm it does **not** exist yet.
> 3. `model.create --file /tmp/model.json` — create it; report the written path.
> 4. `model.exists --file /tmp/model.json` again — confirm it now exists.
> 5. `model.create --file /tmp/model.json` a second time — confirm it **fails** with an "already
>    exists" error (exit `1`).
>
> ```json
> {
>   "type": "stg_select_source",
>   "projectName": "<project>",
>   "group": "mlde",
>   "topic": "pharos",
>   "name": "node_cpu_daily_cost",
>   "from": { "source": "<catalog>__<schema>.<table>" },
>   "select": [
>     "node",
>     { "name": "cost_date",  "expr": "date(hour)", "type": "date" },
>     { "name": "daily_cost", "expr": "sum(cost)",  "type": "double" }
>   ]
> }
> ```

**Expect:** `model.preview` → `{ json, sql, yaml, columns[] }`, no file written. `model.exists` →
`{ exists:false, … }` then `{ exists:true, fileName, filePath }`. First `model.create` → `{ ok:true,
response:… }` and a `.model.json` on disk; second → exit `1`, "Model … already exists".

**Prompt (update):**
> Modify the model you just created (e.g. add a `select` column) and run
> `model.update` with `{ projectName, modelJson, originalModelPath }` (use the path from
> `model.exists`). Confirm the file is updated/relocated and report the result.

**Expect:** exit `0`; the model file is merged/validated (relocated if name/topic/group changed).

**Prompt (cte-analysis):**
> Run `model.cte-analysis` on a CTE-style model payload and report the per-CTE inferred columns and
> any diagnostics.

**Expect:** exit `0`; `{ columns{}, diagnostics[] }`. This is a **read** op (no write).

---

## 3 · Mutate tier (compile / parse / run)

**Prompt:**
> For `<model>` in `<project>`:
> 1. `dbt.compile --json '{"modelName":"<model>","projectName":"<project>"}'` — compile one model.
> 2. `dbt.compile-logs` with the same args — the log-emitting variant.
> 3. `dbt.parse --json '{"projectName":"<project>"}'` — parse the project and refresh the manifest.
>    (Also try it with **no** payload; it should infer the sole project.)
> 4. `dbt.run --json '{"modelName":"<model>","projectName":"<project>"}'` — run the model.
> Report each exit code.

**Expect:**
- `dbt.compile` / `dbt.compile-logs` → `{ success, message? }`, exit `0` on success.
- `dbt.parse` → the refreshed manifest object. Passing an **unknown** project name should error
  `dbt.parse: project '<name>' is not loaded` (exit `1`).
- `dbt.run` → **`{ ok:true, note:"dbt run started; output streams to the VS Code terminal." }`**.
  ⚠️ Known limitation: run output goes to the VS Code integrated terminal, **not** stdout — the agent
  won't see row-level results here. Verify by checking the terminal in VS Code.

---

## 4 · Query & data read tier (read-only)

**Prompt:**
> For a compiled model `<model>`:
> 1. `model.compiled-sql --json '{"modelName":"<model>","projectName":"<project>"}'` — read the
>    compiled SQL.
> 2. `model.query --json '{"modelName":"<model>","projectName":"<project>","limit":20}'` — preview
>    the model's data.
> 3. `model.lineage` for the same model — its upstream/downstream lineage.
> 4. `model.reverse-lineage --json '{"kind":"chart","slug":"<some-slug>"}'` — trace a dashboard/chart
>    back to models (skip if you don't have a slug).
> Report each result and exit code.

**Expect:** `model.compiled-sql` → `{ sql | null, … }`; `model.query` → `{ columns, rows, rowCount,
executionTime? }`; `model.lineage` → lineage graph; `model.reverse-lineage` → reverse lineage graph.

**Prompt (query.execute — the read-only-SELECT gate):**
> Run these and report the exit code + message for each:
> 1. `query.execute --json '{"sql":"select 1","limit":10}'` — **should succeed**.
> 2. `query.execute --json '{"sql":"show catalogs"}'` — **should succeed** (SHOW is read-only).
> 3. `query.execute --json '{"sql":"with t as (select 1) select * from t"}'` — **should succeed**.
> 4. `query.execute --json '{"sql":"delete from some_table"}'` — **should be rejected**.
> 5. `query.execute --json '{"sql":"select 1; drop table t"}'` — **should be rejected** (multi-statement).
> 6. `query.execute --json '{"sql":"/* select */ delete from t"}'` — **should be rejected** (comment trick).
> 7. `query.execute --json '{"sql":"   "}'` — **should be rejected** (empty).

**Expect:** #1–#3 exit `0` and forward to the warehouse. #4 & #6 exit `1` with
`query.execute: only read-only SELECT queries are permitted …`. #5 exit `1` with `only a single
read-only statement is allowed (no ";")`. #7 exit `1` with `query.execute requires a non-empty 'sql'
string`. This confirms the read-only policy gate is enforced **before** any SQL reaches the warehouse.

---

## 5 · Error & input-handling paths (exit-code contract)

**Prompt:**
> Verify the CLI's failure modes and report the exit code for each:
> 1. `.dj/bin/dj bogus.op` — unknown operation.
> 2. `.dj/bin/dj trino.schemas --json 'not json'` — malformed JSON.
> 3. `.dj/bin/dj trino.schemas --json '"a string"'` — valid JSON but not an object.
> 4. `.dj/bin/dj dbt.models` in a multi-project workspace with no `projectName`.
> 5. `.dj/bin/dj model.create --json '{"topic":"x","name":"y"}'` missing required fields — downstream
>    validation error.
> 6. (Optional) Quit VS Code, then `.dj/bin/dj system.ping` — no live endpoint.

**Expect:**
- `bogus.op` → exit `1`, `Unknown operation: bogus.op`.
- malformed JSON → exit `2`.
- non-object JSON → exit `1`/`2` with `Payload must be a JSON object`.
- ambiguous project → exit `1`, `Multiple dbt projects found …`.
- missing fields → exit `1` with the downstream validation message (`dj: <message>` on stderr).
- DJ closed → exit `3` (no live endpoint).

Confirms errors surface as `dj: <message>` on **stderr** with a non-zero exit, so an agent can detect
and react to failures.

---

## 6 · End-to-end scenario (the real agent workflow)

**Prompt:**
> You are authoring a new DJ staging model from scratch using only `.dj/bin/dj`. Do it end-to-end and
> narrate each step + exit code:
> 1. `system.capabilities` to learn the surface.
> 2. `dbt.projects` → pick a project. `trino.catalogs` → `trino.schemas` → `trino.tables` →
>    `trino.columns` to find a real source table and its columns.
> 3. `source.create` for that table.
> 4. Draft a `stg_select_source` model referencing that source; `model.preview` it (inspect SQL/YAML),
>    `model.exists` to confirm it's new, then `model.create`.
> 5. `dbt.compile` the new model; `dbt.compiled-status` to confirm it compiled.
> 6. `model.compiled-sql` and `model.query --json '{…,"limit":10}'` to read it back.
> 7. `query.execute` a `SELECT` against the underlying table to sanity-check the numbers.
> Finish with a short report: which commands succeeded, any that failed, and whether the model looks
> correct.

**Expect:** a clean top-to-bottom pass where each command grounds the next — no hallucinated
catalog/table/column names, a real `.source.json` and `.model.json` written, a successful compile,
and readable data. This is the flow we'll wrap in a skill next.

---

## Result checklist

| # | Command | Pass? | Notes |
|---|---|---|---|
| 0 | `system.ping` / `system.capabilities` (27 ops) | ☐ | |
| 1 | `dbt.projects` | ☐ | |
| 1 | `dbt.models` (+ inference / ambiguous error) | ☐ | |
| 1 | `dbt.sources` | ☐ | |
| 1 | `dbt.modified-models` | ☐ | |
| 1 | `trino.catalogs/schemas/tables/columns` chain | ☐ | |
| 1 | `dbt.compiled-status` / `dbt.model-outdated` | ☐ | |
| 2 | `source.create` | ☐ | |
| 2 | `model.preview` | ☐ | |
| 2 | `model.exists` (before/after) | ☐ | |
| 2 | `model.create` (+ duplicate → exit 1) | ☐ | |
| 2 | `model.update` | ☐ | |
| 2 | `model.cte-analysis` | ☐ | |
| 3 | `dbt.compile` / `dbt.compile-logs` | ☐ | |
| 3 | `dbt.parse` (+ unknown project → exit 1) | ☐ | |
| 3 | `dbt.run` (note: output → VS Code terminal) | ☐ | |
| 4 | `model.compiled-sql` | ☐ | |
| 4 | `model.query` | ☐ | |
| 4 | `model.lineage` / `model.reverse-lineage` | ☐ | |
| 4 | `query.execute` accept (SELECT/WITH/SHOW) | ☐ | |
| 4 | `query.execute` reject (DML/multi/comment/empty) | ☐ | |
| 5 | Error paths (exit 1/2/3) | ☐ | |
| 6 | End-to-end authoring scenario | ☐ | |

---

## Known limitations to keep in mind while verifying

- **`dbt.run`** returns a start-acknowledgement only; run output streams to the VS Code terminal, not
  stdout (see `phase-1-plan.md`).
- **`query.execute`** is intentionally restricted to a single read-only `SELECT`/`WITH`/`SHOW`/
  `DESCRIBE`/`EXPLAIN` statement. Confirm catalog/schema and never target production.
- Not yet exposed (pending): upstream `select` columns (`column.lineage`), read-existing-model
  (`model.get` / `model.original-files` / `model.settings.get`), `query.analyze`, tests
  (`tests.list/add/remove/run`), `project.overview`. See `phase-1-plan.md` → *Deferred*.
