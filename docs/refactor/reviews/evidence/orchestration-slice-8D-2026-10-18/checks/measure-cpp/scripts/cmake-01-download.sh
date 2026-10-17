#!/usr/bin/env bash
# Download CMake 3.30.5 source tarball + official SHA-256 list, verify, extract.
set -euo pipefail
ROOT="$HOME/dsh-work/measure-cpp"
D="$ROOT/downloads/cmake-3.30.5"
mkdir -p "$ROOT/downloads" "$ROOT/copies" "$ROOT/build" "$ROOT/results" "$ROOT/fixtures"
if [ -e "$D" ] && [ -n "$(ls -A "$D" 2>/dev/null)" ]; then
  echo "ABORT: $D exists and is not empty"; ls -la "$D"; exit 2
fi
mkdir -p "$D"
cd "$D"
BASE=https://github.com/Kitware/CMake/releases/download/v3.30.5
curl -fL --proto '=https' --tlsv1.2 --retry 2 -o cmake-3.30.5.tar.gz "$BASE/cmake-3.30.5.tar.gz"
curl -fL --proto '=https' --tlsv1.2 --retry 2 -o cmake-3.30.5-SHA-256.txt "$BASE/cmake-3.30.5-SHA-256.txt"
ls -la
echo "--- SHA file line for tarball:"
LINE=$(grep -E '[[:space:]]cmake-3\.30\.5\.tar\.gz$' cmake-3.30.5-SHA-256.txt || true)
echo "$LINE"
EXPECTED=$(echo "$LINE" | awk '{print $1}')
ACTUAL=$(sha256sum cmake-3.30.5.tar.gz | awk '{print $1}')
echo "expected=$EXPECTED"
echo "actual  =$ACTUAL"
if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "CHECKSUM MISMATCH OR MISSING - STOP"; exit 3
fi
echo "CHECKSUM OK"
# Extract inside the download dir; refuse absolute paths / .. members.
if tar -tzf cmake-3.30.5.tar.gz | grep -qE '(^/|(^|/)\.\.(/|$))'; then
  echo "UNSAFE MEMBER PATHS - STOP"; exit 4
fi
tar --no-same-owner --no-same-permissions -xzf cmake-3.30.5.tar.gz
ls -la
du -sh cmake-3.30.5
