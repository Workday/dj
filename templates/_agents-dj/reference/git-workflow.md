# Git workflow

Load this when committing, staging, or branching DJ work in this dbt project. For merge conflicts between a `.model.json` and its generated `.sql` / `.yml`, use the `dj-resolve-merge-conflicts` skill instead.

## Commit the JSON source and its generated output together

A DJ model is two coupled artifacts: the hand-authored source (`.model.json` / `.source.json`) and the framework-generated siblings (`.sql` / `.yml`, plus `.python.py` for Python models). Commit them **together** so the repository stays consistent for dbt runs and CI.

- **Sync before you commit.** After editing a `.model.json`, ask the user to run **`DJ: Sync to SQL and YML`** so the generated files reflect the source. Never commit a JSON change while its `.sql` / `.yml` are stale.
- **Never hand-edit the generated files** to make a diff look right — change the `.model.json` and re-sync.

## Do not commit DJ internal state

- `.dj/` holds DJ's local caches, diagnostics, and state; DJ adds it to `.gitignore`. Never stage it.
- The dashboards-as-code path (`lightdash/` by default) may be intentionally gitignored via marker blocks depending on the project's setup — respect the existing `.gitignore` rather than force-adding those files.

## Branch, stage, commit

Standard git: `git checkout -b <branch>`, `git add <paths>`, `git commit`. Follow the **project's own** commit-message style — scan `git log --oneline` to match it. (The DJ extension repository uses `type(scope): description`, but a downstream dbt project may have its own convention; do not impose DJ's scopes on it.)

## Find what changed

To see which models a change touched, mirror what DJ's own tooling does:

```bash
git --no-pager diff --name-only origin/master..
git status --porcelain
```

Filter for `.model.json` / `.source.json` to find edited sources, and confirm their generated `.sql` / `.yml` are staged alongside them.

## Guardrails

- **Ask before pushing.** Do not `git push` without the user's go-ahead, and never `git push --force` to a shared branch. Stop at the commit by default — pushing, opening a PR, or any `gh` operation needs the user to ask for it first.
- **Do not discard work.** Avoid `git reset --hard`, `git checkout -- .`, or deleting untracked files that may be in-progress work — ask first.
- **Don't commit secrets, and follow `.gitignore`.** API tokens and hard-coded warehouse credentials must never be staged; honor the repo's `.gitignore` rather than force-adding an ignored file. A `profiles.yml` is safe to commit only when it reads its secrets from environment variables (e.g. `{{ env_var('...') }}`) instead of embedding them. If you're unsure whether a file contains a secret, stop and confirm with the user before staging it.
