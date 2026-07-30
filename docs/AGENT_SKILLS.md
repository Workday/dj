# Agent Skills

DJ ships **AI agent skills** — packaged instructions that guide AI coding assistants (Claude Code, Cursor, GitHub Copilot, Cline, Windsurf, and others) through common DJ (Data JSON) Framework tasks: creating and refactoring models, authoring Lightdash dashboards, diagnosing slow Trino queries, resolving merge conflicts, and more.

This page explains what the skills are, how to turn them on, and catalogs the 13 skills DJ provides today.

## What are DJ Agent Skills?

- **Agent-agnostic.** Skills are plain-Markdown files that follow the [Agent Skills open standard](https://agentskills.io) — each skill is a folder containing a `SKILL.md` (plus optional `references/` and `scripts/`). Any AI coding tool that understands the standard can use them; there is no per-agent configuration.
- **Task-focused.** Each skill encodes DJ's conventions for a single job, so the assistant produces framework-correct output — the right model `type`, valid JSON against the schemas, and the single-source-of-truth rules — instead of guessing.
- **Paired with a framework reference.** Alongside the skills, DJ generates `.agents/dj/AGENTS.md` — a project-tailored reference for the whole framework (model types, materialization, Lightdash config, CTEs, and more) that the skills read first.

## Enabling skills

Skills are opt-in via a single setting.

1. Set `dj.codingAgent` to `true` in the VS Code settings UI, or in `.vscode/settings.json`:

   ```json
   { "dj.codingAgent": true }
   ```

2. Run **`DJ: Refresh Projects`** from the Command Palette. (`dj.codingAgent` takes effect on refresh — see [When Settings Take Effect](SETTINGS.md#when-settings-take-effect).)

DJ then writes, at your workspace root:

- `.agents/dj/AGENTS.md` — the framework reference
- `.agents/skills/<skill-name>/SKILL.md` — one folder per skill, with any bundled `references/` and `scripts/`

Point your AI coding tool at the workspace and the skills become available. Most skills also rely on the `.dj/schemas/` directory (the JSON schemas DJ maintains in every workspace) for exact model shapes.

> Legacy string values (`"github-copilot"`, `"claude-code"`, `"cline"`) are still accepted but deprecated — skills are now agent-agnostic. For details, see [AI & Coding Agents](SETTINGS.md#ai--coding-agents) in the Settings reference.

## How skills work

- **Just ask.** Describe your task in natural language ("create a mart for daily orders", "why is this query slow?") and the assistant matches it to a skill via that skill's _Use when…_ description. You can also name a skill directly.
- **Progressive disclosure.** A skill loads its `SKILL.md` first and pulls in `references/` or runs `scripts/` only when needed, keeping the assistant focused.
- **Single source of truth.** Skills edit only the JSON sources of truth — `.model.json`, `.source.json`, `.python.json` — and never hand-edit the generated `.sql` / `.yml` / `.python.py`, which DJ regenerates via JSON Sync.
- **You stay in control of DJ commands.** Skills can't run VS Code commands themselves; they'll ask you to run things like **`DJ: Sync to SQL and YML`** or **`DJ: Refresh Projects`** at the right moment.
- **Some skills are read-only.** `dj-review-python-model`, `dj-govern-model`, and `dj-trino-analyzer` produce reports and change nothing.

## The skills

DJ provides 13 skills, grouped below by what they help you do.

### Setup & onboarding

#### `dj-initialize`

Interactive wizard that sets up and configures the DJ Framework in an existing dbt project — Python virtual environment, `dbt_project.yml` vars, `models/groups.yml`, `.vscode/settings.json`, and optional Trino, Lightdash, and Airflow integrations — one step at a time.

- **Use when:** you want to set up DJ in an existing dbt project, configure required settings, or diagnose why DJ is not working correctly.
- **Example prompt:** _"Set up the DJ framework in this dbt project."_

### Authoring SQL models

#### `dj-create-new-model`

Scaffolds a new `.model.json` for any layer — staging, intermediate, or mart — including joins, CTEs, rollups, subqueries, and aggregations. This is DJ's primary model-authoring reference; the other authoring skills defer to it.

- **Use when:** you want to create, add, or scaffold a dbt model.
- **Example prompt:** _"Create a mart that summarizes daily order totals per customer."_
- **Bundled reference:** `mart-lightdash-recipes.md` — recipes for marts that back a Lightdash explore.

#### `dj-convert-sql-to-model`

Converts an existing SQL query into a **new** `.model.json`, mapping SQL patterns to the right model `type` and column definitions. It only creates new files — it never overwrites existing JSON, SQL, or YAML.

- **Use when:** you have a working SQL query (often from a `.draft.sql` file) and want to formalize it as a DJ/dbt model.
- **Example prompt:** _"Convert this draft.sql into a DJ model."_

### Python ETL models

#### `dj-create-python-model`

Scaffolds a `.python.json` for a pre-dbt Python ETL pipeline that extracts data from external sources (APIs, databases, files) and loads it into Iceberg tables for downstream dbt models to consume. It favors Trino SQL for transforms, using pandas only for ingestion and Python-only logic.

- **Use when:** you want to create a Python model, ETL pipeline, data ingestion, API fetch, CSV import, or any pre-dbt Python data processing task.
- **Example prompt:** _"Create a Python model that fetches the Backstage API into an Iceberg table."_
- **Bundled references:** `etl-patterns.md` (per-stage code templates), `worked-example.md` (a complete end-to-end pipeline).

#### `dj-review-python-model`

**Read-only** audit of a Python model (`.python.py` + `.python.json`) for framework compliance, lineage readiness, downstream integration, and performance, producing a structured report before you productionize it.

- **Use when:** you want to review, audit, validate, or check a Python model for production readiness.
- **Example prompt:** _"Review this Python model for production readiness."_
- **Bundled reference:** `review-checklist.md` — pass/fail examples and edge cases for every check.

### Lightdash BI & AI hints

#### `dj-create-lightdash-yaml`

Authors brand-new Lightdash chart and dashboard YAML (Dashboards-as-Code) from scratch for a DJ-managed explore, then uploads it. Field IDs are resolved mechanically rather than guessed from labels, and model-level required filters are honored.

- **Use when:** you want to build, author, or scaffold a chart or dashboard that does not exist yet (no prior `lightdash download`) and then upload it.
- **Example prompt:** _"Build a Lightdash dashboard for the customer_orders explore."_
- **Bundled reference & script:** `lightdash-as-code-authoring.md`; `get_explore_fields.py`, a read-only helper that lists an explore's dimension and metric field IDs.

#### `dj-edit-lightdash-yaml`

Makes minimal-diff edits to Lightdash chart/dashboard YAML that already exists locally (downloaded or previously authored) — filters, sorts, axes, table config, tiles, dashboard filters — before you re-upload.

- **Use when:** you want to tweak existing Lightdash YAML before re-uploading via the `DJ: Lightdash - Dashboards as Code` webview.
- **Example prompt:** _"Change this chart's date filter to the last 30 days."_
- **Bundled reference:** `lightdash-as-code-fields.md` — field-ID derivation and upload flags.

#### `dj-update-ai-hints`

Adds or updates Lightdash `ai_hint` values across a model's full dependency tree, typically driven from an Excel sheet — updating existing hints in place without adding new columns or metrics.

- **Use when:** you're working with AI hints in model or source JSON files.
- **Example prompt:** _"Update the AI hints for this model's dependency tree from ai_hints.xlsx."_

### Refactoring & maintenance

#### `dj-review-and-refactor-model`

Reviews a `.model.json` (or a folder, dependency tree, or the whole workspace) and modernizes it to newer DJ capabilities — materialization shorthand, `lightdash.*` over `meta.*`, `from.rollup`, `exclude_framework_artifacts`, the `"dims"` shorthand, inline subqueries, and more. It presents all findings first and applies only what you approve.

- **Use when:** you want to review, audit, modernize, refactor, clean up legacy patterns, adopt newer DJ capabilities, or upgrade `.model.json` files.
- **Example prompt:** _"Review and modernize the models in this folder."_
- **Bundled reference:** `refactor-catalog.md` — detection heuristics and before/after examples for each pattern.

#### `dj-migrate-ephemerals-to-ctes`

Detects legacy ephemeral models and inlines them as Common Table Expressions (CTEs) inside their downstream consumer, then removes the now-redundant file — dissolving trivial intermediate layers.

- **Use when:** you want to migrate, inline, flatten, consolidate, or remove ephemeral models, or standardize trivial transformations into inline CTEs.
- **Example prompt:** _"Inline the ephemeral models under intermediate/ as CTEs."_
- **Bundled reference:** `transformation-matrix.md` — per-type inline recipes and CTE-naming rules.

#### `dj-resolve-merge-conflicts`

Resolves git merge, rebase, or cherry-pick conflicts the DJ way — hand-merging only the `.model.json` / `.source.json` sources of truth and regenerating the `.sql` / `.yml` siblings (never hand-merging generated files). It also helps when an incoming branch is old or diverged and you must choose between a full merge and porting specific models.

- **Use when:** you hit conflicts in DJ files while merging/rebasing/cherry-picking, or say "resolve the merge conflicts" or "help me rebase".
- **Example prompt:** _"Resolve the merge conflicts in these .model.json files."_
- **Bundled reference:** `staleness-and-porting.md` — the staleness assessment and guided-port recipe.

### Governance

#### `dj-govern-model`

**Read-only** audit of governance posture across a model, folder, dependency tree, or the whole workspace — ownership coverage, PII / classification / compliance tagging, registered-group conformance, and prod-write posture. It reports gaps and points you at the skill to fix each one; it never edits files and never forces a project to adopt metadata it hasn't chosen.

- **Use when:** you want to review data ownership, check PII / sensitivity / compliance tagging, find models with no owner, or assess governance coverage for a group or project.
- **Example prompt:** _"Which models in the finance group have no owner or PII tags?"_

### Performance diagnostics

#### `dj-trino-analyzer`

**Read-only** diagnosis of Trino query performance from the `QueryInfo` JSON that DJ's Query Control Center writes to `.dj/diagnostics/`. It explains slowness — broadcast-join blow-ups, data skew, blocked time, object-store scan latency, and more — and suggests `.model.json` knobs; it never edits generated SQL. Run **`DJ: Analyze Trino Query with AI`** first to produce the diagnostics.

- **Use when:** a query is slow, you want to understand a query plan, compare two queries (for example before vs. after a config change), or investigate a specific Trino query ID.
- **Example prompt:** _"Explain why Trino query 20260101_120000_00001_abcde is slow."_
- **Bundled references:** a six-file Trino field reference — `query-info.md`, `query-stats.md`, `stage-and-task-stats.md`, `operator-stats.md`, `types-and-enums.md`, and `recipes.md`.

## Feedback & more

- The full framework reference the skills build on is generated to `.agents/dj/AGENTS.md` in your workspace once `dj.codingAgent` is enabled.
- Questions or ideas? Open a [GitHub Discussion](https://github.com/Workday/dj/discussions) or [Issue](https://github.com/Workday/dj/issues).
