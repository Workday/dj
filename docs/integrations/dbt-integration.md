# dbt Integration

DJ provides integrated dbt command execution directly from VS Code, allowing you to compile models, run transformations, and test your data models.

**Before you begin:** This guide assumes you have completed initial setup. See the [Setup Guide](../setup/setup.md) first.

**Related Documentation:**

- [Setup Guide](../setup/setup.md) - Initial installation and configuration
- [Tutorial](../TUTORIAL.md) - Hands-on walkthrough
- [Trino Integration](trino-integration.md) - Query execution and catalog browsing
- [Lightdash Integration](lightdash-integration.md) - BI dashboard previews

---

## Table of Contents

1. [Running dbt Commands](#running-dbt-commands)
2. [dbt Project Configuration](#dbt-project-configuration)
3. [Opening dbt Files](#opening-dbt-files)
4. [Development Workflows](#development-workflows)
5. [Troubleshooting](#troubleshooting)

## Running dbt Commands

DJ provides integrated dbt command execution directly from VS Code.

### Compile Model

Compiles model to SQL without executing:

**Method 1: Keyboard Shortcut**

- Mac: `Cmd+Shift+C`
- Windows/Linux: `Ctrl+Shift+C`

**Method 2: Command Palette**

1. Open `.model.json` file
2. Run "DJ: Compile Model"

**Method 3: Context Menu / Tree View**

1. Right-click model in Project Navigator tree view
2. Select "Compile Model"

<video width="100%" controls>
  <source src="https://github.com/Workday/dj/raw/main/assets/videos/dbt-operations.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

> Compiling and running models (including run with upstream), showing compilation output in Output panel

**Output:**

- Opens Data Explorer panel
- Compilation logs appear in the Compilation Logs panel within Data Explorer
- Compiled SQL files are saved to `target/compiled/` directory

**Example:** Compiling [int\_\_sales\_\_orders\_\_enriched.model.json](../examples/jaffle_shop/models/intermediate/sales/orders/int__sales__orders__enriched.model.json) generates SQL with left joins to customers and stores.

### Run Model

Opens an interactive UI for running dbt models with configurable options.

**Method 1: Command Palette**

1. Run "DJ: Run Model" from Command Palette

**Method 2: Actions Tree View**

1. Open "Actions" view in left sidebar
2. Click "Run Model" item

<video width="100%" controls>
  <source src="https://github.com/Workday/dj/raw/main/assets/videos/dbt-run-model-ui.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

> Opening the Run Model UI, selecting a model, configuring run options, and viewing execution results

**What the UI provides:**

- **Model Selection**: Choose which model(s) to run
- **Run Options**:
  - Run single model
  - Run with upstream dependencies (`+model_name`)
  - Run with downstream dependencies (`model_name+`)
  - Full refresh option
  - Defer to production option

**Example workflow:**

1. Open Run Model UI
2. Select [mart\_\_sales\_\_reporting\_\_revenue.model.json](../examples/jaffle_shop/models/marts/sales/reporting/mart__sales__reporting__revenue.model.json)
3. Choose "Run with upstream" to ensure dependencies are fresh
4. Click "Run" and view real-time logs

### Run Model Lineage (Run with Upstream)

Runs model and all upstream dependencies:

**Command:** "DJ: Run Model Lineage"

**Equivalent to:**

```bash
dbt run --select +model_name
```

**Use Cases:**

- Ensure upstream data is fresh
- First-time model run
- After schema changes in dependencies

**Example:** Running `mart__sales__reporting__revenue` with lineage will first run:

- `int__sales__orders__enriched` (intermediate layer)
- `stg__sales__orders__standardized`, `stg__customers__profiles__clean`, `stg__sales__stores__locations` (staging layer)
- Then finally `mart__sales__reporting__revenue`

### Preview Model (Query Model Data)

Queries the compiled model and displays results in Data Explorer:

**Keyboard Shortcut:**

- Mac: `Cmd+Enter`
- Windows/Linux: `Ctrl+Enter`

**Command Palette:**

1. Open `.model.json`, `.sql`, or `.yml` file
2. Run "DJ: Preview Model"

**What it does:**

- Opens Data Explorer panel
- Executes a query against the compiled model (using `target/compiled/` SQL)
- Displays query results with data preview and SQL view
- Different from "Run Model" which materializes the model using `dbt run`

**Use Cases:**

- Quick data preview without materializing
- Verify transformations are working correctly
- Debug SQL logic before running full pipeline
- Explore model output during development

**Example:** Preview [mart\_\_sales\_\_reporting\_\_revenue.model.json](../examples/jaffle_shop/models/marts/sales/reporting/mart__sales__reporting__revenue.model.json) to see aggregated revenue data without running the full pipeline.

### Auto-Generated Tests

DJ automatically generates tests based on model type. Tests can be configured in VS Code settings:

**Configuration:**

```json
{
  "dj.autoGenerateTests": {
    "tests": {
      "equalRowCount": {
        "enabled": false,
        "applyTo": ["inner"],
        "targetFolders": []
      },
      "equalOrLowerRowCount": {
        "enabled": false,
        "applyTo": ["left"],
        "targetFolders": []
      }
    }
  }
}
```

**Test Types:**

- `equal_row_count` for inner joins (validates no row multiplication)
- `equal_or_lower_row_count` for left joins (validates row count constraints)
- `no_null_aggregates` for aggregation checks

**Running Tests:**

Use standard dbt commands to run tests:

```bash
dbt test --select model_name
```

**Example:** In [int\_\_sales\_\_orders\_\_enriched.model.json](../examples/jaffle_shop/models/intermediate/sales/orders/int__sales__orders__enriched.model.json), DJ can auto-generate `equal_or_lower_row_count` tests for the left joins to customers and stores when enabled in settings.

## dbt Project Configuration

DJ integrates with dbt through your Python virtual environment. Key settings:

**Python Virtual Environment:**

```json
{
  "dj.pythonVenvPath": ".venv"
}
```

DJ uses your configured Python venv to run dbt commands.

**Multi-Project Support:**

```json
{
  "dj.dbtProjectNames": ["analytics", "marketing"]
}
```

Restrict DJ to specific dbt projects in workspace.

**dbt Command Output:**

All dbt output streams to VS Code Output panel:

1. View → Output
2. Select "DJ" from dropdown

For complete list of extension settings, see [Setup Guide - Configure Extension Settings](../setup/setup.md#6-configure-extension-settings).

## Opening dbt Files

**View Compiled SQL:**

- Command: "DJ: Open Target Compiled SQL"
- Shortcut: `Cmd+'` (Mac) / `Ctrl+'` (Windows/Linux)
- Opens file from `target/compiled/`
- Opens in split view beside current editor
- Shows final SQL sent to warehouse

**View Run SQL:**

- Command: "DJ: Open Target Run SQL"
- Opens file from `target/run/`
- Shows executed SQL with run metadata

**Jump to YAML:**

- Shortcut: `Cmd+Shift+Y` / `Ctrl+Shift+Y`
- Opens generated `.yml` properties file

## Development Workflows

### End-to-End Development Flow

1. **Create Model** (Visual Editor or JSON)
2. **Compile** (`Cmd+Shift+C`) - Generate SQL
3. **Run** (DJ: Run Model) - Execute in warehouse
4. **Test** (DJ: Test Model) - Validate data quality
5. **Iterate** - Edit, compile, run, test

**Example with jaffle_shop:**

Create [int\_\_sales\_\_orders\_\_enriched.model.json](../examples/jaffle_shop/models/intermediate/sales/orders/int__sales__orders__enriched.model.json) → Compile to see join SQL → Run to materialize → Test to verify joins → Preview in Lightdash.

### Testing Workflow

1. **Develop model** with transformations
2. **Run model** to materialize
3. **Auto-generated tests** created by DJ
4. **Run tests** (DJ: Test Model)
5. **Fix failures** if any
6. **Commit** when tests pass

**Example:** After creating a join model, DJ auto-generates `equal_or_lower_row_count` tests. Run tests to verify joins don't duplicate rows.

## Troubleshooting

### dbt Commands Not Working

**Check Python venv:**

```json
{
  "dj.pythonVenvPath": ".venv"
}
```

**Verify dbt installation:**

```bash
source .venv/bin/activate
dbt --version
```

**Check dbt_project.yml:**
Ensure file exists in workspace root

**View dbt Output:**

1. View → Output
2. Select "DJ" from dropdown
3. Look for dbt command output and errors

## Next Steps

- [Trino Integration](trino-integration.md) - Query execution and catalog browsing
- [Lightdash Integration](lightdash-integration.md) - BI dashboard previews
- [Tutorial](../TUTORIAL.md) - Hands-on walkthrough
- [Visual Editor](../VISUAL_EDITOR.md) - Create models visually
- [Lineage Visualization](../LINEAGE.md) - Explore model dependencies
