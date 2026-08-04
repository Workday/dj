# Running the Lightdash CLI

Load this when you need to run the Lightdash CLI (or reason about its connection) for a DJ project — starting a preview, downloading, or uploading dashboards-as-code. For authoring or editing the chart / dashboard YAML itself, use the `dj-create-lightdash-yaml` and `dj-edit-lightdash-yaml` skills; this reference is only the CLI, connection, and guardrail basics they share.

## Executable and connection

The `lightdash` CLI must be on `PATH` (commonly inside the same Python venv as dbt — see `.agents/dj/reference/running-dbt.md` for venv activation). Connection and target come from environment variables, the same names DJ and the CLI use:

- `LIGHTDASH_URL` — instance base URL
- `LIGHTDASH_API_KEY` — API token
- `LIGHTDASH_PROJECT` — default project UUID
- `LIGHTDASH_PREVIEW_NAME` — preview name (defaults to `DJ Preview`)
- `LIGHTDASH_TRINO_HOST` — Trino host override (e.g. `host.docker.internal` under Docker)

If the URL / API key / project are not set in your terminal, ask the user for them rather than guessing.

## Relevant settings (`.vscode/settings.json`)

- `dj.lightdash.dashboardsAsCodePath` — where chart/dashboard YAML lives (default `lightdash/`).
- `dj.lightdashProjectPath` / `dj.lightdashProfilesPath` — dbt project and profiles dirs for previews.
- `dj.lightdash.restrictedProjects` — array of `{ uuid, mode: "block" | "warn", label }`. `block` refuses the upload from the DJ **Upload tab**; `warn` requires confirmation. Treat any listed project as production.

## Commands

- **Start a preview:** `lightdash start-preview --name "<name>" --profiles-dir ~/.dbt --project-dir <dir> -s <model> -y`. Do not pass `--defer` (it routes to `dbt ls`, which rejects it); `-y` skips the credential prompt. Capture the printed preview project UUID (`.../projects/<uuid>/tables`).
- **Stop a preview:** `lightdash stop-preview --name "<name>"` (DJ runs it with `CI=true` in the environment). Tears down the named preview project.
- **Download:** `lightdash download -p <dashboards-as-code-path> --project <uuid>` (add `-c <chart-slug>` / `-d <dashboard-slug>` to scope).
- **Upload:** `lightdash upload --project <uuid> -c <chart-slug> -d <dashboard-slug> [--force] [--include-charts] [--validate]`. Net-new files require `--force`; always `--validate` (the only check that catches bad field IDs / missing slugs).

## Preview registry (`.dj/lightdash/previews.json`)

The Lightdash CLI has no "list previews" command, so DJ keeps its own registry at `.dj/lightdash/previews.json` — this is exactly what the `DJ: Lightdash Preview` webview lists. It holds 2-space JSON of the form `{ "previews": [ { "name", "url", "createdAt", "models": [...], "status": "active" | "inactive" } ] }`; DJ writes an `active` entry (deduped by `name`) when a preview starts and removes it when one stops.

- **To enumerate current previews** (e.g. to choose one to stop), read this file — there is no CLI list to fall back on.
- **Keep it in sync when you run the CLI directly.** If you start a preview from the terminal instead of the webview, add or replace its entry (dedup by `name`) so the UI shows it; if you stop one, remove its entry. Match the shape exactly — `url` is the printed `.../projects/<uuid>/tables`, `createdAt` is an ISO-8601 timestamp, `models` is the `-s` selection, `status` is `"active"`.
- It lives under gitignored `.dj/` — never commit it.
- **Prefer the webview.** `DJ: Lightdash Preview` starts/stops previews _and_ maintains this registry and captures the URL for you; edit `previews.json` by hand only when you ran the CLI yourself.

## Guardrails

- **Confirm the target project UUID before any upload**, and pass `--project <uuid>` explicitly rather than relying on the `LIGHTDASH_PROJECT` default. Deliberately target a **preview**, not prod.
- `dj.lightdash.restrictedProjects` guards only the DJ **Upload tab** — it does **not** stop a direct `lightdash upload` (Lightdash allows it if you have permission). So never upload to a restricted/prod project from the CLI without explicit confirmation.
- **Prefer the DJ webview.** The `DJ: Lightdash - Dashboards as Code` tabs handle auth, working directory, and schema binding — offer to run the CLI directly only after confirming the target, and never instruct the user to run uploads blindly.
