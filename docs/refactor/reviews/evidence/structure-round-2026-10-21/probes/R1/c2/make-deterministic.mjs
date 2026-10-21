// C2 byte proof: make the two remaining volatile fixture values deterministic
// in a base or result copy, before the probe runs.
//
// Book §5.0 rule 3 forbids erasing random ids or clock values with patterns in
// the compared output. The two values that differ between two runs of the same
// copy are instead made deterministic at their source, identically in both
// copies:
//
//   1. tests/helpers/task-claim-fixture.ts calls fs.mkdtemp() for the memory /
//      sqlite workspace root, so the root carries a random suffix. The patch
//      derives a stable name from the current test file's basename plus a
//      per-process counter (so two workers never share a directory) and creates
//      it with mkdir. The test file basename is identical in the base and the
//      result copy; only the copy root differs and is not part of the log.
//   2. src/core/work-graph/sessions/session-directory.ts stamps the Session
//      record and its create operation with new Date().toISOString(). The patch
//      uses the fixture's fixed clock value (CLAIM_FIXTURE_AT, 2026-09-24).
//
// This changes test-fixture and probe-copy code only; nothing in the working
// tree is touched. The script is idempotent.
//
// Usage: node make-deterministic.mjs <copy-root>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
if (root === undefined) {
  console.error('usage: node make-deterministic.mjs <copy-root>');
  process.exit(2);
}

function patch(file, replacements) {
  const path = join(root, file);
  let text = readFileSync(path, 'utf8');
  for (const [from, to] of replacements) {
    if (text.includes(to)) continue;
    const parts = text.split(from);
    if (parts.length !== 2) throw new Error(`${file}: anchor must occur once, got ${String(parts.length - 1)}: ${JSON.stringify(from)}`);
    text = parts.join(to);
  }
  writeFileSync(path, text);
  console.log(`deterministic: ${file}`);
}

patch('tests/helpers/task-claim-fixture.ts', [
  ["import { mkdtemp, rm } from 'node:fs/promises';", "import { mkdir, rm } from 'node:fs/promises';"],
  ["import { join } from 'node:path';", "import { basename, join } from 'node:path';"],
  ["import type { CoreCallContext } from '../../src/contracts/core/call-context.js';",
    "import { expect } from 'vitest';\nimport type { CoreCallContext } from '../../src/contracts/core/call-context.js';"],
  ["export async function createTaskClaimFixture<A = unknown>(kind: ClaimFixtureKind,",
    "let c2DetSeq = 0;\n\nexport async function createTaskClaimFixture<A = unknown>(kind: ClaimFixtureKind,"],
  ["  const directory = await mkdtemp(join(tmpdir(), `next-r4c-claim-${kind}-`));",
    "  const c2DetName = basename(expect.getState().testPath ?? 'unknown', '.test.ts');\n"
    + "  const directory = join(tmpdir(), `next-r4c-claim-${kind}-${c2DetName}-${String(++c2DetSeq)}`);\n"
    + "  await rm(directory, { recursive: true, force: true });\n"
    + "  await mkdir(directory, { recursive: true });"],
]);

patch('src/core/work-graph/sessions/session-directory.ts', [
  ['    const now = new Date().toISOString();', "    const now = '2026-09-24T00:00:00.000Z';"],
  ['    const createdAt = new Date().toISOString();', "    const createdAt = '2026-09-24T00:00:00.000Z';"],
]);
