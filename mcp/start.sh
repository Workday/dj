#!/bin/zsh
# Launch DJ MCP inheriting TRINO_PASSWORD from the user's shell env.
# Passwords stay in env only — never in DJ_MCP_CONFIG JSON.
set -euo pipefail

# Load interactive/login env that Cursor GUI does not inherit.
[[ -f "$HOME/.zprofile" ]] && source "$HOME/.zprofile"
[[ -f "$HOME/.zshrc" ]] && source "$HOME/.zshrc"

# Sensible defaults if not set in the shell profile.
export DJ_DBT_PATH="${DJ_DBT_PATH:-$HOME/.dj-mcp/venv/bin/dbt}"
export DBT_PROFILES_DIR="${DBT_PROFILES_DIR:-$HOME/.dj-mcp/mirrors/project-c}"
export DJ_DBT_PROFILES_DIR="${DJ_DBT_PROFILES_DIR:-$DBT_PROFILES_DIR}"

ROOT="$(cd "$(dirname "$0")" && pwd)"
exec node "$ROOT/dist/server.js"
