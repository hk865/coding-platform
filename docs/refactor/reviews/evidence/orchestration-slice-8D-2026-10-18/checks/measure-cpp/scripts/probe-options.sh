#!/usr/bin/env bash
set -euo pipefail
S=/mnt/d/cc-lead-notes/impl/s8d/measure-cpp/scripts
R="$HOME/dsh-work/measure-cpp/fixtures/selftest"
mkdir -p "$R/probe"
cat > "$R/probe/two_missing.c" <<'EOF'
#include <stdio.h>
#include "proj/api.h"
size_t x;
#include "nope.h"
#include "proj/types.h"
int y = ;
int f(void) {
#include "body.inc"
  return 0;
}
EOF
cd "$HOME/dsh-work/measure-cpp/results/selftest"
python3 -I "$S/probe_options.py" /usr/lib/llvm-18/lib/libclang.so.1 "$R/probe/two_missing.c" "-I$R/include" -nostdinc -w -ferror-limit=0
rm -rf "$R/probe"
