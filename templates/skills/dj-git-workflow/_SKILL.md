---
name: dj-git-workflow
description: >-
  Git hygiene for a DJ (Data JSON) Framework dbt project — what to commit (the
  .model.json / .source.json sources together with their generated .sql / .yml),
  what to ignore (.dj/), branching, and commit conventions. Use when the user
  asks to commit, stage, branch, or check in their DJ models, or asks what should
  be committed. For merge conflicts between JSON and generated files, use
  dj-resolve-merge-conflicts instead.
compatibility: DJ (Data JSON) Framework workspace under git with .agents/dj/AGENTS.md
metadata:
  dj-skill: '1.0'
---

# DJ git workflow

Commit DJ work consistently. The full guidance — coupling JSON sources with generated output, ignoring DJ state, finding changed models, and the guardrails — lives in `.agents/dj/reference/git-workflow.md`. Read it before staging.

Essentials:

1. **Commit the pair together.** A `.model.json` / `.source.json` and its generated `.sql` / `.yml` are one unit. Ask the user to run `DJ: Sync to SQL and YML` first, then stage the source and its generated siblings together — never commit a JSON change with stale generated files.
2. **Never stage `.dj/`.** It is DJ's local state and is gitignored. Respect the existing `.gitignore` (including any dashboards-as-code marker blocks).
3. **Match the project's commit style.** Scan `git log --oneline`; don't impose the DJ repo's `type(scope):` convention on a downstream project.
4. **Ask before pushing; guard secrets.** Stop at the commit unless the user asks to push; never `git push --force` a shared branch or `git reset --hard`. Follow the repo's `.gitignore`, don't stage hard-coded credentials, and confirm with the user when you're unsure whether a file holds a secret (a `profiles.yml` is fine only when it uses `env_var`).
