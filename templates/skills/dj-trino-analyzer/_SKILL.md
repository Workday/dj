---
name: dj-trino-analyzer
description: >-
  Diagnose Trino query performance from the QueryInfo JSONs written by
  the DJ Query Control Center to .dj/diagnostics/ — the sanitized
  <queryId>.json and the raw <queryId>.full.json. Use when the user
  mentions "trino slow", "explain why query is slow", "trino query
  plan", "broadcast vs partitioned join", "data skew", "trino blocked
  time", "operator memory", asks about raw Trino queryInfo / queryStats
  fields (physicalInputReadTime, totalDrivers, blockedReasons,
  connectorMetrics), wants to compare two queries (e.g. before vs after
  a config change), or asks to investigate a specific Trino query ID.
compatibility: DJ (Data JSON) Framework workspace with .dj/diagnostics/ written by `DJ: Analyze Trino Query with AI`
metadata:
  dj-skill: '1.0'
---

# Analyze a Trino query plan + runtime stats

The DJ extension writes two files per analyzed query:

- **`.dj/diagnostics/<queryId>.json`** — sanitized, shaped for LLM
  token budgets. **Read it first**; most diagnoses end here.
- **`.dj/diagnostics/<queryId>.full.json`** — the raw coordinator
  response from `/v1/query/{queryId}`. Open it only for a targeted
  deep dive, and read only the slice you need (it can be tens of MB —
  use `jq`, never read it whole).

## File shapes

Sanitized `<queryId>.json` top-level keys:

| Key                                                        | Contents                                                                                                                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `summary`                                                  | Computed headline: state, timings in ms, peak memory bytes, splits, `dataSkewScore`, `largestOperator`, connectors, error fields.                                             |
| `queryStats`                                               | Raw passthrough of the coordinator's `queryStats` (minus `operatorSummaries`, `stageGcStatistics`, `rootOperator`). Values keep raw string forms — `"5.01m"`, `"288482816B"`. |
| `failureInfo`, `errorCode`, `dynamicFiltersStats`, `query` | Raw passthrough.                                                                                                                                                              |
| `rootStage`                                                | Trimmed nested stage tree: per-stage `stageStats` and `tasks[]`, minus operator summaries, pipelines, GC info, and output buffers.                                            |
| `operatorSummary`                                          | Flat trimmed operator list (below).                                                                                                                                           |
| `profileName`, `coordinatorUrl`                            | Which Trino cluster the file came from.                                                                                                                                       |

Sanitized `operatorSummary[]` entries vs raw `OperatorStats` names:

| Sanitized                                                                                                          | Raw (full.json)                                                  |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `operatorType`, `pipelineId`, `planNodeId`, `inputPositions`, `outputPositions`, `inputDataSize`, `outputDataSize` | Same names.                                                      |
| `cpuNanos` (number)                                                                                                | `addInputCpu` + `getOutputCpu` + `finishCpu` (Duration strings). |
| `blockedWallNanos` (number)                                                                                        | `blockedWall`.                                                   |
| `peakMemoryReservation`                                                                                            | `peakUserMemoryReservation`.                                     |

Caveats baked into `summary` (computed against multiple Trino
versions):

- `totalSplits` / `completedSplits` fall back to `totalDrivers` /
  `completedDrivers` on newer Trino — same scheduling unit.
- `dataSkewScore` is the worst max/avg input ratio observed — from
  per-operator input distributions when the payload carries them
  (older Trino), else across each stage's tasks. Absent only when
  neither level has the data (e.g. all stages single-task).
- `connectorTypes` / `joinDistributionTypes` are operator-derived
  proxies and may still be empty when operators carry no `info`;
  identify connectors from `summary.catalog`, catalog names in
  `query`, or `inputs[]` in full.json.

## Reading order

1. **`summary`** — the headline view. **Always start here.** Most
   diagnoses can be made from `summary` alone.
2. **`failureInfo` + `errorCode`** — present when `state === "FAILED"`.
   Quote the message back to the user and skip to the recommendation.
