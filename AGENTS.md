# AGENTS.md

This file provides guidance to AI coding agents working with code in this repository.

## Project Overview

DJ (Data JSON) Framework is a VS Code extension that revolutionizes dbt development through a structured, JSON-first approach. Users define dbt models and sources as validated `.model.json` and `.source.json` files that automatically generate corresponding SQL and YAML configurations.

The extension provides a rich visual UI built with React, including interactive model and column lineage graphs, a visual model creation wizard, query result previews, and a data modeling canvas -- all rendered as VS Code webviews.

**Key Technologies:**

- TypeScript extension backend running in Node.js/VS Code extension host
- React 18 + Vite frontend for webviews (interactive lineage graphs, model wizards, data explorer)
- dbt Core integration with manifest.json parsing
- Trino CLI integration for data catalog browsing and query execution
- Lightdash CLI integration for BI dashboards

## Common Commands

Run `npm install` first. The live source of truth for every script is `package.json`; the ones below cover day-to-day work.

| Command                                     | Purpose                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| `npm run dev`                               | Start all watchers (recommended for active development)                 |
| `npm test`                                  | Run the full Jest suite (`npm run fixtures:update` to refresh fixtures) |
| `npm run lint:all` / `npm run lint:fix:all` | Lint (or autofix) both the extension and web surfaces                   |
| `npm run compile` / `npm run compile:web`   | Build the extension / web TypeScript                                    |
| `npm run schema`                            | Regenerate TypeScript types after editing `schemas/`                    |
| `npm run format` / `npm run format:check`   | Apply / verify Prettier formatting                                      |
| `npm run package`                           | Produce the `.vsix` package                                             |

