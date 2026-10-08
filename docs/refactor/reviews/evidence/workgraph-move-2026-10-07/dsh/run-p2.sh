#!/usr/bin/env bash
# Task D, stage DSH, part 2 (TASK-D-PLAN §5): same Session, same copy; then save the copy's diff/status (read only)
# and run LTd/check.sh on a quiet machine.
set -uo pipefail
L=~/dsh-work/ladder; . $L/_common/env.sh
S=/mnt/c/Users/han001/AppData/Local/Temp/claude/D--1-project-Software-agent-next-main--claude-worktrees-claude-code-task-execution-f3cca6/e5036f9b-df59-40c2-bf49-8b148d5818f6/scratchpad
OUT=$S/taskd/dsh; C=$L/LTd-1
SID=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).sessionId)' $L/_runs/LTd-1-p1/run.json)
echo "session $SID" > $OUT/p2.runner.out
date -Is > $OUT/p2.start
node $COMMON/run-dsh.mjs run $C $L/LTd/task-part2.md LTd-1-p2 --level $L/LTd --session-id $SID >> $OUT/p2.runner.out 2>&1
echo "runner exit $?" >> $OUT/p2.runner.out
date -Is > $OUT/p2.end
R=$L/_runs/LTd-1-p2; mkdir -p $OUT/run-p2
cp $R/run.json $R/final.md $R/scan.json $R/git-status.txt $R/stderr.txt $OUT/run-p2/; gzip -c $R/events.jsonl > $OUT/run-p2/events.jsonl.gz
git -C $C diff -M --binary HEAD > $OUT/LTd-1.patch
git -C $C status --short > $OUT/LTd-1.status.txt
git -C $C status --short --ignored > $OUT/LTd-1.status-ignored.txt
git -C $C diff -M HEAD --numstat > $OUT/LTd-1.numstat.txt
git -C $C log --oneline --all > $OUT/LTd-1.log.txt; git -C $C tag -l -n1 >> $OUT/LTd-1.log.txt; git -C $C rev-parse ladder-setup HEAD >> $OUT/LTd-1.log.txt
date -Is > $OUT/check.start
bash $L/LTd/check.sh $C > $OUT/LTd-1.check.json 2> $OUT/LTd-1.check.err
echo "check exit $?" >> $OUT/LTd-1.check.err
date -Is > $OUT/check.end
