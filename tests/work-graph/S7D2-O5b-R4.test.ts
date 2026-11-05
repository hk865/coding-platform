/**
 * O5b-R4, BK-15 (`7d2-start-rulings.v4.md:6756`; book §3.8 item 6 `:617–:623`, `:612–:613`; DR7d2O5b's second table,
 * R4; O5b start ruling 42; write-tests brief `tests-7d2-o5b1.txt` "O5b-R4"): the secretary pick reads the effective
 * scope array, a region-only secretary is picked for nothing, and the same array is what `role-lines/read` shows.
 * O4b-1 wired the pick (M26–M28), so steps 2 and 3 are expected green on the start point and step 1 red (the route).
 * The empty-array case is the pure table's (`tests/work-graph/S6A-secretary-selection-pure.test.ts:163–:179`): making
 * a secretary's scope empty is not a public step this world can promise.
 *
 * World (memory, one for the block, in declaration order): `openS7D2RoleLineWorld`
 * (tests/helpers/S7D2-role-line-world.ts). Only a line with a secretary profile is a candidate (DR R4), so the other
 * candidates are moved off first: `createSecretary` (the S6A secretary role, profiled, with one project link,
 * `tests/helpers/S6A-request-fixture.ts:748–:749`) makes Sr and Sg; `role-lines/change-scope` moves Sr to region `src`,
 * Sg to goal G, and the opening secretary to region `docs`, so no project secretary hides the mutation. G2 is the
 * world's second goal (`handle.world.goals.second`). A round is `requests/submit` with no recipient
 * (`tests/helpers/S6A-host-fixture.ts:724–:728`), its line the round's `assignedSession` on `requests/read`.
 *
 * Expected (by hand): step 1 — Sr's scope `[{kind:'region', moduleRef:src, modules:[src, src/a, src/b]}]`
 * (`effectiveRegions` over `s7d2Catalog`: `src` contains `src/a` and `src/b`, no other secretary region lies deeper
 * inside `src`, sorted by module id), Sg's `[{kind:'goal', goalRef:G}]`. Step 2 — G's round is Sg's (G's goal scope
 * covers Sg; Sr and the opening secretary are region-only, book `:612–:613`). Step 3 — G2's round goes to none of the
 * secretary lines that existed before it (the opening secretary, Sr, Sg, and step 2's line): none covers G2, so intake
 * opens a line with a project link (`src/business/workflow/request-intake.ts:250–:256`, ruling 42). This does not depend
 * on whether step 2's line is still busy (`secretary-selection.ts:127–:131`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { RequestReadV1 } from '../../src/core/work-graph/views/main-surface-read-model.js';
import type { RoleLineReadResultV1, RoleLineReadV1 } from '../../src/core/work-graph/views/role-line-read.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { openS7D2RoleLineWorld, type S7D2RoleLineWorld } from '../helpers/S7D2-role-line-world.js';
import { waitFor } from '../scenarios/harness.js';

const WORKSPACE = { projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId };

function rowOf(rows: readonly RoleLineReadV1[], line: SessionRef): RoleLineReadV1 {
  const found = rows.find(entry => entry.row.key.sessionId === line.sessionId);
  if (found === undefined) {
    throw new Error(`O5b-R4: role-lines/read has no row for ${line.sessionId}: ${JSON.stringify(rows.map(entry => entry.row.key))}`);
  }
  return found;
}

/** `requests/submit` of one round on `goalId` (no recipient); polls `requests/read` until the round names its line. */
async function roundLine(handle: S7D2RoleLineWorld, commandId: string, goalId: string): Promise<SessionRef> {
  const submitted = await handle.world.submit({ commandId, goalId, text: `R4 ${commandId}` });
  if (submitted.status !== 'queued') throw new Error(`O5b-R4: ${commandId} was not queued: ${JSON.stringify(submitted)}`);
  const requestRoot: QueryJobRef = submitted.requestRoot;
  const view = await waitFor(async () => valueOf<RequestReadV1>(await handle.main.route('requests/read',
    { requestRoot }), 'ready', `requests/read of ${commandId}`),
  read => read.rounds[0]?.assignedSession !== null && read.rounds[0]?.assignedSession !== undefined,
  `the round of ${commandId} to have a secretary`);
  return view.rounds[0]!.assignedSession!;
}

describe('O5b-R4 BK-15 (memory): the pick reads the effective scope array; a region-only secretary is picked for nothing',
  () => {
    let handle: S7D2RoleLineWorld;
    let sr: S6ASession;
    let sg: S6ASession;
    let onG: SessionRef | null = null;
    beforeAll(async () => {
      handle = await openS7D2RoleLineWorld({ backend: 'memory' });
      sr = await handle.world.createSecretary('r4-sr');
      sg = await handle.world.createSecretary('r4-sg');
    }, 300_000);
    afterAll(async () => { await handle?.close(); });

    it('the prior: change-scope moves Sr to region src, Sg to goal G, the opening secretary to region docs',
      async () => {
        const moves = [
          { session: sr, scope: [{ kind: 'region' as const, moduleRef: handle.modules.region }], requestId: 'r4-sr-scope' },
          { session: sg, scope: [{ kind: 'goal' as const, goalRef: handle.goal }], requestId: 'r4-sg-scope' },
          { session: handle.lines.secretary, scope: [{ kind: 'region' as const, moduleRef: handle.modules.other }],
            requestId: 'r4-opening-scope' },
        ];
        for (const move of moves) {
          expect((await handle.changeScope(move)).result, move.requestId).toMatchObject({ status: 'committed' });
        }
      }, 120_000);

    it('step 1: role-lines/read shows Sr\'s region array and Sg\'s goal, the arrays the pick reads', async () => {
      const read = valueOf<RoleLineReadResultV1>((await handle.world.post('role-lines/read',
        plain(S6A_SCOPE, { workspace: WORKSPACE }))).body, 'ready', 'role-lines/read');
      expect(rowOf(read.rows, sr.ref).scope).toEqual([{ kind: 'region', moduleRef: handle.modules.region,
        modules: [handle.modules.region, handle.modules.child, handle.modules.sibling] }]);
      expect(rowOf(read.rows, sg.ref).scope).toEqual([{ kind: 'goal', goalRef: handle.goal }]);
    }, 120_000);

    it('step 2: a round on G is Sg\'s (Sr and the opening secretary are region-only)', async () => {
      onG = await roundLine(handle, 'r4-g', handle.goal.goalId);
      expect(onG.sessionId).toBe(sg.ref.sessionId);
    }, 120_000);

    /*
     * Named mutation (v4 :6761): delete `orderCandidates`' project/Goal coverage filter
     * (`src/core/work-graph/tasks/secretary-selection.ts:123–:126`) -> step 3's round goes to an existing secretary
     * line (Sr, Sg or the opening secretary): its `not.toContain` is red.
     */
    it('step 3: a round on G2 goes to none of the secretary lines that existed before it', async () => {
      const before = [handle.lines.secretary.ref.sessionId, sr.ref.sessionId, sg.ref.sessionId,
        ...(onG === null ? [] : [onG.sessionId])];
      const onG2 = await roundLine(handle, 'r4-g2', handle.world.goals.second.goalId);
      expect(before).not.toContain(onG2.sessionId);
    }, 120_000);
  });
