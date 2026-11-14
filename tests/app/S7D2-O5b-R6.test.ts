/**
 * O5b-R6 (`7d2-start-rulings.v4.md:6758`; drill-ruling drafts O5b-04, O5b-06; book `:1143–:1144`; O5b start rulings
 * 2, 43, 44, 47, 48; write-tests brief `tests-7d2-o5b2.txt` "O5b-R6"): a goal scribe's scope, its count and the Host's
 * reminder are one scope. The person's current note on goal G's anchor counts in the scribe Sg that holds G, not in
 * the opening project scribe Sp; a formal archive that stops an executor line's real Work Run makes G `immediate`,
 * and the Host sends the original `scribe-reminder` to Sg alone, once (no workspace-wide smallest-sessionId pick).
 *
 * World (memory): `openS7D2RoleLineWorld` with `scribeReminderPeriodMs: 25` and a delegating `noteScribeTodos`
 * (rule sheet A3) that counts `readLedgerCursor` calls and returns the Host platform's own reads; while the world is
 * still opening it answers `unavailable` and that period records nothing (ruling 47). The clock is fixed and the
 * Host's period gate reads it, so each check follows one explicit `clock.advance(25)`; a check reads the cursor once
 * and the main workspace is the only one, so the (k+1)-th cursor read starting proves the k-th check ended (ruling 44).
 *
 * Expected (by hand): Sg's `scope` is `[{kind:'goal', goalRef:G}]`; after the note Sg's position counts 1 in G and
 * Sp's 0 in the project (a goal anchor with a scribe holding G is managed by G, `scribe-scope.ts`
 * `managingScopeOfAnchors`); the reminder starts with `书记提醒：` (`strings.json` `scribe.marker`) and says
 * `待审 0 条` (the person's note is current, not pending).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { ArchiveTaskChoiceV1 } from '../../src/contracts/core/session-archive.js';
import type { NoteScribeTodoPort } from '../../src/core/work-graph/model/note-contracts.js';
import type { RoleLineReadResultV1, RoleLineReadV1 } from '../../src/core/work-graph/views/role-line-read.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { adoptPLMixedPlan } from '../helpers/PL-consumption-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { inboxOf } from '../helpers/S7B-F-support.js';
import { linkS7D2Scopes, openS7D2RoleLineWorld, type S7D2RoleLineWorld } from '../helpers/S7D2-role-line-world.js';
import { waitFor } from '../scenarios/harness.js';

const worlds: S7D2RoleLineWorld[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(world => world.close())); });

/** `role-lines/read` of the main workspace, by line. */
async function rowOf(h: S7D2RoleLineWorld, line: SessionRef): Promise<RoleLineReadV1 | undefined> {
  const read = ready<RoleLineReadResultV1>(await h.world.post('role-lines/read',
    plain(S6A_SCOPE, { workspace: { ...S6A_SCOPE } })), 'role-lines/read');
  return read.rows.find(entry => entry.row.key.sessionId === line.sessionId);
}

/** The line's inbox messages whose saved body (`messages/body`) starts with the reminder marker. */
async function remindersOf(h: S7D2RoleLineWorld, line: SessionRef) {
  const found: { sender: string; intent: unknown; text: string }[] = [];
  for (const message of await inboxOf(h.world, line)) {
    const { text } = ready<{ text: string }>(await h.world.post('messages/body',
      plain(S6A_SCOPE, { messageRef: message.ref, part: 'message' })), `the body of ${message.ref.messageId}`);
    if (text.startsWith('书记提醒：')) found.push({ sender: message.sender.kind, intent: message.intent, text });
  }
  return found;
}

