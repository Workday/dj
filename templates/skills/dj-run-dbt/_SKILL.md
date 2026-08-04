---
name: dj-run-dbt
description: >-
  Run a dbt command from the terminal in a DJ (Data JSON) Framework dbt
  project — compile, parse, ls, deps, docs generate, test, or a
  warehouse-writing run/build/seed/snapshot. Use when the user asks to
  "compile this model", "run dbt", "parse the project", "build my models",
  "dbt test", refresh the manifest, or otherwise execute the dbt CLI. Not for
  authoring or editing models (-> dj-create-new-model), and not for analyzing
  Trino query diagnostics (-> dj-trino-analyzer).
compatibility: DJ (Data JSON) Framework workspace with a dbt project and .agents/dj/AGENTS.md
metadata:
  dj-skill: '1.0'
---

# Run dbt

Execute dbt CLI commands correctly in this project. The full mechanics — activating the Python venv (`dj.pythonVenvPath`), running from the dbt project directory, and the read-only vs warehouse-writing command classes — live in `.agents/dj/reference/running-dbt.md`. Read it before running anything.

Essentials:

1. **Activate the venv first.** A terminal does not inherit DJ's Python environment. Resolve `dj.pythonVenvPath` from `.vscode/settings.json` (fall back to `.venv`), `source <venv>/bin/activate`, and verify `dbt --version`.
2. **Run from the dbt project directory** (the one with `dbt_project.yml`), not necessarily the workspace root. If more than one project exists, confirm which one.
3. **Sync before compiling.** dbt reads the generated `.sql`, not the `.model.json`. After a JSON edit, ask the user to run `DJ: Sync to SQL and YML` first.
4. **Read-only by default.** `parse` / `compile` / `ls` / `deps` / `docs generate` / `test` are safe. `run` / `build` / `seed` / `snapshot` / `run-operation` write to the warehouse — get explicit per-command confirmation and never target production. See **Command & Query Execution Safety** in `.agents/dj/AGENTS.md`.
