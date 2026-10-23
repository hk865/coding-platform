#!/bin/bash
# Lead regression after run PC-2 (af84802, 2026-10-23 night): the full suite in the lead's clone moved to af84802
# (DSH listed the bubblewrap failures and two families of old tests the book missed; reply §1, §6)
# (build, typecheck, check:architecture, both generators' --check, vitest with bubblewrap, 5 workers, scope 7G).
# The clone is s9pc1b-full, reset to the DSH copy's HEAD.
set -u
S=/home/han001/dsh-work/slices; A=$S/s9pc2; D=$S/s9pc1b-full; OUT=/mnt/d/cc-lead-notes/impl/pc/checks; L=pc2; H=af84802
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
  echo "PC-2 full suite: $D at $(git log --oneline -1 | cat); bubblewrap, 5 workers, scope 7G; started $(date +%H:%M) available $(free -m | awk '/Mem:/{print $7}') MB"
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
