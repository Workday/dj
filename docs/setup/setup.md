# DJ (Data JSON) Framework Setup Guide

Get the DJ (Data JSON) Framework extension up and running in VS Code. This guide covers extension installation and basic configuration.

Table of Contents

1. [Install Prerequisites](#1-install-prerequisites)
2. [Install Trino CLI](#2-install-trino-cli)
3. [Configure Trino Connection](#3-configure-trino-connection)
4. [Install DJ (Data JSON) Framework Extension](#4-install-dj-data-json-framework-extension)
5. [First Launch](#5-first-launch)
6. [Configure Extension Settings](#6-configure-extension-settings)
7. [Optional: Lightdash Integration](#7-optional-lightdash-integration)
8. [Verify Installation](#8-verify-installation)

## 1. Install Prerequisites

**Required Software:**

- **VS Code** (version 1.90.0 or higher)
- **Python**
- **dbt Core** (or dbt adapter with dbt-core)
- **Trino CLI** (for data catalog browsing)
- **Java** (required for Trino CLI)
- **Node.js** (v20.x - v22.x LTS recommended) (optional, for Lightdash CLI)

**dbt Project Requirements:**

The DJ (Data JSON) Framework requires a dbt project with Python dependencies installed:

- **dbt-core** (minimum version 1.0.0)
- **dbt adapter** (e.g., dbt-trino, dbt-postgres, dbt-snowflake) that includes dbt-core

Install dbt dependencies using pip:

```bash
# Create a virtual environment
python -m venv .venv
source .venv/bin/activate

# Install dbt-trino (necessary for this extension)
pip install dbt-trino
```

> **Note**: The dbt adapter packages (like `dbt-trino`) automatically include `dbt-core` as a dependency, so you don't need to install both separately.

## 2. Install Trino CLI

The DJ (Data JSON) Framework uses Trino CLI for data catalog integration and query execution.

> If you want to use Trino locally, see [Trino Local Setup](trino-local-setup.md)

### Option A: Download JAR (Recommended)

```bash
curl -o trino-cli https://repo1.maven.org/maven2/io/trino/trino-cli/476/trino-cli-476-executable.jar
chmod +x trino-cli
sudo mv trino-cli /usr/local/bin/
sudo ln -s /usr/local/bin/trino-cli /usr/local/bin/trino
```

### Option B: Using Homebrew (macOS)

```bash
brew install trino
sudo ln -s /opt/homebrew/bin/trino /usr/local/bin/trino-cli

# This should return the Trino CLI version
trino-cli --version
trino --version
```

## 3. Configure Trino Connection

Set up your Trino connection using environment variables:

```bash
# Add to your shell profile (.bashrc, .zshrc, etc.)
export TRINO_HOST=<your-trino-host>
export TRINO_PORT=<your-trino-port>    # 443 for Starburst Galaxy, 8080 for Local Trino
export TRINO_USERNAME=<your-username>
export TRINO_PASSWORD=<your-password>  # Optional
export TRINO_CATALOG=<your-catalog>
export TRINO_SCHEMA=<your-schema>
```

**Examples:**

- **Starburst Galaxy**: `your-cluster.galaxy.starburst.io:443`
- **Local Trino**: `localhost:8080`
- **Enterprise**: `trino.company.com:443`

## 4. Install DJ (Data JSON) Framework Extension

1. **Open VS Code**
2. **Go to Extensions** (Cmd/Ctrl + Shift + X)
3. **Search for "DJ"** or "Data JSON"
4. **Install the extension**

Or install directly from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=workday.dj).

> Note: Want to build from source? See the [DEVELOPMENT_SETUP.md](../DEVELOPMENT_SETUP.md) for development setup.

## 5. First Launch

On first activation, DJ performs background checks and may prompt for configuration:

### Background Checks

DJ silently checks for required tools in the background:

- Trino CLI installation
- Python virtual environment
- dbt installation in venv
- dbt project in workspace

**Note:** These checks run automatically without user notification. If any prerequisites are missing, you'll see errors when trying to use features that depend on them. Refer back to the prerequisites section above if you encounter issues.

### .gitignore Prompt (User Action Required)

DJ stores temporary files in a `.dj/` folder in your workspace:

- Edit drafts
- Sync cache
- Temporary files

**Recommended:** Add `.dj/` to `.gitignore`

On first use, DJ will prompt:

```text
DJ uses a .dj folder for local state.
Would you like to add it to .gitignore?
```

Click "Yes" to automatically update `.gitignore`.

**This is the only interactive prompt during first launch.**

## 6. Configure Extension Settings

The extension can be configured in the VS Code settings or by adding to the `.vscode/settings.json` file.

To configure the extension via VS Code settings,

- Open the VS Code settings (Cmd/Ctrl + ,)
- Under "Extensions", select "DJ (Data JSON) Framework".
- Configure the extension settings as needed.

To configure the extension via `.vscode/settings.json`, add the configuration options as needed to the file:

```json
{
  "dj.pythonVenvPath": ".venv", // path to the local Python virtual environment relative to the workspace root
  "dj.dbtProjectNames": ["your_project_name"] // optional, configure if you have multiple dbt projects in your workspace
}
```

## Extension Settings

The DJ (Data JSON) Framework offers extensive configuration options. For complete documentation with examples, validation details, and troubleshooting, see the **[Settings Reference Guide](../SETTINGS.md)**.

### Essential Settings

**Python Environment:**

- `dj.pythonVenvPath` - Path to Python virtual environment (e.g., `".venv"`)

**Trino Configuration:**

- `dj.trinoPath` - Path to Trino CLI (supports command names, full paths, or directories)

**Project Management:**

- `dj.dbtProjectNames` - Filter which dbt projects to load (useful in monorepos)

**Airflow Integration:**

- `dj.airflowGenerateDags` - Enable Airflow DAG generation (`true`/`false`)
- `dj.airflowTargetVersion` - Target Airflow version (`"2.7"`, `"2.8"`, `"2.9"`, `"2.10"`)
- `dj.airflowDagsPath` - Custom DAG output directory

**File Organization:**

- `dj.dbtMacroPath` - Custom macro folder (default: `"macros"`)
- `dj.dbtGenericTestsPath` - Generic test location (default: `"tests/generic"`)

### Testing Your Configuration

After configuring settings:

- **Trino**: Run `DJ: Test Trino Connection` to verify Trino CLI works
- **Python venv**: Check Output panel when running dbt commands
- **Project settings**: Run `DJ: Refresh Projects` to apply changes

## 7. Optional: Lightdash Integration

If you are using lightdash, you can integrate it with the extension to create dashboards.

Add `lightdash` or `lightdash-explore` tags to the models in your dbt project to add them to Lightdash. For example:

```json
{
  "tags": ["lightdash", "lightdash-explore"]
}
```

> **Local Setup**: If you want to setup Lightdash locally, see [Lightdash Local Setup](lightdash-local-setup.md).
>
> **Troubleshooting**: If you encounter connection issues with Lightdash + Trino, see the [troubleshooting section](lightdash-local-setup.md#troubleshooting) in the local setup guide.

This requires Lightdash CLI to be installed which can be done by running the following command:

```bash
npm install -g @lightdash/cli
```

We will need to authenticate the Lightdash CLI, see [Authenticating your CLI](https://docs.lightdash.com/guides/cli/cli-authentication#login).

Next, lets configure the environment variables for Lightdash:

```bash
# Add to your shell profile (.bashrc, .zshrc, etc.)
export LIGHTDASH_URL=<lightdash-domain>
export LIGHTDASH_PREVIEW_NAME=<lightdash-preview-name>
export LIGHTDASH_PROJECT=<lightdash-project> # The UUID for your project.
```

> Note: If your URL looks like `https://<lightdash-domain>/projects/<UUID>/Tables`, then `<UUID>` is your LIGHTDASH_PROJECT
> If you are using local Lightdash, your domain will be `http://localhost:8081`
>
> **Configuration**: For custom dbt project path and profiles path, see [Lightdash Configuration](lightdash-configuration.md).

## 8. Verify Installation

1. **Reload VS Code** to load environment variables
2. **Open Command Palette** (Cmd/Ctrl + Shift + P)
3. **Type "DJ"** - you should see DJ commands available
4. **Test Trino connection** by running `DJ: Test Trino Connection` from the command palette

## What's Next?

**Ready to build your first models?**

1. **[Follow the Tutorial](../TUTORIAL.md)** - Build your first models step-by-step with the example dbt project based on jaffle shop data from dbt docs
2. **[Integrations Guide](../integrations/dbt-integration.md)** - Learn how to use dbt commands, query Trino, and preview models in Lightdash
3. **[Explore the Example Project](../examples/jaffle_shop/README.md)** - See what's possible with the example dbt project based on jaffle shop data from dbt docs
4. **[Browse Model Types](../models/README.md)** - Learn about all 11 model types with the example dbt project based on jaffle shop data from dbt docs

## Troubleshooting

### Extension Not Working?

- **Reload VS Code** after setting environment variables
- **Check Python virtual environment path** in the extension settings
- **Verify Trino CLI** is in your PATH: `which trino-cli`
- **Verify Trino connection** by running `DJ: Test Trino Connection` from the command palette
- **Verify Groups** are defined in `dbt_project.yml` or `models/groups.yml`
- **Run `dbt parse`** to generate/update the manifest.json file
- **Verify environment variables** in your shell profile

### Need More Help?

- **Local Trino Setup**: See [Trino Local Setup](trino-local-setup.md)
- **Local Lightdash Setup**: See [Lightdash Local Setup](lightdash-local-setup.md)
- **Lightdash Configuration**: See [Lightdash Configuration](lightdash-configuration.md)
- **Development Setup**: See [DEVELOPMENT_SETUP.md](../../DEVELOPMENT_SETUP.md)
- **Example Project Issues**: Check [examples/jaffle_shop/README.md](../examples/jaffle_shop/README.md)

---

**Installation complete!** → [Start the Tutorial](../TUTORIAL.md)
