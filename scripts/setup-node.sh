#!/usr/bin/env bash
# Install Node.js 22 LTS into ./.tools/node (no sudo, nothing outside the project).
# The tarball is verified against nodejs.org's published SHA-256 checksums.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -x .tools/node/bin/node ]; then echo "Node $(.tools/node/bin/node --version) already installed in .tools/node"; exit 0; fi
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) plat=darwin-arm64 ;;
  Darwin-x86_64) plat=darwin-x64 ;;
  Linux-x86_64) plat=linux-x64 ;;
  Linux-aarch64) plat=linux-arm64 ;;
  *) echo "Unsupported platform $(uname -s)-$(uname -m); install Node 22 manually" >&2; exit 1 ;;
esac
base=https://nodejs.org/dist/latest-v22.x
line=$(curl -fsSL "$base/SHASUMS256.txt" | grep -E "node-v[0-9.]+-${plat}\.tar\.gz$")
sum=${line%% *}; file=${line##* }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
curl -fsSL -o "$tmp/$file" "$base/$file"
echo "$sum  $tmp/$file" | shasum -a 256 -c -
mkdir -p .tools && tar -xzf "$tmp/$file" -C .tools && mv ".tools/${file%.tar.gz}" .tools/node
echo "Installed $(.tools/node/bin/node --version) into .tools/node"
