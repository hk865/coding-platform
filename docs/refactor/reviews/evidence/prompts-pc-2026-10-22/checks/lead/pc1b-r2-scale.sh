#!/bin/bash
# Lead's scale batch on PC-1b after rework 2 (68dfb10; decision 86-6: before a merge), in the lead's clone after its full
# suite: npm run test:scale (one worker, bubblewrap, scope 7G). (lead, 2026-10-22 night)
set -u
D=/home/han001/dsh-work/slices/s9pc1b-full; OUT=/mnt/d/cc-lead-notes/impl/pc/checks; L=pc1b-r2
export PATH=$HOME/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
export CODING_AGENT_BWRAP_PATH=$HOME/.local/opt/bubblewrap/usr/bin/bwrap
cd $D || exit 1
test "$(git rev-parse --short HEAD)" = 68dfb10 || { echo "clone HEAD is not 68dfb10"; exit 2; }
av=$(free -m | awk '/Mem:/{print $7}'); [ "$av" -gt 2000 ] || { echo "available ${av} MB, not started"; exit 3; }
R=$OUT/scale-$L.txt
echo "PC-1b-R2 scale batch: $D at $(git log --oneline -1 | cat); started $(date +%H:%M) available ${av} MB" > $R
systemd-run --user --scope -q --unit=pc-scale-$L -p MemoryMax=7G npm run -s test:scale > /tmp/pc-scale-$L.txt 2>&1
echo "test:scale exit $?" >> $R
sed -r 's/\x1b\[[0-9;]*m//g' /tmp/pc-scale-$L.txt > /tmp/pc-scale-$L-clean.txt
grep -E "^ +(Test Files|Tests|Duration)" /tmp/pc-scale-$L-clean.txt >> $R
echo "failing files:" >> $R
grep -E "^ (FAIL|❯) " /tmp/pc-scale-$L-clean.txt | sed -E 's/ +[0-9]+ms$//' | sort -u >> $R
cp /tmp/pc-scale-$L.txt $OUT/scale-$L.log
echo "ended $(date +%H:%M)" >> $R
cat $R
