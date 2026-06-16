# Staleness assessment & guided port

Load this on demand from `dj-resolve-merge-conflicts` when you reach the **staleness gate (Phase 1)** or the **guided port (Phase 2b)**. It covers: how to decide whether an incoming branch is old/diverged, how to ask the user, and the step-by-step port recipe.

---

## 1. Staleness / divergence assessment

Combine three independent signals. No single one is decisive; **thresholds are advisory** -- you surface the evidence, the user decides.

### 1a. Git signals (how far / how old)

First resolve the incoming ref: `MERGE_HEAD` (merge), `CHERRY_PICK_HEAD` (cherry-pick), or the upstream/onto for a rebase. Then:

| Signal            | Command                                                             | Reading                                                        |
| ----------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| Merge base        | `git merge-base HEAD MERGE_HEAD`                                    | The common ancestor commit.                                    |
| Divergence counts | `git rev-list --left-right --count HEAD...MERGE_HEAD`               | `<ahead>  <behind>` -- how far each side moved since the base. |
| Base age          | `git log -1 --format='%cr (%cd)' $(git merge-base HEAD MERGE_HEAD)` | How long ago the branches diverged.                            |
| Incoming tip age  | `git log -1 --format='%cr' MERGE_HEAD`                              | How stale the incoming work itself is.                         |
| Conflict breadth  | `git diff --name-only --diff-filter=U \| wc -l`                     | Many conflicts across many models hints at deep divergence.    |

Treat as "likely stale" when, for example, the merge base is many months old, the incoming branch is hundreds of commits behind, or nearly every conflicted model collides. These are heuristics, not gates.

### 1b. Content signals (legacy DJ patterns)

Scan the **incoming** side of the conflicted `.model.json` (use `git show :3:<path>` for the theirs side, or `git show <branch>:<path>`). A high density of these means the branch predates current DJ capabilities:

- Legacy materialization: top-level `"materialized"`, `"incremental_strategy"`, `"partitioned_by"`.
- Lightdash-under-`meta`: a `"meta"` block carrying `"dimension"` / `"metrics"` / `"metrics_merge"` / `"case_sensitive"` (now authored under `lightdash.*`).
- `"type": "int_rollup_model"` (now expressible via `from.rollup`).
- Standalone ephemeral `int_*` / `stg_*` models that newer code would inline as CTEs.

These overlap exactly with the `dj-review-and-refactor-model` and `dj-migrate-ephemerals-to-ctes` catalogs -- which is the point: if they're dense, modernization is the natural follow-up.

### 1c. Schema-validation signal (strongest)

After a trial resolution (or directly on the incoming JSON), validate each conflicted `.model.json` against the current `.dj/schemas/model.schema.json`. **Validation failures from removed/renamed fields are the clearest proof the branch was authored against an older schema.** Check via the VS Code Problems tab (the workspace binds `.dj/schemas/` to `*.model.json`) or a quick standalone Ajv check against `.dj/schemas/model.schema.json`.

### 1d. Verdict

Summarize the evidence in one compact block, e.g.:

```text
Incoming branch feature/legacy-billing:
  - diverged ~8 months ago (base 2025-10), 412 commits behind main
  - 9 of 11 conflicted models use legacy `materialized` + `incremental_strategy`
  - 3 models fail current-schema validation (removed field `partitioned_by` shape)
=> looks old / based on an older DJ schema.
```

Then ask (Phase 1 gate).

---

## 2. Decision-gate wording

Ask in natural prose that fits the findings -- do **not** paste a fixed template. Present the two paths and their trade-offs, and **wait**:

- **Full merge** -- resolve every conflict on this branch. Expect to flag (and, with your consent, modernize) the legacy shapes. Best when the branch is broadly still relevant and you want all of it.
- **Port specific models** -- abandon this merge and bring over only the models you name, modernized to the current schema. Best when the branch is mostly stale and you only need a few models.

Illustrative (rewrite each time): _"This branch diverged ~8 months ago and most of its models use a pre-`materialization` schema. I can either push through the full merge (resolving + modernizing as we go), or skip the merge and port just the models you actually need. Which do you want -- and if porting, which models?"_

Do not auto-pick. A vague reply is a clarification request, not consent.

---

## 3. Guided port recipe (Phase 2b)

Used when the user chooses to port instead of merging. Modernization itself is delegated -- this recipe brings the files over and hands off.

- [ ] **1. Confirm scope.** Get the exact model/source names. Resolve their paths on the stale branch: `git ls-tree -r --name-only <branch> -- models/ sources/ | rg '<name>'`.
- [ ] **2. Abort the in-progress operation.** `git merge --abort` (or `git rebase --abort` / `git cherry-pick --abort`). Ensure the working tree is clean first; stash unrelated changes if needed. You're now on a clean current branch.
- [ ] **3. Extract JSON only.** For each chosen file: `git show <branch>:<path>` and write it to the same (or corrected) path on the current branch. **Never extract the generated `.sql` / `.yml`** -- they regenerate from the JSON.
- [ ] **4. Pull in dependencies.** If a ported model references upstream models/sources via `from.model` / `from.join[]` / `from.union` / `*_from_model` / CTE refs that don't exist on the current branch, either recurse (port those too) or, with the user, rewire the references to existing current-branch equivalents. A ported model whose upstreams are missing will fail to generate.
- [ ] **5. Resolve collisions.** If a model with the same identity (`type`/`group`/`topic`/`name`) already exists on the current branch, decide with the user: overwrite, re-identify the import (change `type`/`group`/`topic`/`name` -> new file path), or merge the two. Watch for filename/path collisions specifically.
- [ ] **6. Validate & hand off modernization.** Validate each ported `.model.json` against `.dj/schemas/`. If anything is legacy or invalid, flag it; with the user's go-ahead, **read and follow** `.agents/skills/dj-review-and-refactor-model/SKILL.md` (and `.agents/skills/dj-migrate-ephemerals-to-ctes/SKILL.md` for ephemerals) to modernize it to the current schema.
- [ ] **7. Regenerate.** Ported files are new and usually several at once -- prefer the full path: ask the user to run `DJ: Clear JSON Sync Cache`, then `DJ: Sync to SQL and YML`, then `DJ: Refresh Projects` so the manifest picks up the new models.
- [ ] **8. Verify & finalize.** Confirm the Problems tab is clean for every ported file. `git add` the JSON and the regenerated `.sql` / `.yml`. Leave the commit to the user.

### Caveats

- **Porting copies content, not git history.** The ported models lose their per-commit history from the stale branch. If preserving history is essential, a targeted `git cherry-pick` of the specific commits is the alternative -- but that reintroduces the old-schema conflicts the user was trying to avoid, so porting is usually the pragmatic choice for genuinely stale branches. Surface this trade-off if history matters.
- **Generated siblings are always regenerated, never copied.** Even if the stale branch had a perfectly good `.sql`, regenerate it -- the current framework may emit different SQL for the same JSON.
- **Sources port the same way** but have only a single generated `.yml` sibling (no `.sql`).
