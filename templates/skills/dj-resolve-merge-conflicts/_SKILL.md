---
name: dj-resolve-merge-conflicts
description: >-
  Resolve git merge, rebase, or cherry-pick conflicts in a DJ (Data JSON)
  Framework workspace. Use when the user is merging/rebasing/cherry-picking
  branches and hits conflicts in `.model.json` / `.source.json` or their
  generated `.sql` / `.yml` siblings, or says "resolve the merge conflicts",
  "fix these conflicts", "merge this branch", "help me rebase" -- even if they
  don't mention DJ. Also use when an incoming branch looks old or diverged and
  the user must choose between a full merge and porting specific models from it.
compatibility: DJ (Data JSON) Framework extension workspace with `.dj/schemas/` and `.agents/dj/AGENTS.md`
metadata:
  dj-skill: '1.0'
---

# Resolve DJ merge conflicts

**Goal:** resolve git conflicts in a DJ workspace _correctly for this framework_. The only files you ever hand-merge are the JSON sources of truth (`.model.json` / `.source.json`). The generated `.sql` / `.yml` siblings are **regenerated from the JSON** -- never hand-merged. When the incoming branch looks old or diverged, pause and let the user choose between a full merge and a guided port of specific models.

**Reading order:** `.agents/dj/AGENTS.md` (Model Types, Important Conventions, sync flow) -> `.dj/schemas/` (validate resolved JSON) -> this skill's `references/staleness-and-porting.md` once you reach the staleness gate (Phase 1) or the port path (Phase 2b).

## When this skill applies

- The user is in (or about to start) a `git merge`, `git rebase`, or `git cherry-pick` and has conflicts.
- Conflicts touch `.model.json` / `.source.json` or their generated `.sql` / `.yml`.
- An incoming branch is suspected to be old / based on an older DJ schema, and the user needs to decide full-merge vs. port.

## Core DJ facts (do not violate)

- **Only `.model.json` / `.source.json` are real conflicts.** `.sql` and `.yml` live under `models/` and are committed, so they conflict too -- but they are **framework output**, regenerated from the JSON. Never hand-merge them. There is **no header marker** on generated files; a file is framework-generated iff a **same-stem sibling JSON** exists in the same directory (`foo.model.json` -> `foo.sql` + `foo.yml`; `foo.source.json` -> `foo.yml` only).
- **Conflict markers are NOT reliably caught -- the parser silently recovers.** DJ reads `.model.json` with a lenient `jsonc-parser` that does **not** throw on `<<<<<<<` / `=======` / `>>>>>>>`: it drops the marker lines and keeps a best-effort object (duplicate keys -> last/`theirs` side wins; disjoint keys -> both merged), and the sync discards the parser's error list. DJ flags the Problems tab and skips the file **only if that recovered object then fails schema validation** -- otherwise it generates SQL/YML from the half-resolved model with **no DJ error**. So never rely on sync to "catch" markers: remove every one by hand and verify (Phase 4). VS Code's built-in JSON syntax errors are the more reliable marker signal.
- **An invalid upstream silently degrades its dependents.** A model that fails validation is not merged into the in-memory manifest, and downstream models read their upstream columns from that manifest (`frameworkGetNode`), not by re-parsing the upstream JSON -- so they regenerate against the upstream's **last-good manifest copy** (or against empty columns if the upstream is brand-new and absent from the manifest). The output looks generated but is wrong, so resolve interdependent conflicts upstream-first.
- **Saving a marker-free `.model.json` auto-regenerates its own `.sql` / `.yml`.** The DJ file watcher debounces (`dj.syncDebounceMs`, default ~1500ms) and regenerates that single file. For a **small set of independent conflicts (none reference each other)**, resolving + saving each one is enough -- wait ~2-3s, then verify diagnostics. No project-wide sync required.
- **DAG order only matters when conflicting files reference each other.** If conflicted model A reads from / selects from / CTE-references conflicted model B, then B is upstream: resolve & save B first, then A, so A regenerates and validates against a clean upstream. For large or interdependent conflict sets, prefer one full sync at the end instead.
- **JSONC-aware edits only.** Preserve comments and trailing commas. Never round-trip through `JSON.stringify`.
- **Model identity is `type` / `group` / `topic` / `name` inside the JSON**, mirrored in the filename `<layer>__<group>__<topic>__<name>.model.json`. A "rename" on one branch changes the **file path and both generated siblings**, so renames usually surface as add/delete pairs across 3 files, not as content conflicts. (See Gotchas.)
- **`.dj/` and `target/` are gitignored.** Schemas, the sync cache (`.dj/state`), and dbt's `manifest.json` never appear as conflicts. The manifest is rebuilt by `dbt parse` -- which `DJ: Sync to SQL and YML` triggers on demand. `DJ: Refresh Projects` does **not** run dbt; it only reloads the on-disk manifest into the extension and re-reads `dbt_project.yml`.
- **You cannot invoke VS Code commands.** When a step needs `DJ: Sync to SQL and YML` (`dj.command.jsonSync`), `DJ: Clear JSON Sync Cache` (`dj.command.clearSyncCache`), or `DJ: Refresh Projects` (`dj.command.refreshProjects`), **ask the user to run it** from the command palette.
- **Modernization is out of scope -- but handed off, not dead-ended.** This skill never modernizes inline. When you detect legacy patterns or schema-validation failures, **flag them, ask the user**, and on their go-ahead **read and follow** `.agents/skills/dj-review-and-refactor-model/SKILL.md` (and `.agents/skills/dj-migrate-ephemerals-to-ctes/SKILL.md` for ephemeral inlining) to continue the work in the same session.

