# Local Trino Setup Guide

This guide runs a local Trino with a persistent Iceberg `development` catalog for the DJ (Data JSON) Framework. If you already have Trino running (cloud or on-premises), return to the [main setup guide](setup.md#2-install-trino-cli) instead.

**Related Documentation:**

- [Setup Guide - Trino](setup.md#2-install-trino-cli) - Trino CLI installation and connection setup
- [Integrations Guide - Trino](../integrations/trino-integration.md) - Using Query Engine, browsing catalogs, and executing queries
- [Lightdash Local Setup](lightdash-local-setup.md) - Connecting Lightdash to this Trino

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Start Trino](#start-trino)
3. [Verify](#verify)
4. [Stop, Restart, and Reset](#stop-restart-and-reset)
5. [Troubleshooting](#troubleshooting)
6. [Next Steps](#next-steps)

## Prerequisites

- **Docker** with Docker Compose (nothing else is needed)
- **Lightdash** running, if you use it. Start Lightdash first, because the Trino compose file joins its network. See [Lightdash Local Setup](lightdash-local-setup.md).

## Start Trino

From the repository root:

```bash
docker compose -f docs/setup/trino/docker-compose.yml up -d
```

This starts two containers:

- `trino_default`: Trino 484 on port `8080`, with the `development` Iceberg catalog.
- `dj-trino-postgres-1`: Postgres 15, which stores the Iceberg catalog metadata. Its tables are created automatically on first start.

Trino stores table files in a Docker volume (`dj-trino_trino-warehouse`), so the catalog and its data survive restarts. No environment variables or config files need to be edited. The `jaffle_shop` example's `dbt` profile and the extension already point at `localhost:8080`.

## Verify

```bash
# Trino is up (returns JSON with "state":"ACTIVE")
curl http://localhost:8080/v1/info

# The development catalog is available
docker exec trino_default trino --execute "SHOW CATALOGS"
# "development", "system"
```

## Stop, Restart, and Reset

| Command                                                         | Effect                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `docker compose -f docs/setup/trino/docker-compose.yml stop`    | Stops the containers. Tables and data are kept.                                      |
| `docker compose -f docs/setup/trino/docker-compose.yml start`   | Starts them again with the same data.                                                |
| `docker compose -f docs/setup/trino/docker-compose.yml down`    | Removes the containers. Volumes and data are kept.                                   |
| `docker compose -f docs/setup/trino/docker-compose.yml down -v` | **Deletes the catalog and all data.** Run `dbt seed` and `dbt run` again afterwards. |

## Troubleshooting

### Port 8080 is already in use

If you ran Trino before with `docker run --name trino_default`, that old container still holds port `8080`. Remove it once, then start the compose stack:

```bash
docker rm -f trino_default
docker compose -f docs/setup/trino/docker-compose.yml up -d
```

### `network lightdash_default declared as external, but could not be found`

The Trino compose file joins the Lightdash network. Start Lightdash first (`docker compose up -d` in the Lightdash directory), then start Trino again.

### `Catalog 'development' not found`

Check that the stack is running (`docker ps | grep trino_default`) and that the Trino logs show `SERVER STARTED`:

```bash
docker logs trino_default 2>&1 | tail -20
```

### Trino does not respond after a restart

Trino can take about 30 seconds to start. Wait, then run `curl http://localhost:8080/v1/info` again.

## Next Steps

- **[Return to Setup Guide](setup.md)** - Continue with extension configuration
- **[Lightdash Local Setup](lightdash-local-setup.md)** - Connect Lightdash to Trino
- **[Integrations Guide - Trino](../integrations/trino-integration.md)** - Learn how to use Query Engine, browse catalogs, and execute queries
