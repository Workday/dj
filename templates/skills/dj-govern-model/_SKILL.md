---
name: dj-govern-model
description: >-
  Audit governance posture of DJ models and sources -- ownership, PII /
  classification / compliance metadata coverage, registered-group conformance,
  and prod-write posture -- across a file, folder, dependency tree, or the whole
  workspace. Use when the user wants to review data ownership, check PII /
  sensitivity / compliance tagging, find models with no owner, or assess
  governance coverage. Read-only: it reports gaps and recommendations, never
  edits files and never blocks.
compatibility: DJ (Data JSON) Framework extension workspace with `.dj/schemas/` and `.agents/dj/AGENTS.md`
metadata:
  dj-skill: '1.0'
---

# Audit DJ governance posture

**Goal:** produce a **read-only** governance report for `.model.json` / `.source.json`
files in scope. Surface ownership and metadata-coverage gaps, registered-group
conformance, and prod-write posture. **Never edit any file. Never require
governance metadata** — these keys are optional and teams self-enforce their own
policy. This skill only reports; it hands off edits to the authoring / refactor
skills when the user asks to act.

**Reading order:** `.agents/dj/AGENTS.md` (**Structural Governance**, **Project &
Environment Resolution**) → `.agents/dj/reference/meta-and-governance.md`
(**Custom Meta**, **Governance metadata conventions**) → this skill's checks below.

## When this skill applies

- The user mentions reviewing governance, data ownership, owners, stewardship,
  PII, sensitivity, classification, compliance, or metadata coverage.
- The user asks "which models have no owner?", "is this PII tagged?", "what's our
  governance coverage for group X?", or wants a pre-audit before a review cycle.
- Out of scope: applying tags or refactors. When the user wants to _fix_ a gap,
  hand off — model metadata edits to `dj-create-new-model` /
  `dj-review-and-refactor-model`, and reserved-key relocation to
  `dj-review-and-refactor-model`.

## Step 1 — Resolve scope and project

- **Project.** If the workspace holds more than one dbt project, ask which one
  (or all) to audit — do not silently pick a default.
- **Scope.** Default to the open `.model.json` if any; otherwise ask for a single
  file, a folder, the dependency tree of a base model (from
  `target/manifest.json` `child_map` / `parent_map`), or the whole workspace.
  Confirm before a folder / tree / workspace pass.

## Step 2 — Run the checks (read-only)

Read each in-scope `.model.json` / `.source.json`. Capture findings as
`{ file, check, severity, detail }`. Severity is advisory only: `info`
(coverage note) or `warn` (conformance drift). **Nothing here is an error and
nothing blocks.**

### A. Structural conformance (framework-enforced — flag drift only)

- **Registered group.** The model's `group` must be registered in the project's
  dbt group definitions — scan `.yml` files for a top-level `groups:` key (e.g.
  `models/_groups.yml`, `models/groups.yml`, or per-folder `group_*.yml`) and the
  `dbt_project.yml` models config. Flag any model whose group is not registered
  (usually a hand-edited or converted file that drifted).
- **Path matches identity.** The file should sit at the framework-derived path
  for its `type` + `group` + `topic` + `name` (see AGENTS.md **Structural
  Governance**). Flag files whose location or name does not match — do not move
  them; report so the user can re-sync.

### B. Metadata coverage (advisory — report, never require)

- **Ownership.** Report which models/sources declare `meta.owner` (and
  `owner_slack`), and list those without. Present as coverage (e.g. "8/11 models
  have an owner"), not pass/fail.
- **Sensitivity.** Report `pii` / `classification` / `compliance` presence at
  model and column level. Only offer these keys the project already uses — scan
  sibling models first; do not invent a taxonomy the project has not adopted.
- **Freshness.** Note models/sources with vs. without `freshness_sla`.

Skip any dimension the project does not use at all (e.g. if no model tags
`classification`, report that as "not adopted" once, not as a gap per file).

### C. Consistency

- **Owner drift within a group.** Flag a group whose models declare conflicting
  `owner` values — often one is stale.
- **Reserved-key collisions.** Flag governance-looking data authored under a
  framework-reserved `meta` key instead of its structured sibling (see
  `.agents/dj/reference/meta-and-governance.md` **Framework-reserved keys under `meta`**).
  Recommend `dj-review-and-refactor-model` to relocate; do not edit here.

### D. Prod-write posture

- **Python models.** Note any `.python.json` whose `output.database` /
  `output.schema` points at a production target, and whether `write_mode` is
  destructive (`overwrite_partitions`). Report for awareness — do not change.
- **Lightdash-backed marts.** Note marts exposing a `lightdash` block with no
  `lightdash.table.required_filters` (an unbounded explore). Recommend
  `dj-create-new-model` to add a default window if the user wants one.

## Step 3 — Render the report

Print a single structured report, grouped by the four check categories, in this
order: **Structural conformance → Metadata coverage → Consistency → Prod-write
posture**. For each category, lead with a one-line summary (coverage numbers
where relevant), then list findings with `file` and `detail`. If a category is
clean, say so in one line. End with **Recommendations** — a short, prioritized
list that names the sibling skill to run for each actionable item. If there are
no findings, say so plainly and exit.

## Hard rules

- **Read-only.** Never create, edit, move, or delete a file. If the user asks to
  fix something, hand off to the named authoring / refactor skill.
- **Never require governance metadata.** Absence of `owner` / `pii` /
  `classification` / `compliance` is a coverage note, not a failure. Do not
  push a project to adopt keys it has not chosen.
- **Do not run warehouse queries.** This audit reads JSON files only; it does not
  connect to Trino or Lightdash.
- **Respect the framework as the source of truth for placement.** Structural
  drift is reported for the user to re-sync, not corrected here.
