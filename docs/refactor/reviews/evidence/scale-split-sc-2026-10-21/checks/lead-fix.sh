#!/bin/bash
# Lead fixes after SC rework 1: two unused import names in scale files (the verbatim worlds stay). (lead, 2026-10-21)
set -e
export PATH=$HOME/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
D=/home/han001/dsh-work/slices/s9scr1; cd $D
test "$(git rev-parse --short HEAD)" = 9a504c0
sed -i "s|^import { failingReadRecords, S2A_ROUTE_READ_FAILURE_REASON } from '../helpers/S2A-route-storage-support.js';$|import { failingReadRecords } from '../helpers/S2A-route-storage-support.js';|" tests/app/S2A-decision-routes.scale.test.ts
sed -i "\|^import type { CoreCallContext } from '../../src/contracts/core/call-context.js';$|d" tests/work-graph/WP2-context-extensions.scale.test.ts
git diff --stat | cat
node ./.dsh-ref/scale-move-check.mjs sc-base WORKTREE 2>/dev/null | tail -1 || true
npx tsc --noEmit -p tsconfig.json --noUnusedLocals 2>&1 | grep "TS6133\|TS6196\|TS6192\|TS6198" | grep -E "scale\.test|S2A-|WP2-|S2C-|B2-401|S5R2|unknown-call-review-list" || echo "no unused-local line in SC files"
git add -A -- tests/app/S2A-decision-routes.scale.test.ts tests/work-graph/WP2-context-extensions.scale.test.ts
git -c user.name=lead -c user.email=lead@localhost commit -qm "SC lead fixes: two unused import names in scale files"
node ./.dsh-ref/scale-move-check.mjs sc-base HEAD | tail -3
git log --oneline sc-r1-base..HEAD | cat
