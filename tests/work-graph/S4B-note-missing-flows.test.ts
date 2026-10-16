/**
 * Slice 4B round 2 G4 — the MF15 flows that round 1 left untested. Everything is
 * built through the real 4A/4B `platform.notes` holder (`S4BNoteCheckFixture`,
 * no read-model factory spy) or the real interleave fixture; the only doubles
 * are the spec §7/§9 read-fault switches (storage `readMany`, catalog read and
 * the workspace-tools-unavailable switch). Assertions go through the public
 * ports only; expected values are literals from spec M-03/M-07/M-11/M-14/M-15.
 */
import { describe, expect, it } from 'vitest';
import { symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CheckProcessObservation } from '../../src/contracts/verification.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { NoteMemoryReadPort } from '../../src/core/work-graph/model/note-contracts.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createS4BNoteCheckFixture, currentVersion } from '../helpers/S4B-note-check-fixture.js';
import { createS4AInterleaveFixture } from '../helpers/S4A-note-interleave-fixture.js';
import { createR3eEvidenceFixture, R3E_WORK_TASK_ID } from '../helpers/R3e-evidence-fixture.js';
import { B2_AT } from '../helpers/B2-execution-fixture.js';

/** The S2C-L pattern: a hand-built Host observation, never a real process. */
function executed(text: string): CheckProcessObservation {
  return { kind: 'executed', startedAt: B2_AT, finishedAt: B2_AT, exitCode: 0, signal: null,
    timedOut: false, cancelled: false,
    stdout: { text, totalBytes: Buffer.byteLength(text), truncated: false },
    stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { workspaceRevision: '1', changedPaths: [] }, sandboxProfileVersion: 's4b-m15@1' };
}

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'missing', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