## Workflow

### Phase 0 -- Triage

- [ ] Identify the in-progress operation: `.git/MERGE_HEAD` = merge, `.git/rebase-merge` or `.git/rebase-apply` = rebase, `.git/CHERRY_PICK_HEAD` = cherry-pick.
- [ ] List unmerged files: `git diff --name-only --diff-filter=U`.
- [ ] Bucket every conflicted file:
  - **JSON source of truth** -- `*.model.json`, `*.source.json`. (The real work.)
  - **Generated artifact** -- `*.sql` / `*.yml` that has a same-stem sibling JSON. (Do not hand-merge; regenerate.)
  - **Other repo file** -- `dbt_project.yml`, `packages.yml`, seeds, hand-written macros, Python, etc. (Resolve generically or defer to the user.)
  - **Gitignored** -- anything under `.dj/` or `target/` should not appear; if it does, the user committed it against the framework's intent -- flag it.
- [ ] Within the JSON bucket, check whether the conflicted models reference each other (scan `from.model`, `from.join[]`, `from.union`, `*_from_model` bulk selects, and CTE model refs). If they do, record an **upstream-first** resolve/save order and treat the set as "interdependent" (favor a full sync in Phase 3).

### Phase 1 -- Staleness / divergence gate

- [ ] Assess whether the incoming branch is old or diverged using `references/staleness-and-porting.md` (git divergence/age + legacy-pattern count + a trial schema-validation of the conflicted models). Thresholds are advisory.
- [ ] If it does **not** look stale, continue to Phase 2a.
- [ ] If it **does** look stale/diverged, **stop and ask the user** to choose, presenting the concrete findings:
  - **Full merge** -- proceed with Phase 2a (expect to flag/modernize legacy shapes).
  - **Port specific models** -- proceed with Phase 2b (abandon the full merge; bring over only the models they name).

### Phase 2a -- Full-merge resolution

- [ ] **Resolve JSON sources of truth first**, in upstream-first order if interdependent. Reconstruct each side cleanly with the stage refs -- `git show :1:<path>` (base), `:2:<path>`, `:3:<path>` -- then merge semantically with a JSONC-aware edit. Under `git merge`, `:2:` = your branch and `:3:` = the incoming branch; under `git rebase` / `git cherry-pick` they are **swapped** (see Gotchas). Remove every conflict marker; the result must be valid JSONC.
- [ ] **Do not hand-merge generated `.sql` / `.yml`.** For each with a sibling JSON, clear the markers by checking out either side (e.g. `git checkout --ours -- <path>` then `git add <path>`) -- the content is overwritten in Phase 3, so the side doesn't matter. (If only the generated file conflicts but its JSON does not, the JSON already agrees -- just regenerate.)
- [ ] **Other repo files:** resolve generically; if it's outside your competence (e.g. a hand-tuned macro), surface it and ask the user.
- [ ] **Flag legacy patterns** you encounter while resolving (legacy `materialized` + `incremental_strategy` + `partitioned_by`; `meta.dimension` / `meta.metrics` instead of `lightdash.*`; `int_rollup_model`; standalone ephemerals). Do **not** rewrite them here. List them, ask whether to modernize, and on yes read & follow `dj-review-and-refactor-model` (or `dj-migrate-ephemerals-to-ctes`).

