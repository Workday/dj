# `queryStats` schema

Field semantics verified against the Trino 479 source
(`io.trino.execution.QueryStats`). These keys appear in **both**
diagnostics files: the sanitized `<id>.json` passes `queryStats`
through verbatim (minus `operatorSummaries`, `stageGcStatistics`, and
`rootOperator`), so values keep their raw string forms — parse them per
[types-and-enums.md](types-and-enums.md).

All values are cluster-level aggregates — sums across every worker,
every stage, every driver unless stated otherwise.

## 1. Timeline

| JSON key              | Type            | Meaning                                       |
| --------------------- | --------------- | --------------------------------------------- |
| `createTime`          | Instant         | Coordinator accepted the query.               |
| `executionStartTime`  | Instant or null | First transition to RUNNING. Null until then. |
| `lastHeartbeat`       | Instant         | Last client poll.                             |
| `endTime`             | Instant or null | Terminal state reached. Null until then.      |
| `elapsedTime`         | Duration        | `endTime − createTime`. Wall clock.           |
| `queuedTime`          | Duration        | Time in QUEUED (resource-group queue).        |
| `resourceWaitingTime` | Duration        | Waiting for cluster resources after dequeue.  |
| `dispatchingTime`     | Duration        | Time in DISPATCHING.                          |
| `executionTime`       | Duration        | Time in STARTING + RUNNING + FINISHING.       |
| `analysisTime`        | Duration        | Parser + analyzer wall time.                  |
| `planningTime`        | Duration        | Planner wall time, includes optimizer rules.  |
| `planningCpuTime`     | Duration        | CPU-only share of planning.                   |
| `startingTime`        | Duration        | Dispatching tasks to workers.                 |
| `finishingTime`       | Duration        | Post-execution commit/cleanup.                |

Wall-clock decomposition:
`elapsedTime ≈ queuedTime + resourceWaitingTime + dispatchingTime + executionTime + finishingTime`.
Use it to answer "where did the wall clock go".

## 2. Tasks and drivers

| JSON key                                                                   | Type                   | Meaning                                                              |
| -------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| `totalTasks` / `runningTasks` / `completedTasks`                           | int                    | Task = one container per stage per worker.                           |
| `failedTasks`                                                              | int                    | Non-zero ≠ query failed (`retryPolicy != NONE` may have recovered).  |
| `totalDrivers`                                                             | int                    | Driver = one execution unit, typically one split. Σ ever started.    |
| `queuedDrivers` / `runningDrivers` / `blockedDrivers` / `completedDrivers` | int                    | Current counts per state.                                            |
| `scheduled`                                                                | boolean                | All splits generated; progress fields meaningful after this.         |
| `progressPercentage` / `runningPercentage`                                 | double or null (0-100) | `completedDrivers ÷ totalDrivers` / `runningDrivers ÷ totalDrivers`. |

## 3. Memory

| JSON key                                                                          | Type     | Meaning                                                                    |
| --------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------- |
| `userMemoryReservation` / `revocableMemoryReservation` / `totalMemoryReservation` | DataSize | Current reservations across all workers.                                   |
| `peakUserMemoryReservation`                                                       | DataSize | Cluster high-water mark, user memory only.                                 |
| `peakRevocableMemoryReservation` / `peakTotalMemoryReservation`                   | DataSize | Same for revocable / total.                                                |
| `peakTaskUserMemory` / `peakTaskRevocableMemory` / `peakTaskTotalMemory`          | DataSize | Largest single-task peaks. Compare against the per-node task memory limit. |
| `spilledDataSize`                                                                 | DataSize | Bytes spilled to disk. Non-zero ⇒ revocable memory was reclaimed.          |
| `cumulativeUserMemory` / `failedCumulativeUserMemory`                             | double   | Σ (user memory × seconds held). Resource accounting, not peak spotting.    |

## 4. Time decomposition

