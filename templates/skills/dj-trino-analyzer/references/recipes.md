# Diagnostic recipes

Copy-pasteable jq / Python snippets for `<id>.full.json` (raw QueryInfo
shape). On the sanitized `<id>.json`, the `.queryStats.*` expressions
work as-is; stage/task recipes need `rootStage` (nested tree) instead of
`.stages.stages[]`, and operator recipes use the trimmed top-level
`operatorSummary[]`.

If a number looks wrong, re-check the aggregation level
(query vs stage vs task vs operator).

## R1. One-line vital signs

```bash
jq '{
  id: .queryId, state: .state,
  err: (.errorCode.name // null), failureType: (.failureInfo.type // null),
  elapsed: .queryStats.elapsedTime, cpu: .queryStats.totalCpuTime,
  scheduled: .queryStats.totalScheduledTime, blocked: .queryStats.totalBlockedTime,
  blockedReasons: .queryStats.blockedReasons,
  drivers: .queryStats.totalDrivers,
  peakMem: .queryStats.peakUserMemoryReservation,
  peakTaskMem: .queryStats.peakTaskUserMemory,
  read: .queryStats.physicalInputDataSize, readTime: .queryStats.physicalInputReadTime,
  rows: .queryStats.processedInputPositions,
  retry: .retryPolicy, final: .finalQueryInfo, pruned: .pruned
}' file.full.json
```

Anything off here decides which recipe to run next. Trust `queryStats`
only when `finalQueryInfo == true`; per-stage detail only when
`pruned == false`.

## R2. Where did the wall clock go?

```bash
jq '.queryStats | {elapsed: .elapsedTime, queued: .queuedTime,
  resourceWaiting: .resourceWaitingTime, dispatching: .dispatchingTime,
  planning: .planningTime, starting: .startingTime,
  execution: .executionTime, finishing: .finishingTime}' file.full.json
```

Sum check: `elapsed ≈ queued + resourceWaiting + dispatching + execution + finishing`.

## R3. Slowest stages

```bash
jq -r '.stages.stages[] | [.stageId, .state,
  .stageStats.totalScheduledTime, .stageStats.physicalInputReadTime,
  .stageStats.totalDrivers,
  (.stageStats.outputBufferUtilization.max // 0)] | @tsv' file.full.json | column -t
```

Order by `totalScheduledTime` to find the dominant stage.

## R4. Per-worker skew within a stage

```bash
STAGE=<queryId>.1
jq -r --arg s "$STAGE" '.stages.stages[] | select(.stageId == $s) | .tasks[] |
  [.taskStatus.taskId, .taskStatus.nodeId, .taskStatus.state,
   .stats.totalCpuTime, .stats.physicalInputReadTime,
   .stats.totalDrivers, .stats.peakUserMemoryReservation] | @tsv' \
  file.full.json | column -t | sort -k4 -h
```

Max/min `totalCpuTime` > 3x with similar `totalDrivers` ⇒ **data skew**
(one worker got the heavy partitions). `totalDrivers` also skewed ⇒
**split-distribution skew** (one worker got more splits).

## R5. Slowest operators (cluster rollup)

```bash
jq -r '.queryStats.operatorSummaries | sort_by(.addInputWall) | reverse | .[0:15] |
  .[] | [.stageId, .planNodeId, .operatorType,
         .inputPositions, .outputPositions,
         .addInputCpu, .addInputWall, .blockedWall,
         .peakUserMemoryReservation, .spilledDataSize] | @tsv' \
  file.full.json | column -t
```

- `blockedWall / addInputWall > 1` ⇒ mostly waiting.
- `addInputWall >> addInputCpu` on a scan ⇒ storage-read bound (R6).
- `spilledDataSize > 0` ⇒ memory pressure pushed it off-heap.

## R6. Scan-leaf deep dive (Iceberg / Parquet)

```bash
jq '.queryStats.operatorSummaries[]
  | select(.operatorType == "ScanFilterAndProjectOperator"
        or .operatorType == "TableScanOperator")
  | {planNodeId, totalDrivers, inputPositions, inputDataSize,
     physicalInputDataSize, physicalInputReadTime,
     connectorMetrics, metrics}' file.full.json
```

Interpretation table: [operator-stats.md](operator-stats.md) §3.

## R7. Memory-pressure check

```bash
jq '{peakUserMem: .queryStats.peakUserMemoryReservation,
  peakTotalMem: .queryStats.peakTotalMemoryReservation,
  perTaskPeak: .queryStats.peakTaskUserMemory,
  spilled: .queryStats.spilledDataSize,
  blockedReasons: .queryStats.blockedReasons,
  fullyBlocked: .queryStats.fullyBlocked}' file.full.json
```

`blockedReasons` contains `WAITING_FOR_MEMORY` ⇒ a memory pool hit a
limit. `spilledDataSize > 0` ⇒ revocable spill triggered (joins, sorts,
aggregations).

## R8. Output-buffer back-pressure

```bash
jq -r '.stages.stages[] | [.stageId,
  (.stageStats.outputBufferUtilization.p50 // null),
  (.stageStats.outputBufferUtilization.p95 // null),
  (.stageStats.outputBufferUtilization.max // null)] | @tsv' file.full.json | column -t
```

`max ≈ 1.0` with `p95 > 0.9` ⇒ the downstream stage can't keep up.

## R9. Dynamic-filter health

```bash
jq '.queryStats.dynamicFiltersStats' file.full.json
```

Shape: `{dynamicFilterDomainStats: [{dynamicFilterId, simplifiedDomain,
collectionDuration}], lazyDynamicFilters, replicatedDynamicFilters,
totalDynamicFilters, dynamicFiltersCompleted}`. An entry with
`simplifiedDomain == "ALL"` was useless; a tight domain whose
`collectionDuration` is close to `executionTime` arrived too late to
prune the scan.

## R10. Compare two queries side by side

```python
import json

KEYS = [
    "elapsedTime", "totalScheduledTime", "totalCpuTime", "totalBlockedTime",
    "physicalInputDataSize", "physicalInputPositions", "physicalInputReadTime",
    "internalNetworkInputDataSize", "processedInputPositions", "totalDrivers",
    "peakUserMemoryReservation", "peakTaskUserMemory", "spilledDataSize",
    "outputDataSize", "outputPositions",
]

def stats(path):
    with open(path) as f:
        q = json.load(f)["queryStats"]
    return {k: q.get(k) for k in KEYS}

a, b = stats("before.full.json"), stats("after.full.json")
for k in KEYS:
    print(f"{k:32}  A={a[k]!s:25} B={b[k]!s}")
```

Compare on the same predicate. `totalDrivers` and
`physicalInputReadTime` differences are the two most common drivers of
wall-clock regressions between connectors / configs.

## R11. Writer breakdown (INSERT / CTAS)

```bash
jq '.queryStats.operatorSummaries[]
  | select(.operatorType == "TableWriterOperator")
  | {planNodeId, stageId, inputPositions, inputDataSize,
     physicalWrittenDataSize, info}' file.full.json
```

Per-task write volumes live in
`.stages.stages[] | .tasks[].stats.physicalWrittenDataSize`.

## R12. Slow-planning hunt

```bash
jq '.queryStats | {planningTime, planningCpuTime, analysisTime}' file.full.json
jq '.queryStats.optimizerRulesSummaries | sort_by(.totalTime) | reverse | .[0:10]' file.full.json
```

`planningTime >> planningCpuTime` ⇒ planner blocked on metadata
(metastore round-trips, Iceberg manifest reads). Cross-check
`queryStats.catalogMetadataMetrics`.
