---
name: dj-cli-registry
description: >-
  Master index of all DJ agent skills and their preferred `.dj/bin/dj` operations.
  Use when picking a skill, routing an ambiguous request, or finding the right
  CLI command. Not a replacement for task-specific skills — load the matched skill
  for full workflow instructions. For CLI invocation patterns see dj-cli.
compatibility: DJ (Data JSON) Framework extension workspace with dj.codingAgent enabled
metadata:
  dj-skill: '1.0'
---

# DJ skills & CLI registry

Fast routing — **which skill** + **which CLI ops** — without loading full skill bodies.

**Precedence rule:** When `.dj/bin/dj system.ping` succeeds, prefer `.dj/bin/dj <op>` over hand-authoring JSON, loading `.dj/schemas/`, grepping for columns, or raw `trino-cli` — then load the task skill for workflow decisions only.

## How to use

1. Scan [references/skills-index.md](references/skills-index.md) for the user's intent.
2. Activate the matched **skill** for workflow decisions.
3. Run the listed **CLI ops** via `dj-cli` (invocation patterns, exit codes, fallbacks).
4. If `CLI: No`, follow the skill's file-based workflow only.

## References

- Full skill ↔ CLI table: [references/skills-index.md](references/skills-index.md)
- CLI invocation: `dj-cli` → [references/command-catalog.md](../dj-cli/references/command-catalog.md)
- Extended CLI reference (repo): `docs/cli_commands/command-reference.md`
