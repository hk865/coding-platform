/**
 * Slice 4B G2 round 2 — MF1 / R1: every fact kind is resolved through an
 * existing reader. Datasets come only from the real `platform.notes` writers,
 * the real `platform.materials.storeArtifact` and the real
 * `platform.executions.recordExecutionHistory`; assertions go only through the
 * public holder's `checkNotes`.
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1, NoteFactV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture, type S4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'facts', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function writeAccepted(f: S4BNoteCheckFixture, note: NoteDraftV1): Promise<string> {
  const result = await f.inner.write(f.ctx(), note, null);
  if (result.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

async function check(f: S4BNoteCheckFixture, noteId: string): Promise<NonNullable<
  Extract<Awaited<ReturnType<S4BNoteCheckFixture['check']['checkNotes']>>, { status: 'ready' }>['value'][number]>> {
  const result = await f.check.checkNotes(f.ctx(), { items: [{ noteId, version: 1 }] });
  if (result.status !== 'ready') throw new Error(`check not ready: ${JSON.stringify(result)}`);
  return result.value[0]!;
}

describe('S4B MF1 facts resolve every kind', () => {
  it.each(['memory', 'sqlite'] as const)('MF1 %s: a record pointer above the current revision is version_ahead', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const fact: NoteFactV1 = { kind: 'record', revision: 999, digest: null,
        ref: { aggregateType: 'Goal', projectId: f.inner.scope.projectId, goalId: 's4a-goal' } };
      const noteId = await writeAccepted(f, draft({ facts: [fact] }));
      const value = await check(f, noteId);
      expect(value.unresolvedFacts).toEqual([{ index: 0, reason: 'version_ahead' }]);
      expect(value.freshness).toBe('unchecked');
      expect(value.currentEligible).toBe(false);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF1 %s: a record pointer at the current revision resolves untouched', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const goal = await f.inner.platform.plans.queryGoal(f.ctx(), f.inner.goalRef);
      if (goal.status !== 'ready') throw new Error('goal read failed');
      const fact: NoteFactV1 = { kind: 'record', revision: goal.value.goal.revision, digest: null,
        ref: { aggregateType: 'Goal', projectId: f.inner.scope.projectId, goalId: 's4a-goal' } };
      const noteId = await writeAccepted(f, draft({ facts: [fact] }));
      const value = await check(f, noteId);
      expect(value.unresolvedFacts).toEqual([]);
      expect(value.freshness).toBe('fresh');
      expect(value.currentEligible).toBe(true);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF1 %s: a stored artifact resolves and an absent one is not_found', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const actor = { kind: 'human' as const, id: 's4a-operator' };
      const origin = { kind: 'platform_operation' as const, projectId: f.inner.scope.projectId,
        workspaceId: f.inner.scope.workspaceId, requestId: 's4b-mf1-artifact', actor };
      const stored = await f.inner.platform.materials.storeArtifact(f.ctx(), {
        contentType: 'text/plain', body: 'an artifact body',
        sources: [{ kind: 'workspace', refId: f.inner.scope.workspaceId, revision: '1' }],
        origin });
      if (stored.status !== 'stored') throw new Error(`storeArtifact failed: ${JSON.stringify(stored)}`);
      const goodId = await writeAccepted(f, draft({ topic: 'good-artifact',
        facts: [{ kind: 'artifact', ref: stored.ref, provenance: origin }] }));
      const good = await check(f, goodId);
      expect(good.unresolvedFacts).toEqual([]);
      expect(good.uncheckedFacts).toEqual([]);

      const missingRef = { ...stored.ref, digest: '0'.repeat(64) };
      const badId = await writeAccepted(f, draft({ topic: 'bad-artifact',
        facts: [{ kind: 'artifact', ref: missingRef, provenance: origin }] }));
      const bad = await check(f, badId);
      expect(bad.unresolvedFacts).toEqual([{ index: 0, reason: 'not_found' }]);
      expect(bad.freshness).toBe('unchecked');
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF1 %s: a kernel-history locator resolves positions within the observed range', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const session = await f.inner.createSession('mf1', 'executor');
      const card = await f.inner.platform.sessions.readSession(f.ctx(), session.sessionRef);
      if (card.status !== 'ready' || card.value.record.kernel === null) throw new Error('session kernel mapping missing');
      const kernel = card.value.record.kernel;
      const run = await f.inner.claimInSession('mf1', session.sessionRef, 't1', 'executor');
      const execution = await f.inner.platform.executions.readExecution(f.ctx(), run);
      if (execution.status !== 'ready') throw new Error('run read failed');
      const recorded = await f.inner.platform.executions.recordExecutionHistory(f.ctx(), {
        meta: { requestId: 's4b-mf1-history', expected: [{ ref: run, revision: execution.value.run.revision }] },
        input: { runRef: run, kernel: { adapterId: kernel.adapterId, kernelSessionId: kernel.kernelSessionId,
          runId: 's4b-k-run', turnId: 's4b-k-turn' }, startPosition: 10, observedThroughPosition: 20, endPosition: null } });
      if (recorded.status !== 'committed') throw new Error(`recordExecutionHistory failed: ${JSON.stringify(recorded)}`);
      const identity = { kind: 'kernel_history' as const, runRef: run, sessionRef: session.sessionRef,
        adapterId: kernel.adapterId, kernelSessionId: kernel.kernelSessionId, kernelRunId: 's4b-k-run',
        turnId: 's4b-k-turn', fromPosition: 12 };
      const inRangeId = await writeAccepted(f, draft({ topic: 'in-range', facts: [{ ...identity, throughPosition: 15 }] }));
      const inRange = await check(f, inRangeId);
      expect(inRange.unresolvedFacts).toEqual([]);
      expect(inRange.uncheckedFacts).toEqual([]);
      expect(inRange.freshness).toBe('fresh');

      const aheadId = await writeAccepted(f, draft({ topic: 'ahead', facts: [{ ...identity, throughPosition: 25 }] }));
      const ahead = await check(f, aheadId);
      expect(ahead.unresolvedFacts).toEqual([{ index: 0, reason: 'version_ahead' }]);
      expect(ahead.freshness).toBe('unchecked');
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF1 %s: a file fact needs a 64-hex digest and an in-workspace path', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const badDigestId = await writeAccepted(f, draft({ topic: 'bad-digest',
        facts: [{ kind: 'file', path: 'src/a/x.ts', digest: 'not-a-digest' }] }));
      const badDigest = await check(f, badDigestId);
      expect(badDigest.unresolvedFacts).toEqual([{ index: 0, reason: 'invalid_file_digest' }]);
      expect(badDigest.freshness).toBe('unchecked');

      const outsideId = await writeAccepted(f, draft({ topic: 'outside',
        facts: [{ kind: 'file', path: '../outside.ts', digest: 'a'.repeat(64) }] }));
      const outside = await check(f, outsideId);
      expect(outside.unresolvedFacts).toEqual([{ index: 0, reason: 'forbidden' }]);
    } finally { await f.close(); }
  });
});
