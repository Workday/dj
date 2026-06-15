# OperatorStats and connectorMetrics

Field semantics verified against the Trino 479 source
(`io.trino.operator.OperatorStats`). One entry per
`(stageId, pipelineId, operatorId, planNodeId)`.

In `<id>.full.json`, `OperatorStats` appears in three places:

- `queryStats.operatorSummaries[]` — cluster-wide rollup per logical operator.
- `stages.stages[].stageStats.operatorSummaries[]` — same rollup, one stage.
- `stages.stages[].tasks[].stats.pipelines[].operatorSummaries[]` — per task/pipeline.

The sanitized `<id>.json` instead exposes a flat trimmed
`operatorSummary[]` (see the SKILL.md field mapping); everything below
is the raw shape.

## 1. `OperatorStats` schema

### Identity

| JSON key       | Type           | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stageId`      | int            | Integer suffix of the StageId.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `pipelineId`   | int            | Pipeline index within the task.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `operatorId`   | int            | Operator index within the pipeline (0 = pipeline source).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `planNodeId`   | string         | Same id used in `EXPLAIN ANALYZE`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `sourceId`     | string or null | Set when the operator pulls from another plan node (joins, exchanges).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `operatorType` | string         | Java simple-class name. Common: `ScanFilterAndProjectOperator`, `TableScanOperator`, `FilterAndProjectOperator`, `HashAggregationOperator`, `StreamingAggregationOperator`, `HashBuilderOperator`, `LookupJoinOperator`, `NestedLoopJoinOperator`, `ExchangeOperator`, `TaskOutputOperator`, `PartitionedOutputOperator`, `TableWriterOperator`, `MergeWriterOperator`, `OrderByOperator`, `TopNOperator`, `LimitOperator`, `WindowOperator`. There is no `HashJoinOperator` — hash joins are `HashBuilderOperator` (build side) + `LookupJoinOperator` (probe side). |
| `totalDrivers` | long           | Driver executions that traversed this operator, summed over all splits — not a per-driver count.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### Input

| JSON key                                                         | Type                       | Meaning                                                           |
| ---------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------- |
| `addInputCalls` / `addInputWall` / `addInputCpu`                 | long / Duration / Duration | `Operator.addInput(page)` call count, wall, CPU.                  |
| `physicalInputDataSize` / `physicalInputPositions`               | DataSize / long            | Bytes/rows read from storage. Non-zero only for source operators. |
| `physicalInputReadTime`                                          | Duration                   | Time inside storage reads.                                        |
| `internalNetworkInputDataSize` / `internalNetworkInputPositions` | DataSize / long            | Received via exchange. Non-zero only for exchange operators.      |
| `inputDataSize` / `inputPositions`                               | DataSize / long            | Input after decompression / column reconstruction.                |
| `sumSquaredInputPositions`                                       | double                     | Σ (rows per page)² — page-size variance for skew analysis.        |

### Output, blocking, finish

| JSON key                                            | Type                       | Meaning                                                                                 |
| --------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------- |
| `getOutputCalls` / `getOutputWall` / `getOutputCpu` | long / Duration / Duration | `Operator.getOutput()` call count, wall, CPU.                                           |
| `outputDataSize` / `outputPositions`                | DataSize / long            | Produced bytes/rows.                                                                    |
| `blockedWall`                                       | Duration                   | Σ wall time blocked (upstream input, buffer space, dynamic filters, …).                 |
| `blockedReason`                                     | string or null             | Only possible value: `WAITING_FOR_MEMORY`. Null + high `blockedWall` ⇒ non-memory wait. |
| `finishCalls` / `finishWall` / `finishCpu`          | long / Duration / Duration | `Operator.finish()` phases.                                                             |

There are no `failed*` twin fields at the operator level (unlike
`queryStats` / `stageStats`).

### Memory, writer, metrics

| JSON key                                                                                      | Type           | Meaning                                                                         |
| --------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------- |
| `userMemoryReservation` / `revocableMemoryReservation`                                        | DataSize       | Current reservations.                                                           |
| `peakUserMemoryReservation` / `peakRevocableMemoryReservation` / `peakTotalMemoryReservation` | DataSize       | Operator peaks.                                                                 |
| `spilledDataSize`                                                                             | DataSize       | Bytes spilled by this operator.                                                 |
| `physicalWrittenDataSize`                                                                     | DataSize       | Bytes written (writer operators only).                                          |
| `dynamicFilterSplitsProcessed`                                                                | long           | Splits processed under a dynamic filter on this operator.                       |
| `metrics`                                                                                     | map            | Operator-internal metrics (§2).                                                 |
| `connectorMetrics`                                                                            | map            | Connector-provided metrics (§3).                                                |
| `pipelineMetrics`                                                                             | map            | From the driver loop; rarely populated.                                         |
| `info`                                                                                        | object or null | Operator-specific extra info (§4). Dropped from non-final summarized snapshots. |

## 2. Known `metrics` keys

Operator-internal entries commonly observed (exact string literals):

| Key                                                                                               | Metric type      | Meaning                                                                                  |
| ------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `Filter CPU time`                                                                                 | DurationTiming   | CPU inside the compiled filter expression (`ScanFilterAndProject` / `FilterAndProject`). |
| `Projection CPU time`                                                                             | DurationTiming   | CPU inside the compiled projection expression.                                           |
| `CPU time distribution (s)` / `Scheduled time distribution (s)` / `Blocked time distribution (s)` | TDigestHistogram | Per-driver distributions — skew per driver.                                              |
| `Input rows distribution` / `Output rows distribution`                                            | TDigestHistogram | Per-page row counts.                                                                     |

## 3. Known `connectorMetrics` keys

The storage layer reports format/plugin-specific signals on leaf-scan
operators. Keys differ per connector and Trino version — when a key
isn't listed here, grep the connector source rather than guessing:

```text
rg -n 'new Metrics\(' plugin/trino-<connector>/src/main
```

### Iceberg split source

`scanPlanningDuration` (DurationTiming), and LongCounts: `dataFiles`,
`dataFileSizeBytes`, `deleteFileSizeBytes`, `dataManifests`,
`deleteManifests`, `equalityDeleteFiles`, `positionalDeleteFiles`.
`dataFiles` far larger than the predicate should hit ⇒ partition /
column-statistics pruning is not kicking in.

### Parquet reader

- `ParquetReaderCompressionFormat_<CODEC>` (LongCount) — one entry per
  codec (`SNAPPY`, `ZSTD`, …); value = compressed column-chunk bytes read.
- `ParquetColumnIndexRowsFiltered` (LongCount) — rows skipped by
  column-index push-down.

### Filesystem / cache wrappers

Base filesystem reports nothing; caching wrappers (e.g. an Alluxio
client) may add LongCounts such as `bytesReadFromCache` and
`bytesReadExternally`. Cache-hit ratio =
`bytesReadFromCache / (bytesReadFromCache + bytesReadExternally)`.
Exact key names come from the wrapper, not upstream Trino.

## 4. `info` subtypes

Tagged `"@type"` in full.json. Ones worth opening:

| `@type`                 | On operator                   | Carries                                                                                              |
| ----------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `exchangeClientStatus`  | ExchangeOperator              | `bufferedBytes`, `maxBufferedBytes`, `averageBytesPerRequest`, `bufferedPages`, per-client statuses. |
| `tableWriterInfo`       | TableWriterOperator           | `statisticsWallTime`, `statisticsCpuTime`, `validationCpuTime`, peak on/off-heap usage.              |
| `tableFinishInfo`       | TableFinishOperator           | Connector commit metrics.                                                                            |
| `splitOperatorInfo`     | TableScanOperator             | `{catalogName, splitInfo}` — which file a scan touched.                                              |
| `hashCollisionsInfo`    | HashAggregation / HashBuilder | Hash collision stats.                                                                                |
| `joinOperatorInfo`      | LookupJoinOperator            | Join-side position stats.                                                                            |
| `windowInfo`            | WindowOperator                | Partition/page counts per index.                                                                     |
| `partitionedOutputInfo` | PartitionedOutputOperator     | `{rowsAdded, pagesAdded, outputBufferPeakMemoryUsage}`.                                              |

## 5. Reading order for one slow operator

1. `operatorType`, `planNodeId`, `stageId` — confirm which plan node
   (the same `planNodeId` can appear in multiple stages).
2. `totalDrivers`, `inputPositions`, `outputPositions` — sanity-check
   the work volume.
3. `addInputWall + getOutputWall + finishWall` vs `blockedWall` —
   on-thread vs waiting.
4. Wall vs the matching `*Cpu` sums — the gap is stall / I/O.
5. `physicalInputReadTime` + `connectorMetrics` — leaf scans only.
6. `peakUserMemoryReservation`, `spilledDataSize` — joins, aggregations, sorts.
7. `metrics` distributions — per-driver skew.
8. `info` — operator-specific deep dive.
