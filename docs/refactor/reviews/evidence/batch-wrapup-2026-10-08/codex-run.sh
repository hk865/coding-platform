#!/usr/bin/env bash
# W1: Codex read-only "is the implementation meaningful" review, xhigh.
T="C:/Users/han001/AppData/Local/Temp/claude/D--1-project-Software-agent-next-main--claude-worktrees-claude-code-task-execution-f3cca6/e5036f9b-df59-40c2-bf49-8b148d5818f6/scratchpad/wrapup"
C="$LOCALAPPDATA/OpenAI/Codex/bin/ca9abb0b4d8ac692/codex.exe"
start=$(date +%s); echo "start=$(date -Iseconds)" > "$T/w1-codex.time"
"$C" exec -s read-only -C "D:/cxt/wrapup-review" -c model_reasoning_effort='"xhigh"' --ephemeral --json \
  -o "$T/w1-codex.md" "$(cat "$T/w1-prompt.txt")" < /dev/null > "$T/w1-codex-events.jsonl" 2> "$T/w1-codex.err"
rc=$?; end=$(date +%s)
echo "end=$(date -Iseconds) rc=$rc seconds=$((end-start))" >> "$T/w1-codex.time"
