#!/usr/bin/env bash
# Serve a JupyterLite site built by scripts/build-lite.sh.
#
# Usage: scripts/serve-lite.sh
#
# Environment overrides:
#   VENV             virtualenv that provides jupyter (default: <repo>/.venv)
#   LITE_OUTPUT_DIR  built site to serve (default: <repo>/_output)
#   LITE_PORT        port to listen on (default: 8000)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${VENV:-$REPO_ROOT/.venv}"
LITE_OUTPUT_DIR="${LITE_OUTPUT_DIR:-$REPO_ROOT/_output}"
LITE_PORT="${LITE_PORT:-8000}"

if [[ ! -x "$VENV/bin/jupyter" ]]; then
  echo "No usable virtualenv at $VENV. Run scripts/build-lite.sh first." >&2
  exit 1
fi

if [[ ! -f "$LITE_OUTPUT_DIR/index.html" ]]; then
  echo "No built site in $LITE_OUTPUT_DIR. Run scripts/build-lite.sh first." >&2
  exit 1
fi

echo "==> Serving $LITE_OUTPUT_DIR"
echo "    Lab:      http://localhost:$LITE_PORT/lab/index.html"
echo "    Notebook: http://localhost:$LITE_PORT/notebooks/index.html?path=cell-defined-routes.ipynb"
echo "    Press Ctrl+C to stop."
exec "$VENV/bin/jupyter" lite serve \
  --lite-dir "$REPO_ROOT" \
  --output-dir "$LITE_OUTPUT_DIR" \
  --port "$LITE_PORT"