| JSON key             | Type     | Meaning                                                                                                                               |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `totalScheduledTime` | Duration | Σ wall time drivers were on a worker thread. Dozens of hours on a 1-minute query is normal for a large cluster.                       |
| `totalCpuTime`       | Duration | Σ JVM-thread CPU time. `scheduled − cpu` ≈ I/O / syscall stall.                                                                       |
| `totalBlockedTime`   | Duration | Σ off-thread blocked wall time.                                                                                                       |
| `fullyBlocked`       | boolean  | True iff every running driver is currently blocked.                                                                                   |
| `blockedReasons`     | array    | Only possible entry: `WAITING_FOR_MEMORY`. **Empty array + high blocked time ⇒ non-memory blocking (almost always I/O or exchange).** |

## 5. I/O boundaries

Keep the three input families distinct:

| JSON key                                                         | Type            | Boundary                                                                            |
| ---------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------- |
| `physicalInputDataSize` / `physicalInputPositions`               | DataSize / long | Bytes/rows pulled from storage (compressed chunk size for Parquet).                 |
| `physicalInputReadTime`                                          | Duration        | Σ time inside storage reads. Compare to `totalScheduledTime` to size the I/O share. |
| `internalNetworkInputDataSize` / `internalNetworkInputPositions` | DataSize / long | Bytes/rows received via exchange from other Trino stages.                           |
| `processedInputDataSize` / `processedInputPositions`             | DataSize / long | Bytes/rows fed into operator chains (post-decompression).                           |
| `inputBlockedTime`                                               | Duration        | Σ time leaf drivers blocked waiting on input.                                       |
| `outputDataSize` / `outputPositions`                             | DataSize / long | Returned to the client (or final output stage).                                     |
| `outputBlockedTime`                                              | Duration        | Σ time the output stage blocked on a slow consumer.                                 |
| `physicalWrittenDataSize`                                        | DataSize        | Bytes written to storage (INSERT/CTAS).                                             |

Every input/output metric above also has a `failed*` twin
(`failedPhysicalInputDataSize`, `failedCpuTime`, …) counting work done
by tasks that ultimately failed and were discarded. A high
`failedX / X` ratio means retry waste.

## 6. Writers, GC, dynamic filters, metadata

| JSON key                                      | Type                   | Meaning                                                                                                                                                                                                                             |
| --------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `writtenPositions` / `logicalWrittenDataSize` | long / DataSize        | Computed: Σ input rows/bytes over writer operators (`TableWriterOperator`, `MergeWriterOperator`).                                                                                                                                  |
| `stageGcStatistics`                           | array                  | Per stage: `{stageId, tasks, fullGcTasks, minFullGcSec, maxFullGcSec, totalFullGcSec, averageFullGcSec}`. Stripped from the sanitized file.                                                                                         |
| `dynamicFiltersStats`                         | object                 | `{dynamicFilterDomainStats: [{dynamicFilterId, simplifiedDomain, collectionDuration}], lazyDynamicFilters, replicatedDynamicFilters, totalDynamicFilters, dynamicFiltersCompleted}`. Also surfaced top-level in the sanitized file. |
| `catalogMetadataMetrics`                      | map                    | Per-catalog metadata fetch metrics (metastore calls, Iceberg manifest reads). Values are `Metrics` maps.                                                                                                                            |
| `operatorSummaries`                           | array of OperatorStats | Cluster-wide rollup per `(stageId, pipelineId, operatorId, planNodeId)`. See [operator-stats.md](operator-stats.md). Stripped from the sanitized file (trimmed top-level `operatorSummary` replaces it).                            |
| `optimizerRulesSummaries`                     | array                  | Per-optimizer-rule invocation counts and timings. For slow-planning hunts.                                                                                                                                                          |

## 7. Field-group quick map

- **`peak*`** — high-water marks; compare across runs.
- **`failed*`** — discarded work from failed tasks.
- **`physical*`** — storage boundary. **`internalNetwork*`** — exchange boundary. **`processed*`** — operator-input boundary. **`output*`** — query-output boundary.
- **`*Drivers`** — logical work units; **`*Tasks`** — per-worker containers.
- **`*Time`** — Duration string; **`*DataSize`** — DataSize string; **`*Positions`** — row count number.

The same names recur verbatim on `StageStats`, `TaskStats`,
`PipelineStats`, and `OperatorStats`, scoped to that level.
