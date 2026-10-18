#!/usr/bin/env bash
# Fixture: a fake `systemctl` for the K3-49 / L31b scope-stop branch.
# Builds: the stop double for a Host-created systemd scope (spec L31b).
# Rows: K3-49 (RE1) and the sandbox-runnable helper tests.
#
# Configuration lives in files beside this script (`$0`'s own directory),
# because production spawns `systemctl` with the Host's environment and we do
# not want to leak test switches into it:
#   .mode   fail (default) | ok | hang
#   .log    every invocation's arguments are appended here, one line each
# It is selected only through CODING_AGENT_SYSTEMCTL_PATH; production code
# never knows this file exists.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
read_file() {
  if [ -f "$1" ]; then cat "$1"; else printf '%s' "$2"; fi
}
mode="$(read_file "$here/.mode" fail)"
printf '%s\n' "$*" >> "$here/.log"
case "$mode" in
  fail)
    # Two lines on purpose: the production seam must still write exactly one
    # physical stderr line.
    echo "Failed to stop unit: access denied" >&2
    echo "See system logs for details." >&2
    exit 1
    ;;
  ok)
    exit 0
    ;;
  hang)
    exec sleep 600
    ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 2
    ;;
esac