describe('O5b-R6: the same scope\'s note, count and reminder reach the same goal scribe', () => {
  /* Named mutation (draft O5b-06; v4 :6488): pass `{ kind: 'project' }` instead of the bucket's scope to `manages` in
   * `resolveScribeRecipient` (`src/composition/create-platform.ts`) -> the reminder goes to Sp: Sg's
   * `toHaveLength(1)` and Sp's `toEqual([])` after check A are red. */
  it('O5b-R6 (memory): Sg holds G, counts its note and alone gets the immediate reminder once', async () => {
    let opened: S7D2RoleLineWorld | undefined;
    let cursorReads = 0;
    const opening = { status: 'rejected', code: 'unavailable', reason: 'R6: the world is still opening' } as const;
    const noteScribeTodos: NoteScribeTodoPort = {
      async readLedgerCursor(ctx) {
        cursorReads += 1;
        return opened === undefined ? opening : await opened.world.platform.notes.readLedgerCursor(ctx);
      },
      async readScribeTodos(ctx, input) {
        return opened === undefined ? opening : await opened.world.platform.notes.readScribeTodos(ctx, input);
      },
    };
    opened = await openS7D2RoleLineWorld({ backend: 'memory',
      extraHostOptions: { scribeReminderPeriodMs: 25, noteScribeTodos } });
    const h = opened;
    worlds.push(h);
    const G = h.goal;
    const Sp = h.lines.scribe.ref;
    const Sg = (await h.lineOf('r6-sg-2', (await h.open({ duty: 'scribe', scope: [{ kind: 'goal', goalRef: G }],
      requestId: 'r6-sg-2' })).result)).ref;
    // the old pick (the smallest sessionId in the workspace) must not land on Sg by chance, or this row proves nothing
    expect(Sp.sessionId < Sg.sessionId, 'Sp sorts before Sg').toBe(true);
    expect((await rowOf(h, Sg))?.scope).toEqual([{ kind: 'goal', goalRef: G }]);

    // The person's note on G's goal anchor (the S4C2 `general` shape), current at once.
    const note = await h.world.post('notes/write', plain(S6A_SCOPE, { commandId: 'r6-note', goalId: G.goalId,
      expectedPointerRevision: null, note: { kind: 'convention', topic: 'r6', conclusion: '结论 r6', body: '正文 r6',
        anchor: { kind: 'goal', goalId: G.goalId }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
        replaces: [], contradicts: [], coexistWith: [] } }));
    expect(note.body).toMatchObject({ write: { status: 'accepted' } });
    expect((await rowOf(h, Sg))?.position).toEqual([{ kind: 'scribe', scope: { kind: 'goal', goalId: G.goalId }, current: 1 }]);
    expect((await rowOf(h, Sp))?.position).toEqual([{ kind: 'scribe', scope: { kind: 'project' }, current: 0 }]);

    // `immediate` (draft O5b-04, rulings 43, 48): executor line E holds a real Work Run at its model gate, and the
    // formal archive stops it, so the archive writes its `archiveOrigin` requeue.
    const { tasks: [T] } = await adoptPLMixedPlan(h.world, { goal: G, label: 'r6',
      tasks: [{ taskId: 'r6-t', role: S6A_WORK_ROLE.templateId }] });
    const E = await h.createWorkLine('r6-exec');
    await linkS7D2Scopes(h.world, { line: E, targets: [{ kind: 'task', ref: T! }], label: 'r6-task' });
    const gate = await h.world.gates.modelRequest(E);
    // The drive only holds E's Work Run at its gate (`runS7D2Work`'s drive). It stops before the Workflow opens a
    // replacement Session for the requeued Task: that Session's claim claims the archive trigger and ends `immediate`
    // (ruling 8), racing check A (the flake seen 11-14).
    await h.world.scripted.script(E, [{ kind: 'text', text: 'R6 run' }]);
    driveWorkflow(h.world.ag2b, { schemaVersion: 1, goalRef: G, flowId: 's7d2-r6-run', sessionHint: E.ref,
      kind: 'select_work', taskId: T!.taskId }, { stopBefore: op => op.kind === 'open_checks' || op.kind === 'create_session' })
      .catch(() => undefined);
    await gate.reached;
    const card = await h.readCard(E);
    const tasks: ArchiveTaskChoiceV1[] = [];
    for (const link of card.links) {
      const target = link.ref.target;
      if (link.until !== null || link.ref.relation !== 'responsible') continue;
      if (target.kind === 'task' || target.kind === 'work') tasks.push({ target, disposition: { kind: 'drop' } });
    }
    const archived = await h.world.post('sessions/archive-line', graphWrite(S6A_SCOPE, { sessionRef: E.ref,
      reason: 'R6 archive', tasks, wait: null }, 'r6-archive', [{ ref: card.record.ref, revision: card.record.revision }]));
    expect(archived.body).toMatchObject({ status: 'ready' });
    gate.release();
    await waitFor(async () => (await h.world.post('sessions/archive-continue',
      plain(S6A_SCOPE, { sessionRef: E.ref, archiveRequestId: 'r6-archive' }))).body,
    body => (body as { value?: { state?: unknown } }).value?.state === 'archived', 'the archive of E');

    // Two periods, each finished (ruling 44): check A starts at n0 + 1 and has ended when n0 + 2 starts.
    const n0 = cursorReads;
    const period = async (k: number): Promise<void> => {
      h.world.clock.advance(25);
      await waitFor(async () => cursorReads, reads => reads >= n0 + k, `cursor read ${String(n0 + k)}`);
    };
    await period(1);
    await period(2);
    const atSg = await remindersOf(h, Sg);
    expect(atSg).toHaveLength(1);
    expect(atSg[0]).toMatchObject({ sender: 'host', intent: 'notify' });
    expect(atSg[0]!.text).toContain('待审 0 条');
    expect(await remindersOf(h, Sp)).toEqual([]);
    // Checks B and C ended: the same bucket at the same cursor is not sent again.
    await period(3);
    await period(4);
    expect(await remindersOf(h, Sg)).toHaveLength(1);
  }, 120_000);
});
