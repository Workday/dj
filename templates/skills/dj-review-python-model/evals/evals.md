# Evals — dj-review-python-model

Prompt → expected-finding cases for the read-only Python model review. Each case describes an input model condition and the finding the review must raise (with its check ID). Use these to sanity-check the skill after edits.

The review treats `.python.py` as the **code source of truth** (hand-edits are expected, not drift). `.python.json` holds metadata + a non-authoritative `cells` snapshot. Only `_trino_io.py` / `_config.py` / `_model_tasks.py` are generated.

---

## E1 — Missing upstream_source for a table read

**Input:** model reads `glue_development.analytics.user_sessions` in SQL but `upstream_sources` omits it.

**Expected:** **L5 ISSUE** — completeness gap; the table read in code has no matching `trino` entry. Report lists tables-read vs declared and the missing FQN.

## E2 — Inline Trino connection

**Input:** `.python.py` uses `from trino.dbapi import connect` / raw HTTP to Trino.

**Expected:** **F5 ISSUE** — inline Trino code; recommend `_trino_io` helpers. HIGH priority.

## E3 — Stale upstream_sources entry

**Input:** `upstream_sources` lists `old_events_table` that no code path reads.

**Expected:** **L6 WARNING** — stale/phantom entry; misleading graph edge.

## E4 — Sibling read without depends_on

**Input:** model reads another Python model's output table but `depends_on` does not list that model.

**Expected:** **L7 ISSUE** — race condition; `depends_on` must list the sibling for task ordering (in addition to the `upstream_sources` lineage edge).

## E5 — Import-unsafe module

**Input:** `.python.py` has a bare `run_etl(context)` at module top level.

**Expected:** **F8 ISSUE** — not import-safe; would execute on import under Airflow worker / KPO. Recommend the `__main__` block as the sole entry.

## E6 — Pure pandas model is not penalized

**Input:** coherent pandas end-to-end model (`extract → transform → load`).

**Expected:** **P1 PASS** — do **not** flag solely because pandas is used. Only flag genuine inconsistencies with the chosen style.

## E7 — Legacy 2-part trino FQN

**Input:** `upstream_sources` uses `opus_python_source.tenant_events` (2-part).

**Expected:** **L3 WARNING (LOW)** — legacy format still parsed; recommend migrating to `catalog.schema.table`.

## E8 — Read-only guarantee

**Input:** any model.

**Expected:** the skill produces a structured report and changes **no** files; it does not execute SQL against Trino.
