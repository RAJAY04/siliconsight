#!/bin/bash
# Installs SiliconSight from the latest GitHub release into ~/.siliconsight and starts it.
# Needs an Apple Silicon Mac on macOS 14 or later. No sudo, Xcode or Node.js.
set -euo pipefail

die() { echo "$*" >&2; exit 1; }

# Everything runs inside main, called on the last line, so a download cut off halfway runs nothing.
main() {
  local repo="RAJAY04/siliconsight"
  local dir="$HOME/.siliconsight"

  [[ "$(uname -s)" == Darwin ]] || die "SiliconSight runs on macOS only"
  [[ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" == 1 ]] || die "SiliconSight needs an Apple Silicon Mac (M1 or later)"
  local major
  major="$(sw_vers -productVersion | cut -d. -f1)"
  ((major >= 14)) || die "SiliconSight needs macOS 14 or later, this Mac has $(sw_vers -productVersion)"

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  echo "downloading SiliconSight..."
  curl -fsSL "https://github.com/$repo/releases/latest/download/siliconsight-macos-arm64.tar.gz" -o "$tmp/s.tgz"
  rm -rf "$dir"
  mkdir -p "$dir"
  tar -xzf "$tmp/s.tgz" -C "$dir"
  echo "installed to $dir. To remove it: rm -rf $dir"

  # exec replaces this shell, so the EXIT trap never fires; clean up first.
  rm -rf "$tmp"
  exec "$dir/siliconsight"
}

main "$@"
