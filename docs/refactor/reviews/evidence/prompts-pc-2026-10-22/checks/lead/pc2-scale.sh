#!/bin/bash
# Lead's scale batch on PC-2 after rework 3 and the audit-4 patches (993dd07; decision 86-6: before a merge), in the
# lead's clone moved to the DSH copy's HEAD after its full suite on 2efd8f8 (993dd07 changes two test files only):
# npm run test:scale (one worker, bubblewrap, scope 7G). (lead, 2026-10-23 night)
set -u
S=/home/han001/dsh-work/slices; A=$S/s9pc2; D=$S/s9pc1b-full; OUT=/mnt/d/cc-lead-notes/impl/pc/checks; L=pc2-a4; H=993dd07
export PATH=$HOME/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
export CODING_AGENT_BWRAP_PATH=$HOME/.local/opt/bubblewrap/usr/bin/bwrap
av=$(free -m | awk '/Mem:/{print $7}'); [ "$av" -gt 2000 ] || { echo "available ${av} MB, not started"; exit 3; }
test "$(git -C $A rev-parse --short HEAD)" = $H || { echo "DSH copy HEAD is not $H"; exit 2; }
test -z "$(git -C $D status --porcelain -- . ':!.dsh-scratch')" || { echo "clone not clean"; git -C $D status --porcelain | head; exit 2; }
git -C $D fetch -q $A HEAD && git -C $D reset -q --hard FETCH_HEAD
cd $D || exit 1
test "$(git rev-parse --short HEAD)" = $H || { echo "clone HEAD is not $H"; exit 2; }
R=$OUT/scale-$L.txt
echo "PC-2 scale batch: $D at $(git log --oneline -1 | cat); started $(date +%H:%M) available ${av} MB" > $R
systemd-run --user --scope -q --unit=pc-scale-$L -p MemoryMax=7G npm run -s test:scale > /tmp/pc-scale-$L.txt 2>&1
echo "test:scale exit $?" >> $R
sed -r 's/\x1b\[[0-9;]*m//g' /tmp/pc-scale-$L.txt > /tmp/pc-scale-$L-clean.txt
grep -E "^ +(Test Files|Tests|Duration)" /tmp/pc-scale-$L-clean.txt >> $R
echo "failing files:" >> $R
grep -E "^ (FAIL|❯) " /tmp/pc-scale-$L-clean.txt | sed -E 's/ +[0-9]+ms$//' | sort -u >> $R
cp /tmp/pc-scale-$L.txt $OUT/scale-$L.log
echo "clone clean after the run: $(git status --porcelain -- . ':!.dsh-scratch' | wc -l) changed" >> $R
echo "ended $(date +%H:%M)" >> $R
cat $R
