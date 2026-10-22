#!/bin/bash
# Builds the release tarball that install.sh downloads: macviz, the built page and the launcher.
# Usage: scripts/package.sh, then upload dist/siliconsight-macos-arm64.tar.gz to a GitHub release.
set -euo pipefail
cd "$(dirname "$0")/.."

npm --prefix web ci
npm --prefix web run build
swift build -c release --package-path reader
bin="$(swift build -c release --package-path reader --show-bin-path)/macviz"

stage="$(mktemp -d)/siliconsight"
mkdir -p "$stage"
cp "$bin" "$stage/macviz"
cp -R web/dist "$stage/web"
cp scripts/siliconsight "$stage/siliconsight"
cp LICENSE NOTICE "$stage/"
"$stage/macviz" --selftest

mkdir -p dist
tar -czf dist/siliconsight-macos-arm64.tar.gz -C "$stage" .
echo "wrote dist/siliconsight-macos-arm64.tar.gz"
