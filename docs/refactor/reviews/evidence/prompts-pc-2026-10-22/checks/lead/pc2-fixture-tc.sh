#!/bin/bash
# Lead's mechanical check of the two PC-2 fixture drafts (2026-10-22 night): a scratch clone of PC-1 as merged
# (s9pc1b at 68dfb10) plus W (87f16ba from s9pc2w), the drafts copied in as tests/helpers/PC2-*.ts, then typecheck.
# Errors that name PC-2's own new interfaces (resolve-pack.ts, the prompts/* settings routes) are expected; any other
# error is a fixture finding. Also: is the frozen PC-1 platform fixture the same as the lead's copy?
set -u
S=/home/han001/dsh-work/slices; A=$S/s9pc1b; W=$S/s9pc2w; D=$S/s9pc2fx; N=/mnt/d/cc-lead-notes/impl/pc
export PATH=$HOME/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
test ! -e $D || { echo "$D exists"; exit 2; }
test "$(git -C $A rev-parse --short HEAD)" = 68dfb10 || { echo "s9pc1b HEAD is not 68dfb10"; exit 2; }
git clone -q $A $D; git -C $D remote remove origin
cp -al $S/s9sc/node_modules $D/node_modules; cp -al $S/s9sc/vendor/coding-agent/node_modules $D/vendor/coding-agent/node_modules
git -C $D fetch -q $W HEAD && test "$(git -C $D rev-parse --short FETCH_HEAD)" = 87f16ba && git -C $D -c user.name=lead -c user.email=lead@localhost cherry-pick FETCH_HEAD > /dev/null \
  && echo "W cherry-picked: $(git -C $D log --oneline -1 | cat)" || { echo "W cherry-pick failed"; git -C $D status --short | head; exit 2; }
echo "frozen PC-1 platform fixture vs the lead's copy: $(cmp -s $D/tests/helpers/PC-platform-fixture.ts $N/fixtures/PC-platform-fixture.ts && echo same || echo differs)"
diff <(tr -d '\r' < $N/fixtures/PC-platform-fixture.ts) $D/tests/helpers/PC-platform-fixture.ts | head -20
cp $N/fixtures/PC2-pack-fixture.draft.ts $D/tests/helpers/PC2-pack-fixture.ts
cp $N/fixtures/PC2-host-fixture.draft.ts $D/tests/helpers/PC2-host-fixture.ts
cd $D || exit 1
npm run -s typecheck > /tmp/pc2fx-tc.txt 2>&1; echo "typecheck exit $?"
grep -E "error TS" /tmp/pc2fx-tc.txt | sed -E 's/^([^(]+)\(([0-9]+),[0-9]+\): error (TS[0-9]+): /\1:\2 \3 /' | head -60
echo "errors: $(grep -c 'error TS' /tmp/pc2fx-tc.txt); outside the two drafts: $(grep 'error TS' /tmp/pc2fx-tc.txt | grep -vc 'tests/helpers/PC2-')"
date +%H:%M
