#!/usr/bin/env bash
# Creates the synthetic self-test project for light_include_scan.py (only under fixtures/selftest).
set -euo pipefail
R="$HOME/dsh-work/measure-cpp/fixtures/selftest"
B="$HOME/dsh-work/measure-cpp/build/selftest"
rm -rf "$R" "$B"
mkdir -p "$R/include/proj" "$R/src" "$B"
cd "$R"

cat > include/proj/api.h <<'EOF'
#ifndef PROJ_API_H
#define PROJ_API_H
#include "proj/types.h"
int proj_api(proj_int x);
#endif
EOF
cat > include/proj/types.h <<'EOF'
#ifndef PROJ_TYPES_H
#define PROJ_TYPES_H
typedef int proj_int;
#endif
EOF
cat > include/macro_target.h <<'EOF'
#ifndef MACRO_TARGET_H
#define MACRO_TARGET_H
int macro_target(void);
#endif
EOF
for h in glibc_only has_pthread no_pthread orphan; do
  printf '#ifndef %s_H\n#define %s_H\nint %s(void);\n#endif\n' "$h" "$h" "$h" > "include/$h.h"
done
cat > include/errhdr.h <<'EOF'
#ifndef ERRHDR_H
#define ERRHDR_H
#ifndef ERRHDR_OK
#error "errhdr.h needs ERRHDR_OK"
#endif
int errhdr(void);
#endif
EOF
cat > include/unterminated.h <<'EOF'
#ifndef UNTERMINATED_H
#define UNTERMINATED_H
#if 1
int unterminated(void);
#endif
EOF
cat > include/needs_sys.h <<'EOF'
#ifndef NEEDS_SYS_H
#define NEEDS_SYS_H
#include <stddef.h>
typedef size_t my_size_t;
#endif
EOF
cat > include/body.inc <<'EOF'
total += 1;
EOF
cat > src/local_only.h <<'EOF'
#ifndef LOCAL_ONLY_H
#define LOCAL_ONLY_H
int local_only(void);
#endif
EOF

# --- translation units ---
cat > src/healthy.c <<'EOF'
#include "proj/api.h"
int proj_api(proj_int x) { return x + 1; }
EOF
cat > src/angled.c <<'EOF'
#include <proj/api.h>
#include <local_only.h>
int angled(void) { return proj_api(local_only()); }
EOF
cat > src/sysmissing.c <<'EOF'
#include <stdio.h>
#include "proj/api.h"
size_t g_size;
int print_it(void) { printf("%d\n", 1); return 0; }
EOF
cat > src/vec.cpp <<'EOF'
#include <vector>
#include "proj/api.h"
std::vector<int> g_values;
int vec_size() { return static_cast<int>(g_values.size()); }
EOF
cat > src/projmissing.c <<'EOF'
#include "proj/does_not_exist.h"
#include "proj/api.h"
missing_type_t g_missing;
EOF
cat > src/error_before_missing.c <<'EOF'
int early_error = ;
#include "nope.h"
nope_t after_missing;
EOF
cat > src/lookahead.c <<'EOF'
int no_semicolon
#include "nope2.h"
int after;
EOF
cat > src/macro_include.c <<'EOF'
#define PROJ_HDR "macro_target.h"
#include PROJ_HDR
#define SYS_HDR <string.h>
#include SYS_HDR
#include UNDEFINED_HDR_MACRO
int use_macro(void) { return macro_target(); }
EOF
cat > src/body_include.c <<'EOF'
int body_total(void) {
    int total = 0;
#include "body.inc"
    return total;
}
EOF
cat > src/glibc_branch.c <<'EOF'
#include <stdlib.h>
#ifdef __GLIBC__
#include "glibc_only.h"
#endif
#if __has_include(<pthread.h>)
#include "has_pthread.h"
#else
#include "no_pthread.h"
#endif
int branch(void) { return 0; }
EOF
cat > src/syntax_filescope.c <<'EOF'
#include "proj/api.h"
struct broken { int a int b; };
int fine(void) { return 0; }
EOF
cat > src/syntax_body.c <<'EOF'
#include "proj/api.h"
int body_error(void) {
    int x = ;
    return x;
}
EOF
cat > src/uses_error_header.c <<'EOF'
#include "errhdr.h"
int use_err(void) { return 0; }
EOF
cat > src/uses_error_header_ok.c <<'EOF'
#include "errhdr.h"
int use_err_ok(void) { return errhdr(); }
EOF
cat > src/uses_unterminated.c <<'EOF'
#include "unterminated.h"
int use_unterminated(void) { return 0; }
EOF
cat > src/cross_order.c <<'EOF'
#include "needs_sys.h"
size_t g_n;
int cross(void) { return 0; }
EOF
cat > src/cross_order_late.c <<'EOF'
int early = ;
#include "needs_sys.h"
int late(void) { return 0; }
EOF
cat > src/flags.c <<'EOF'
#include "proj/api.h"
int flags_fn(void) { return 0; }
EOF

# --- compile database (build directory outside the root, like CMake out-of-tree) ---
I="-I$R/include"
cc() { printf '{"directory": "%s", "file": "%s", "arguments": ["/usr/bin/cc", "%s", "-std=gnu11", "-O2", "-o", "%s.o", "-c", "%s"]}' "$B" "$R/src/$1" "$I" "$1" "$R/src/$1"; }
{
  echo '['
  # relative paths and a command string (directory = the root)
  printf '{"directory": "%s", "file": "src/healthy.c", "command": "cc -Iinclude -std=gnu11 -o build/healthy.o -c src/healthy.c"},\n' "$R"
  for f in angled.c sysmissing.c projmissing.c error_before_missing.c lookahead.c macro_include.c body_include.c \
           glibc_branch.c syntax_filescope.c syntax_body.c uses_error_header.c uses_unterminated.c cross_order.c cross_order_late.c; do
    cc "$f"; echo ','
  done
  printf '{"directory": "%s", "file": "%s", "arguments": ["/usr/bin/cc", "%s", "-DERRHDR_OK", "-o", "ok.o", "-c", "%s"]},\n' "$B" "$R/src/uses_error_header_ok.c" "$I" "$R/src/uses_error_header_ok.c"
  printf '{"directory": "%s", "file": "%s", "arguments": ["/usr/bin/c++", "%s", "-std=gnu++17", "-fPIC", "-o", "vec.o", "-c", "%s"]},\n' "$B" "$R/src/vec.cpp" "$I" "$R/src/vec.cpp"
  printf '{"directory": "%s", "file": "%s", "arguments": ["/usr/bin/cc", "-march=native", "-fvisibility=hidden", "-Wl,--as-needed", "-fplugin=/tmp/nothing.so", "-mavx2", "-Werror", "-fno-gnu-unique", "-fsomething-unknown", "-I/usr/include/eigen3", "-isystem", "%s/include", "-DFLAGS_OK", "-gcc-toolchain", "/usr", "-ggdb", "-o", "flags.o", "-c", "%s"]}\n' "$B" "$R/src/flags.c" "$R" "$R/src/flags.c"
  echo ']'
} > compile_commands.json
python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print("entries", len(d))' compile_commands.json
find "$R" -type f | sort | sed "s#$R/##"
