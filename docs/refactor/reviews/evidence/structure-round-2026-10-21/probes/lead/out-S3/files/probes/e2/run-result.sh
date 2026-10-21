#!/usr/bin/env bash
# Apply the identical S3/D3a probe to a scratch result copy, capture, and compare
# it with base-run1. Usage: run-result.sh <result-copy> [output-dir]
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
result=$(realpath "${1:?result copy}")
out=${2:-"$here/result"}
if [ ! -e "$result/node_modules" ]; then
  echo "note: $result/node_modules is missing; link it before running" >&2
fi
if [ ! -e "$result/vendor/coding-agent/node_modules" ]; then
  echo "note: $result/vendor/coding-agent/node_modules is missing; link it before running" >&2
fi
node "$here/apply-probes.mjs" "$result"
"$here/run-capture.sh" "$result" "$out" "$out.log"
node "$here/compare.mjs" "$here/base-run1" "$out"
