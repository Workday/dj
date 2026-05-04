# Local Trino Setup Guide

This guide covers how to set up Trino locally for development with the DJ (Data JSON) Framework. If you already have Trino running (cloud or on-premises), return to the [main setup guide](setup.md#2-install-trino-cli) instead.

**Related Documentation:**

- [Setup Guide - Trino](setup.md#2-install-trino-cli) - Trino CLI installation and connection setup
- [Integrations Guide - Trino](../integrations/trino-integration.md) - Using Query Engine, browsing catalogs, and executing queries

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Install](#install)
   - [Using Docker](#using-docker)
   - [Verify](#verify)
   - [Configure](#configure)
3. [Troubleshooting](#troubleshooting)

## Prerequisites

- **Docker** (recommended for easy setup)

## Install

### Using Docker

This guide uses Docker to run Trino locally. If you prefer other installation methods, refer to the [official Trino installation guide](https://trino.io/docs/current/installation.html).

```bash
# Set the catalog directory path (customize if needed)
TRINO_CATALOG_DIR=~/trino-catalogs

# Create a local directory for Trino catalog configurations
mkdir -p $TRINO_CATALOG_DIR

# Create the development catalog configuration
cat > $TRINO_CATALOG_DIR/development.properties << EOF
connector.name=memory
memory.max-data-per-node=128MB
EOF

# Pull Trino image
docker pull trinodb/trino

# Run Trino with catalog directory mounted
docker run --name trino_default -d -p 8080:8080 \
  -v $TRINO_CATALOG_DIR:/etc/trino/catalog \
  trinodb/trino
```

> **Note**: This approach mounts your local `$TRINO_CATALOG_DIR` directory to the container, making catalog configurations persistent and easy to modify.

### Verify

```bash
# Test Trino server directly
curl http://localhost:8080/v1/info

# Verify the development catalog exists
docker exec trino_default trino --execute "SHOW CATALOGS;"

# Or test with Trino CLI (Requires CLI to be installed. See main setup guide)
trino-cli --server localhost:8080 --execute "SHOW CATALOGS;"

# You should see: development, system
```

Or access the Trino web UI at [http://localhost:8080](http://localhost:8080) (enter any username).

### Configure Environment (Optional)

Once Trino is running locally, configure your environment variables for trino CLI:

```bash
# Add to your shell profile (.bashrc, .zshrc, etc.)
export TRINO_HOST=localhost
export TRINO_PORT=8080
export TRINO_USERNAME=admin
export TRINO_CATALOG=development
export TRINO_SCHEMA=jaffle_shop
```

## Troubleshooting

### Catalog not found error

If you see errors like `Catalog 'development' not found`, follow the steps in the [Using Docker](#using-docker) section to create the catalog configuration file.

### Connection refused

```bash
# Check if Trino is running
curl http://localhost:8080/v1/info

# Check if Docker container exists and is running
docker ps -a | grep trino_default

# Start the container if it's stopped
docker start trino_default

# Restart Trino if needed
docker restart trino_default

# Check logs if there are issues
docker logs trino_default
```

#### Port already in use

```bash
# Check if port 8080 is available
lsof -i :8080

# Use a different port if port 8080 is already in use
docker run --name trino_default -d -p 8081:8080 \
  -v $TRINO_CATALOG_DIR:/etc/trino/catalog \
  trinodb/trino

# Update your environment variables
export TRINO_PORT=8081
```

---

## Next Steps

Once Trino is running:

- **[Return to Setup Guide](setup.md)** - Continue with extension configuration
- **[Integrations Guide - Trino](../integrations/trino-integration.md)** - Learn how to use Query Engine, browse catalogs, and execute queries
