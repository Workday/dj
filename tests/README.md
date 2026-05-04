# Tests

This directory contains the test suite for the DJ (Data JSON) Framework extension, which validates that the framework correctly converts JSON model definitions to SQL and YAML files.

## Overview

The DJ (Data JSON) Framework extension allows defining dbt models using JSON schemas, which are then automatically converted to:

- **SQL files**: Executable dbt model code
- **YAML files**: dbt model properties and documentation

The tests ensure this conversion process works correctly across all model types and layers.

## Test Structure

```text
tests/
├── README.md           # This file
├── update-fixtures.ts  # Script to update test fixtures
├── fixtures/           # Test data copied from example project
│   ├── manifest.json   # dbt project metadata
│   ├── *.model.json    # DJ model definitions
│   ├── *.sql           # Expected generated SQL
│   └── *.yml           # Expected generated YAML
└── ../src/services/framework.test.ts  # Main test suite
```

## Fixtures

**What are fixtures?** Test data files that represent real, working examples from the `docs/examples/jaffle_shop` project.

**Coverage:** Staging, intermediate, and mart models that test all DJ (Data JSON) Framework capabilities.

## Usage

### Prerequisites

The example project must be parsed/compiled first:

```bash
cd docs/examples/jaffle_shop
dbt parse
```

### Update Fixtures

```bash
# Update from example project (default)
npm run fixtures:update

# Or specify different project
npm run fixtures:update path/to/dbt/project
```

### Run Tests

```bash
npm run test
```

## Troubleshooting

**Fixtures out of date:**

```bash
npm run fixtures:update && npm run test
```

**Missing manifest.json:**

```bash
cd docs/examples/jaffle_shop
dbt parse
npm run fixtures:update
```

**Test failures:** Check if changes are intentional, verify the example project compiles, and update fixtures if needed.

## Contributing

When contributing to the DJ (Data JSON) Framework:

1. **Always update fixtures** after model changes (`npm run fixtures:update`)
2. **Run tests** before submitting PRs
3. **Include test coverage** for new features
4. **Document changes** in model examples

The test suite is critical for maintaining framework reliability and preventing regressions.
