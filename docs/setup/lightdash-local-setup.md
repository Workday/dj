# Local Lightdash Setup Guide

Quick setup guide for running Lightdash locally with the DJ (Data JSON) Framework.

Lightdash is an open-source BI tool that creates dashboards directly from your dbt models.

> **Already have Lightdash?** Return to the [main setup guide](setup.md#7-optional-lightdash-integration) instead.

**Related Documentation:**

- [Setup Guide - Lightdash](setup.md#7-optional-lightdash-integration) - CLI installation and environment variables
- [Lightdash Configuration](lightdash-configuration.md) - Auto-detection and custom project paths
- [Integrations Guide - Lightdash](../integrations/lightdash-integration.md) - Using Preview Manager UI and configuring metadata

---

Table of Contents

1. [Prerequisites](#prerequisites)
2. [Setup](#setup)
3. [Troubleshooting](#troubleshooting)
4. [Next Steps](#next-steps)

## Prerequisites

- **Docker** and **Docker Compose**
- **Trino running locally** (see [Trino setup](trino-local-setup.md))

## Setup

This guide uses Docker Compose to run Lightdash locally. For other installation methods, refer to the [official Lightdash installation guide](https://docs.lightdash.com/self-host/self-host-lightdash-docker-compose).

### 1. Install Lightdash

```bash
# Clone and start Lightdash
git clone https://github.com/lightdash/lightdash
cd lightdash
```

Let's update .env config for the below settings:

```bash
PORT=8081 # Since trino is already running on port 8080, let's use a different port.
SITE_URL=http://localhost:8081
DBT_PROJECT_DIR=<path-to-your-dbt-project>
```

### Start Lightdash

```bash
docker compose up -d
```

### 2. Start Trino After Lightdash (Docker)

The Trino compose stack in [Trino Local Setup](trino-local-setup.md) joins the `lightdash_default` network automatically, so no manual network connection is needed. Start Lightdash first, then Trino:

```bash
# 1. In the Lightdash directory (creates the lightdash_default network)
docker compose up -d

# 2. In the DJ repository root
docker compose -f docs/setup/trino/docker-compose.yml up -d
```

If Trino is running on your host machine instead of in Docker, skip this and use `host.docker.internal` (see Option A below).

### 3. Create Lightdash Project

Install Lightdash CLI if you haven't already:

```bash
npm install -g @lightdash/cli
```

Authenticate Lightdash CLI:

```bash
lightdash login http://localhost:8081
```

Then inside your dbt project, run the following command to create a Lightdash project:

```bash
DBT_HOST=trino_default lightdash deploy --create --skip-warehouse-catalog --assume-yes
```

> Note: dbt must be installed in the dbt project for this command to work.

- `DBT_HOST=trino_default` tells Lightdash (running in Docker) to reach Trino via its Docker container name `trino_default`.
- `--skip-warehouse-catalog` skips local CLI catalog probing during deploy so `trino_default` does not need to resolve on your host machine.
- `--assume-yes` stores the warehouse credentials from `profiles.yml` (with an empty password), avoiding the Lightdash UI's mandatory password validation and `401` errors.

Once created, you should see the URL of the newly created project in the output.

### Configure DJ (Data JSON) Framework Extension for Docker

When using the DJ (Data JSON) Framework extension to create Lightdash previews, you need to configure how Lightdash (running in Docker) connects to Trino. Choose the option that matches your setup:

#### Option A: Trino running on host machine (Not in Docker)

If Trino is running directly on your Mac (not in Docker), use Docker's special hostname to access the host:

```bash
# Add to your shell profile (.bashrc, .zshrc, etc.)
echo 'export LIGHTDASH_TRINO_HOST=host.docker.internal' >> ~/.zshrc
source ~/.zshrc
```

This allows Lightdash (in Docker) to connect to Trino on your host machine via `host.docker.internal:8080`.

#### Option B: Both Trino and Lightdash in Docker

If both are running in Docker containers (the recommended setup from [Trino Local Setup](trino-local-setup.md)), set the environment variable to the container name:

```bash
# Set the environment variable
echo 'export LIGHTDASH_TRINO_HOST=trino_default' >> ~/.zshrc
source ~/.zshrc
```

This allows Lightdash to connect to Trino using the container name `trino_default`. The Trino compose stack already shares the `lightdash_default` network, so no further network setup is needed.

#### After Setting the Environment Variable

1. **Verify it's set**:

   ```bash
   echo $LIGHTDASH_TRINO_HOST
   # Should output: host.docker.internal OR trino_default
   ```

2. **Quit VS Code completely** (Cmd+Q, not just close the window)

3. **Reopen VS Code from terminal**:
   ```bash
   cd /Users/gowthamraj.j/Development/Workday/dj
   code .
   ```

VS Code needs to be restarted to pick up the new environment variable. The extension will automatically pass this to dbt via the `DBT_HOST` environment variable when creating Lightdash previews.

**Note**: Your normal dbt commands (running directly on your Mac) will continue to use `localhost` and work as expected.

### 4. Verify

```bash
# Check status
docker compose ps
```

Open the URL of the Lightdash project you created from the output in the browser. You should see the project you created.

## Troubleshooting

### Connection Errors with DJ (Data JSON) Framework Extension Preview

If you get connection errors when using the DJ (Data JSON) Framework extension's Lightdash preview feature, make sure you've configured the `LIGHTDASH_TRINO_HOST` environment variable as described in the "Configure DJ (Data JSON) Framework Extension for Docker" section above.

The environment variable ensures the extension passes the correct Trino hostname to dbt when creating previews.

### "Request failed with status code 401" / Mandatory Password in Lightdash UI

Local Trino runs with `INSECURE` authentication over HTTP (`:8080`), which accepts an empty password (`password: ''`) and rejects any non-empty password with `401 Unauthorized: Password not allowed for insecure authentication`. Because the Lightdash UI form marks **Password** as required when creating or replacing a warehouse connection manually, entering a placeholder password in the UI causes `401` errors.

To fix this without touching the UI form, push the empty-password credentials from your dbt project's `profiles.yml` via the CLI:

```bash
DBT_HOST=trino_default lightdash set-warehouse --assume-yes
```

(Or re-run `DBT_HOST=trino_default lightdash deploy --create --skip-warehouse-catalog --assume-yes` inside your dbt project directory.)

### Manual Connection Configuration (Lightdash UI)

If you need to inspect or update the host in the Lightdash UI after credentials have been stored via the CLI:

1. Go to `Settings` -> `Project Settings`
2. Click on the `Connection Settings` tab
3. Under `Warehouse Connections`, verify the host (leave **User** and **Password** untouched so the stored empty password is preserved):
   - If Trino is in Docker: `trino_default`
   - If Trino is on host: `host.docker.internal`

### Trino Container Is Not on the Lightdash Network

The Trino compose stack must be started after Lightdash, because it joins `lightdash_default`. If Trino started first or Lightdash was recreated, restart the Trino stack:

```bash
docker compose -f docs/setup/trino/docker-compose.yml up -d
```

### Verify Trino

```bash
# Should return 200 or 303
curl -v http://localhost:8080
```

## Next Steps

Once Lightdash is running locally:

- **[Return to Setup Guide](setup.md#7-optional-lightdash-integration)** - Configure environment variables for DJ integration
- **[Lightdash Configuration](lightdash-configuration.md)** - Configure custom project paths and auto-detection
- **[Integrations Guide - Lightdash](../integrations/lightdash-integration.md)** - Learn how to use Preview Manager UI, configure metadata, and create previews
- **[Tutorial](../TUTORIAL.md)** - Build dbt models and preview them in Lightdash
- **[Official Lightdash docs](https://docs.lightdash.com/self-host/self-host-lightdash-docker-compose)** - Docker setup documentation
