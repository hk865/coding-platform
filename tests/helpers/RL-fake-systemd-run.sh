#!/usr/bin/env bash
# Fixture: a fake `systemd-run` for the RE1 rows.
# Builds: the file-driven launcher double described in spec §7.
# Rows: RL-07b, RL-09, RL-09b, RL-10, RL-10b, RL-13, RL-15, RL-15b (MF2).
#
# Configuration lives in files beside this script (`$0`'s own directory),
# because production spawns the launcher with only PATH and XDG_RUNTIME_DIR
# (spec L3), so an environment variable would never reach it:
#   .mode        forward | fail-bus | fail-start | no-scope | strip-p |
#                rewrite-dollar | sleep | wait-external | write-started |
#                hang-version
#   .real        the real systemd-run to forward to (default /usr/bin/systemd-run)
#   .log         every invocation's argv is appended here, prefixed `pid=<pid> `
#   .sleep       seconds for mode=sleep
#   .external    a file mode=wait-external waits for
#   .started     a file mode=write-started touches
#   .hang-marker argv[0] for the hung `--version` process (default rl-hang-version)
# It is selected only through CODING_AGENT_SYSTEMD_RUN_PATH; production code
# never knows this file exists.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
read_file() {
  if [ -f "$1" ]; then cat "$1"; else printf '%s' "$2"; fi
}
mode="$(read_file "$here/.mode" forward)"
real="$(read_file "$here/.real" /usr/bin/systemd-run)"
# Item 8/P3: log the pid too; `--scope` execs in place, so this pid stays the
# launcher/bwrap/gate pid the whole way. Existing `.includes` users are
# unaffected by the `pid=… ` prefix.
printf 'pid=%s %s\n' "$$" "$*" >> "$here/.log"
# MF2/RL-15b: hang the version query (L5 step 3) instead of forwarding it; the
# 10 s probe deadline must abort and reap it. Any scope launch in this mode
# still forwards to the real launcher.
if [ "${1:-}" = "--version" ] && [ "$mode" = "hang-version" ]; then
  exec -a "$(read_file "$here/.hang-marker" rl-hang-version)" sleep 600
fi
# A version/probe query reaches the real systemd-run in every other mode, so a
# machine-condition mode only fails the scope launch (L5 step 3 vs step 6).
if [ "${1:-}" = "--version" ]; then
  exec "$real" "$@"
fi
case "$mode" in
  forward)
    exec "$real" "$@"
    ;;
  hang-version)
    exec "$real" "$@"
    ;;
  fail-bus)
    echo "Failed to connect to bus: No such file or directory" >&2
    exit 1
    ;;
  fail-start)
    echo "Failed to start transient scope unit: Access denied" >&2
    exit 1
    ;;
  no-scope)
    while [ "$#" -gt 0 ]; do
      if [ "$1" = "--" ]; then shift; break; fi
      shift
    done
    exec "$@"
    ;;
  strip-p)
    args=()
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -p) shift ;;
        *) args+=("$1") ;;
      esac
      shift
    done
    exec "$real" "${args[@]}"
    ;;
  rewrite-dollar)
    args=()
    for arg in "$@"; do
      args+=("${arg//\$\$/\$}")
    done
    exec "$real" "${args[@]}"
    ;;
  sleep)
    sleep "$(read_file "$here/.sleep" 2)"
    exec "$real" "$@"
    ;;
  wait-external)
    external="$(read_file "$here/.external" /nonexistent)"
    while [ ! -e "$external" ]; do sleep 0.05; done
    exec "$real" "$@"
    ;;
  write-started)
    : > "$(read_file "$here/.started" /tmp/rl-started)"
    sleep 1
    exec "$real" "$@"
    ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 2
    ;;
esac
