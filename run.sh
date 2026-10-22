#!/usr/bin/env bash
# Build what is missing and start macviz. Usage: ./run.sh [--no-open] [macviz flags such as --port 7979]
set -euo pipefail
cd "$(dirname "$0")"

die() { echo "$*" >&2; exit 1; }

[[ "$(uname -s)" == Darwin && "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" == 1 ]] || die "macviz needs Apple Silicon"
[[ "$(uname -m)" == arm64 ]] || die "macviz needs Apple Silicon (this terminal runs under Rosetta; open a native one)"
command -v swift >/dev/null || die "swift not found. Install Xcode or the Command Line Tools: xcode-select --install"
command -v npm >/dev/null || die "npm not found. Install Node.js 20.19+ or 22.12+ from https://nodejs.org"

open_browser=1
args=()
port=7878
while (($#)); do
  case "$1" in
    --no-open) open_browser=0 ;;
    --port) args+=("$1" "${2:-}"); port="${2:-}"; shift ;;
    --port=*) args+=("$1"); port="${1#--port=}" ;;
    *) args+=("$1") ;;
  esac
  shift
done

if [[ ! -f web/dist/index.html ]] ||
   [[ -n "$(find web/src docs/learn web/index.html web/package.json web/vite.config.ts -newer web/dist/index.html -print -quit 2>/dev/null)" ]]; then
  echo "building web app..."
  [[ -d web/node_modules ]] || npm --prefix web ci
  npm --prefix web run build
fi

echo "building reader..."
swift build -c release --package-path reader
bin="$(swift build -c release --package-path reader --show-bin-path)/macviz"

# Something already answering would get the browser tab, so refuse before starting.
if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$port/"; then
  die "port $port is already in use, maybe by another macviz. Stop it or pass --port <n>."
fi

if ((open_browser)); then
  # Waits for the port, then opens the page. $$ becomes macviz below, so this stops if macviz exits.
  (
    for _ in $(seq 1 100); do
      kill -0 $$ 2>/dev/null || exit 0
      if curl -sf -o /dev/null "http://127.0.0.1:$port/"; then open "http://127.0.0.1:$port/"; exit 0; fi
      sleep 0.2
    done
  ) &
fi

echo "press Ctrl-C to stop"
exec "$bin" ${args[@]+"${args[@]}"}