describe('S4B M-11 workspace observation at write', () => {
  it.each(['memory', 'sqlite'] as const)(
    'M-11 %s write: a missing basis file is invalid/basis_file_missing and echoes the draft', async kind => {
      const f = await createS4BNoteCheckFixture(kind);
      try {
        const note = draft({ basisFiles: ['src/a/missing.ts'] });
        const written = await f.inner.write(f.ctx(), note, null);
        expect(written.status).toBe('rejected');
        if (written.status !== 'rejected') return;
        expect(written.code).toBe('invalid');
        expect(written.reason).toBe('basis_file_missing');
        expect((written as unknown as { draft: { note: NoteDraftV1 } }).draft.note).toEqual(note);
      } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)(
    'M-11 %s write: a denied basis path (.env) is invalid/basis_file_forbidden', async kind => {
      const f = await createS4BNoteCheckFixture(kind);
      try {
        const written = await f.inner.write(f.ctx(), draft({ basisFiles: ['.env'] }), null);
        expect(written.status).toBe('rejected');
        if (written.status !== 'rejected') return;
        expect(written.code).toBe('invalid');
        expect(written.reason).toBe('basis_file_forbidden');
      } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)(
    'M-11 %s write: workspace tools unavailable is a rejection code unavailable that keeps the draft', async kind => {
      const f = await createS4BNoteCheckFixture(kind);
      try {
        const note = draft({ basisFiles: ['src/a/x.ts'] });
        f.armWorkspaceFault();
        const written = await f.inner.write(f.ctx(), note, null);
        expect(written.status).toBe('rejected');
        if (written.status !== 'rejected') return;
        expect(written.code).toBe('unavailable');
        expect((written as unknown as { draft: { note: NoteDraftV1 } }).draft.note).toEqual(note);
      } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)(
    'M-11 %s write: an in-workspace symlink that escapes the root is forbidden', async kind => {
      const f = await createS4BNoteCheckFixture(kind);
      try {
        await writeFile(join(f.root, '..', 's4b-m11-outside.ts'), 'export const outside = 1;\n');
        await symlink('../../../s4b-m11-outside.ts', join(f.root, 'src/a/escape.ts'));
        const written = await f.inner.write(f.ctx(), draft({ basisFiles: ['src/a/escape.ts'] }), null);
        expect(written.status).toBe('rejected');
        if (written.status !== 'rejected') return;
        expect(written.code).toBe('invalid');
        expect(written.reason).toBe('basis_file_forbidden');
      } finally { await f.close(); }
  });
});

describe('S4B M-03/M-11 workspace observation at read', () => {
  it.each(['memory', 'sqlite'] as const)(
    'M-11 %s: an unavailable workspace marks the item unchecked with outcome unavailable', async kind => {
      const f = await createS4BNoteCheckFixture(kind);
      try {
        const written = await f.inner.write(f.ctx(), draft({ basisFiles: ['src/a/x.ts'] }), null);
        if (written.status === 'rejected') throw new Error(JSON.stringify(written));
        f.armWorkspaceFault();
        const read = await f.notes.readNote(f.ctx(), { noteId: written.noteId });
        expect(read.status).toBe('ready');
        if (read.status !== 'ready') return;
        expect(read.value.freshness).toBe('unchecked');
        expect(read.value.observedFiles).toEqual([{ path: 'src/a/x.ts', digest: null, outcome: 'unavailable' }]);
      } finally { await f.close(); }
    });
});

describe('S4B M-14 after-write check', () => {
  it.each(['memory', 'sqlite'] as const)('M-14 %s: a denied file fact is unresolved forbidden', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const written = await f.inner.write(f.ctx(), draft({ facts: [
        { kind: 'file', path: '.env', digest: '0'.repeat(64) }] }), null);
      if (written.status === 'rejected') throw new Error(JSON.stringify(written));
      const checks = await f.check.checkNotes(f.ctx(), { items: [{ noteId: written.noteId, version: await currentVersion(f, written.noteId) }] });
      expect(checks.status).toBe('ready');
      if (checks.status !== 'ready') return;
      expect(checks.value[0]!.unresolvedFacts).toEqual([{ index: 0, reason: 'forbidden' }]);
    } finally { await f.close(); }
  });
});

describe('S4B M-07 same-topic race read through the real holder', () => {
  it.each(['memory', 'sqlite'] as const)(
    'M-07 %s: two interleaved same-topic writes are both conflicting and not current', async kind => {
      const f = await createS4AInterleaveFixture(kind);
      try {
        const anchor = { kind: 'file' as const, path: 'src/a/x.ts' };
        const [first, second] = await f.interleave(
          () => f.notes.writeNote(f.workCtxA(), { commandId: 's4b-m07-a',
            note: draft({ topic: 'race topic', anchor }), expectedPointerRevision: null, goalId: null }),
          () => f.notes.writeNote(f.workCtxB(), { commandId: 's4b-m07-b',
            note: draft({ topic: 'race topic', anchor }), expectedPointerRevision: null, goalId: null }),
        );
        expect(first.status).toBe('accepted');
        expect(second.status).toBe('accepted');
        if (first.status === 'rejected' || second.status === 'rejected') return;
        // R16: the real holder's read port, no separately built reader.
        const memory = f.notes as unknown as NoteMemoryReadPort;
        const read = await memory.memoryConflicts(f.hostCtx(), { v: 1, op: 'conflicts', anchor, limit: 20, cursor: null });
        expect(read.status).toBe('ready');
        if (read.status !== 'ready') return;
        expect(read.value.items.map(item => item.noteId).sort()).toEqual([first.noteId, second.noteId].sort());
        expect(read.value.items.map(item => item.conflicting)).toEqual([true, true]);
        expect(read.value.items.map(item => item.currentEligible)).toEqual([false, false]);
      } finally { await f.close(); }
    });
});

describe('S4B M-15 a satisfied task stays live', () => {
  it('M-15 a task satisfied through the real completion path is live, not task_ended', async () => {
    const fixture = await createR3eEvidenceFixture('sqlite');
    let platform: Awaited<ReturnType<typeof createTargetPlatform>> | null = null;
    try {
      // The R3e fixture builds the real ended Run and trusted static check over
      // its own records; rebuilding the platform over the SAME store lets the
      // note holder sit over those records (the R3e completion-platform pattern).
      await fixture.b2.base.closeBackend();
      platform = await createTargetPlatform({
        storage: { kind: 'sqlite', directory: fixture.b2.base.directory },
        workspace: fixture.workspaceHost, checks: fixture.configuration, now: () => B2_AT });
      const ctx = fixture.ctx;
      const wrote = await platform.notes.writeNote(ctx, { commandId: 's4b-m15-satisfied-write',
        note: draft({ topic: 'satisfied', anchor: { kind: 'task', goalId: fixture.goalRef.goalId,
          taskId: R3E_WORK_TASK_ID } }),
        expectedPointerRevision: null, goalId: fixture.goalRef.goalId });
      if (wrote.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(wrote)}`);

      const opened = await platform.evidence.openVerification(ctx, fixture.openRequest());
      if (opened.status !== 'committed') throw new Error(`open failed: ${JSON.stringify(opened)}`);
      let latest = opened.value;
      for (const check of latest.checks) {
        const begin = await platform.evidence.beginCheck(ctx, fixture.beginRequest(latest, check.checkId));
        if (begin.status !== 'committed') throw new Error(`begin failed: ${JSON.stringify(begin)}`);
        const current = await platform.evidence.readVerification(ctx, latest.ref);
        if (current.status !== 'ready') throw new Error(`round read failed: ${JSON.stringify(current)}`);
        const recorded = await platform.evidence.recordCheckResult(ctx,
          fixture.recordRequest(current.value, check.checkId, begin.value.invocationId, executed(`S4B_OK_${check.checkId}\n`)));
        if (recorded.status !== 'committed') throw new Error(`record failed: ${JSON.stringify(recorded)}`);
        latest = recorded.value;
      }
      const finalized = await platform.evidence.finalizeChecks(ctx, fixture.finalizeRequest(latest));
      if (finalized.status !== 'committed') throw new Error(`finalize failed: ${JSON.stringify(finalized)}`);
      const goalRead = await platform.plans.queryGoal(ctx, fixture.goalRef);
      if (goalRead.status !== 'ready') throw new Error('goal read failed');
      const reductionRef = { aggregateType: 'TaskReduction' as const, projectId: fixture.scope.projectId,
        goalId: fixture.goalRef.goalId, taskId: R3E_WORK_TASK_ID };
      const completed = await platform.goals.completeTask(ctx, {
        input: { taskRef: fixture.subject, planRef: fixture.planRef, roundRef: finalized.value.snapshot.ref },
        meta: { requestId: 's4b-m15-complete', expected: [
          { ref: fixture.goalRef, revision: goalRead.value.goal.revision }, { ref: reductionRef, revision: 0 }] } });
      if (completed.status !== 'committed') throw new Error(`complete failed: ${JSON.stringify(completed)}`);
      expect(completed.value.phase).toBe('satisfied');

      const read = await platform.notes.readNote(ctx, { noteId: wrote.noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.anchorStatus).toBe('live');
      expect(read.value.anchorRetiredReasons).toEqual([]);
      expect(read.value.currentEligible).toBe(true);
    } finally {
      if (platform !== null) await platform.close();
      await fixture.close();
    }
  });
});
