# Stages, tasks, pipelines

Field semantics verified against the Trino 479 source
(`io.trino.execution.StagesInfo` / `StageInfo` / `StageStats` /
`TaskInfo` / `TaskStatus`, `io.trino.operator.TaskStats` /
`PipelineStats`). Full detail exists only in `<id>.full.json`; the
sanitized `<id>.json` carries a trimmed tree under `rootStage` (see the
note at the end).

## 1. `stages` — the envelope (full.json)

```json
{
  "outputStageId": "20260527_042254_01014_ff2rr.0",
  "stages": ["<StageInfo>", "..."]
}
```

`stages` is a **flat list** of every stage; parent → child edges live in
each entry's `subStages` (stage-id strings). `outputStageId` is the root
stage (writes results to the client / output target). A stage with
`subStages == []` is a leaf scan stage.

## 2. `StageInfo` — one entry of `stages.stages[]`

| JSON key          | Type              | Meaning                                                                    |
| ----------------- | ----------------- | -------------------------------------------------------------------------- |
| `stageId`         | string            | E.g. `"<queryId>.0"`.                                                      |
| `state`           | `StageState` enum | See [types-and-enums.md](types-and-enums.md).                              |
| `plan`            | object or null    | Per-stage physical plan fragment (operators, partitioning, output layout). |
| `coordinatorOnly` | boolean           | Stage runs only on the coordinator.                                        |
| `types`           | array             | Output column types of this stage.                                         |
| `stageStats`      | object            | See §3.                                                                    |
| `tasks`           | array of TaskInfo | One per worker task in this stage.                                         |
| `subStages`       | array             | Child stage ids (data dependencies).                                       |
| `tables`          | map               | Tables read by leaf scans in this stage.                                   |
| `failureCause`    | object or null    | Non-null if this stage failed.                                             |

## 3. `stageStats` — per-stage aggregates

Nearly identical to `queryStats` (see [query-stats.md](query-stats.md))
— same metric names and units, scoped to one stage. Stage-specific
extras:

| JSON key                  | Type                   | Meaning                                                                                                            |
| ------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `schedulingComplete`      | Instant                | All splits generated and dispatched.                                                                               |
| `getSplitDistribution`    | map                    | Per-leaf-scan distribution of split-generation latency (DistributionSnapshot). Spots split-source skew.            |
| `splitSourceMetrics`      | map                    | Per-leaf-scan connector split-source metrics; merged into the leaf operator's `connectorMetrics`.                  |
| `bufferedDataSize`        | DataSize               | Bytes currently in the stage's output buffer (sampled).                                                            |
| `outputBufferUtilization` | object or null         | DistributionSnapshot of buffer fullness (0.0-1.0). Sustained `max ≈ 1.0` ⇒ the downstream stage is the bottleneck. |
| `outputBufferMetrics`     | map                    | Output-buffer implementation metrics.                                                                              |
| `gcInfo`                  | object                 | Stage-scoped GC stats (same shape as `queryStats.stageGcStatistics[i]`).                                           |
| `operatorSummaries`       | array of OperatorStats | Per-operator rollup within this stage.                                                                             |

`StageStats` carries `peakUserMemoryReservation` and
`peakRevocableMemoryReservation`, but not `peakTotalMemoryReservation`
or the `peakTask*` fields — those exist only at the query level.

## 4. `tasks[]` — `TaskInfo`

| JSON key          | Type             | Meaning                                                                                                                                                                                                                                                                                 |
| ----------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `taskStatus`      | object           | Lifecycle + lightweight counters (§5).                                                                                                                                                                                                                                                  |
| `lastHeartbeat`   | Instant          | Last coordinator → worker ping.                                                                                                                                                                                                                                                         |
| `outputBuffers`   | object           | Output-buffer state: `type` (`BROADCAST` / `PARTITIONED` / `ARBITRARY` / `SPOOLING`), `state`, `canAddBuffers`, `canAddPages`, `totalBufferedBytes`, `totalBufferedPages`, `totalRowsSent`, `totalPagesSent`, `pipelinedBufferStates`, `utilization`, `spoolingOutputStats`, `metrics`. |
| `noMoreSplits`    | array            | Leaf scan ids whose split source hit end-of-stream.                                                                                                                                                                                                                                     |
| `stats`           | object           | Detailed per-task stats (§6).                                                                                                                                                                                                                                                           |
| `estimatedMemory` | DataSize or null | Coordinator estimate; only on final snapshots.                                                                                                                                                                                                                                          |
| `needsPlan`       | boolean          | True until the worker acknowledged the plan.                                                                                                                                                                                                                                            |

## 5. `taskStatus`

