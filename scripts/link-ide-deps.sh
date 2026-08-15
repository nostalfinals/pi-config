#!/usr/bin/env bash
# Link pi's globally installed npm packages into this repo's node_modules/
# so VS Code / IDEA can resolve @earendil-works/*, typebox and @types/node
# for indexing and IntelliSense when editing ./extensions.
#
# Re-run this script after `pi` itself or the node runtime (mise) is upgraded,
# because the global install path contains the node version.
set -euo pipefail

PI_BIN="$(readlink -f "$(command -v pi)")"      # .../bin/pi -> .../dist/cli.js
PKG_DIR="$(dirname "$(dirname "$PI_BIN")")"    # .../node_modules/@earendil-works/pi-coding-agent

if [[ ! -f "$PKG_DIR/package.json" ]]; then
  echo "error: cannot locate the pi package (resolved to $PKG_DIR)" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NM="$REPO_ROOT/node_modules"
mkdir -p "$NM/@earendil-works" "$NM/@types"

link() { ln -sfn "$1" "$2" && echo "linked $2 -> $1"; }

link "$PKG_DIR" "$NM/@earendil-works/pi-coding-agent"
for sub in pi-tui pi-ai pi-agent-core pi-client pi-protocol; do
  link "$PKG_DIR/node_modules/@earendil-works/$sub" "$NM/@earendil-works/$sub"
done
link "$PKG_DIR/node_modules/typebox" "$NM/typebox"
link "$PKG_DIR/node_modules/@types/node" "$NM/@types/node"

echo
echo "done. Open $REPO_ROOT in VS Code / IDEA; indexing should now resolve pi packages."
