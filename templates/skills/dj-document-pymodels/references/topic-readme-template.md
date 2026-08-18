# Topic README template

Skeleton for `dags/python_models/<group>/<topic>/README.md`, generated/refreshed by `dj-document-pymodels`.

## Preserve vs. regenerate convention

Wrap any hand-written prose you want to survive future regenerations in a `<!-- keep -->` / `<!-- /keep -->` block:

```markdown
<!-- keep -->
This section was written by a human and will not be touched by future
regenerations of this README.
<!-- /keep -->
```

Everything **outside** `<!-- keep -->` blocks is mechanically regenerated from the current `.python.json` files each time the skill runs — most importantly the model table (§2 below), which should always reflect current state rather than go stale. A README with no `<!-- keep -->` markers at all is treated as fully regeneratable, but the skill still shows a diff before overwriting it.

## Skeleton

```markdown
# <topic> (<group>)

<!-- keep -->
<One-paragraph topic purpose — what this group of models exists to do,
who/what consumes the output, and why it's organized as its own topic.>
<!-- /keep -->

## Models

| Model | Description | DAG(s) | Output table | Write mode | Partition | Depends on |
|-------|-------------|--------|---------------|------------|-----------|------------|
| `python__<group>__<topic>__<name>` | <one-line description> | <dag list or "none"> | `<database>.<schema>.<table>` | <write_mode> | <partition_by columns> | <upstream models or "none"> |

## `<model_name>`

### Data flow

<Source → extract → transform → output, one or two sentences. E.g., "Fetches
paginated results from an external API, stages raw JSON into a Trino temp
table, then transforms and writes to `<database>.<schema>.<table>`.">

### Business logic notes

<Non-obvious joins, dedup rules, special-case handling worth calling out —
only include what's evidenced in the code or JSON, omit if none.>

### Upstream / downstream

- **Reads from:** <source tables / other python models this depends on>
- **Read by:** <other python models or dbt sources that consume this model's output table>

### Gotchas

<Only include what's actually evidenced — a rate limit noted in a markdown
cell, a manual credential-rotation step, a known data-quality caveat. Omit
this subsection entirely for a model if nothing is evidenced.>

<!-- repeat the "## `<model_name>`" section for every model in the topic -->
```

## Notes

- The model table (§ "Models") is always mechanically derived from the `.python.json` files' `name`/`description`/`dags`/`output`/`depends_on` fields — never hand-edit it directly; edit the source JSON and re-run the skill instead.
- Per-model sections that have no evidenced content for a subsection (e.g., no gotchas found) should omit that subsection rather than show an empty heading.
- If the topic folder has only one model, still use the same per-model section structure — consistency matters more than brevity for a topic that later grows more models.