| JSON key                                                                     | Type             | Meaning                                                               |
| ---------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------- |
| `taskId`                                                                     | string           | `"<stageId>.<taskIndex>.<attempt>"`.                                  |
| `taskInstanceId`                                                             | string           | Per-attempt UUID.                                                     |
| `version`                                                                    | long             | Status snapshot version.                                              |
| `state`                                                                      | `TaskState` enum | See [types-and-enums.md](types-and-enums.md).                         |
| `self`                                                                       | URI              | Worker URL.                                                           |
| `nodeId`                                                                     | string           | Worker node id — the right field for per-worker skew analysis.        |
| `speculative`                                                                | boolean          | Speculative task (fault-tolerant execution).                          |
| `failures`                                                                   | array            | Failures observed by this task.                                       |
| `queuedPartitionedDrivers` / `runningPartitionedDrivers`                     | int              | Drivers queued / executing for partitioned splits.                    |
| `queuedPartitionedSplitsWeight` / `runningPartitionedSplitsWeight`           | long             | Weighted sums for the priority scheduler.                             |
| `outputBufferStatus`                                                         | object           | `{outputBufferStateMachineVersion, outputBuffersFull, overutilized}`. |
| `outputDataSize`                                                             | DataSize         | Bytes produced by this task.                                          |
| `writerInputDataSize` / `physicalWrittenDataSize`                            | DataSize         | Writer input / bytes physically written.                              |
| `writerCount`                                                                | int or null      | Max parallel writers used.                                            |
| `memoryReservation` / `peakMemoryReservation` / `revocableMemoryReservation` | DataSize         | Current / peak / revocable user memory.                               |
| `fullGcCount` / `fullGcTime`                                                 | long / Duration  | Worker-wide full GCs observed during the task.                        |
| `dynamicFiltersVersion`                                                      | long             | Highest dynamic-filter version consumed.                              |

## 6. `stats` — `TaskStats`

Most fields mirror `queryStats` (same names, scoped to one task; no
`failed*` twins at this level). Task-specific extras:

| JSON key                                                                                               | Type                   | Meaning                                                                    |
| ------------------------------------------------------------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------- |
| `createTime` / `firstStartTime` / `lastStartTime` / `terminatingStartTime` / `lastEndTime` / `endTime` | Instant or null        | Task lifecycle timeline.                                                   |
| `queuedPartitionedDrivers` / `runningPartitionedDrivers` (+ `*SplitsWeight`)                           | int / long             | Subsets of `queuedDrivers` / `runningDrivers` handling partitioned splits. |
| `writerInputDataSize` / `physicalWrittenDataSize`                                                      | DataSize               | Writer-side totals.                                                        |
| `writerCount`                                                                                          | int or null            | Max parallel writers in this task.                                         |
| `fullGcCount` / `fullGcTime`                                                                           | int / Duration         | Full GCs observed by this worker during the task.                          |
| `pipelines`                                                                                            | array of PipelineStats | One per pipeline (§7). Dropped from the sanitized file.                    |

## 7. `pipelines[]` — `PipelineStats`

A pipeline is a chain of operators with the same partitioning; each has
many drivers. Fields mirror the task level (`totalScheduledTime`,
`totalCpuTime`, `totalBlockedTime`, the input/output families,
driver-state counters, memory reservations) plus:

- `pipelineId`, `inputPipeline` / `outputPipeline` flags, timeline Instants.
- `queuedTime` and `elapsedTime` are **DistributionSnapshots**
  (percentiles over individual drivers), not sums — unlike at higher levels.
- `operatorSummaries[]` — per-operator stats within this pipeline.
- `drivers[]` — per-driver stats; usually empty (the coordinator
  summarizes them away to keep snapshots small).

## 8. Three identities you can audit

For a finished, non-pruned query (modulo rounding of succinct units):

- `queryStats.totalDrivers ≈ Σ stages[].stageStats.totalDrivers`
- `stageStats.totalDrivers ≈ Σ that stage's tasks[].stats.totalDrivers`
- `stageStats.totalScheduledTime ≈ Σ that stage's tasks[].stats.totalScheduledTime`

Mid-flight snapshots violate them; trust per-stage breakdowns only when
`finalQueryInfo == true` and `pruned == false`.

## 9. Sanitized `rootStage` vs full.json `stages`

The sanitized `<id>.json` re-roots the flat list as a nested tree:
each node keeps `stageId`, `state`, `stageStats` (minus
`operatorSummaries` and `gcInfo`), `tasks[]`, and recursive
`subStages[]`. Task entries drop `outputBuffers`; task `stats` drop
`pipelines` and `gcInfo`. For anything dropped (pipelines, output
buffers, per-stage operator summaries, plan fragments), open
`<id>.full.json`.
