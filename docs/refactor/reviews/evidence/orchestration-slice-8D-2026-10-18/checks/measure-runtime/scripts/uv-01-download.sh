#!/usr/bin/env bash
# libuv 1.48.0: download ONLY the approved release tarball into its own new empty directory, record SHA-256 and size,
# check member paths, extract.  Nothing from the tarball is executed.
set -euo pipefail
ROOT="$HOME/dsh-work/measure-runtime"
D="$ROOT/src/libuv"
R="$ROOT/results/libuv"
mkdir -p "$ROOT/src" "$ROOT/build" "$R"
if [ -e "$D" ] && [ -n "$(ls -A "$D" 2>/dev/null)" ]; then
  echo "ABORT: $D exists and is not empty"; ls -la "$D"; exit 2
fi
mkdir -p "$D"
cd "$D"
URL1=https://dist.libuv.org/dist/v1.48.0/libuv-v1.48.0.tar.gz
URL2=https://github.com/libuv/libuv/archive/refs/tags/v1.48.0.tar.gz
if curl -fL --proto '=https' --tlsv1.2 --retry 2 -o libuv-v1.48.0.tar.gz "$URL1"; then
  echo "source_url=$URL1" | tee "$R/download.txt"
else
  rm -f libuv-v1.48.0.tar.gz
  curl -fL --proto '=https' --tlsv1.2 --retry 2 -o libuv-v1.48.0.tar.gz "$URL2"
  echo "source_url=$URL2" | tee "$R/download.txt"
fi
SIZE=$(stat -c %s libuv-v1.48.0.tar.gz)
SHA=$(sha256sum libuv-v1.48.0.tar.gz | awk '{print $1}')
echo "size_bytes=$SIZE" | tee -a "$R/download.txt"
echo "sha256=$SHA" | tee -a "$R/download.txt"
if tar -tzf libuv-v1.48.0.tar.gz | grep -qE '(^/|(^|/)\.\.(/|$))'; then
  echo "UNSAFE MEMBER PATHS - STOP"; exit 4
fi
echo "members=$(tar -tzf libuv-v1.48.0.tar.gz | wc -l)" | tee -a "$R/download.txt"
tar --no-same-owner --no-same-permissions -xzf libuv-v1.48.0.tar.gz
ls -la
du -sh ./*/
