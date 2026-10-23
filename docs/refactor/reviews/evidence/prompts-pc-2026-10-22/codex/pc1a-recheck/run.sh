#!/usr/bin/env bash
# Codex read-only quick re-check of PC-1a after rework 1 on D:/cxt/pc1a-r1 (lead, 2026-10-22). Retries at capacity.
set -u
CX=$(ls -t "$LOCALAPPDATA"/OpenAI/Codex/bin/*/codex.exe | head -1)
O=D:/cc-lead-notes/codex2/pc/r1
for i in 1 2 3 4 5 6; do
  echo "R1 try $i $(date +%H:%M)"
  "$CX" exec -m gpt-6-astra -s read-only -C D:/cxt/pc1a-r1 -c model_reasoning_effort='"xhigh"' --ephemeral --skip-git-repo-check --json \
    -o $O/R1.out.md - < $O/R1.prompt.md > $O/R1.jsonl 2> $O/R1.err
  if [ -s $O/R1.out.md ]; then echo "R1 done $(date +%H:%M)"; tail -1 $O/R1.out.md; exit 0; fi
  if grep -q "at capacity" $O/R1.jsonl; then echo "at capacity; wait 600 s"; sleep 600; continue; fi
  echo "failed for another reason:"; tail -c 400 $O/R1.jsonl; exit 1
done
exit 1
