#!/bin/bash
# Lead's full suite on PC-1b as delivered (c1c7af4), before the audit's rework (2026-10-22): a separate clone so the
# DSH copy stays untouched; build, typecheck, check:architecture, both generators' --check, vitest (bubblewrap,
# 5 workers, scope 7G). Old tests that PC-1b breaks go into the audit's frozen findings table.
set -u
S=/home/han001/dsh-work/slices; A=$S/s9pc1b; D=$S/s9pc1b-full; OUT=/mnt/d/cc-lead-notes/impl/pc/checks; L=pc1b; mkdir -p $OUT
export PATH=$HOME/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
export CODING_AGENT_BWRAP_PATH=$HOME/.local/opt/bubblewrap/usr/bin/bwrap
if [ ! -e $D ]; then
  git clone -q $A $D; git -C $D remote remove origin
  cp -al $S/s9sc/node_modules $D/node_modules; cp -al $S/s9sc/vendor/coding-agent/node_modules $D/vendor/coding-agent/node_modules
fi
cd $D || exit 1
test "$(git rev-parse --short HEAD)" = c1c7af4 || { echo "HEAD is not c1c7af4"; exit 2; }
R=$OUT/full-$L.txt
{
  echo "PC-1b full suite: $D at $(git log --oneline -1 | cat); bubblewrap, 5 workers, scope 7G; started $(date +%H:%M) available $(free -m | awk '/Mem:/{print $7}') MB"
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
echo "ended $(date +%H:%M)" >> $R
cat $R
