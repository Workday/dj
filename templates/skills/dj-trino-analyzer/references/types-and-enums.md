# Type and enum reference

Verified against the Trino 479 source. Applies to both diagnostics
files — the sanitized `<id>.json` passes raw value strings through
unchanged outside its computed `summary`.

## 1. Value types

### Duration

Succinct string, two decimals, unit auto-selected from
`{ns, us, ms, s, m, h, d}`: `"5.01m"` (minutes), `"20.21h"`,
`"140.14us"`. `DurationTiming.duration` values are sometimes left in
nanoseconds (`"23361077778.00ns"`).

```python
import re
DUR = re.compile(r"^\s*([0-9.]+)\s*(ns|us|ms|s|m|h|d)\s*$")
_NS = {"ns": 1, "us": 1e3, "ms": 1e6, "s": 1e9, "m": 60e9, "h": 3600e9, "d": 86400e9}
def to_seconds(s):
    m = DUR.match(s)
    return float(m.group(1)) * _NS[m.group(2)] / 1e9
```

### DataSize

Two output forms:

| Form                        | Example                 | When                                                                                  |
| --------------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| Bytes-with-suffix (default) | `"288482816B"`          | `/v1/query/{id}` — i.e. every DJ diagnostics file. Parse as `int(value.rstrip("B"))`. |
| Succinct unit               | `"275MB"`, `"148.95GB"` | Only the Web-UI endpoint with `?pretty`; you won't see this in DJ files.              |

### Instant / Optional / collections

- `Instant`: ISO-8601 with `Z`, up to nanosecond precision.
- `Optional<T>` (and OptionalDouble/OptionalInt): `null` when empty,
  bare value when present — never a wrapper object.
- Sets and lists are JSON arrays; set order is not stable.

## 2. `Metric` values (in `metrics` / `connectorMetrics` / `catalogMetadataMetrics`)

A `Metrics` container serializes as a plain map — no wrapper:

```json
"connectorMetrics": {
  "dataFiles": {"@class": "io.trino.plugin.base.metrics.LongCount", "total": 17},
  "scanPlanningDuration": {"@class": "io.trino.plugin.base.metrics.DurationTiming", "duration": "3.21s"}
}
```

Concrete shapes:

| Class                  | JSON shape                                                                                                     | Notes                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `LongCount`            | `{"total": <long>}`                                                                                            | The canonical counter. Carries `@class` in `/v1/query` output.                                                      |
| `DurationTiming`       | `{"duration": "<Duration string>"}`                                                                            | Carries `@class`.                                                                                                   |
| `TDigestHistogram`     | `{"digest": "<base64>", "min", "max", "p01", "p05", "p10", "p25", "p50", "p75", "p90", "p95", "p99", "total"}` | **No `@class`** (type info disabled on the class). Ignore `digest`; the percentiles are pre-computed.               |
| `DistributionSnapshot` | `{"total", "min", "max", "p01", "p05", "p10", "p25", "p50", "p75", "p90", "p95", "p99"}`                       | **No `@class`.** Used for `outputBufferUtilization`, `getSplitDistribution`, pipeline `queuedTime` / `elapsedTime`. |

The fixed percentile list is **1, 5, 10, 25, 50, 75, 90, 95, 99** —
there is no p99.9. The Web-UI endpoint strips `@class` everywhere and
drops `digest`; DJ's files come from `/v1/query` so expect `@class` on
LongCount/DurationTiming and `digest` present.

## 3. Enums

### `QueryState`

`QUEUED`, `WAITING_FOR_RESOURCES`, `DISPATCHING`, `PLANNING`,
`STARTING`, `RUNNING`, `FINISHING`, then terminal `FINISHED` (success)
or `FAILED`.

### `StageState`

`PLANNED`, `SCHEDULING`, `RUNNING`, `PENDING` (all tasks done, more may
be scheduled), terminal `FINISHED`, `ABORTED` (failure elsewhere),
`FAILED` (this stage failed).

### `TaskState`

`PLANNED`, `RUNNING`, `FLUSHING` (no more drivers, buffer draining),
`FINISHED`, and the cancel/abort/fail pairs: `CANCELING`/`CANCELED`,
`ABORTING`/`ABORTED`, `FAILING`/`FAILED`. The `-ING` forms are
terminating, not terminal.

### `BlockedReason`

Exactly one value exists: `WAITING_FOR_MEMORY`. A driver blocked on
input, exchange, output buffer, or dynamic filters reports an empty
`blockedReasons` set while `blockedWall` / `totalBlockedTime` grows.
This is the most common cause of "blocked time is high but
blockedReasons is empty" confusion — it means I/O or back-pressure,
not memory.

### `RetryPolicy`

`NONE`, `TASK` (fault-tolerant execution), `QUERY`. When not `NONE`, a
`FINISHED` query can have `failedTasks > 0` — those tasks were retried
and recovered.

### `ErrorType`

`USER_ERROR` (bad SQL, limits set by the user), `INTERNAL_ERROR`
(Trino bug), `INSUFFICIENT_RESOURCES` (memory pool / queue / cluster),
`EXTERNAL` (connector or external system).

### `QueryType`

`SELECT`, `EXPLAIN`, `DESCRIBE`, `INSERT`, `UPDATE`, `DELETE`,
`ANALYZE`, `DATA_DEFINITION`, `ALTER_TABLE_EXECUTE`, `MERGE`.

### `BufferState` (in `outputBuffers.state`)

`OPEN`, `NO_MORE_BUFFERS`, `NO_MORE_PAGES`, `FLUSHING`, `FINISHED`,
`ABORTED`, `FAILED`.

## 4. Edge cases that bite

- `Duration` and `DataSize` fields are always present and non-null,
  even on failed queries — zero renders as `"0.00ns"`-style strings or
  `"0B"`.
- `progressPercentage` / `runningPercentage` are `null` until
  `scheduled == true`; `endTime` is `null` until terminal.
- `pruned == true` queries can have empty stage detail even when
  `FINISHED` — don't conclude anything per-stage from a pruned snapshot.
- `failedTasks > 0` does **not** mean the query failed; check `state`.
