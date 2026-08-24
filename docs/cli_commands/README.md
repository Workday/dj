# DJ CLI bridge (`.dj/bin/dj`)

A thin command-line entry point that lets a terminal or an AI agent invoke DJ
operations **against the running VS Code extension**, reusing the exact same
logic the webview UI uses (`Api.handleApi`). No feature logic is reimplemented in
the CLI — it is a second transport into the extension.

> **Status:** 27 operations across four tiers — Read, Authoring, Mutate, and
> Query & data (plus `system.ping` / `system.capabilities`). macOS/Linux only.
> Requires VS Code running with the DJ extension active on the workspace.

## Documentation

- [`command-reference.md`](command-reference.md) — the full command scope, request
  shapes, and token/accuracy rationale.
- [`agent-verification-prompts.md`](agent-verification-prompts.md) — copy-paste
  prompts to verify **every** command with an AI agent directly.
- [`phase-1-plan.md`](phase-1-plan.md) — the operation plan and what remains deferred.

## How it works

```
terminal / agent
   │  .dj/bin/dj model.create --file req.json
   ▼
dj  (standalone Node bundle, vscode-free)     reads endpoint descriptor + token
   │  JSON-RPC over a Unix domain socket (newline-delimited)
   ▼
CliBridgeServer  (inside the extension host)  token auth → operation allowlist
   ▼
Api.handleApi({ type: 'framework-model-create', request })   ← existing, unchanged
   ▼
writes  models/<layer>/<group>/<topic>/<layer>__<group>__<topic>__<name>.model.json
```

On activation the extension:

1. copies the bundled CLI (`dist/cli/dj.js`) to the workspace at `.dj/bin/dj`
   (executable), and
2. starts a per-session socket, writing an endpoint descriptor to
   `.dj/state/cli-endpoints/<sessionId>.json` (mode `0600`) containing the socket
   path and a random auth token. `.dj` is gitignored, so the token is never
   committed.

The CLI discovers the workspace by walking up from `--workspace` (or the current
directory) to `.dj/state/cli-endpoints/`, then picks the newest descriptor whose
`system.ping` succeeds (stale descriptors from crashed windows are skipped, and
reaped on the next activation).

## Usage

```bash
# liveness / version
.dj/bin/dj system.ping

# list the operations this bridge exposes
.dj/bin/dj system.capabilities

# create a model from a request file (see examples/model-create.request.json)
.dj/bin/dj model.create --file examples/model-create.request.json

# or pipe the request in
cat req.json | .dj/bin/dj model.create
```

Flags: `--file <path>` · `--json '<inline json>'` · `--workspace <dir>` ·
`--timeout <ms>`. Input may also be supplied on stdin.

## `model.create` request

The input is `{ "request": <framework-model-create request> }` — the same object
the Create Model form posts. Minimal `stg_select_source` example:

```json
{
  "request": {
    "type": "stg_select_source",
    "projectName": "analytics",
    "group": "core",
    "topic": "sales",
    "name": "customers",
    "from": { "source": "raw__public.customers" },
    "select": [{ "name": "id", "type": "dim" }, { "name": "name" }]
  }
}
```

- **`projectName` is optional** — when the workspace has exactly one dbt project
  it is inferred; with several projects, it is required (the error lists the
  available names).
- **`group`** must be a group already registered in the target dbt project, and
  **`from.source`** must reference an existing source. Path is framework-derived
  from `type` + `group` + `topic` + `name` — never chosen by the caller.
- Field shapes are the per-type model schemas under `.dj/schemas/` (identical to
  what you author by hand in a `.model.json`).

On success the model file is written and opened in the editor; the CLI prints the
result JSON and exits `0`.

## Exit codes

| Code | Meaning                                             |
| ---- | --------------------------------------------------- |
| `0`  | success                                             |
| `1`  | operation error (e.g. "Model … already exists")     |
| `2`  | usage / malformed input JSON                        |
| `3`  | no live DJ endpoint (VS Code not running / DJ off)  |
| `4`  | timed out waiting for a reply                       |

## Constraints & notes

- **VS Code must be running** with DJ active — the CLI is a client of the live
  extension, not a headless runtime.
- **macOS/Linux only** for now; the bridge no-ops on Windows (named-pipe
  transport is a later task).
- **Multiple windows** on the same workspace each publish a descriptor; the CLI
  targets the newest one that answers `system.ping`.
- Deep, schema-level input validation is a fast-follow; today the downstream
  handler enforces model rules and surfaces failures as a `1` exit.
