#!/usr/bin/env bash
# Codex read-only audit 4 of PC-2 after rework 3, the last (decision 80), one part on D:/cxt/pc2-r3. (lead, 2026-10-23 night)
set -u
CX=$(ls -t "$LOCALAPPDATA"/OpenAI/Codex/bin/*/codex.exe | head -1)
O=D:/cc-lead-notes/codex2/pc/a8
for i in 1 2 3 4 5 6; do
  echo "A try $i $(date +%H:%M)"
  "$CX" exec -m gpt-6-astra -s read-only -C D:/cxt/pc2-r3 -c model_reasoning_effort='"xhigh"' --ephemeral --skip-git-repo-check --json \
    -o $O/A.out.md - < $O/A.prompt.md > $O/A.jsonl 2> $O/A.err
  if [ -s $O/A.out.md ]; then echo "A done $(date +%H:%M)"; tail -1 $O/A.out.md; exit 0; fi
  if grep -q "at capacity" $O/A.jsonl; then echo "A at capacity; wait 600 s"; sleep 600; continue; fi
  echo "A failed for another reason:"; tail -c 400 $O/A.jsonl; exit 1
done
echo "A gave up"; exit 1