3. **`operatorSummary`** — flat operator list. Sort by
   `peakMemoryReservation` desc to find the hot spot.
4. **`rootStage`** — full stage tree, only if the operator summary
   alone doesn't explain the slowness.
5. **`dynamicFiltersStats`** — dynamic-filter effectiveness; key for
   join-pushdown diagnoses.
6. **`query`** (the SQL text) — map the query back to a DJ model. dbt
   injects `/* {"app": "dbt", …, "node_id":
"model.<project>.<modelName>", …} */` at the top of every query it
   submits (enabled by default in `dbt_core`); read the model name from
   `node_id`. Without the comment, infer it from the materialization
   target (`CREATE TABLE/VIEW "<catalog>"."<schema>"."<modelName>" AS …`
   / `INSERT INTO …`) or the trailing `SELECT * FROM <modelName>` of
   dbt's compiled form. The Query Control Center UI shows this same
   match, but it is computed at display time — it is **not** stored in
   the JSON. If none resolves, the query is ad-hoc (or dbt's
   `query-comment` was disabled) — say so plainly rather than guessing.

Do **not** ask the coordinator for additional data. If you need
something not in the sanitized JSON, drill into `full.json` (see the
deep dive below) or recommend the user re-run the analysis.

## Performance heuristics

Apply these in order. Cite the field you used.

### 1. Broadcast-join blow-up

Symptom: a `HashBuilderOperator` or `LookupJoinOperator` with
`peakMemoryReservation` close to the per-node memory limit, or
`summary.peakUserMemoryBytes` > 50% of it. (There is no
`HashJoinOperator` in Trino — the build side is `HashBuilderOperator`,
the probe side `LookupJoinOperator`.)

- The build side is the `HashBuilderOperator`: `inputPositions` > ~1M
  rows there is the classic blow-up. Confirm the distribution in
  full.json — the build-side exchange's `outputBuffers.type` is
  `"BROADCAST"`, or the stage's plan fragment says replicated.
- Fix: force `PARTITIONED` distribution (session property
  `join_distribution_type=PARTITIONED`), or shrink the build side by
  pushing predicates / using an `int_join_models` with explicit
  `where` filters upstream of the join.

### 2. Data skew

Symptom: `summary.dataSkewScore` > 5. To pinpoint the offender and
classify the skew, compare `stats.totalCpuTime`,
`stats.processedInputDataSize`, and `stats.totalDrivers` across
sibling tasks of the dominant stage in `rootStage.tasks[]`.

- Max/min task CPU > 3x with similar `totalDrivers` ⇒ **data skew** —
  a join key with high null/empty cardinality or a power-law key
  distribution. Fix: add null-handling to the join condition, or salt
  the key (`coalesce(key, rand() * 1000)` on one side).
- `totalDrivers` also skewed ⇒ **split-distribution skew** — one
  worker got more splits; fix file sizing (heuristic 7), not the key.

### 3. JSON parsing CPU

Symptom: JSON-heavy SQL (`json_extract*`, `json_parse`,
`CAST(… AS json)` in `query`) with a `ScanFilterAndProjectOperator` or
`FilterAndProjectOperator` dominating `cpuNanos`. There is no dedicated
JSON operator type — parsing burns CPU inside scan/project operators.

- Confirm in full.json via that operator's `metrics` entries
  `"Projection CPU time"` / `"Filter CPU time"`.
- Fix: cast JSON columns to native types in a `stg_*` model so
  downstream models don't re-parse on every query. For one-off
  filtering, use `json_extract_scalar` with explicit paths instead of
  full deserialization.

### 4. High `blockedTimeMs`

Symptom: `summary.blockedTimeMs` > 30% of `wallTimeMs`.

- Check `queryStats.blockedReasons` first. It has exactly one possible
  entry: `WAITING_FOR_MEMORY` ⇒ memory pressure (see heuristics 1
  and the memory fields). **Empty + high blocked time ⇒ I/O or
  exchange back-pressure**, not memory.
