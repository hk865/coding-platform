#!/usr/bin/env bash
# Checker (libuv): my own not-ignored listing (own scratch git dir, nothing committed, no hooks/filters), then the
# database/material numbers.  Reads the already-downloaded tree; downloads nothing.
set -euo pipefail
ROOT="$HOME/dsh-work/measure-runtime"
S="$ROOT/src/libuv/libuv-v1.48.0"
DB="$ROOT/build/libuv-out/compile_commands.json"
CK="$ROOT/results/libuv/check"
G="$ROOT/work/libuv-check-gitdir"
SC=/mnt/d/cc-lead-notes/impl/s8d/measure-runtime/scripts
mkdir -p "$CK"
cd "$CK"
[ -d "$G/.git" ] || git init -q "$G"
git --git-dir="$G/.git" --work-tree="$S" ls-files --others --exclude-standard -z > "$CK/not-ignored.z"
git --git-dir="$G/.git" --work-tree="$S" ls-files --others --ignored --exclude-standard -z > "$CK/ignored.z"
echo "not ignored: $(tr '\0' '\n' < "$CK/not-ignored.z" | wc -l); ignored: $(tr '\0' '\n' < "$CK/ignored.z" | wc -l)"
tr '\0' '\n' < "$CK/ignored.z"
echo "tar members: $(tar -tzf "$ROOT/src/libuv/libuv-v1.48.0.tar.gz" | wc -l); regular files in tree: $(find "$S" -type f | wc -l); symlinks: $(find "$S" -type l | wc -l)"
sha256sum "$ROOT/src/libuv/libuv-v1.48.0.tar.gz"; stat -c %s "$ROOT/src/libuv/libuv-v1.48.0.tar.gz"
python3 -I "$SC/check_libuv_db.py" "$DB" "$S" "$CK/not-ignored.z" "$CK/db.json"
