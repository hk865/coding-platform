#!/bin/bash
# usage: run.sh <case> <sha> <effort>
n=$1; sha=$2; eff=$3
T="$(dirname "$0")"; C="$LOCALAPPDATA/OpenAI/Codex/bin/ca9abb0b4d8ac692/codex.exe"
start=$(date +%s)
"$C" exec -s read-only -C "C:/Users/han001/cxt/$n" -c model_reasoning_effort="\"$eff\"" --ephemeral --json -o "$T/$n.out.md" "You are reviewing a commit. The working tree is checked out at that commit; see its diff with: git show $sha (and git show $sha^ for the parent state). Do not modify any file. $(cat "$T/$n.prompt")" < /dev/null > "$T/$n.events.jsonl" 2> "$T/$n.err"
rc=$?
end=$(date +%s)
echo "case=$n sha=$sha effort=$eff rc=$rc seconds=$((end-start))" | tee "$T/$n.time"
