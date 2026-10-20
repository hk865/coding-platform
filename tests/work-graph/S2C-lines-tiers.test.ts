/**
 * Slice 2C row 2C-03 (LE3): the six-tier sort (L10) with the L1b read-incomplete
 * tier built through the real archive step.
 *
 * Every Session, claim, Run result and anchor is built through the real public
 * services; the one archive request is the real `requestSessionArchive` +
 * `recordSessionAnomaly` pair (the fixture calls the WorkGraph port directly).
 * Expected orders are the literal L10 tier order, not computed by the product.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import { openLineFixture, rowOf, type LineFixture } from '../helpers/S2C-L-line-support.js';
import { completedEvent, crashedEvent, waitContinuation, yieldedEvent } from '../helpers/S2C-L-runs-support.js';

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  return result.value;
}

const CANCELLED_POINTER = 'cancelled';

describe.each(['memory', 'sqlite'] as const)('2C-03 six attention tiers (%s)', (kind) => {
  const open: LineFixture[] = [];
  afterEach(async () => { for (const fixture of open.splice(0)) await fixture.close(); });
  async function lineFixture(): Promise<LineFixture> {
    const fixture = await openLineFixture(kind);
    open.push(fixture);
    return fixture;
  }

  /** An idle secretary line: no responsibility, no runs, no attention. */
  async function idleSecretary(f: LineFixture, requestId: string): Promise<SessionRef> {
    return (await f.createSession(requestId, { role: { kind: 'legacy_template', templateId: 'secretary', templateRevision: '1' } })).ref;
  }

  it('2C-03 (1) the tiers sort decide < failed < unknown < read-incomplete < none, and pinning a none line goes first', async () => {
    const f = await lineFixture();
    const duty = (role: { templateId?: string }) => role.templateId === 'secretary' ? 'secretary' as const : 'executor' as const;

    // Tier 0/1: a crashed task (failed) with its real auto_rework_pending card (decide).
    const decideGoal = await f.addGoal('g03-decide', [{ taskId: 'd', title: 'Decide task' }]);
    const decideHead = (await f.createSession('s03-decide')).ref;
    await f.link(decideHead, { kind: 'task', ref: decideGoal.tasks['d']! }, 'responsible', true);
    const decideClaim = await f.claim('d', decideHead, decideGoal);
    await f.runs.enter(decideClaim.claim);
    await f.runs.recordResult(decideClaim.claim, crashedEvent(decideClaim.claim, 'decide'));

    // Tier 1 only: a yielded wait that is cancelled; `task_cancelled` is no decision cause.
    const failedGoal = await f.addGoal('g03-failed', [{ taskId: 'f', title: 'Failed task' }]);
    const failedHead = (await f.createSession('s03-failed')).ref;
    await f.link(failedHead, { kind: 'task', ref: failedGoal.tasks['f']! }, 'responsible', true);
    const failedClaim = await f.claim('f', failedHead, failedGoal);
    await f.runs.enter(failedClaim.claim);
    await f.runs.recordResult(failedClaim.claim, yieldedEvent(failedClaim.claim, 'failed'),
      waitContinuation(failedClaim.claim, { aggregateType: 'SessionMessage', projectId: failedHead.projectId,
        workspaceId: f.base.scope.workspaceId, messageId: 'g03-failed-wait' }));
    await f.runs.submitControl(failedClaim.claim, 'cancel');

    // Tier 3: a secretary line whose answering copy has an unknown outcome.
    const unknownHead = await idleSecretary(f, 's03-unknown');
    const copy = await f.runs.beginConsultationCopy(unknownHead, 'g03-unknown');
    await f.runs.completeConsultation(copy.queryRunRef, copy.copy, 'unknown', 'g03-unknown');

    // Tier 4: the read-incomplete line, three anchors written by its Session with budget 2.
    const anchorGoal = await f.addGoal('g03-anchor', [
      { taskId: 'a1', title: 'Anchor 1' }, { taskId: 'a2', title: 'Anchor 2' }, { taskId: 'a3', title: 'Anchor 3' },
    ]);
    const anchorHead = (await f.createSession('s03-anchor')).ref;
    const anchorClaims: TaskClaim[] = [];
    for (const taskId of ['a1', 'a2', 'a3']) {
      const claim = await f.claim(taskId, anchorHead, anchorGoal);
      await f.runs.enter(claim.claim);
      await f.runs.recordResult(claim.claim, completedEvent(claim.claim, `g03-${taskId}`));
      anchorClaims.push(claim.claim);
    }
    await f.writeAnchors(anchorHead, anchorClaims.map((claim) => claim.runRef), 'g03-anchor');

    // Tier 5: two idle secretary lines (equal createdAt, so the head refKey breaks the tie).
    const none1 = await idleSecretary(f, 's03-none-1');
    const none2 = await idleSecretary(f, 's03-none-2');

    const reader = f.queueReader(undefined, 2, { duty });
    const list = ready(await reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    const order = list.rows.map((row) => row.key.sessionId);
    expect(order[0]).toBe(decideHead.sessionId);
    expect(order[1]).toBe(failedHead.sessionId);
    expect(order[2]).toBe(unknownHead.sessionId);
    expect(order[3]).toBe(anchorHead.sessionId);

    const decideRow = rowOf(list.rows, decideHead);
    const failedRow = rowOf(list.rows, failedHead);
    const unknownRow = rowOf(list.rows, unknownHead);
    const anchorRow = rowOf(list.rows, anchorHead);
    expect(decideRow?.status.attention?.code).toBe('decide');
    expect(failedRow?.status.attention?.code).toBe('failed');
    expect(failedRow?.status.attentionCounts.decide).toBe(0);
    expect(unknownRow?.status.attention?.code).toBe('unknown');
    expect(anchorRow?.status.attention).toBeNull();
    expect(anchorRow?.status.attentionComplete).toBe(false);
    expect(anchorRow?.status.partialParts.some((part) => part.part === 'written_anchors')).toBe(true);
    expect(anchorRow?.status.bucket).not.toBeNull();

    // The two none-tier lines are adjacent and ordered by their head refKey.
    const noneKeys = [none1, none2].sort((left, right) => {
      const a = JSON.stringify({ projectId: left.projectId, sessionId: left.sessionId });
      const b = JSON.stringify({ projectId: right.projectId, sessionId: right.sessionId });
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const noneRows = list.rows.filter((row) => noneKeys.some((ref) => ref.sessionId === row.key.sessionId));
    expect(noneRows).toHaveLength(2);
    expect(noneRows[0]?.key.sessionId).toBe(noneKeys[0]!.sessionId);
    expect(noneRows[1]?.key.sessionId).toBe(noneKeys[1]!.sessionId);
    for (const row of noneRows) {
      expect(row.status.attention).toBeNull();
      expect(row.status.attentionComplete).toBe(true);
    }

    // Pin one none-tier line: it sorts first.
    await f.setPins([none2], []);
    const pinned = ready(await reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    expect(pinned.rows[0]?.key.sessionId).toBe(none2.sessionId);
    expect(pinned.rows[0]?.pinned).toBe(true);
  });

  it('2C-03 (2) a known-failed line with unread anchors stays in the failed tier and marks attention incomplete', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g03-failed-anchor', [
      { taskId: 'f', title: 'Failed' }, { taskId: 'a1', title: 'Anchor 1' },
      { taskId: 'a2', title: 'Anchor 2' }, { taskId: 'a3', title: 'Anchor 3' },
    ]);
    const head = (await f.createSession('s03-failed-anchor')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['f']! }, 'responsible', true);
    const failedClaim = await f.claim('f', head, goal);
    await f.runs.enter(failedClaim.claim);
    await f.runs.recordResult(failedClaim.claim, yieldedEvent(failedClaim.claim, 'g03-fa'),
      waitContinuation(failedClaim.claim, { aggregateType: 'SessionMessage', projectId: head.projectId,
        workspaceId: f.base.scope.workspaceId, messageId: 'g03-fa-wait' }));
    await f.runs.submitControl(failedClaim.claim, 'cancel');
    const anchorRunRefs = [];
    for (const taskId of ['a1', 'a2', 'a3']) {
      const claim = await f.claim(taskId, head, goal);
      await f.runs.enter(claim.claim);
      await f.runs.recordResult(claim.claim, completedEvent(claim.claim, `g03-fa-${taskId}`));
      anchorRunRefs.push(claim.claim.runRef);
    }
    await f.writeAnchors(head, anchorRunRefs, 'g03-fa');
    const reader = f.queueReader(undefined, 2);
    const row = rowOf(ready(await reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.attention?.code).toBe('failed');
    expect(row?.status.attentionComplete).toBe(false);
  });

  it('2C-03 (3) / 2C-12 (9) an INCONCLUSIVE formal round puts the line in the blocked tier', async () => {
    const f = await lineFixture();
    await f.checks.installPolicy();
    const goal = await f.checks.addCheckableGoal('g03-blocked', [{ taskId: 'b', title: 'Blocked task' }]);
    const head = (await f.createSession('s03-blocked')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['b']! }, 'responsible', true);
    const claim = await f.claim('b', head, goal);
    await f.runs.enter(claim.claim);
    await f.runs.recordResult(claim.claim, completedEvent(claim.claim, 'g03-blocked'));
    const round = await f.checks.openRound(claim.runRef, goal.tasks['b']!, goal.planRef);
    const begun = await f.checks.beginFirstCheck(round);
    await f.checks.recordCancelled(round.ref, begun.ticket.checkId, begun.ticket.invocationId);
    const finalized = await f.checks.finalize(round.ref);
    expect(finalized.outcome).toBe('INCONCLUSIVE');

    const row = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.own).toBe('standby');
    expect(row?.status.attention?.code).toBe('blocked');
    expect(row?.status.attention?.reason.code).toBe('round_inconclusive');
    expect(row?.status.bucket).toBe('standby');
  });

  it('2C-03 (4) within one attention tier the later lastActivityAt sorts first', async () => {
    const f = await lineFixture();
    // The idle line's only activity is its createdAt (the fixture's fixed clock).
    const idle = (await f.createSession('s03-idle', {
      role: { kind: 'legacy_template', templateId: 'secretary', templateRevision: '1' } })).ref;
    // A running Work line entered one day later has the later lastActivityAt.
    const goal = await f.addGoal('g03-later', [{ taskId: 'w', title: 'W task' }]);
    const later = (await f.createSession('s03-later')).ref;
    await f.link(later, { kind: 'task', ref: goal.tasks['w']! }, 'responsible', true);
    const claim = await f.claim('w', later, goal);
    await f.runs.enter(claim.claim, '2026-09-25T00:00:00.000Z');

    const list = ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    const idleRow = rowOf(list.rows, idle);
    const laterRow = rowOf(list.rows, later);
    expect(idleRow?.status.attention).toBeNull();
    expect(laterRow?.status.attention).toBeNull();
    expect(laterRow!.lastActivityAt > idleRow!.lastActivityAt).toBe(true);
    expect(list.rows.indexOf(laterRow!)).toBeLessThan(list.rows.indexOf(idleRow!));
  });
});