Local iteration is covered under [Development Tips](#development-tips).

## Architecture

### Dual-Architecture System

**Extension Backend (`src/`)** — TypeScript running in VS Code extension host:

- Entry point: `src/extension.ts` activates the `Coder` service
- Core orchestrator: `src/services/coder/index.ts` wires up all services
- Uses **ServiceLocator pattern** for lazy dependency injection to avoid circular dependencies

**Web Frontend (`web/`)** — React app rendered in VS Code webviews:

- Built with Vite, outputs to `dist/web`
- Pages: ModelCreate, SourceCreate, Home, QueryView, ModelRun, ModelTest, LightdashPreviewManager
- Lineage views: DataExplorer (model lineage), ColumnLineage, ModelLineage
- Message-based RPC communication with extension host
- State management with Zustand stores

**Shared Code (`src/shared/`)** — Cross-environment utilities used by both backend and frontend

### Service Architecture

Services follow a **layered architecture**:

```text
VS Code Commands & Views (UI Layer)
         ↓
Api Router (Message Bus) - src/services/api.ts
         ↓
Domain Services:
  • Framework (src/services/framework/index.ts) - JSON↔SQL/YAML sync
  • Dbt (src/services/dbt.ts) - manifest parsing, tree views
  • Trino (src/services/trino.ts) - query execution, catalog browsing
  • DataExplorer (src/services/dataExplorer.ts) - model lineage graph
  • ColumnLineage (src/services/columnLineage.ts) - column-level lineage
  • ModelLineage (src/services/modelLineage.ts) - model-level lineage
  • Lightdash (src/services/lightdash/index.ts) - BI integration
         ↓
Shared Utilities & Types (src/shared/)
```

**ServiceLocator Pattern** (`src/services/ServiceLocator.ts`):

- Breaks circular dependencies between services
- Lazy instantiation on first access via factory registration
- Type-safe access via `SERVICE_NAMES` constants
- Example:

```typescript
locator.register('dbt', () => new Dbt(locator.get('logger')));
const dbt = locator.get<Dbt>(SERVICE_NAMES.Dbt);
```

**Handler Pattern**:

- Large services split into specialized handlers
- Framework service uses handlers in `src/services/framework/handlers/`: UIHandlers, ModelDataHandlers, ModelCrudHandlers, ColumnLineageHandlers, SourceHandlers, PreferencesHandlers

### The Core Framework: JSON to SQL/YAML Sync

**Flow:**

```text
.model.json (user-editable, JSON Schema validated)
    ↓
Framework.handleJsonSync() triggers after debounce (configurable via dj.syncDebounceMs)
    ↓
SyncEngine orchestration (src/services/sync/SyncEngine.ts):
  1. Discovery - scan all .model.json files
  2. Dependency Resolution - build dependency graph (dependencyGraph.ts)
  3. Validation - validate against schemas (ValidationService.ts)
  4. Processing - ModelProcessor & SourceProcessor in dependency order
  5. Execution - generate and write SQL/YAML files (fileOperations.ts)
    ↓
.sql + .yml files (auto-generated, read-only)
```

**Key Points:**

- **JSON Schema Validation** using Ajv with 93 schemas in `schemas/`
- **Hash-based caching** (`cacheManager.ts`) to skip unchanged files
- **Batch updates** to prevent VS Code API overload
- **Rename detection** (`RenameHandler.ts`) tracks old→new file pairs
- **Manifest management** (`ManifestManager.ts`) for dbt manifest parsing
- **Sync queue** (`SyncQueue.ts`) for ordered processing

### 11 Model Types

Each model has a `type` field validated by JSON schema:

**Staging** (3 types):

- `stg_select_source` — Select from Trino source tables
- `stg_union_sources` — Union multiple sources
- `stg_select_model` — Transform staging data

**Intermediate** (6 types):

- `int_select_model` — Aggregations and business logic
- `int_join_models` — Join multiple models
- `int_join_column` — Unnest arrays/flatten complex data
- `int_union_models` — Union processed models
- `int_lookback_model` — Trailing time window analysis
- `int_rollup_model` — Roll up to higher time intervals

**Mart** (2 types):

- `mart_select_model` — Analytics-ready datasets
- `mart_join_models` — Comprehensive 360-degree views

Each type has its own schema file: `schemas/model.type.*.schema.json`

**Cross-cutting features** (applicable to multiple model types):

- **Inline CTEs** — `ctes` array on `int_select_model`, `int_join_models`, `int_union_models`, `mart_select_model`, `mart_join_models`. CTE bulk selects (`all_from_cte`, `dims_from_cte`, `fcts_from_cte`) support `exclude`/`include` filters. Plain string selects in CTEs inherit `dim`/`fct` type from the upstream model or CTE.
- **Inline subqueries** — `subquery` key in `where`, `having`, and join `on` conditions. 10 operators: `in`, `not_in`, `exists`, `not_exists`, `eq`, `neq`, `gt`, `gte`, `lt`, `lte`.
- **`from.rollup`** — Optional time-grain re-aggregation on `int_select_model` and `int_join_models` at the model level (not on marts), and on individual CTE entries (`from.model` / `from.cte` only — not on `from.source` or `from.union`). CTE-scoped rollup mirrors the model-level behavior: `datetime` is rewritten with `date_trunc(...)`, finer-grain `portal_partition_*` columns are dropped, fct columns are wrapped with their suffix-agg, and `GROUP BY <dims>` is synthesized when not authored. `exclude_datetime` / `exclude_framework_artifacts` is mutually exclusive with `from.rollup` at the same scope (model OR CTE).
- **`"dims"` shorthand** — `group_by: "dims"` is equivalent to `[{ "type": "dims" }]`; join `on: "dims"` auto-joins on all shared dimension columns.
- **Materialization shorthand** — `materialization` field accepts a string (`"incremental"` | `"ephemeral"`) or structured object with `type`, `format` (`delta_lake` | `hive` | `iceberg`), `partitions`, `strategy`, and `database`. Supplements the legacy `materialized` field.
- **Catalog-agnostic storage** — `dbt_project.yml` vars `storage_type` (`delta_lake` | `iceberg`), `etl_schema`, and `project_catalog` drive storage-specific SQL generation (e.g., `partitioned_by` for Delta vs `partitioning` for Iceberg).

### dbt Integration

**Dbt Service** (`src/services/dbt.ts`):

- Discovers dbt projects by scanning for `dbt_project.yml`
- Parses `target/manifest.json` to build in-memory maps:
  - `models: Map<string, DbtModel>` — all dbt models with dependencies
  - `sources: Map<string, DbtSource>` — all dbt sources
  - `macros: Map<string, DbtMacro>` — all dbt macros
  - `projects: Map<string, DbtProject>` — all dbt projects
- Executes dbt commands via Python virtual environment (configured in `dj.pythonVenvPath`)
- Provides tree view data for VS Code sidebar

**Python Integration:**

```typescript
const env = buildProcessEnv({ venv: '.venv' }); // Uses configured venv
spawn('dbt', ['compile', '--select', model], { env });
```

### Trino Integration

**Trino Service** (`src/services/trino.ts`):

- Executes SQL queries via Trino CLI subprocess
- Browses catalogs/schemas/tables/columns for source creation
- Provides query results to Data Explorer
- Configured via environment variables: `TRINO_HOST`, `TRINO_PORT`, `TRINO_USERNAME`, `TRINO_CATALOG`, `TRINO_SCHEMA`
- Falls back to VS Code setting `dj.trinoPath`

### Webview Communication

**Message-based RPC** between React webviews and extension host:

```typescript
// Webview sends (web/src/):
api.send({ type: 'framework-model-create', request: { projectName, type, ... } });

// Extension routes (src/services/api.ts):
switch (payload.type) {
  case 'framework-model-create': return framework.handleApi(payload);
  case 'dbt-run-model': return dbt.handleApi(payload);
  // ... routes to appropriate service
}
```

All API message types defined in `src/shared/api/types.ts` with full TypeScript safety.

### Column Lineage Engine

**ColumnLineageService** (`src/services/columnLineage.ts`):

- Traces column origins and transformations across the DAG
- Analyzes SQL expressions to classify transformations:
  - **passthrough**: `{ expr: "customer_id" }`
  - **renamed**: `{ expr: "id", name: "customer_id" }`
  - **derived**: `{ expr: "amount * quantity" }`
  - **aggregated**: `{ expr: "SUM(revenue)" }`
- Expands bulk selects like `dims_from_model`, `all_from_model`
- Builds DAG rendered in webview using React Flow

### Data Explorer / Model Lineage

**ModelLineage Service** (`src/services/modelLineage.ts`):

- Model-level dependency visualization
- Shows upstream/downstream traversal
- Uses manifest.json's dependency graph
- Renders with Dagre layout algorithm + @xyflow/react
- Layer visualization by model type (staging/intermediate/mart)

## Project Structure

Backend code lives under `src/`: entry point `src/extension.ts`, domain services under `src/services/` (each major integration is its own service or folder — `framework/`, `sync/`, `dbt.ts`, `trino.ts`, `lightdash/`, `agent/`, the lineage services), and cross-environment utilities and types under `src/shared/` (`api/`, `framework/`, `trino/`, `sql/`, `schema/types/`, etc.).

Webview code lives under `web/src/`: top-level views under `web/src/pages/`, reusable design-system primitives under `web/src/elements/`, feature bundles under `web/src/features/`, Zustand stores under `web/src/stores/`, custom hooks under `web/src/hooks/`, and React contexts under `web/src/context/`.

Supporting trees: JSON schemas under `schemas/` (regenerate types with `npm run schema`), dbt macros under `macros/`, Airflow DAG templates under `airflow/v2_7/` and `airflow/v2_10/` (dual-tree — see Pitfalls), agent skill templates under `templates/`, tests and fixtures under `tests/`, docs under `docs/`, and build output under `dist/`. Use file-search tooling for exact paths rather than relying on a snapshotted tree.

## Code Style and Conventions

### Import Aliases

**Extension Code** (tsconfig.json):

```typescript
import { log } from 'admin'; // src/admin.ts
import { Dbt } from '@services/dbt'; // src/services/dbt.ts
import { ApiMessage } from '@shared/api/types'; // src/shared/api/types.ts
import { parseModel } from '@shared/framework'; // src/shared/framework/index.ts
```

**Web Code** (web/tsconfig.json):

```typescript
import { useEnvironment } from '@web/context/environment';
import { Button } from '@web/elements/Button';
import { useModelStore } from '@web/stores/useModelStore';
```

### TypeScript Configuration

- **Target**: ES2023
- **Module**: CommonJS for extension, ESNext for web
- **Strict mode**: enabled
- Paths configured for import aliases (see above)

### Comment & Doc Style

Comments and JSDoc must be neutral, self-contained descriptions of the code as it exists. They serve both newcomers and contributors familiar with the codebase, so phrasing that references past iterations, chat threads, code reviews, or the bug that prompted a change is noise to either audience. Apply these rules:

- **No chat or review artifacts.** Don't write "the user reported …", "as discussed", "we just fixed …", or quote bug reports.
- **No before/after framing.** Avoid "used to", "previously", "this used to flash", "now updated", "has been fixed". Describe present behavior and the invariant it maintains, regardless of whether the code has shipped.
- **Cite the alternative, not the bug.** When a comment justifies a non-obvious design choice, contrast it with the alternative ("a poll here would race the in-flight RPC"), not with the prior broken version or the discussion that motivated it. Chat / review context can become a comment only when reframed as a forward-looking design rationale.
- **Prefer one sentence of intent over a paragraph of narration.** Skip restating what the code clearly does ("Set loading to true.") and only call out non-obvious why.
- **No duplicated docstrings.** If the JSDoc on a context field already says everything, don't repeat it inline at the call site.

### Web Design System & Component Authoring

- Prefer the primitives in [`web/src/elements/`](web/src/elements/) over native HTML — `Button`, `SelectSingle`, `SelectMulti`, `InputText`, `Checkbox`, `DialogBox`, `Tab`, `Alert`, `Tooltip`, `Spinner`, `Progress`, `CodeBlock`, `Text`, `Box`, `Banner`, `Switch`, `Popover`, `RadioGroup`. Reach for native `<button>` / `<select>` / `<input>` / `<dialog>` or a hand-rolled `<pre>` + `react-syntax-highlighter` only when no element fits.
- One component per file. Multi-component features use the folder-as-component pattern: a PascalCase folder named after the public component, with `index.tsx` exporting it and private siblings co-located.
- Promotion to [`web/src/elements/`](web/src/elements/) requires all three: two or more features need it, it has no domain-specific props, and its name is not feature-coined. Otherwise leave it in the feature folder.
- Renames on unreleased code are full renames — no legacy aliases or deprecation shims. Aliases are reserved for shipped public surfaces (settings keys, command IDs, schema fields, dbt macro names).

### Shared Utilities & DRY

- When the same parser / formatter / transform appears in two or more services, or in a service plus a webview, factor it into `src/shared/`. Existing exemplars: [`src/shared/sql/`](src/shared/sql/) for SQL helpers and [`src/shared/trino/types.ts`](src/shared/trino/types.ts) for cross-environment types.
- During a refactor that moves a utility, keep a small backward-compat re-export at the original location so call sites can migrate independently. Drop the re-export only after every consumer has switched.

### Test Configuration

**Jest Configuration** (jest.config.js):

- Preset: `ts-jest`
- Supports same path aliases as tsconfig.json via `moduleNameMapper`
- Test files: `**/*.test.ts`
- Ignores: `out/`, `dist/`, `.venv/`

### Commit Message Format

```text
type(scope): description
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`
Scopes: `extension`, `web`, `macros`, `schemas`, `scripts`

### Changelog — MANDATORY

> **Every PR that adds features, fixes bugs, or makes notable behavioral changes MUST include a `CHANGELOG.md` update. Do not consider a task complete until the changelog entry has been written.**

When adding features or making notable changes, update `CHANGELOG.md`:

- Always check `package.json` for the current `version` field and add entries under the matching `## <version>` heading in `CHANGELOG.md`
- If the heading for the current version doesn't exist yet, create it above the previous version
- Match the _formatting_ conventions of existing entries (`## <version>` heading, feature sub-heading, bold lead-in, no prefix labels) — but **not their length**. Several current entries are too verbose; do not treat them as a length template.
- Group related changes into a single bullet when possible
- Do not add date suffixes or create new version headings unless explicitly asked
- **Write for end users, not for reviewers.** Lead with capability ("Lets you do X") and the user-facing command / setting name. Skip internal identifiers — REST endpoint paths, API parameter names (`prefer: 'persisted' | 'rest'`), TypeScript class names, CSS / theme tokens, schema filenames — unless the user will actually type or read them.
- **Keep each bullet skim-readable.** Aim for 1–3 short sentences (~60 words). If a bullet runs longer, _trim_ it — do not split it into more bullets.
- **One bullet per user-visible capability.** Do not add a separate bullet for each implementation refinement (perf tuning, layout tweaks, internal bug fixes, robustness work); fold it into the capability it supports, or drop it. A single feature should rarely need more than 3–4 bullets.
- **Cite paths users will inspect** (e.g. `.dj/diagnostics/`, `~/.dbt/profiles.yml`, `templates/skills/<skill>/SKILL.md`) and omit paths they won't (internal source files under `src/` or `web/src/`).
- **Litmus test:** a reader skims the changelog to learn _what they can now do differently_. If a clause does not change that, cut it.

### Naming Conventions

- Classes: `PascalCase`
- Methods/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Types/interfaces: `PascalCase`
- Command IDs: `dj.command.*` via `COMMAND_ID` constants in `src/services/constants.ts`

## Key VS Code Integration Points

Commands, keybindings, and views are declared in `package.json` under `contributes.*`; handlers register against the `dj.command.*` IDs defined in [`src/services/constants.ts`](src/services/constants.ts). Read `package.json` for the full list.

- Most-used commands while iterating: `dj.command.jsonSync` (regenerate SQL/YAML), `dj.command.modelCompile`, `dj.command.modelPreview`, `dj.command.modelLineage` (Data Explorer).
- File watchers are registered in the Coder service ([`src/services/coder/index.ts`](src/services/coder/index.ts)) and react to `.model.json`, `.source.json`, `manifest.json`, and the generated `.sql` / `.yml` they produce.

## Common Workflows

### Creating a Model

1. User clicks "Create Model" in Actions view
2. Extension opens webview with ModelCreate React component
3. User fills form (project, type, group, topic, name)
4. Webview sends `framework-model-create` API message
5. Framework validates, generates `.model.json`
6. JSON sync triggers and generates `.sql` and `.yml`
7. Extension opens generated files in editor

### JSON Sync Process

1. User edits `.model.json` file
2. FileSystemWatcher detects change
3. Framework adds to `SyncQueue`
4. Debounce timer (configurable via `dj.syncDebounceMs`, default 1500ms) triggers sync
5. SyncEngine:
   - Discovers dependencies from manifest
   - Validates JSON against schema
   - Generates SQL/YAML via processors
   - Writes files in batches
6. VS Code refreshes file tree

### Column Lineage Trace

1. User opens `.model.json`, clicks "Column Lineage"
2. Extension opens Column Lineage panel (webview)
3. ColumnLineageService:
   - Parses model JSON
   - Expands bulk selects (`dims_from_model`)
   - Analyzes expressions (passthrough vs derived)
   - Recursively traces upstream columns
   - Builds DAG
4. Webview renders graph with React Flow
5. User clicks column to navigate to definition

## Development Tips

### Local Iteration

- Press `F5` to launch the Extension Development Host; `Cmd+Shift+F5` reloads after edits. `Developer: Reload Window` does a full reload.
- Build a `.vsix` with `npm run package`; install it with `code --install-extension dj-*.vsix`.
- Extension logs: View → Output → "DJ"; verbosity is controlled by the `dj.logLevel` setting (debug, info, warn, error). Webview DevTools: `Developer: Open Webview Developer Tools` from the command palette.

### Working with Services

1. Services are lazily initialized via ServiceLocator (`src/services/ServiceLocator.ts`)
2. Use `SERVICE_NAMES` constants for type-safe service access
3. Be careful with circular dependencies — use ServiceLocator to break cycles
4. Handler pattern preferred for large services (see Framework service `handlers/` directory)
5. All service API messages must be typed in `src/shared/api/types.ts`
6. **API surface discipline.** Reuse an existing per-id message in a client-side loop rather than adding a bulk endpoint when N is small (typical history lists, profile sets, model batches). Add a new message type only when the operation must be atomic on the backend, the client-side loop would create thousands of round-trips, or the operation needs filesystem / network resources the client can't reach.

### Working with Schemas

To add/modify JSON schemas:

1. Edit schema files in `schemas/`
2. Run `npm run schema` to regenerate TypeScript types
3. Types appear in `src/shared/schema/types/`
4. Update validators in Framework service if needed

### Working with Webviews

1. React code in `web/src/pages/`
2. Use `api.send()` to communicate with extension host
3. Define message types in `src/shared/api/types.ts`
4. Handle messages in appropriate service (via Api router)
5. State management with Zustand stores in `web/src/stores/`
6. Reusable components in `web/src/elements/`

### Webview UI Patterns

- **Dark-mode borders.** Use the neutral border token for card and panel surfaces; the heavy bordered `Box` variant reads too bright on dark themes.
- **Scroll containment.** Keep overflow inside tab panels and tall cards rather than letting the whole page scroll. This needs a height constraint at each level of the flex chain so the inner region — not the page — is what scrolls.
- **Layout-shift prevention.** Anchor primary actions to a fixed position and let conditionally-rendered controls fill the remaining space, so the primary action doesn't jump as controls appear and disappear.
- **Accessibility minimums.** Disabled controls must look disabled, not just behave that way — the shared `Button` variants already encode this. Use a native `title` for short tooltips and the design-system `Tooltip` for longer explanations, and pick semantic icons for actions.
- **Empty states.** When a panel has no content yet, show a brief hero — icon, one-line heading, and one sentence pointing at the next action — rather than a bare sentence.
- **Syntax highlighting.** Render code through the shared [`CodeBlock`](web/src/elements/CodeBlock.tsx) so highlighting and theme handling stay consistent; see the webview `<code>` styling pitfall before hand-rolling a highlighter.

### Webview State & Polling

- **Centralize polling.** Prefer a single shared ticker / fetch loop that consumers read from, over per-component intervals that duplicate work and race each other.
- **Optimistic UI for slow backend ops.** Reflect the user's action immediately and show an in-flight indicator until the backend confirms; reconcile on success or roll back on failure.
- **Distinguish first load from background refresh.** Show the full loading state only on the initial load; silent background refreshes should update in place without flashing a spinner.
- **Lazy-load expensive payloads.** Prefer cached or persisted reads and hit the network only on explicit user action, not on hover, tab switch, or auto-select.
- **Freeze action scope at trigger time.** When an action depends on the current selection or filters, capture its targets when it is triggered so later state changes can't silently alter what it operates on.
- **Document sentinels where they originate.** Magic values — an empty id meaning "clear selection", a negative index meaning "append" — belong in a comment at the producing site, not only in the consumer.

### Working with Tests

- CTE, subquery, partition, and storage-type code paths are high-regression zones — always add or update tests when modifying these areas. Tests live in `src/services/framework/__tests__/`.
- Run `npm test` before submitting changes to SQL generation or schema validation code.
- **Pre-submit verification.** Before considering work done, run all four pipelines and confirm zero new errors: `npm run lint:web`, `npm run compile:web`, `npm run compile`, `npm test`. Pre-existing warnings unrelated to the change may remain; new errors or warnings on the change must not.
- **Pair fixes with regression tests.** Every parser / SQL-generator / schema-validator / sanitizer fix lands with a regression test in the same change.
- **Don't double-test composed paths.** A bulk operation that loops a tested per-id call doesn't need its own end-to-end test — cover the per-id path and trust composition.

### File System Operations

- Extension writes files via VS Code workspace API (atomic updates)
- Batch updates to prevent API overload
- Hash-based caching to skip unchanged files
- Always use absolute paths from `admin.WORKSPACE_ROOT`

## Development Pitfalls & Patterns

### Airflow Dual-Tree Rule

- `airflow/v2_7/` and `airflow/v2_10/` are **mirrors** — fixes and changes must be applied to **both** directories.

### JSONC Comment Preservation

- Standard `JSON.stringify` strips comments. Any code path that writes `.model.json` files must use JSONC-aware handling (e.g., `jsonc-parser`) to preserve user comments.

### Diagnostics Lifecycle

- Validation entries in the VS Code Problems tab must be **explicitly cleared** when the underlying issue is fixed. Any work on validation should consider when diagnostics are set and cleared to avoid stale entries.

### Storage-Type Branching

- Partitioning keyword depends on storage format: **Iceberg uses `partitioning: ARRAY[...]`** while **Delta Lake / Hive uses `partitioned_by: ARRAY[...]`**. The switch happens in `frameworkGenerateModelOutput` (`sql-utils.ts`) based on `materialization.format` or the project var `storage_type`.
- Incremental strategy resolution (`frameworkGenerateModelOutput` in `sql-utils.ts`): per-model `materialization.strategy.type` → legacy top-level `incremental_strategy` → extension default via `dj.config.materializationDefaultIncrementalStrategy` → shared constant `DEFAULT_INCREMENTAL_STRATEGY` in `src/shared/framework/constants.ts` (currently `overwrite_existing_partitions`; planned to switch to `delete+insert` in a future release). Five strategy types are supported: `append`, `delete+insert`, `merge` (Iceberg-only in dbt-trino), `overwrite_existing_partitions` (consumer macro required), and `dj_iceberg_partition_overwrite` (Iceberg-only; DJ ships the dispatch macro `get_incremental_dj_iceberg_partition_overwrite_sql` via `macros/strategies.sql`, auto-copied to `<project>/macros/_ext_/strategies.sql` by `writeMacroFiles` in `dbt.ts`). The Iceberg requirement for `dj_iceberg_partition_overwrite` is enforced by `validateDjIcebergPartitionOverwrite` in `src/services/modelValidation.ts`, surfaced as a Problems-tab error via `ModelProcessor`. To change the factory default, update the shared constant **and** the `default` field for `dj.materialization.defaultIncrementalStrategy` in `package.json` in lockstep. All other fallback sites (`config.ts`, `preferences-handler.ts`, `sql-utils.ts`, web store, web mock api) already route through the shared constant.
- When touching `getMaterializationProp`, `getDefaultUniqueKey`, or the strategy switch in `sql-utils.ts`, run the materialization shorthand tests in `src/services/framework/__tests__/index.test.ts` against both Iceberg and Delta/Hive paths.

### `FrameworkColumn.meta` vs `FrameworkColumn.internal` Split

- `FrameworkColumn` has two buckets: `meta` (user-facing, lands verbatim in the emitted YAML) and `internal` (framework-private SQL-generation state, never emitted).
- SQL-internal keys — `agg`, `aggs`, `expr`, `prefix`, `exclude_from_group_by`, `interval`, `override_suffix_agg` — live on `column.internal.*`. Always read/write these there; reading them off `column.meta` will silently fail.
- `frameworkInheritColumn` replaces `internal` wholesale on the descendant column and deep-merges `meta`. Don't propagate upstream SQL-gen state by accident when adding new inheritance paths.
- Free-form user keys under `meta` are stripped at emit time if they collide with a framework-reserved name (see `COLUMN_META_SQL_INTERNAL_RESERVED_KEYS` / `COLUMN_META_POPULATED_RESERVED_KEYS` in `meta-lint.ts`). The reserved-key lint surfaces these collisions as Warning diagnostics.
- The invariant "SQL-internal keys never appear in emitted `columns[].meta`" is guarded by a regression test in `model-meta.test.ts` — keep it passing when adding new column-processing paths.

### Lightdash Global `sql_filter` Default

- The lightdash table-level `sql_filter` resolution lives in `frameworkModelProperties` (`sql-utils.ts`, near the `// Add model level lightdash meta` block). Precedence is: explicit string on `lightdash.table.sql_filter` → explicit `null` (disable) → `dj.config.lightdashDefaultSqlFilter` (only if every entry in `dj.config.lightdashDefaultSqlFilterRequiredColumns` is present on the model). Models without a `lightdash` block are never filtered.
- `lightdash.table.sql_filter` accepts `string | null` per the schema in `schemas/lightdash.table.schema.json`; `null` means "explicitly disable, ignore the global default".
- When changing the precedence rules, update the `lightdash global sql_filter default` describe block in `src/services/framework/__tests__/index.test.ts` (covers all six branches).

### Extension-Host Errors Across `postMessage`

- Errors thrown in the extension host cross the `postMessage` boundary as structured-cloned plain objects, so on the webview side they are not `Error` instances — naive `String(err)` or `err.message` rendering can show `[object Object]` or nothing.
- When a webview displays an error returned from an `api.send()` / `api.post()` call, normalize it to a readable string at the boundary (handle `Error`-shaped objects, plain strings, and `{ message }` shapes) before showing or logging it.

### VS Code Webview `<code>` / `<pre>` Styling

- The webview ships default styling for `<code>` / `<pre>` (background, padding, border) that bleeds through `react-syntax-highlighter` and tints lines and tokens in both themes. [`web/src/main.css`](web/src/main.css) neutralizes it for the existing highlighted surfaces via per-wrapper override rules.
- Render code through the shared [`CodeBlock`](web/src/elements/CodeBlock.tsx) so it inherits this treatment. If you add a new highlighted surface, extend the existing override rather than restyling ad hoc — and when you do, reset only the box styles (background / padding / border) and leave `color` alone, since the highlighter sets token colors inline on the spans.

## Configuration

### Extension Settings (dj.\*)

The full settings reference is [`docs/SETTINGS.md`](docs/SETTINGS.md); the live source of truth for names, types, and defaults is `package.json` under `contributes.configuration`. Settings with non-obvious behavior are documented where that behavior lives: `dj.materialization.defaultIncrementalStrategy` under [Storage-Type Branching](#storage-type-branching), and `dj.lightdash.defaultSqlFilter` / `dj.lightdash.defaultSqlFilterRequiredColumns` under [Lightdash Global `sql_filter` Default](#lightdash-global-sql_filter-default).

### Environment Variables

**Trino Connection:**

```bash
TRINO_HOST=your-trino-host
TRINO_PORT=8080                    # 443 for Starburst Galaxy
TRINO_USERNAME=your-username
TRINO_CATALOG=your-catalog
TRINO_SCHEMA=your-schema
```

**Lightdash (optional):**

```bash
LIGHTDASH_URL=your-lightdash-url
LIGHTDASH_PREVIEW_NAME=your-preview-name
LIGHTDASH_PROJECT=your-project-uuid
LIGHTDASH_TRINO_HOST=host.docker.internal  # Trino host override for Docker
```

## AI Agent Integration

When `dj.codingAgent` is `true`, the extension generates a project-tailored `AGENTS.md` at `.agents/dj/AGENTS.md` and copies agent-agnostic skill directories from [`templates/`](templates/) to `.agents/skills/` at workspace activation, following the [Agent Skills](https://agentskills.io) open standard (each skill is a folder with a `SKILL.md`). The agent code lives in [`src/services/agent/`](src/services/agent/); skill files are written by the Dbt service.

## Additional Resources

- **README.md** — User-facing documentation and setup guide
- **DEVELOPMENT_SETUP.md** — Detailed development environment setup
- **CONTRIBUTING.md** — Contribution guidelines and code standards
- **CHANGELOG.md** — Release history
- **ROADMAP.md** — Future plans
- **docs/** — Complete documentation including tutorials and examples
- **docs/models/README.md** — Detailed reference for all 11 model types
- **docs/SETTINGS.md** — Full settings reference
