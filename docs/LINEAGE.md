# Lineage Visualization

DJ provides powerful lineage visualization at both model and column levels, helping you understand data flow and dependencies across your dbt project.

## Data Explorer

The Data Explorer visualizes your dbt models as an interactive lineage graph, showing how models connect and depend on each other.

> **Note:** The Data Explorer displays model-level lineage. For column-level lineage, see the [Column Lineage](#column-lineage) section below.

### Opening Data Explorer

#### Method 1: Command Palette

1. Press `Cmd+Shift+P` / `Ctrl+Shift+P`
2. Type "DJ: Data Explorer"
3. Press Enter

#### Method 2: Keyboard Shortcut

- Mac: `Cmd+Shift+L`
- Windows/Linux: `Ctrl+Shift+L`

#### Method 3: Model Context Menu

1. Right-click a model file (`.model.json`, `.sql`, or `.yml`) in the explorer
2. Select "DJ: Data Explorer"

<video width="100%" controls>
  <source src="https://github.com/Workday/dj/raw/main/assets/videos/data-explorer-overview.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

> Opening Data Explorer, navigating/zooming the graph, expanding nodes, and running models from the graph

### Understanding the Model Lineage Graph

The Data Explorer shows your dbt models as an interactive directed acyclic graph (DAG):

**Visual Elements:**

- **Nodes**: Each model is represented as a colored node
- **Edges**: Arrows show dependencies (data flow)
- **Layers**: Models organized by type (staging → intermediate → mart)

**Example from jaffle_shop:**

The lineage graph shows how `int__sales__orders__enriched` depends on:

- `stg__sales__orders__standardized` (staging layer)
- `stg__customers__profiles__clean` (staging layer)
- `stg__sales__stores__locations` (staging layer)

And how `mart__sales__reporting__revenue` depends on `int__sales__orders__enriched`.

### Navigation Controls

**Pan and Zoom:**

- Pan: Click and drag canvas
- Zoom: Scroll wheel or pinch gesture
- Fit View: Click "Fit to View" button

**Node Selection:**

- Click node to highlight upstream/downstream
- Click to open model file and switch to the model's lineage
- Hover for quick info tooltip

### Toolbar Features

The Data Explorer toolbar provides additional controls for customizing your view:

**Auto-Sync Toggle:**

- Enable "Auto-sync" to automatically update the graph when you switch between model files
- When enabled, opening a different `.model.json`, `.sql`, or `.yml` file updates the graph to show that model's lineage
- Disabled by default to prevent unwanted graph changes
- Can also be configured via `dj.dataExplorer.autoRefresh` setting

**Split View Mode:**

- Click the split view icon to enable side-by-side layout
- Shows the lineage graph alongside query results or compilation logs
- Useful for comparing model structure with query output
- Click again to return to single-panel view

**Refresh Button:**

- Manually refresh the lineage graph to reflect latest changes
- Useful after running `dbt parse` or modifying model dependencies
- Icon animates while loading

### Exploring the Graph

By default, the Data Explorer displays a model with its immediate upstream (parent) and downstream (child) models. You can progressively explore the lineage by expanding individual nodes.

**Expanding Nodes:**

Each node displays expand buttons (+ icons) when it has additional upstream or downstream models not currently shown:

- **Upstream expand button** (left side): Shows models that feed into this model
- **Downstream expand button** (right side): Shows models that depend on this model
- Click the + button to reveal additional levels of lineage
- Expansion happens per-node, allowing you to explore specific branches

**Example:** Starting from `mart__sales__reporting__revenue`:

1. Initially shows immediate upstream: `int__sales__orders__enriched`
2. Click upstream expand on `int__sales__orders__enriched` to reveal:
   - `stg__sales__orders__standardized`
   - `stg__customers__profiles__clean`
   - `stg__sales__stores__locations`
3. Click upstream expand on staging models to reveal source tables:
   - `raw_orders`, `raw_customers`, `raw_stores`

This progressive expansion lets you focus on relevant parts of the lineage without overwhelming the view.

### Model Actions

Each model node in the Data Explorer displays icon buttons for quick actions:

**View Columns:**

- Click the columns icon (grid icon) on any node
- Opens Column Lineage panel for that model
- Shows column-level dependencies and transformations

**Compile Model:**

- Click the gear icon on a model node
- Compiles the model and displays compilation logs
- Shows generated SQL in the results panel
- Note: Source nodes don't have compile/run buttons

**Run Query:**

- Click the play circle icon on a model node
- Executes a query against the compiled model
- If model needs compilation, automatically compiles first
- Shows query results with data preview and SQL view

**Expand Lineage:**

- Click the + icon on nodes that have additional upstream/downstream models
- Progressively reveals more of the lineage graph
- Left side expands upstream dependencies
- Right side expands downstream dependents

**Select Model:**

- Click on a node to select it and view details
- Opens the model file in the editor
- Model becomes the active context for the graph

### Results and Compilation Panels

The Data Explorer includes panels for viewing query results and compilation logs:

**Query Results Panel:**

- Appears when you run a query from a model node
- **Data View**: Shows query results in a tabular format
  - Displays column names and row data
  - Shows row count and execution time
  - Supports scrolling through results
- **SQL View**: Displays the compiled SQL that was executed
  - Syntax-highlighted SQL
  - Shows the exact query sent to the database
  - Useful for debugging and understanding generated SQL
- Toggle between Data and SQL views using the tab buttons
- Maximize/restore the panel for better visibility

**Compilation Logs Panel:**

- Shows real-time compilation output when compiling a model
- Displays dbt compilation messages and any errors
- Automatically appears when compilation starts
- Shows success/failure status with visual indicators
- Can be closed after reviewing the output

## Column Lineage

### Opening Column Lineage

#### Method 1: From Model File

1. Open any `.model.json` file
2. Click "Column Lineage" button in editor toolbar

#### Method 2: Command Palette

1. With `.model.json` file active
2. Run "DJ: Column Lineage"

#### Method 3: From Data Explorer

1. Click the columns icon button on a model node
2. Column Lineage opens for that model

<video width="100%" controls>
  <source src="https://github.com/Workday/dj/raw/main/assets/videos/column-lineage-overview.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

> Opening Column Lineage, understanding transformation types (raw/passthrough/renamed/derived), and tracing column origins

### Understanding Column Flow

Column Lineage traces individual columns through transformations:

**Transformation Types:**

1. **Raw** (⬜ Gray)

   - Source columns from raw tables
   - Not yet transformed
   - Example: Columns in `raw_orders`, `raw_customers`

2. **Passthrough** (🟢 Green)

   - Column passes unchanged through transformation
   - Example: `customer_id` → `customer_id`

3. **Renamed** (🟡 Yellow)

   - Column renamed but values unchanged
   - Example: `id` → `customer_id`

4. **Derived** (🟠 Orange)

   - New column from expression, calculation, or aggregation
   - Examples:
     - Calculation: `first_name || ' ' || last_name` → `full_name`
     - Aggregation: `SUM(amount)` → `total_revenue`
     - Date extraction: `EXTRACT(YEAR FROM order_date)` → `order_year`

**Example from jaffle_shop:**

In `mart__sales__reporting__revenue`:

- `order_id` is **passthrough** from `int__sales__orders__enriched`
- `order_year` is **derived** from `EXTRACT(YEAR FROM order_date)`
- `total_dollars` is **passthrough** (but originally derived in intermediate layer)

### Tracing Column Origins

**Backward Tracing:**

1. Click a column in the target model
2. Graph highlights the column and its immediate upstream connections
3. **For derived columns:** Hover over the derived badge area to see the transformation
4. A tooltip displays the SQL expression or transformation logic
5. Follow the highlighted path backwards to source

**Viewing Transformations:**

- **Derived columns** with expressions show a tooltip when you hover over the badge area
- The tooltip displays:
  - SQL expression used to create the column
  - Aggregation functions (SUM, COUNT, AVG, etc.)
  - Calculations and formulas
  - Date extractions and transformations
- **Simple mappings** (raw, passthrough, renamed) don't show transformation tooltips since the relationship is direct

**Example:** Tracing `order_total_dollars` in `int__sales__orders__enriched`:

- Shows it's derived from: `CAST(stg__sales__orders__standardized.order_total_cents AS DECIMAL(10,2)) / 100.0`
- Which comes from `order_total_cents` in staging
- Which comes from `order_total` in the source table `raw_orders`

**Forward Tracing:**

1. Select column
2. See all downstream uses
3. Identify impacted models

**Example:** Tracing `order_date` forward shows it's used in:

- `mart__sales__reporting__revenue` (for year/month/quarter extraction)
- `int__sales__analytics__monthly_revenue` (for rollup)
- `int__sales__analytics__rolling_30day` (for lookback window)

### Column Lineage Graph

**Visual Elements:**

- **Column Nodes**: Individual columns displayed as separate nodes with color-coded badges
- **Model Information**: Each node shows the model name that contains the column
- **Transformation Edges**: Lines connecting columns across models
- **Color Coding**: Badges show transformation type (raw/passthrough/renamed/derived)
- **Expression Tooltips**: Hover over derived column badges to see transformation details

**Viewing Details:**

- **Hover column node**: Highlights the column and its immediate connections
- **Hover derived badge**: Shows SQL expression for derived columns in a tooltip
- **Hover edge**: Highlights immediately connected nodes only

### Bulk Select Expansion

DJ automatically expands bulk column selects:

**`all_from_model`**

```json
{ "type": "all_from_model", "model": "stg__sales__orders__standardized" }
```

Expands to all columns from specified model

**`dims_from_model`**

```json
{ "type": "dims_from_model", "model": "stg__sales__orders__standardized" }
```

Expands to dimension columns only

**`fcts_from_model`**

```json
{ "type": "fcts_from_model", "model": "stg__sales__orders__standardized" }
```

Expands to fact/measure columns only

**Example from jaffle_shop:**

In `int__products__analytics__product_popularity`:

```json
{
  "type": "dims_from_model",
  "model": "stg__sales__items__order_details",
  "include": ["product_sku", "product_type", "item_id"]
}
```

Column Lineage shows this expands to three dimension columns and traces each back to its source.

### Finding Column Origin

**From any file:**

1. Place cursor on column name in SQL or `.model.json`
2. Run "DJ: Find Column Origin"
3. Column Lineage opens with column highlighted
4. Trace back to source table

### Use Cases

**Impact Analysis:**

- "If I change this source column, what breaks?"
- Trace downstream to find affected models

**Example:** Changing `ordered_at` in `raw_orders`:

- Affects `order_date` in `stg__sales__orders__standardized`
- Which affects `order_year`, `order_month`, `order_quarter` in `mart__sales__reporting__revenue`
- Which affects multiple dashboard queries

**Debugging:**

- "Where does this value come from?"
- Trace upstream to source table

**Example:** Investigating incorrect `revenue_tier` classification:

- Trace to expression: `CASE WHEN order_total_dollars >= 15.00 THEN 'High'...`
- Trace `order_total_dollars` to intermediate layer
- Trace to cents-to-dollars conversion in staging
- Trace to `order_total` in source

**Documentation:**

- "What transformations are applied?"
- Export lineage graph for documentation

**Optimization:**

- "Is this column used downstream?"
- Identify unused columns to remove

**Example:** Check if `tax_paid_cents` is used:

- Trace forward through all models
- Find it's only used in `mart__sales__reporting__profitability`
- Safe to remove from other intermediate models

## Lineage Configuration

### Auto-Refresh Settings

Both Data Explorer and Column Lineage support auto-refresh on editor tab changes.

**How it works:**

- Switch to a `.model.json`, `.sql`, or `.yml` file
- The active lineage view (Data Explorer or Column Lineage) detects the file change
- Graph updates to show the current model's context

**Configuration:**

```json
{
  // Auto-refresh Data Explorer on tab change
  "dj.dataExplorer.autoRefresh": true,

  // Auto-refresh Column Lineage on tab change
  "dj.columnLineage.autoRefresh": true
}
```

**Defaults:**

- `dj.dataExplorer.autoRefresh`: `false` (disabled by default)
- `dj.columnLineage.autoRefresh`: `true` (enabled by default)

### Performance Tips

**Large Projects (100+ models):**

- Use progressive node expansion to explore specific branches
- Avoid expanding all nodes at once
- Disable auto-refresh if graph updates are slow

**Deep Lineages (10+ levels):**

- Expand nodes progressively rather than all at once
- Zoom in on specific sections of interest
- Focus on critical paths through your pipeline

## Troubleshooting

### Lineage Not Showing

**Check manifest.json:**

1. Ensure dbt has been run: `dbt parse` in terminal
2. Verify `target/manifest.json` exists in your dbt project
3. Check for compilation errors in Output panel

### Column Lineage Empty

**Ensure model is compiled:**

1. Open `.model.json` file
2. Run "DJ: Compile Model" from Command Palette
3. Check for validation errors in editor

**Check dependencies:**

1. Verify upstream models exist
2. Ensure manifest includes dependencies
3. Run `dbt parse` in terminal to rebuild manifest

## Integration with dbt

DJ lineage graphs use dbt's `manifest.json`:

- Parses `target/manifest.json` for dependencies
- Respects dbt's `ref()` and `source()` relationships
- Updates automatically when manifest changes
- Compatible with all dbt features (packages, macros, etc.)

## Next Steps

- [Visual Editor Guide](VISUAL_EDITOR.md) - Create models visually
- [Tutorial](TUTORIAL.md) - Build a complete pipeline
- [Model Types](models/README.md) - Understand model dependencies
