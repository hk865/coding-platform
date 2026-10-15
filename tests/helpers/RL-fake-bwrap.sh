#!/usr/bin/env bash
# Fixture (R3): a fake `bwrap` for the MF3 gate-stream-error row and the MF4
# exit-after-r smoke. It is selected ONLY through CODING_AGENT_BWRAP_PATH.
#
# Modes (file-driven, like RL-fake-systemd-run.sh):
#   forward      exec .bwrap-real "$@" — that sibling holds the caller's
#                CODING_AGENT_BWRAP_PATH, else /usr/bin/bwrap. Used for the
#                probe and the warm probeResourceCaps(); the real sandbox and
#                user session are still required, so this is a dependency
#                replacement, not a fake environment.
#   gate-reset   printf r >&4; sleep 0.5 4>&-; exec 4>&- 4<&-; sleep 1; exit 7
#                Closing fd 4 while `g` is still unread forces ECONNRESET on
#                the Host's socket (MF3).
#   exit-after-r printf r >&4; exit 9 — exits after `r` and before release (MF4).
#
# Sibling config: .bwrap-mode, .bwrap-real (default /usr/bin/bwrap), .bwrap-log.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
read_file() {
  if [ -f "$1" ]; then cat "$1"; else printf '%s' "$2"; fi
}
mode="$(read_file "$here/.bwrap-mode" forward)"
real="$(read_file "$here/.bwrap-real" /usr/bin/bwrap)"
printf 'pid=%s %s\n' "$$" "$*" >> "$here/.bwrap-log"
case "$mode" in
  forward)
    exec "$real" "$@"
    ;;
  gate-reset)
    printf 'r' >&4
    sleep 0.5 4>&-
    exec 4>&- 4<&-
    sleep 1
    exit 7
    ;;
  exit-after-r)
    printf 'r' >&4
    exit 9
    ;;
  *)
    echo "unknown bwrap mode: $mode" >&2
    exit 2
    ;;
esac