### Phase 2b -- Guided port (stale branch alternative)

Follow the full recipe in `references/staleness-and-porting.md`. In short: confirm exactly which models the user wants, abort the in-progress merge/rebase, `git show <stale-branch>:<path>` the chosen `.model.json` / `.source.json` (JSON only -- never the generated siblings), place them on the current branch, resolve name/path collisions, validate against the current `.dj/schemas/`, flag legacy/invalid shapes and -- with the user's go-ahead -- read & follow `dj-review-and-refactor-model` to bring them up to the current schema. Then continue at Phase 3.

### Phase 3 -- Regenerate & verify (adaptive)

- [ ] Confirm no conflict markers remain in any JSON (every `.model.json` / `.source.json` is valid JSONC).
- [ ] Pick the lightest sufficient regeneration -- **do not reflexively reach for the full Clear Cache + Sync**:
  - **Few, independent conflicts:** rely on the per-file watcher -- after saving each resolved `.model.json`, wait ~2-3s for the debounce, then confirm its `.sql` / `.yml` regenerated and the Problems tab is clean for that file. (Interdependent: save upstream-first.) No cache clear or project-wide sync is needed here.
  - **Many or interdependent conflicts (or any doubt):** ask the user to run `DJ: Clear JSON Sync Cache`, then `DJ: Sync to SQL and YML`, for a deterministic dependency-ordered regen of the whole project.
- [ ] **No separate manifest step is needed for added / renamed / deleted models** -- `DJ: Sync to SQL and YML` reparses the manifest on demand (it runs `dbt parse` when a synced model is missing or the manifest is stale). Ask for `DJ: Refresh Projects` **only** if the merge changed `dbt_project.yml` (vars like `storage_type` / `etl_schema` / `project_catalog`, or the project name) or added a whole dbt project; it reloads project config + the on-disk manifest, but does not run dbt.
- [ ] Re-stage the regenerated `.sql` / `.yml` (`git add`) once they look correct and diagnostics are clean.

### Phase 4 -- Finalize

- [ ] **Verify no conflict markers remain** in anything you're about to stage -- e.g. `git grep -nE '^(<<<<<<<|=======|>>>>>>>)' -- '*.model.json' '*.source.json'` should print nothing. A `git add` on a still-markered file silently commits the markers.
- [ ] **Stage what you resolved and regenerated:** the resolved `.model.json` / `.source.json` **and** the regenerated `.sql` / `.yml`. After a Sync those generated siblings are modified-but-unstaged again, so they must be re-added (`git add <paths>`) or the commit captures the stale pre-Sync output.
- [ ] Confirm `git diff --diff-filter=U` is empty (no remaining unmerged paths) and `git status` shows the resolved + regenerated files staged.
- [ ] Summarize what was resolved, what was regenerated, and any flagged-but-deferred modernization.
- [ ] **Do not commit -- hand the final commit to the user**, naming the command that matches the in-progress op detected in Phase 0:
  - merge -> `git commit` (or `git merge --continue`)
  - rebase -> `git rebase --continue`
  - cherry-pick -> `git cherry-pick --continue`

## Hard rules (DO NOT)

