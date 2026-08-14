# Notebook pattern → DJ/Trino equivalent mapping

Common Jupyter notebook idioms and the DJ python model / Trino equivalent to migrate them to. Use this alongside the SQL-first decision tree in `dj-create-python-model`.

## Extract stage

| Notebook idiom | Migrated equivalent |
| --- | --- |
| `requests.get(url, headers=...)` + `pd.json_normalize(resp.json())` | `extract(context)` — same HTTP call, stage the flattened rows into a Trino temp/staging table via `_trino_io` |
| `requests.get` with manual `while` pagination loop | Keep the pagination loop in `extract()`; accumulate all pages before staging |
| `pyodbc`/`sqlalchemy` query against another DB | `extract(context)` using the same driver; write results to a Trino staging table rather than holding the full result in a DataFrame for the rest of the notebook |
| `pd.read_csv("local/path.csv")` | `extract(context)` reading the same CSV (from S3/blob if it was a shared drive path), staged into Trino |
| `boto3.client("s3").get_object(...)` | `extract(context)` using `boto3`, staged into Trino |

## Transform stage

| Notebook idiom | Migrated equivalent |
| --- | --- |
| `df[df["col"] > 0]` | Trino `WHERE col > 0` |
| `df.rename(columns={"a": "b"})` | Trino `SELECT a AS b` |
| `df["col"].astype(int)` | Trino `CAST(col AS INTEGER)` |
| `df.drop_duplicates(subset=["id"])` | Trino `ROW_NUMBER() OVER (PARTITION BY id ORDER BY ...) = 1` filter |
| `df.groupby("id")["amount"].sum()` | Trino `SELECT id, SUM(amount) FROM ... GROUP BY id` |
| `pd.merge(df1, df2, on="id")` | Trino `JOIN ... ON id` |
| `df.sort_values("date")` | Trino `ORDER BY date` (usually unnecessary before a partitioned write) |
| `pd.json_normalize(nested_col)` on a column of dicts/lists | Stays pandas — SQL cannot easily flatten arbitrary nested JSON structures cell-by-cell |
| Custom Python string parsing / regex not expressible in SQL `REGEXP_*` | Stays pandas |
| `sklearn`/embedding/ML preprocessing | Stays pandas |

## Load stage

| Notebook idiom | Migrated equivalent |
| --- | --- |
| `df.to_sql(table, engine, if_exists="replace")` | `overwrite_partition(...)` or `overwrite(...)` from `_trino_io`, depending on whether it's a full refresh or one partition |
| `df.to_sql(table, engine, if_exists="append")` | `append(...)` from `_trino_io` |
| `df.to_parquet("s3://.../date=...")` | An `INSERT ... SELECT` writing to the Iceberg table's corresponding partition via `_trino_io` |
| `df.to_csv(...)` for manual inspection only | Drop — this was a debugging artifact, not part of the production load path |

## Magic commands / notebook-only constructs (always dropped)

| Idiom | Disposition |
| --- | --- |
| `%%time`, `%timeit` | Drop — no equivalent needed in a scheduled model |
| `!pip install <package>` | Drop the magic, but carry `<package>` into the model's declared Python dependencies |
| `%matplotlib inline`, any `plt.*`/`sns.*`/`px.*` plotting cell | Drop — exploratory only |
| `display(df)`, bare `df` as last line of a cell, `df.head()`/`df.describe()`/`df.info()` | Drop — exploratory only |
| `%%bash`, `%%sh` shell-out cells | Drop unless the shell command performs a required step with no Python/SQL equivalent — flag for the user to confirm |
| Interactive widgets (`ipywidgets`, `input()` prompts) | Drop — a scheduled model cannot pause for interactive input; if the widget drove a parameter, surface it as a `context`/config value instead |

## Non-determinism patterns to flag

| Pattern | Why it's a risk |
| --- | --- |
| `datetime.now()` / `date.today()` without deriving from `context["ds"]` | Re-running the model for a historical `ds` would use today's date instead of the intended one |
| `random`/`np.random` without a fixed seed | Output differs across re-runs, breaking idempotency checks |
| A cell that only works if run out of written order (relies on a variable set by a cell below it, or by manual re-running) | Scheduled execution always runs cells top-to-bottom once — order-dependent logic will silently break or reference stale state |
| Global mutable state (a module-level list/dict appended to across multiple cells) | Doesn't survive being reorganized into discrete `extract`/`transform_and_load`/`cleanup` functions |
