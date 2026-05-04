# DJ (Data JSON) Framework

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![GitHub Release](https://img.shields.io/github/v/release/Workday/dj)](https://github.com/Workday/dj/releases)
[![dbt](https://img.shields.io/badge/dbt-Core-orange.svg)](https://www.getdbt.com/)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Workday/dj/badge)](https://scorecard.dev/viewer/?uri=github.com/Workday/dj)

DJ is a VS Code extension that revolutionizes dbt development through a structured, JSON-first approach. Define your dbt models and sources as validated `.model.json` and `.source.json` files that automatically generate corresponding SQL and YAML configurations.

## Interactive Development Experience

- **Visual Model Builder** - Interactive node-based canvas for creating models visually
- **Interactive Tutorials** - "Assist Me" and "Play Tutorial" modes for guided learning
- **Real-time Lineage** - Model and column-level dependency visualization
- **Integrated BI Preview** - One-click Lightdash preview from your models

<video width="100%" controls>
  <source src="https://github.com/Workday/dj/raw/main/assets/videos/visual-editor-overview.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

> Quick demonstration of creating a model using the visual editor

## Key Features

- **IntelliSense**: Smart autocomplete for models, sources, columns, and SQL expressions.
- **Real-time Validation**: JSON Schema validation with instant error detection.
- **Modern Web Interface**: React-based UI for scaffolding model and source JSONs.
- **Auto-Generation**: Automatically generates dbt SQL and YAML files from JSON configurations.
- **Data Catalog Integration**: Browse Trino catalogs and execute queries directly in VS Code.
- **BI Integration**: Built-in Lightdash support for creating dashboards from dbt models.
- **11 Model Types**: Complete coverage from staging to marts with pre-built templates.

## Supported Stack

<!-- Using GitHub raw URL to show image in both GitHub and VS Code extension marketplace -->

![DBT Stack](https://github.com/Workday/dj/blob/main/assets/images/dj_stack.png?raw=true)

_DJ integrates seamlessly with your modern data stack - from VS Code to dbt, Trino, and Lightdash._

> **Prerequisites:** DJ builds on top of dbt. If you're new to dbt, we recommend starting with the [dbt Introduction Guide](https://docs.getdbt.com/docs/introduction).

Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Model Types](#model-types)
4. [Getting Started](#getting-started)
5. [Support & Community](#support--community)
6. [Contributing](#contributing)
7. [License](#license)

## Prerequisites

- **VS Code**
- **Java** (required for Trino CLI)
- **Trino CLI** (for data catalog browsing)
- **Python** (for dbt)
- **Node.js** (v20.x - v22.x LTS recommended) (optional, for Lightdash CLI)

## Quick Start

> If you dont have a dbt project already setup, you can instead follow the [Tutorial](docs/TUTORIAL.md) that will walk you through setting up the example dbt project.
>
> For a complete setup guide, see [SETUP.md](docs/setup/setup.md)

### 1. Install Trino CLI

```bash
# Install Trino CLI (required for data catalog browsing)
curl -o trino-cli https://repo1.maven.org/maven2/io/trino/trino-cli/476/trino-cli-476-executable.jar
chmod +x trino-cli
sudo mv trino-cli /usr/local/bin/
```

> The extension will look for `trino-cli` in your PATH. If you don't have it in your PATH, you can configure the `trinoPath` in the extension settings.

### 2. Configure Trino Connection

Set up environment variables for Trino connection. Trino CLI will use these variables from your environment.

```bash
# Add to your shell profile (.bashrc, .zshrc, etc.)
export TRINO_HOST=your-trino-host
export TRINO_PORT=8080                    # 443 for Starburst Galaxy, 8080 for Local
export TRINO_USERNAME=your-username
export TRINO_CATALOG=your-catalog
export TRINO_SCHEMA=your-schema
```

> If you don't have Trino CLI installed, see [SETUP.md](docs/setup/setup.md#2-install-trino-cli)

### 3. Open Your dbt Project

1. Open your dbt project (should have `dbt_project.yml` file) in VS Code.
2. Install python dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt # dbt-trino is required for this extension
```

> If you don't have a dbt project already setup, you can instead follow the [Tutorial](docs/TUTORIAL.md) that will walk you through setting up the example dbt project.
>
> For a complete setup guide, see [SETUP.md](docs/setup/setup.md)

3. Make sure dbt dependencies have been installed and dbt parse has been run to generate the manifest.json file.

```bash
dbt deps
dbt parse # this generates the manifest.json file
```

### 4. Install the Extension

1. Download the latest `.vsix` file from the [GitHub Releases page](https://github.com/Workday/dj/releases)
2. Install the extension in VS Code:
   - Open VS Code
   - Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
   - Type "Extensions: Install from VSIX..."
   - Select the downloaded `.vsix` file

Note: Want to build the DJ (Data JSON) Framework extension from source? See the [DEVELOPMENT_SETUP.md](DEVELOPMENT_SETUP.md) for development setup.

### 5. Configure VS Code Settings

The extension can be configured in the VS Code settings or by adding to the `.vscode/settings.json` file.

To configure the extension via VS Code settings,

- Open the VS Code settings (Cmd/Ctrl + ,)
- Under "Extensions", select "DJ (Data JSON) Framework".
- Configure the extension settings as needed.

To configure the extension via `.vscode/settings.json`, add the configuration options as needed to the file:

```json
{
  "dj.pythonVenvPath": ".venv", // path to the local Python virtual environment relative to the workspace root
  "dj.dbtProjectNames": ["your_project_name"] // optional, configure if you have multiple dbt projects
}
```

## Configuration

DJ offers extensive configuration options to customize your workflow. For a complete reference with examples and troubleshooting, see the **[Settings Reference Guide](docs/SETTINGS.md)**.

### Quick Configuration

Common settings you'll want to configure first:

```json
{
  "dj.pythonVenvPath": ".venv", // Python virtual environment
  "dj.trinoPath": "/usr/local/bin", // Trino CLI location
  "dj.dbtProjectNames": ["analytics"], // Filter which projects to load
  "dj.airflowGenerateDags": true // Enable Airflow DAG generation
}
```

### Settings by Category

- **[Python & Environment](docs/SETTINGS.md#python--environment)** - `pythonVenvPath`, `trinoPath`
- **[Project Configuration](docs/SETTINGS.md#project-configuration)** - `dbtProjectNames`, `dbtMacroPath`
- **[Airflow Integration](docs/SETTINGS.md#airflow-integration)** - `airflowGenerateDags`, `airflowTargetVersion`, `airflowDagsPath`
- **[Lightdash Integration](docs/SETTINGS.md#lightdash-integration)** - `lightdashProjectPath`, `lightdashProfilesPath`
- **[AI & Coding Agents](docs/SETTINGS.md#ai--coding-agents)** - `aiHintTag`, `codingAgent`
- **[Auto-Generation & Tests](docs/SETTINGS.md#auto-generation--tests)** - `autoGenerateTests`
- **[Lineage Visualization](docs/SETTINGS.md#lineage-visualization)** - `columnLineage.autoRefresh`, `dataExplorer.autoRefresh`
- **[Diagnostics](docs/SETTINGS.md#diagnostics)** - `logLevel`

### When Settings Take Effect

Most settings take effect immediately or on next command execution. Some settings require running `DJ: Refresh Projects`:

- **Immediate**: `logLevel`, auto-refresh settings
- **Next command**: `pythonVenvPath`, `trinoPath`, Lightdash paths
- **Refresh Projects needed**: `dbtProjectNames`, Airflow settings, `codingAgent`

See the [Settings Reference](docs/SETTINGS.md#when-settings-take-effect) for complete details.

### 6. Create Your First Source

1. Look for the DJ (Data JSON) Framework extension panel in the sidebar and click on it.
2. Under "Actions", click on "Create Source".
3. Fill the form:
   - **Select Project**: Choose your dbt project
   - **Select Trino Catalog**: Choose your data catalog
   - **Select Trino Schema**: Choose your schema
   - **Select Trino Table**: Choose your source table

This creates a `.source.json` file with full IntelliSense support.

> Important: Source data should have been ingested into the Trino catalog as this is where the extension will look for the values for the form fields.

### 7. Choose Your Path

DJ offers multiple ways to build models - choose what works best for you:

- **Visual Editor**: Use the node-based canvas for interactive model creation
- **JSON-First**: Edit `.model.json` files directly with full IntelliSense
- **Guided Tutorial**: Run "DJ: Play Tutorial" from the command palette

### 8. Create Your First Model

1. Look for the DJ (Data JSON) Framework extension panel in the sidebar and click on it.
2. Under "Actions", click on "Create Model".
3. Fill the form:
   - **Select Project**: Choose your dbt project
   - **Select Model Type**: Choose your model type
   - **Select Group**: Choose your business domain
   - **Enter Topic**: Enter your data topic
   - **Enter Name**: Enter your model name
4. Save to auto-generate SQL and YAML files

This creates a `.model.json` file with full IntelliSense support and auto-generates corresponding dbt files.

> Important: If you don't see any groups in the dropdown, you need to configure the groups in your dbt project and run `dbt parse` to generate/update the manifest.json file.

### 9. Optional: Lightdash Integration

For BI integration, install Lightdash CLI and configure the environment variables:

```bash
# Install Lightdash CLI
npm install -g @lightdash/cli

# Configure environment variables
export LIGHTDASH_URL=your-lightdash-url
export LIGHTDASH_PREVIEW_NAME=your-preview-name
export LIGHTDASH_PROJECT=your-project-uuid
export LIGHTDASH_TRINO_HOST=your-trino-host # Optional. Uses host from profiles.yml by default. Set this if running Lightdash and Trino together in Docker locally.
```

> **Local Setup**: If you want to setup Lightdash locally, see [LIGHTDASH_LOCAL_SETUP.md](docs/setup/lightdash-local-setup.md).
>
> **Advanced Configuration**: For custom dbt project paths and multiple project support, see [Lightdash Configuration Guide](docs/setup/lightdash-configuration.md).

## Model Types

As models in dbt are intended to be reusable building blocks, instead of performing many different types of transformation in single SQL statements (e.g. nested joins and aggregations), each model in DJ is assigned a single type key which describes the primary operation it performs. This was, if two different downstream models need the same tranformation (e.g. an hourly aggregation), they can simply select from that aggregation building block.

DJ supports the following model types:

### Staging Models (Data Ingestion)

| Type                | Purpose                                    | Use Case                             |
| ------------------- | ------------------------------------------ | ------------------------------------ |
| `stg_select_source` | Clean and standardize data from sources    | Customer data standardization        |
| `stg_union_sources` | Combine similar data from multiple sources | Multi-region data consolidation      |
| `stg_select_model`  | Further refine and transform staging data  | Adding business logic to staged data |

### Intermediate Models (Business Logic)

| Type                 | Purpose                                | Use Case                        |
| -------------------- | -------------------------------------- | ------------------------------- |
| `int_select_model`   | Aggregations and business calculations | Customer order summaries        |
| `int_join_models`    | Multi-model joins for data enrichment  | Orders with customer details    |
| `int_join_column`    | Unnest arrays and flatten complex data | Product tags analysis           |
| `int_union_models`   | Combine processed intermediate models  | Consolidating feedback sources  |
| `int_lookback_model` | Time-based trailing analysis           | 30-day customer behavior trends |
| `int_rollup_model`   | Roll up data to higher time intervals  | Daily sales from hourly data    |

### Mart Models (Analytics-Ready)

| Type                | Purpose                        | Use Case                      |
| ------------------- | ------------------------------ | ----------------------------- |
| `mart_select_model` | Business intelligence datasets | Customer analytics dashboards |
| `mart_join_models`  | Comprehensive 360-degree views | Complete customer 360 view    |

**[Model Types Reference](docs/models/README.md)** - Detailed documentation with examples for all 11 model types

## Getting Started

### New to DJ?

1. **[Tutorial](docs/TUTORIAL.md)** - Step-by-step guide with real data
2. **[Example Project](docs/examples/jaffle_shop/README.md)** - Complete example project with jaffle shop implementation

### Documentation

- **[Setup Guide](docs/setup/setup.md)** - Complete setup and first launch experience
- **[Trino Setup](docs/setup/trino-local-setup.md)** - Local Trino configuration
- **[Lightdash Setup](docs/setup/lightdash-local-setup.md)** - BI tool integration
- **[Lightdash Configuration](docs/setup/lightdash-configuration.md)** - Advanced Lightdash configuration options
- **[Tutorial](docs/TUTORIAL.md)** - Hands-on tutorial with interactive modes
- **[Visual Editor Guide](docs/VISUAL_EDITOR.md)** - Node-based model builder
- **[Lineage Visualization](docs/LINEAGE.md)** - Model and column-level lineage
- **[Integrations Guide](docs/integrations/README.md)** - dbt, Trino, and Lightdash integration
- **[Model Types Reference](docs/models/README.md)** - All 11 model types with examples

## Support & Community

- **Discussions**: [GitHub Discussions](https://github.com/Workday/dj/discussions)
- **Issues**: [GitHub Issues](https://github.com/Workday/dj/issues)
- **Documentation**: [Complete Docs](docs/)

## Contributing

We welcome contributions!

- **[Contributing Guide](CONTRIBUTING.md)** - Code standards, pull request process, and guidelines
- **[Development Setup](DEVELOPMENT_SETUP.md)** - Complete development environment setup

## License

Licensed under the Apache License 2.0 - see [LICENSE](LICENSE.md) for details.

---

**Ready to transform your dbt workflow?** Install DJ and start building with confidence!
