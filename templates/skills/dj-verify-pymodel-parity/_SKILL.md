---
name: dj-verify-pymodel-parity
description: >-
  Generate Trino SQL to verify that a python model's output table matches a
  legacy/reference table — schema diff, per-partition row-count parity,
  tolerance-based aggregate parity, and row-level diffs via full outer join or
  checksum. Use when the user wants to verify, check, or prove parity between
  an old table and a newly built or migrated python model's output table. Not
  for creating the python model itself (-> dj-create-python-model or
  dj-migrate-notebook-to-pymodel), executing the generated SQL (->
  dj-run-trino), or auditing the model's code for production readiness (->
  dj-review-python-model).
compatibility: DJ (Data JSON) Framework extension workspace with Trino access
metadata:
  dj-skill: '1.0'
---

# Verify Python Model Table Parity

**Goal:** generate Trino SQL that proves (or disproves) a new python model's output table matches an old/reference table, so the user can confirm a migration or rebuild produced the same data before retiring the old source. This skill is **read-only with respect to model files** — it only produces SQL and a report; it never edits `.python.json` / `.model.json`, and it never executes SQL itself.

## When this skill applies

Use this skill when the user mentions: verify parity, check parity, compare tables, row-by-row check, does the new table match the old one, or wants to validate a python model's output against a legacy table after a migration or rebuild.

**Out of scope** — delegate to sibling skills:

- Building the python model whose output is being verified → **`dj-create-python-model`**
- Migrating a legacy notebook into a python model (parity check is the natural next step after that) → **`dj-migrate-notebook-to-pymodel`**
- Actually running the generated SQL against Trino → **`dj-run-trino`**
- Auditing the model's code (not its data) for production readiness → **`dj-review-python-model`**

## Workflow

- [ ] **1. Gather inputs.** Ask for:
  - Old/reference table: `catalog.schema.table`
  - New table: `catalog.schema.table`
  - Key column(s) that uniquely identify a row (for the row-level diff)
  - Partition column (if any) and the range/filter to check (default: the most recent partition, widen only if asked)
  - Float tolerance for aggregate comparisons (default: `1e-6`, ask if the data has known precision quirks)
- [ ] **2. Schema diff first.** Generate `SHOW COLUMNS FROM <table>` for both tables and compare the results before proposing any data comparison — column renames, drops, additions, or type changes should be surfaced and resolved before row-level SQL is written (a data diff against a mismatched schema produces misleading noise).
- [ ] **3. Row-count parity.** Generate a per-partition (and overall) `COUNT(*)` comparison. This is the cheapest, highest-signal check — surface any mismatched partition before running anything more expensive.
- [ ] **4. Aggregate parity.** For numeric/fact columns, generate `SUM`/`AVG`/`MIN`/`MAX`/`COUNT(DISTINCT ...)` per partition for both tables, comparing with `ABS(old - new) > <tolerance>` for floating-point columns and exact equality for integers/counts.
- [ ] **5. Row-level diff.** Generate a `FULL OUTER JOIN` on the key column(s) (or `EXCEPT`/`INTERSECT` when an exact-match check is enough), restricted to the chosen partition/filter, that surfaces: rows only in old, rows only in new, and rows present in both but differing on a non-key column. For "differing on any column" without listing every column by hand, use a hash/checksum of the concatenated (cast-to-`VARCHAR`) non-key columns and compare hashes.
- [ ] **6. Apply the sampling guard.** Default every check to one partition (or date) at a time. Do not generate a full-table diff across all history unless the user explicitly asks for it — state this default and let the user widen scope.
- [ ] **7. Render the output.** Produce clearly labeled SQL sections (schema diff / row counts / aggregates / row-level diff) as a `.draft.sql` file or in-chat SQL blocks, plus a plain-language summary of what each section checks. Offer to hand execution to **`dj-run-trino`** — never run the SQL yourself.
- [ ] **8. Interpret results if the user shares them back.** If the user pastes query results, summarize pass/fail per section and suggest likely root causes for any failure (e.g., a missing dedup step, a timezone shift, a partition filter off by one day) — but do not edit any model file to fix it; that's a manual follow-up once root cause is clear.

## Hard rules (DO NOT)

- **DO NOT** generate anything other than read-only `SELECT` / `SHOW COLUMNS` / `DESCRIBE` SQL. No DDL/DML.
- **DO NOT** execute SQL yourself — always hand off to `dj-run-trino`, which owns confirmation and connection resolution.
- **DO NOT** target a production catalog/schema without the user's explicit confirmation of the connection — mirror `dj-run-trino`'s safety posture.
- **DO NOT** diff a full table across all history by default — always scope to one partition/filter first (see sampling guard) and state that default in the response.
- **DO NOT** edit `.python.json` or `.model.json` to "fix" a mismatch — this skill only reports.

## Reference

For copy-paste SQL templates (count parity, checksum-based row diff, tolerance-based aggregate diff, null-safe key joins, and handling schema drift), see [references/parity-recipes.md](references/parity-recipes.md).
