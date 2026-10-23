#!/usr/bin/env bash
# Codex read-only audit 2 of PC-1b after rework 1 (decision 80): parts P, S, R, J and the S-01 question X in parallel
# on D:/cxt/pc1b-r1. Prompts on stdin; retries when the model is at capacity. (lead, 2026-10-22 night)
set -u
CX=$(ls -t "$LOCALAPPDATA"/OpenAI/Codex/bin/*/codex.exe | head -1)
O=D:/cc-lead-notes/codex2/pc/a3
for P in P S R J; do cat $O/$P.head.md $O/common.md > $O/$P.prompt.md; done
cp $O/X.head.md $O/X.prompt.md
one() {
  P=$1
  for i in 1 2 3 4 5 6; do
    echo "$P try $i $(date +%H:%M)"
    "$CX" exec -m gpt-6-astra -s read-only -C D:/cxt/pc1b-r1 -c model_reasoning_effort='"xhigh"' --ephemeral --skip-git-repo-check --json \
      -o $O/$P.out.md - < $O/$P.prompt.md > $O/$P.jsonl 2> $O/$P.err
    if [ -s $O/$P.out.md ]; then echo "$P done $(date +%H:%M)"; tail -1 $O/$P.out.md; echo; return 0; fi
    if grep -q "at capacity" $O/$P.jsonl; then echo "$P at capacity; wait 600 s"; sleep 600; continue; fi
    echo "$P failed for another reason:"; tail -c 400 $O/$P.jsonl; return 1
  done
  echo "$P gave up"; return 1
}
for P in X P S R J; do one $P & sleep 5; done
wait
