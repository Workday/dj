# Lightdash Configuration

The DJ extension provides flexible configuration options for Lightdash integration, allowing you to work with different dbt project structures and multiple projects.

**Related Documentation:**

- [Setup Guide - Lightdash Integration](setup.md#7-optional-lightdash-integration) - Initial installation and environment variables
- [Integrations Guide - Lightdash](../integrations/lightdash-integration.md) - Using Lightdash Preview Manager UI and metadata configuration
- [Lightdash Local Setup](lightdash-local-setup.md) - Docker setup for local development

---

## Configuration Options

### Auto-Detection (Default)

By default, the extension automatically detects dbt projects in your workspace by scanning for `dbt_project.yml` files. When you run the Lightdash preview command, it will:

1. **Single Project**: Automatically use the detected dbt project directory for both `--project-dir` and `--profiles-dir`
2. **Multiple Projects**: Show a quick pick dialog to let you select which project to use
3. **No Projects**: Show an error message asking you to add a dbt project or configure a custom path

**Important**: The Lightdash path will always be the same as the currently available dbt project path. Both the project directory and profiles directory will point to the same location unless explicitly overridden in configuration.

### Manual Configuration

You can override the auto-detection by setting these VS Code configuration options:

#### `dj.lightdashProjectPath`

- **Type**: `string`
- **Description**: Custom path to the dbt project directory (relative to workspace root)
- **Example**: `"docs/examples/jaffle_shop"` for projects where dbt is in a subdirectory

#### `dj.lightdashProfilesPath`

- **Type**: `string`
- **Description**: Custom path to the dbt profiles directory (relative to workspace root)
- **Default**: Uses the project directory or workspace root if not specified

#### `dj.lightdash.defaultPartitionColumnCaseSensitive`

- **Type**: `boolean`
- **Default**: `false`
- **Description**: When `true`, the extension automatically emits `meta.dimension.case_sensitive: true` on every partition column in generated YAML. This stops Lightdash from wrapping the column in `UPPER()` in queries, preserving Trino predicate pushdown on partitioned tables.
- **When to enable**: Lightdash projects that query partitioned tables and notice slow scans because partition predicates are wrapped in `UPPER()`.
- **Per-model override**: `lightdash.case_sensitive` on a specific model or column in `.model.json` continues to take precedence in either mode.
- **Takes effect**: Run `DJ: Sync to SQL and YML` (`Cmd+Shift+P`) to regenerate YAML with the new value.

```json
{ "dj.lightdash.defaultPartitionColumnCaseSensitive": true }
```

## Examples

### Example 1: dbt project in subdirectory

If your dbt project is located at `docs/examples/jaffle_shop/` instead of the default `dags/dbt/`:

```json
{
  "dj.lightdashProjectPath": "docs/examples/jaffle_shop"
}
```

### Example 2: Custom profiles location

If you want to use a specific profiles directory:

```json
{
  "dj.lightdashProjectPath": "my-dbt-project",
  "dj.lightdashProfilesPath": "profiles"
}
```

### Example 3: Multiple projects with auto-selection

Leave the configuration empty to enable auto-detection. When multiple projects are found, you'll see a selection dialog like:

```text
Select dbt project for Lightdash preview
> my_analytics_project (analytics/dbt)
  reporting_project (reports/dbt)
  staging_project (staging/dbt)
```

**Note**: If you cancel the selection dialog (press Escape), the Lightdash preview operation will be cancelled.

## Setting Configuration

### Via VS Code Settings UI

1. Open VS Code Settings (`Cmd+,` on Mac, `Ctrl+,` on Windows/Linux)
2. Search for "dj lightdash"
3. Set the desired values

### Via settings.json

Add to your workspace or user `settings.json`:

```json
{
  "dj.lightdashProjectPath": "docs/examples/jaffle_shop",
  "dj.lightdashProfilesPath": "profiles"
}
```

### Via Workspace Settings

Create/edit `.vscode/settings.json` in your workspace:

```json
{
  "dj.lightdashProjectPath": "docs/examples/jaffle_shop"
}
```

## Troubleshooting

### "No dbt projects found in workspace"

- **Add a dbt project**: Ensure your workspace contains a `dbt_project.yml` file
- **Configure custom path**: Set `dj.lightdashProjectPath` to point to your dbt project directory

### "Lightdash command fails"

- Verify the project path exists and contains a valid dbt project
- Check that Lightdash CLI is installed and accessible
- Ensure the project has the required `lightdash` and `lightdash-explore` tags on models

### "Lightdash preview cannot connect to Trino" (Docker environments)

If you're running Lightdash in Docker and it cannot connect to Trino, you need to configure the Trino hostname. Choose the option that matches your setup:

#### Option A: Trino running on host machine (Not in Docker)

If Trino is running directly on your Mac (not in Docker), use Docker's special hostname:

```bash
# Add to your shell profile (.bashrc, .zshrc, etc.)
echo 'export LIGHTDASH_TRINO_HOST=host.docker.internal' >> ~/.zshrc
source ~/.zshrc
```

Then verify and restart VS Code:

```bash
# Verify it's set
echo $LIGHTDASH_TRINO_HOST
# Should output: host.docker.internal

# Quit VS Code (Cmd+Q) and reopen from terminal
code .
```

#### Option B: Both Trino and Lightdash in Docker

If both are running in Docker containers:

1. **Connect the Docker networks**:

   ```bash
   docker network connect lightdash_default trino_default
   ```

2. **Set the environment variable**:

   ```bash
   echo 'export LIGHTDASH_TRINO_HOST=trino_default' >> ~/.zshrc
   source ~/.zshrc
   ```

3. **Verify and restart VS Code**:

   ```bash
   # Verify it's set
   echo $LIGHTDASH_TRINO_HOST
   # Should output: trino_default

   # Quit VS Code (Cmd+Q) and reopen from terminal
   code .
   ```

#### How It Works

The DJ extension reads `LIGHTDASH_TRINO_HOST` and passes it to dbt via the `DBT_HOST` environment variable when creating Lightdash previews. The dbt profiles.yml uses this to override the connection host.

**Important**: Your normal dbt commands (running directly on your Mac) will continue to use `localhost` because the environment variable override only applies to the Lightdash preview subprocess.

For more details, see the [Lightdash Local Setup Guide](lightdash-local-setup.md).

## Next Steps

Once you've configured Lightdash:

- **[Integrations Guide - Lightdash](../integrations/lightdash-integration.md)** - Learn how to use the Lightdash Preview Manager UI to start, manage, and delete previews
- **[Integrations Guide - Lightdash Metadata](../integrations/lightdash-integration.md#configuring-lightdash-metadata)** - Configure dimensions, metrics, and AI hints in your models
