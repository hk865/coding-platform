#!/bin/bash
# Lead regression after PC-1b rework 1 (1b5183a, 2026-10-22 night): first A1, the one file DSH saw red without
# bubblewrap, rerun with the bwrap path in the DSH copy; then the full suite in the lead's clone moved to 1b5183a
# (build, typecheck, check:architecture, both generators' --check, vitest with bubblewrap, 5 workers, scope 7G).
# The clone has no resources/skills (tracked by 0 files), which is what L-01..L-03 must survive.
set -u
S=/home/han001/dsh-work/slices; A=$S/s9pc1b; D=$S/s9pc1b-full; OUT=/mnt/d/cc-lead-notes/impl/pc/checks; L=pc1b-r1; H=1b5183a
export PATH=$HOME/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
export CODING_AGENT_BWRAP_PATH=$HOME/.local/opt/bubblewrap/usr/bin/bwrap
av=$(free -m | awk '/Mem:/{print $7}'); [ "$av" -gt 2000 ] || { echo "available ${av} MB, not started"; exit 3; }
test "$(git -C $A rev-parse --short HEAD)" = $H || { echo "DSH copy HEAD is not $H"; exit 2; }
test -z "$(git -C $D status --porcelain -- . ':!.dsh-scratch')" || { echo "clone not clean"; git -C $D status --porcelain | head; exit 2; }
git -C $D fetch -q $A HEAD && git -C $D reset -q --hard FETCH_HEAD
cd $D || exit 1
test "$(git rev-parse --short HEAD)" = $H || { echo "clone HEAD is not $H"; exit 2; }
R=$OUT/full-$L.txt
{
  echo "A1 with bubblewrap in $A:"
  (cd $A && npx vitest run --maxWorkers=2 tests/scenarios/A1-rework-same-session.test.ts 2>&1 | sed -r 's/\x1b\[[0-9;]*m//g' | grep -E "Test Files|Tests |FAIL|AssertionError" | head -10)
  echo "PC-1b-R1 full suite: $D at $(git log --oneline -1 | cat); bubblewrap, 5 workers, scope 7G; started $(date +%H:%M) available $(free -m | awk '/Mem:/{print $7}') MB"
  echo "tracked under resources/skills: $(git ls-files resources/skills | wc -l); directory present in the clone: $(test -d resources/skills && echo yes || echo no)"
  npm run -s build > /tmp/pc-full-$L-build.txt 2>&1; echo "build $?"
  npm run -s typecheck > /tmp/pc-full-$L-tc.txt 2>&1; echo "typecheck $?"
  npm run -s check:architecture > /tmp/pc-full-$L-arch.txt 2>&1; echo "check:architecture $?"
  node scripts/build-kernel-patch.mjs --check > /tmp/pc-full-$L-kp.txt 2>&1; echo "build-kernel-patch --check $?"
  node scripts/build-platform-prompts.mjs --check > /tmp/pc-full-$L-pp.txt 2>&1; echo "build-platform-prompts --check $?"
} > $R
systemd-run --user --scope -q --unit=pc-full-$L -p MemoryMax=7G npx vitest run --maxWorkers=5 > /tmp/pc-full-$L-vitest.txt 2>&1
echo "vitest exit $?" >> $R
sed -r 's/\x1b\[[0-9;]*m//g' /tmp/pc-full-$L-vitest.txt > /tmp/pc-full-$L-clean.txt
grep -E "^ +(Test Files|Tests|Duration)" /tmp/pc-full-$L-clean.txt >> $R
echo "failing files:" >> $R
grep -E "^ (FAIL|❯) " /tmp/pc-full-$L-clean.txt | sed -E 's/ +[0-9]+ms$//' | sort -u >> $R
cp /tmp/pc-full-$L-vitest.txt $OUT/full-$L-vitest.log
echo "clone clean after the run: $(git status --porcelain | wc -l) changed" >> $R
echo "ended $(date +%H:%M)" >> $R
cat $R
