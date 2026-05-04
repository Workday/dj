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

### 2. Connect Trino and Lightdash Networks (If both in Docker)

**Note**: This is only required if both Trino and Lightdash are running in Docker containers. If Trino is running on your host machine, skip this step and use `host.docker.internal` in the DJ (Data JSON) Framework extension configuration (see below).

If both are in Docker, connect the networks so they can communicate:

```bash
# Check docker network name of Lightdash (usually lightdash_default)
docker network ls | grep lightdash

# Connect Trino to Lightdash network.
# Replace `lightdash_default` with the network name you found above.
# Replace `trino_default` with the actual container name of Trino if you have created it with a different name.
docker network connect lightdash_default trino_default

# Verify connection (optional)
docker inspect trino_default --format='{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
```

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
lightdash deploy --create
```

> Note: dbt must be installed in the dbt project for this command to work.

This will prompt you to enter the project name and once created, you should see URL of the newly created project in the output. This will be something like ` http://localhost:8081/createProject/cli?projectUuid=48c5c6d6-3b63-4661-baa3-da07eb446769`.

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

If both are running in Docker containers, first connect them to the same network, then use the container name:

```bash
# Connect the Docker networks (do this first)
docker network connect lightdash_default trino_default

# Set the environment variable
echo 'export LIGHTDASH_TRINO_HOST=trino_default' >> ~/.zshrc
source ~/.zshrc
```

This allows Lightdash to connect to Trino using the container name `trino_default`.

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

### Manual Connection Configuration (Lightdash UI)

If you're using `lightdash deploy` directly (not through the DJ (Data JSON) Framework extension) and have connection issues, you can manually update the connection settings in the Lightdash UI:

1. Go to `Settings` -> `Project Settings`
2. Click on the `Connection Settings` tab
3. Under `Warehouse Connections`, update the host:
   - If Trino is in Docker: `trino_default`
   - If Trino is on host: `host.docker.internal`

### Ensure Docker Networks are Connected

If both Lightdash and Trino are running in Docker containers:

```bash
# Ensure containers are connected to the same network
docker network connect lightdash_default trino_default
```

### Alternative: Get Container IP (Linux)

On Linux, you can also use the container's IP address:

```bash
docker inspect trino_default --format='{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
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
