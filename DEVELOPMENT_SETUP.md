# Development Setup

This guide covers setting up your development environment for contributing to the DJ (Data JSON) Framework VS Code extension.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Extension Development Setup](#extension-development-setup)
- [Private npm registry](#private-npm-registry)
- [Development Scripts](#development-scripts)
- [Debugging](#debugging)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Getting Help](#getting-help)
- [Next Steps](#next-steps)

## Prerequisites

### General Environment

For general environment setup (Trino, Java, dbt, etc.), see the **[Setup Guide](docs/setup/setup.md)**.

### Development Tools

For development, you'll also need:

<!-- https://nodejs.org/en/about/previous-releases#looking-for-the-latest-release-of-a-version-branch  -->

- **Node.js** (v22.22+ or v24.x LTS recommended)
- **npm** (10.x or higher)
- **VS Code** (version 1.87.0 or higher)

### Extension Development Setup

1. **Clone and install dependencies:**

```bash
git clone https://github.com/Workday/dj.git
cd dj
npm ci
```

`npm ci` installs the tree pinned in `package-lock.json`. Use `npm install <pkg>` only when adding or updating a dependency.

### Private npm registry

`package-lock.json` records each tarball as `https://registry.npmjs.org/...` plus a sha512 `integrity`. The committed [`.npmrc`](.npmrc) sets `replace-registry-host=npmjs` and does not set `registry`. npm then fetches those URLs from whatever registry is already configured, and only for this repo.

Internal clones pick up Artifactory from `~/.npmrc`, because npmjs is blocked there. External clones use the public registry, or whatever registry they configured. Other internal repos do not have this file, so they keep committing Artifactory URLs. A `registry=` line in this `.npmrc` would override `~/.npmrc` and must not be added.

Use npm 10.9.x, or npm 11.4.1 or newer. npm 11.0.0 through 11.3.0 drops the mirror path prefix (`/artifactory/api/npm/<repo>/`) and the install 404s.

Install the locked tree with `npm ci`. The request goes to the mirror; the lockfile is not rewritten.

To add or update a dependency while the mirror is the configured registry:

```bash
npm install <pkg>
npm ci
```

`npm install` runs `lockfile:normalize` when it finishes. That reads `npm_config_registry` and rewrites matching `resolved` URLs back to `https://registry.npmjs.org/`. It leaves `integrity` unchanged. On the public registry it exits without editing the file.

You do not have to remember that command. `npm ci` also sets `core.hooksPath` to `.githooks`. The pre-commit hook runs the same normalize when `package-lock.json` is staged, then refuses the commit if a tarball URL still uses another host. CI runs `npm run lockfile:check` on every pull request, which is what catches a commit made with `--no-verify` or an install run with `--ignore-scripts`.

`npm run lockfile:normalize` is the same step, if you want to run it by hand. The follow-up `npm ci` confirms the rewritten URL still resolves through the mirror and the sha512 matches.

This depends on the mirror serving the original public tarball. If it repacks packages, GitHub `npm ci` fails the integrity check, and that lockfile update has to be generated somewhere the public registry is reachable. If the mirror is an allowlist, the package has to be available there before `npm install`.

### Running the Extension Locally

#### Method 1: Extension Development Host (Recommended for development)

1. Open the project in VS Code
2. Start development watchers (optional, for auto-rebuild):

   ```bash
   npm run dev
   ```

3. Press `F5` to launch Extension Development Host
4. Open a dbt project in the new VS Code window
5. Make changes and press `Cmd+Shift+F5` to reload

#### Method 2: Package and Install

1. Build and package the extension:

   ```bash
   npm run package # This will automatically run vscode:prepublish beforehand
   ```

2. Install the generated VSIX file:

   ```bash
   code --install-extension dj-*.vsix
   ```

### Development Scripts

| Command                   | Purpose                                     |
| ------------------------- | ------------------------------------------- |
| `npm run dev`             | Start all watchers (TypeScript, web, tests) |
| `npm run watch:esbuild`   | Watch and rebuild extension JS with esbuild |
| `npm run watch:test`      | Watch and run tests                         |
| `npm run watch:tsc`       | Watch TypeScript compilation (extension)    |
| `npm run watch:web-build` | Watch and build web assets (Vite build)     |
| `npm run watch:web-tsc`   | Watch TypeScript compilation (web)          |

### Debugging

- **Extension logs**: View → Output → "DJ"
- **Reload extension**: `Cmd+Shift+F5` in Extension Development Host
- **Webview debugging**: Developer → Open Webview Developer Tools
- **Full reload**: Developer → Reload Window

## Making Changes

### Project Structure

The root folder's `package.json` contains configuration read by Microsoft's Visual Studio Code Extension Manager (vsce). The `README.md` and `CHANGELOG.md` will be rendered within VSCode as part of the extension description.

- Root

  - `src/` — Extension source (TypeScript)
  - `web/` — Vite React app rendered in VS Code webviews
  - `macros/` — SQL macros shipped and written into the active dbt project
  - You can change where macros are written using the VS Code setting `dj.dbtMacroPath`. This is a subfolder relative to the `macro-paths` defined in your project's `dbt_project.yml`.
  - `schemas/` — JSON Schemas used for validation and TS type generation
  - `tests/` — Test files and fixtures
    - `fixtures/` — Test fixtures and reference data
    - `update-fixtures.ts` — Script to generate test fixtures from dbt projects
  - `scripts/` — Build and utility scripts
  - `dist/` — Built extension (`dist/extension`) and web assets (`dist/web`)

- `src/`

  - `extension.ts` — Extension activation/deactivation entry
  - `admin.ts` — VS Code platform helpers (e.g., `WORKSPACE_ROOT`, `runProcess`, schema/sql paths, `IS_LOCAL` handling)
  - `services/`
    - `api.ts` — Routes API messages to services
    - `coder.ts` — Core controller: wiring, commands, file watching, webview messaging
    - `dbt.ts` — dbt project discovery, manifest parsing, tree views, hovers
    - `framework.ts` — JSON↔SQL/YML sync logic, validation, webview-backed create flows
    - `lightdash.ts` — Preview command integration
    - `trino.ts` — Trino queries, tree view, query view wiring
  - `shared/` — Cross-environment utilities and types (`api/`, `coder/`, `dbt/`, `framework/`, `git/`, `sql/`, `trino/`, `web/`)
  - `shared/schema/types/` — Generated from `schemas/` via `npm run schema`

- `web/`

  - Vite app (React 18). Output is configured in `web/vite.config.ts` to `../dist/web` (`assets/main.js`, `assets/main.css`)
  - Key dirs: `context/`, `elements/`, `forms/`, `pages/`, `styles/`

- `schemas/`

  - Authoritative JSON Schemas for `.model.json` / `.source.json`
  - Regenerate TS types with `npm run schema`

- `macros/`

  - Macro files copied into the active dbt project on activation so dbt resolves them

## Testing

### TypeScript Tests

Run the test suite:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run watch:test
```

### Updating Test Fixtures

To update test fixtures with new reference data:

```bash
npm run fixtures:update
```

## Getting Help

- **Contributing Guidelines**: See [CONTRIBUTING.md](CONTRIBUTING.md) for pull request process
- **GitHub Issues**: Report bugs or request features
- **GitHub Discussions**: Ask questions and get help from the community
- **Documentation**: Check [docs/](docs/) for user guides and API documentation

## Next Steps

Once your development environment is set up:

1. **Read the [Contributing Guidelines](CONTRIBUTING.md)** for code standards and submission process
2. **Explore the codebase** - start with `src/extension.ts` for the main entry point
3. **Run the tests** to ensure everything is working
4. **Make your changes** and test thoroughly
5. **Submit a pull request** following our guidelines

---

**Ready to contribute?** Check out [CONTRIBUTING.md](CONTRIBUTING.md) for the complete contribution workflow!