- For back-pressure, find the dominant operator's `blockedWallNanos`;
  in full.json check `stageStats.outputBufferUtilization` — sustained
  `max ≈ 1.0` means the downstream stage can't drain fast enough.
- Fix: parallelize the slow consumer (raise `task.concurrency`),
  reduce the upstream's output with a predicate, or split a monolithic
  `mart_*` into smaller intermediate models.

### 5. Object-store scan latency

Symptom: a `TableScanOperator` / `ScanFilterAndProjectOperator` on a
`hive` / `iceberg` / `delta_lake` catalog with small `outputDataSize`
but high `blockedWallNanos` (or `physicalInputReadTime` in full.json).

- The scan is paying per-object latency overhead.
- Fix: enlarge file sizes upstream (target ~128MB-1GB parquet files),
  or restrict the scan with a partition predicate. If the model is a
  DJ staging model, set `materialization.partitions` on its parent.

### 6. Dynamic filter effectiveness

Symptom: `dynamicFiltersStats.dynamicFiltersCompleted` much less than
`totalDynamicFilters`, or `lazyDynamicFilters` > 0.

- Per-filter detail is in `dynamicFilterDomainStats[]`:
  `simplifiedDomain === "ALL"` means the filter pruned nothing; a
  `collectionDuration` close to the execution time arrived too late.
- Fix: ensure the join columns have statistics (`ANALYZE TABLE` if the
  connector supports it); if the probe table is bucketed, partition or
  bucket the build table on the same key.

### 7. Many small splits

Symptom: `summary.totalSplits` > 10 000 with low `processedBytes`.

- Per-split scheduling overhead dominates.
- Fix: compact source files (target Trino split size, typically
  ~64MB); on DJ models, set materialization partitions so dbt-trino
  produces fewer, larger output files.

### 8. Failed query

Symptom: `summary.state === "FAILED"`.

- Quote `summary.failureMessage` / `summary.errorCode` to the user.
- For `EXCEEDED_TIME_LIMIT`, examine `summary.queuedTimeMs` and
  `summary.planningTimeMs` — long queue / planning suggests the
  cluster is saturated, not the query.
- For `EXCEEDED_LOCAL_MEMORY_LIMIT`, fall back to the broadcast-join
  heuristic above.

## Deep dive: `full.json`

The raw QueryInfo, for when the sanitized file isn't enough. Mental
model:

```text
QueryInfo
└─ queryStats                       cluster-wide aggregates — start here
└─ stages.stages[]                  flat list; parent→child via subStages ids
   └─ stageStats                    per-stage aggregates (~same keys as queryStats)
   └─ tasks[] → stats               per-worker task stats
      └─ pipelines[] → operatorSummaries[]   per-operator detail
```

The same metric names recur verbatim at every level, scoped to that
level — pivot on any field and roll up or down.

Symptom → where to drill (on `queryStats` unless noted):

| Symptom                                                        | Likely cause                                         | Drill into                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| `queuedTime` large vs `elapsedTime`                            | Resource-group queueing, not a worker problem        | `resourceGroupId`                                                    |
| `planningTime` / `analysisTime` > 1s                           | Heavy metadata, many partitions                      | `catalogMetadataMetrics`, `optimizerRulesSummaries`                  |
| `totalScheduledTime` >> `totalCpuTime`, `blockedReasons` empty | I/O bound                                            | Per-stage `physicalInputReadTime`; `connectorMetrics`                |
| `blockedReasons` has `WAITING_FOR_MEMORY`                      | Memory pressure                                      | `peakUserMemoryReservation`, `peakTaskUserMemory`, `spilledDataSize` |
| `totalDrivers` very high for the data size                     | Many small files / row groups                        | `stageStats.getSplitDistribution`, `connectorMetrics.dataFiles`      |
| One operator's `blockedWall` large                             | Skew or back-pressure                                | That operator's `inputPositions` + per-task stats                    |
| `stageStats.outputBufferUtilization.max ≈ 1.0`                 | Downstream can't keep up                             | The consumer stage                                                   |
| `failedTasks` > 0                                              | Worker died / preempted (retries may have recovered) | `tasks[].taskStatus.failures`, `failed*` twins                       |

