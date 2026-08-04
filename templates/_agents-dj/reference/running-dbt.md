# Running dbt

Load this when you need to run a dbt command from a terminal in this project — compile, parse, list, test, or a warehouse-writing run/build/seed. First read **Command & Query Execution Safety** in `.agents/dj/AGENTS.md`; the rules below are the mechanics, that section is the policy.

## Activate the Python environment first

dbt runs inside the project's Python virtual environment. A terminal you open does **not** inherit that environment automatically — activate it yourself before invoking `dbt`.

1. **Find the venv.** Read `dj.pythonVenvPath` from `.vscode/settings.json` (workspace settings, then user settings). A relative value is resolved against the workspace root; an absolute path is used as-is.
2. **Fall back to the conventional venv.** If `dj.pythonVenvPath` is unset, look for `.venv/` at the workspace or project root (check for `.venv/bin/activate`). If dbt is already on `PATH`, you may skip activation.
3. **Activate and verify.** Run `source <venv>/bin/activate` (macOS/Linux) or `<venv>\Scripts\activate.bat` (Windows), then confirm with `dbt --version`.
4. **If none resolves,** ask the user to set `dj.pythonVenvPath` or to tell you how dbt is installed — do not guess an interpreter.

## Run from the dbt project directory

Run `dbt` from the directory that contains `dbt_project.yml`, not necessarily the workspace root — the dbt project may be nested. If more than one dbt project exists, confirm which one the model belongs to before running (see **Project & Environment Resolution** in `.agents/dj/AGENTS.md`). dbt reads its warehouse credentials from `~/.dbt/profiles.yml` by default; DJ does not override the profiles directory.

## Command classes

| Class                                                        | Commands                                                                                                  | Notes                                                                                                                                   |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Read-only** (safe to run)                                  | `dbt parse`, `dbt compile`, `dbt ls`, `dbt deps`, `dbt docs generate`, `dbt test`, `dbt source freshness` | `test` and `source freshness` issue `SELECT`s but write nothing. Keep them scoped with `--select`.                                      |
| **Warehouse-writing** (per-command confirmation, never prod) | `dbt run`, `dbt build`, `dbt seed`, `dbt snapshot`, `dbt run-operation`                                   | Confirm the target is non-production before each run. `--full-refresh` rebuilds tables from scratch — treat as destructive and confirm. |

Never run a warehouse-writing command against a production target, even with confirmation. If you cannot confirm the target is non-production, stop and ask.

## Common invocations

- **Compile one model's generated SQL:** `dbt compile --select <model_name>`
- **List models:** `dbt ls --select <selector>`
- **Test a model:** `dbt test --select <model_name>`
- **Refresh dependencies:** `dbt deps`
- **Build the manifest from scratch:** `dbt parse` (ask first if the manifest is missing)

Selection syntax: `--select` / `-s` picks nodes, `--exclude` removes them, graph operators expand the set (`+model` = model and its ancestors, `model+` = model and its descendants). Prefer the narrowest selector that covers the task.

## dbt reads generated SQL — sync first

dbt compiles and runs the **generated `.sql`** files, not the `.model.json` sources. After editing a `.model.json`, ask the user to run **`DJ: Sync to SQL and YML`** (which regenerates the `.sql` / `.yml` and reparses the manifest when needed) before you compile or run that model — otherwise dbt sees stale SQL. You cannot run VS Code commands yourself; run `dbt parse` in the terminal only when a manifest must be built from scratch and the user has approved it.