- **DO NOT** hand-merge generated `.sql` / `.yml`. Resolve the JSON, then regenerate. They have no merge value of their own.
- **DO NOT** leave any conflict marker in a `.model.json` / `.source.json`, and never `git add` a markered file. The lenient parser won't reject markers -- it silently keeps one side and can generate SQL/YML from the half-resolved model, so they must be removed by hand, not left for sync to "catch".
- **DO NOT** use `JSON.stringify` or any non-JSONC writer on a `.model.json` -- it strips comments and trailing commas (forbidden by `AGENTS.md`). Use targeted string edits or `jsonc-parser` modify ops.
- **DO NOT** modernize legacy shapes inline. Flag, get user consent, then continue by reading & following `dj-review-and-refactor-model` / `dj-migrate-ephemerals-to-ctes`.
- **DO NOT** invoke VS Code commands yourself. Ask the user to run Sync / Clear Cache / Refresh Projects.
- **DO NOT** reflexively prescribe `DJ: Clear JSON Sync Cache` + full `DJ: Sync to SQL and YML` or `DJ: Refresh Projects`. Use the per-file watcher for a few independent conflicts; reserve the full sync for many/interdependent sets, and `DJ: Refresh Projects` for `dbt_project.yml` / new-project changes -- not for ordinary model edits, which Sync's own reparse already covers.
- **DO NOT** commit or push. Stage the resolved JSON **and** the regenerated `.sql` / `.yml`, then hand the commit to the user with the command matching the in-progress op (`git commit` / `git merge --continue`, `git rebase --continue`, or `git cherry-pick --continue`).
- **DO NOT** resolve a model conflict by deleting a `.model.json` unless that is the genuine intent (one branch intentionally removed the model) and the user confirms -- and then also remove its generated `.sql` / `.yml` siblings.
- **DO NOT** edit anything under `.dj/` or `target/`.

## Gotchas

- **`ours` / `theirs` invert under rebase & cherry-pick.** With `git merge`, `:2:` / `--ours` is your current branch and `:3:` / `--theirs` is the incoming branch. Under `git rebase` / `git cherry-pick` they are swapped (ours = the branch being replayed onto, theirs = the commit being applied). Confirm which side is which before choosing semantics; for generated files it's moot since they're regenerated.
- **Clear-cache is only for the full-sync path.** The per-file watcher regenerates a saved file regardless of cache (resolving the conflict changed the JSON hash). Hash-based caching can skip files only on the project-wide sync, which is why that path clears the cache first.
- **Renames span three files.** A DJ rename (changing `type` / `group` / `topic` / `name`) moves the `.model.json` and both generated siblings. In a merge this shows up as add/delete pairs, often combined with a content edit on the other branch. Reconcile by deciding the final identity, keeping one `.model.json` at the correct path, deleting the stale path's three files, and letting Phase 3 regenerate the siblings at the new path.
- **Sources emit only `.yml`.** A `.source.json` has a single generated sibling; there is no `.sql`.
- **The sync engine coalesces after git operations.** After a checkout/pull/rebase/reset, DJ batches a single sync -- but it will **not** error out on leftover markers (it generates from the half-recovered object; see Core facts), so every JSON must be fully resolved before that sync runs.
- **Manifest conflicts shouldn't happen.** `target/manifest.json` is gitignored. If stale lineage persists, a full `DJ: Sync to SQL and YML` reparses it via `dbt parse`; `DJ: Refresh Projects` only reloads the copy already on disk.
- **Both-added the same column / metric.** The most common semantic `.model.json` conflict is two branches appending different entries to `select` / `lightdash.metrics`. Usually the union of both is correct -- but confirm there's no duplicate `name` and no contradictory `type` / `agg` before saving.

## Worked example

A `git merge feature/orders` leaves two conflicts: `int__sales__orders__daily.model.json` and its generated `int__sales__orders__daily.sql`. The two branches each added a different column to `select`.

1. **Triage.** `git diff --name-only --diff-filter=U` lists the `.model.json` and the `.sql`. The `.sql` has a same-stem sibling JSON -> it's generated. No other conflicted model references this one -> independent, no special order.
2. **Staleness gate.** Merge-base is recent, no legacy patterns, the model validates against `.dj/schemas/` -> not stale. Proceed to full merge.
3. **Resolve the JSON.** Inspect both sides with `git show :2:.../int__sales__orders__daily.model.json` (ours) and `:3:...` (theirs). Both added a `select` entry; keep both (no name clash, types consistent). Edit JSONC-aware, remove all markers.
4. **Clear the generated `.sql`.** `git checkout --ours -- .../int__sales__orders__daily.sql && git add` -- it will be overwritten.
5. **Regenerate (per-file path).** Save the `.model.json`; wait ~3s for the watcher; confirm `int__sales__orders__daily.sql` regenerated with both new columns and the Problems tab is clean.
6. **Finalize.** Verify no markers remain, then `git add` both the resolved `.model.json` and the regenerated `.sql`; confirm `git diff --diff-filter=U` is empty; report the resolution and let the user finish the merge with `git commit` / `git merge --continue`.
