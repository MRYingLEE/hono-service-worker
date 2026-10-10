#!/usr/bin/env bash
# Build the JavaScript kernel extension, then build a JupyterLite site from it.
#
# Usage: scripts/build-lite.sh [--skip-extension]
#
#   --skip-extension  reuse the existing extension build and only rebuild the site
#
# Environment overrides:
#   VENV             virtualenv that provides jupyter and jlpm (default: <repo>/.venv)
#   LITE_CONTENTS    folder of notebooks to include, relative to the repo (default: examples)
#   LITE_OUTPUT_DIR  where the site is written (default: <repo>/_output)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${VENV:-$REPO_ROOT/.venv}"
LITE_CONTENTS="${LITE_CONTENTS:-examples}"
LITE_OUTPUT_DIR="${LITE_OUTPUT_DIR:-$REPO_ROOT/_output}"
EXT_DIR="$REPO_ROOT/packages/javascript-kernel-extension"
SKIP_EXTENSION=0

for arg in "$@"; do
  case "$arg" in
    --skip-extension) SKIP_EXTENSION=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [[ ! -x "$VENV/bin/jupyter" ]]; then
  echo "No usable virtualenv at $VENV." >&2
  echo "Create one with: python -m venv .venv && .venv/bin/pip install -e '.[dev]'" >&2
  exit 1
fi

# The extension's build scripts call jupyter-builder by name, so they need the venv on PATH.
export PATH="$VENV/bin:$PATH"

if [[ "$SKIP_EXTENSION" -eq 0 ]]; then
  echo "==> Building the extension (TypeScript and labextension)"
  (cd "$EXT_DIR" && "$VENV/bin/jlpm" build)

  # `jupyter lite build` copies the labextension from the virtualenv, not from the repo,
  # so refresh that copy or the site keeps the previous bundle.
  LAB_SRC="$REPO_ROOT/jupyterlite_javascript_kernel/labextension"
  LAB_DST="$VENV/share/jupyter/labextensions/@jupyterlite/javascript-kernel-extension"
  echo "==> Syncing labextension to $LAB_DST"
  rm -rf "$LAB_DST"
  mkdir -p "$(dirname "$LAB_DST")"
  cp -r "$LAB_SRC" "$LAB_DST"
fi

CONTENTS_ARGS=()
if [[ -n "$LITE_CONTENTS" ]]; then
  CONTENTS_ARGS=(--contents "$LITE_CONTENTS")
fi

echo "==> Building the JupyterLite site into $LITE_OUTPUT_DIR"
"$VENV/bin/jupyter" lite build \
  --lite-dir "$REPO_ROOT" \
  "${CONTENTS_ARGS[@]}" \
  --output-dir "$LITE_OUTPUT_DIR"

echo "==> Done. Run scripts/serve-lite.sh to serve the site."