Hard rules when reading either file:

1. **Never invent a field.** If a key isn't in the reference tables
   below, it isn't in the JSON — re-check which level you're at.
2. **State the level a number came from.** `totalScheduledTime` on
   `queryStats` is a cluster-wide sum (dozens of hours on a 1-minute
   query is normal); the same name on one operator is just that
   operator's share.
3. **Check finality.** Trust `queryStats` only when
   `finalQueryInfo == true`; trust per-stage detail only when
   `pruned == false` (full.json top-level fields).
4. **Watch the `failed*` twins** on `queryStats` / `stageStats` when
   retries happened — the unprefixed metric includes discarded work.
5. **Parse, don't eyeball, units.** Durations are strings like
   `"5.01m"`; DataSizes are `"288482816B"`. Parsing rules are in the
   types reference.

## Reference files

Load at most the one file the question needs:

- [references/query-info.md](references/query-info.md) — every
  top-level full.json key; `failureInfo` shape; common error codes.
- [references/query-stats.md](references/query-stats.md) — every
  `queryStats` key (applies to both files), grouped by category.
- [references/stage-and-task-stats.md](references/stage-and-task-stats.md)
  — stages, tasks, pipelines; how the sanitized `rootStage` was trimmed.
- [references/operator-stats.md](references/operator-stats.md) — raw
  `OperatorStats` keys; `metrics` / `connectorMetrics` catalogs
  (Iceberg, Parquet, cache wrappers); `info` subtypes.
- [references/types-and-enums.md](references/types-and-enums.md) —
  parsing Duration / DataSize; `Metric` shapes; all enum values and
  their gotchas.
- [references/recipes.md](references/recipes.md) — jq / Python
  snippets: vital signs, wall-clock decomposition, skew, memory,
  dynamic filters, before/after compare.

## DJ model layering — performance expectations by type

When you've resolved the model name (from the dbt query_comment
`node_id`), the prefix tells you what shape of work to expect:

- **`stg_*`** — Trino → conformed columns. Should be cheap; high CPU
  here usually means JSON parsing or a `stg_union_sources` fanning out
  too many sources.
- **`int_*`** — joins, lookbacks, rollups. The expensive layer. Most
  broadcast-join blow-ups and data-skew issues land here.
- **`mart_*`** — analytics-ready. Materialized as views in DJ, so
  every query against a `mart_*` re-runs the entire upstream DAG.
  When a `mart_*` is slow, the fix is almost always upstream
  (cache an `int_*` as `materialization: incremental`).

Tie any recommendation back to the model layer when you can:

> "This query runs `int__finance__billing__daily_summary` which is the
> int layer where broadcast-join blow-ups are most common. The build
> side here is ~12M rows from `stg__finance__accounts` — shrink it with
> a `where` filter on `account_status = 'active'` upstream."

## Output format

Produce **three sections** in order:

1. **Headline** — one sentence: `state`, `wallTimeMs`,
   `peakUserMemoryBytes`, and the single most likely root cause from
   the heuristics above. Cite the field you used.
2. **Evidence** — bullet list of the supporting numbers from the
   sanitized JSON (operator name, CPU %, memory %, skew evidence, etc.).
3. **Recommendations** — at most 3 actionable items. Each item names
   the file or setting to change.

Do **not** output speculative changes to the SQL — the JSON sources of
truth are the `.model.json` files. Suggest the column / filter /
materialization knob to flip; the user will edit the model JSON.

## Safety rails

- **Never** request or accept row-level query results — the sanitizer
  strips those out and rejects payloads that contain them. If you
  catch yourself wanting `result.data`, stop: the diagnosis can
  always be made from operator + stage statistics.
- **Never** suggest editing the generated `.sql` or `.yml` — only
  the `.model.json` source of truth.
