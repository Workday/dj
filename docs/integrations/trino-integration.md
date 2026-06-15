# Trino Integration

DJ integrates with Trino to browse data catalogs, create dbt source definitions, and execute dbt models.

**Before you begin:** This guide assumes you have completed Trino setup. See the [Trino Setup Guide](../setup/trino-local-setup.md) first.

**Related Documentation:**

- [Trino Setup Guide](../setup/setup.md#2-install-trino-cli) - Initial Trino CLI installation and connection setup
- [Trino Local Setup](../setup/trino-local-setup.md) - Docker setup for local development
- [dbt Integration](dbt-integration.md) - Running dbt commands
- [Lightdash Integration](lightdash-integration.md) - BI dashboard previews

---

## Table of Contents

1. [Source Creation from Trino Catalogs](#source-creation-from-trino-catalogs)
2. [Query Engine Monitoring](#query-engine-monitoring)
3. [Model Execution](#model-execution)
4. [Trino Configuration](#trino-configuration)
5. [Development Workflows](#development-workflows)
6. [Troubleshooting](#troubleshooting)

## Source Creation from Trino Catalogs

DJ uses Trino to automatically introspect table structures and create dbt source definitions. Catalog browsing is integrated directly into the Source Create workflow.

### Source Creation Workflow

When you create a source, DJ connects to Trino to browse catalogs and retrieve table metadata:

1. Run `DJ: Create Source` from Command Palette
2. Select your project
3. **Select Catalog** - Dropdown populated with your Trino catalogs (e.g., `memory`, `hive`)
4. **Select Schema** - Dropdown populated with schemas in the selected catalog
5. **Select Table** - Dropdown populated with tables in the selected schema
6. **Columns automatically load** - DJ queries Trino to get:
   - All column names
   - Column data types
   - Table metadata
7. Configure source metadata (group, topic, name)
8. Click "Create Source" - `.source.json` file generated with all table information

**Key Benefits:**

- ✅ No manual typing of column names or types
- ✅ Accurate schema information directly from Trino
- ✅ Catalog/schema/table hierarchy for easy navigation
- ✅ Automatic validation that table exists
- ✅ Complete source definition in seconds

**Example:** `DJ: Create Source` → Project: `jaffle_shop_lightdash` → Catalog: `memory` → Schema: `default` → Table: `raw_orders` → Columns auto-populate → Configure source naming → Creates [raw_orders.source.json](../examples/jaffle_shop/models/sources/raw_orders.source.json) with all columns and types.

## Query Engine Monitoring

The Query Engine view in the sidebar gives at-a-glance Trino cluster status and a one-click entry point to the full Query Control Center.

**What You Can Monitor:**

- **Nodes** - Active Trino worker nodes and their status (active/inactive)
- **Query Control Center** - Click to open the master-detail webview that lists live and persisted Trino queries with stage/operator stats, an `Analyze with AI` action that writes a sanitized diagnostic JSON, and a `Jump to Model` action that resolves the SQL back to the originating `.model.json`.

**Accessing Query Engine View:**

1. Open DJ sidebar in VS Code (Activity Bar icon)
2. Locate "Query Engine" view (database icon)
3. The view shows:
   - **Nodes** (with count of active nodes)
   - **Query Control Center** shortcut

**What's Monitored:**

The Query Control Center surfaces:

- **Live** queries on the active Trino coordinator (polled every 5s; optional "My dbt runs only" filter chip)
- **Recent (persisted)** queries from `.dj/diagnostics/` — survives coordinator in-memory eviction
- For each query: state, wall/CPU time, peak memory, splits, blocked time, data-skew score, largest operator, stage tree, operator table with heuristic chips, the failure block for `FAILED` queries, and the SQL viewer

**Note:** Custom SQL execution still happens through dbt / the Data Explorer; the Query Engine view itself is a monitoring entry point only.

## Model Execution

Trino is used as the execution engine when you run dbt models in Data Explorer.

**Running Models:**

1. Open Data Explorer (`Cmd+Shift+L`)
2. Select a model node in the lineage graph
3. Click "Run & Query" or "Compile & Run"
4. Trino executes the model's SQL
5. Query results appear in the results panel

**Query Results Display:**

- Table view with data from executed models
- Row count and execution time
- Error messages if execution fails

See [Data Explorer documentation](../LINEAGE.md) for complete details on model execution and results viewing.

## Trino Configuration

For initial Trino CLI installation, connection setup, and environment variables configuration, see [Setup Guide - Install Trino CLI](../setup/setup.md#2-install-trino-cli) and [Configure Trino Connection](../setup/setup.md#3-configure-trino-connection).

**Test Connection:**

After configuring Trino, verify the connection:

- Command: "DJ: Test Trino Connection"
- Verifies connectivity and authentication
- Shows cluster information and available catalogs

For local Trino development setup with Docker, see [Trino Local Setup Guide](../setup/trino-local-setup.md).

## Development Workflows

### Data Exploration and Model Development Workflow

DJ uses Trino at multiple points in the development workflow:

1. **Create source from Trino table**
   - `DJ: Create Source` opens wizard
   - Select catalog, schema, table (Trino provides the data)
   - Columns auto-populate from Trino introspection
   - Source definition created with complete metadata
2. **Build staging model** to transform data
   - Reference the created source
   - Apply cleaning and standardization logic
   - Define column selections and transformations
3. **Compile and run** the model
   - dbt generates SQL
   - Trino executes the SQL as the query engine
   - Data written to Trino tables
4. **View in Data Explorer**
   - Check lineage connections
   - Click "Run & Query" on model nodes
   - Trino executes the model
   - Query results appear in results panel
5. **Build downstream models**
   - Intermediate and mart layers
   - Each model execution uses Trino
6. **Preview in Lightdash** (optional)
   - Create BI dashboards from models

**Example Flow:**

`DJ: Create Source` (Trino introspects `memory.default.raw_orders`) → Columns auto-load → Create [raw_orders.source.json](../examples/jaffle_shop/models/sources/raw_orders.source.json) → Build [stg\_\_sales\_\_orders\_\_standardized.model.json](../examples/jaffle_shop/models/staging/sales/orders/stg__sales__orders__standardized.model.json) → `dbt run` (Trino executes) → Data Explorer: Run & Query (Trino returns results) → Build [int\_\_sales\_\_orders\_\_enriched.model.json](../examples/jaffle_shop/models/intermediate/sales/orders/int__sales__orders__enriched.model.json)

## Troubleshooting

### Trino Connection Failed

**Test connection:**

- Run "DJ: Test Trino Connection"
- Check error message

**Common issues:**

- Incorrect TRINO_HOST or TRINO_PORT
- Network/firewall blocking connection
- Invalid credentials
- Trino CLI not installed or not in PATH

**Verify Trino CLI:**

```bash
trino --version
```

**Check Trino CLI Path:**

```json
{
  "dj.trinoPath": "/usr/local/bin/trino"
}
```

## Next Steps

- [dbt Integration](dbt-integration.md) - Running dbt commands
- [Lightdash Integration](lightdash-integration.md) - BI dashboard previews
- [Tutorial](../TUTORIAL.md) - Hands-on walkthrough
- [Visual Editor](../VISUAL_EDITOR.md) - Create models visually
- [Lineage Visualization](../LINEAGE.md) - Explore model dependencies
