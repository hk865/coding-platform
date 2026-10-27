/** Row 35a's service half: the 23 named rules, each over its own public world and the published owner calls;
 *  every row ends with the fixture's exact named error of the first unpublished call in its exercise. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import {
  armS6B3ChildCommitFault, armS6B3ReadManyFault, callS6B3LateRoute, callS6B3PublishedOwner,
  configureS6B3SecondWorkspace, disposeS6B3SettingsWrapper, holdS6B3AdoptionGate, holdS6B3PreparedGoalAnswer,
  holdS6B3RequestAnswer, installS6B3SettingsSpy, openS6B3World, releaseS6B3DraftAnswer, settingsWithChecks,
  type S6B3World,
} from '../helpers/S6B3-fixture.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { InitialPlanningSetupV2, InitializationSourceV1 } from '../../src/contracts/initial-planning.js';
import type { QueryJobAnswerRef } from '../../src/contracts/query-job.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import {
  initializationAdoptionOperationId, type AdoptionStageProgressV1, type InitializationAdoptResultV1,
  type InitializationAdoptionReadV1, type InitializationAdoptionRef,
} from '../../src/contracts/initialization-adoption.js';

// The commit gates need the barrier's two module mocks; each passes the real backend through unchanged.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal => {
  const barrier = await import('../helpers/S6A-commit-barrier.js');
  return await barrier.inMemoryBarrierModule(importOriginal);
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal => {
  const barrier = await import('../helpers/S6A-commit-barrier.js');
  return await barrier.sqliteBarrierModule(importOriginal);
});

const setup: InitialPlanningSetupV2 = {
  architecture: {
    baselineId: 's6b3-adoption-service-baseline', description: 'the adoption service rows', constraints: [],
    catalog: { requireDag: true, dependencies: [], modules: [] },
  },
  completionPolicy: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 },
  checks: [],
};

type Scope = { projectId: string; workspaceId: string };
type AnswerFact = { ref: QueryJobAnswerRef; digest: string };
type AdoptionRead = ReadResult<InitializationAdoptionReadV1>;
type Accepted = { status: 'accepted'; replayed: boolean; generation: number; cursor: unknown };
type StageWrite = { status: string; replayed?: boolean; value?: { result?: unknown } };
/** One row's isolated public prerequisites: its own world, scope, Goal, saved answer and command id. */
type RowWorld = {
  world: S6B3World; scope: Scope; goal: GoalRef; goalRevision: number; answer: AnswerFact; commandId: string;
  bare: { goal: GoalRef; revision: number; answer: AnswerFact } | null;
  decision: { answerRef: QueryJobAnswerRef; answerText: string } | null;
};

/** One prepared-goal Answer through the fixture's own step 6, read back from its release: ref and saved text. */
async function prepared(world: S6B3World, scope: Scope, target: GoalRef, withSetup: boolean,
  proposal: InitialPlanningSetupV2 = setup): Promise<AnswerFact> {
  const held = await holdS6B3PreparedGoalAnswer(world, { scope, goal: target, ...(withSetup ? { setup: proposal } : {}) });
  const body = await held.release();
  const saved = (body['value'] as Record<string, unknown> | undefined)?.['answer'] as Record<string, unknown> | undefined;
  const ref = saved?.['ref'] as QueryJobAnswerRef | undefined;
  const text = (saved?.['answer'] as Record<string, unknown> | undefined)?.['answer'];
  if (ref === undefined || typeof text !== 'string') throw new Error('the released prepared answer was not saved');
  return { ref, digest: sha256Hex(text) };
}

/**
 * One row's whole case over its own world, never shared with another row: every prerequisite comes from a public
 * step, `body` runs on them, and the world is closed in `finally`.
 */
async function inRow(name: string, body: (row: RowWorld) => Promise<void>,
  options: { bare?: boolean; decision?: boolean } = {}): Promise<void> {
  const world = await openS6B3World({ backend: 'memory', mainGoals: 'none' });
  try {
    const second = await configureS6B3SecondWorkspace(world, { name: `s6b3-adoption-${name}`, goals: 2 });
    const scope: Scope = { projectId: second.scope.projectId, workspaceId: second.scope.workspaceId };
    const [first, other] = second.goals;
    if (first === undefined || other === undefined) throw new Error('the second workspace has too few Goals');
    const answer = await prepared(world, scope, first.ref, true);
    const bare = options.bare === true
      ? { goal: other.ref, revision: other.revision, answer: await prepared(world, scope, other.ref, false) }
      : null;
    // A goal request's initial_coordination answer that needs a decision: a prepared_goal source.
    const decision = options.decision === true
      ? await releaseS6B3DraftAnswer(world, await holdS6B3RequestAnswer(world, { scope, label: `adoption-service-${name}`,
        goalId: other.ref.goalId, executionKind: 'initial_coordination', reply: () => ({ kind: 'text', text: JSON.stringify({
          schemaVersion: 2, kind: 'needs_decision', summary: `S6B3 ${name}`, questions: [`S6B3 ${name} question`] }) }) }))
      : null;
    await body({
      world, scope, goal: first.ref, goalRevision: first.revision, answer, commandId: `s6b3-adopt-${name}`,
      bare, decision,
    });
  } finally {
    await world.close();
  }
}

const bodyOf = (row: RowWorld, over: Record<string, unknown> = {}) => ({
  commandId: row.commandId,
  source: { kind: 'prepared_goal', answerRef: row.answer.ref },
  expectedAnswerDigest: row.answer.digest,
  expectedGoal: { ref: row.goal, revision: row.goalRevision },
  ...over,
});

/** The operation locator the platform derives from a public scope, source and expected Goal: its own recipe. */
function operationRef(row: RowWorld,
  source: InitializationSourceV1 = { kind: 'prepared_goal', answerRef: row.answer.ref },
  expectedGoal: { ref: GoalRef; revision: number } = { ref: row.goal, revision: row.goalRevision },
): InitializationAdoptionRef {
  return {
    aggregateType: 'InitializationAdoption', projectId: row.scope.projectId,
    operationId: initializationAdoptionOperationId({
      projectId: row.scope.projectId, workspaceId: row.scope.workspaceId, source, expectedGoal,
    }),
  };
}

/**
 * The published adoption owner `member` through the fixture's real `callS6B3PublishedOwner`, bound to the row's
 * world, scope and wave; the owner's answer, or the original error, comes back unchanged.
 */
const adoptionOwner = (row: RowWorld, member: 'read' | 'accept' | 'resume' | 'saveBefore' | 'saveAfter',
  input: unknown): Promise<unknown> => callS6B3PublishedOwner(row.world,
  { owner: `initializationAdoption.${member}`, wave: '6b3-w3', scope: row.scope }, input);

const postChecks = async (row: RowWorld, suffix: string, input: unknown): Promise<unknown> =>
  await callS6B3LateRoute(row.world, suffix, '6b3-w3', plain(row.scope, input));

const adoptChecks = async (row: RowWorld, over: Record<string, unknown> = {}): Promise<unknown> =>
  await postChecks(row, 'initialization/adopt', bodyOf(row, over));

const adoptViaRoute = async (row: RowWorld, effect: 'ok' | 'fail-notify' = 'ok'): Promise<InitializationAdoptResultV1> => {
  const save = await settingsWithChecks(row.world, {
    scope: row.scope, answerRef: row.answer.ref, effect, entry: 'narrow', goal: row.goal, commandId: row.commandId,
  });
  if (save.entry !== 'narrow') throw new Error('the fixture answered the direct approval');
  return await save.done;
};

/** A public read that proves an accept rejection left the Goal alone: its own revision did not move. */
async function goalRevisionOf(row: RowWorld, goal: GoalRef = row.goal): Promise<number> {
  const reply = await postChecks(row, 'goals/read', goal) as {
    status?: string; value?: { goal?: { revision?: unknown } };
  };
  const revision = reply.value?.goal?.revision;
  if (reply.status !== 'ready' || typeof revision !== 'number') {
    throw new Error(`the Goal read did not answer a revision: ${JSON.stringify(reply)}`);
  }
  return revision;
}

/** The operation's published read; anything but ready is the row's own failure, with what the owner said. */
async function readyAdoption(row: RowWorld, ref: InitializationAdoptionRef): Promise<InitializationAdoptionReadV1> {
  const read = await adoptionOwner(row, 'read', { operationRef: ref }) as AdoptionRead;
  if (read.status !== 'ready') throw new Error(`the adoption read did not answer ready: ${JSON.stringify(read)}`);
  return read.value;
}

/** The read's mark of `stage`; a read without one is the row's own failure. */
function markOf(read: InitializationAdoptionReadV1, stage: AdoptionStageProgressV1['stage']): AdoptionStageProgressV1 {
  const mark = read.stages.find(candidate => candidate.stage === stage);
  if (mark === undefined) throw new Error(`the adoption record carries no ${stage} mark`);
  return mark;
}

/**
 * The committed before- and after-write inputs of the first stage mark, from the published read: the literal stage
 * identities `<op>:<stage>:-:<phase>:<generation>` with the mark's own frozen material and advance outcome.
 */
async function firstStageWrites(row: RowWorld) {
  const ref = operationRef(row);
  const read = await readyAdoption(row, ref);
  const mark = read.stages[0];
  if (mark === undefined) throw new Error('the adoption record carries no first stage mark');
  const identity = (phase: 'before' | 'after') => ({ operationRef: ref, stage: mark.stage,
    commandId: `${ref.operationId}:${mark.stage}:-:${phase}:${String(read.generation)}`, generation: read.generation });
  return {
    before: { ...identity('before'), child: mark.child, savedInput: mark.savedInput, pins: mark.pins },
    after: { ...identity('after'), branch: 'advance', outcome: mark.outcome, result: mark.result },
  };
}

/**
 * A crash at one boundary of the real architecture stage, proved on memory by the real drive. The gate is armed before
 * the adopt starts and only holds that one real write. While it holds, the published read must show `at` (the next
 * stage and the completed prefix, no result) and pass the row's own `boundary`; resume with that read's pair is the
 * unpersisted acknowledgement there; then the same submission is sent again as the recovery drive. Both drives end
 * committed, and the record was written once per identity: accept, then one before- and one after-write per stage
 * (1 + 2 x 8 = 17). Answers the read held at the boundary and the read after both drives ended.
 */
async function recoverAt(row: RowWorld, point: 'after-before' | 'after-child' | 'after-after',
  at: { stage: AdoptionStageProgressV1['stage']; completedSteps: AdoptionStageProgressV1['stage'][] },
  boundary: (held: InitializationAdoptionReadV1) => void | Promise<void>,
): Promise<{ held: InitializationAdoptionReadV1; final: InitializationAdoptionReadV1 }> {
  const ref = operationRef(row);
  // Both are set in the gate's `use`, which runs while the write is held, before the gate resolves.
  let held!: InitializationAdoptionReadV1;
  let recovered: unknown;
  const gate = holdS6B3AdoptionGate(row.world, { operationRef: ref, stage: 'architecture', point }, async () => {
    held = await readyAdoption(row, ref);
    expect(held).toMatchObject({ ...at, result: null });
    await boundary(held);
    expect(await adoptionOwner(row, 'resume', { operationRef: ref, commandId: `${row.commandId}-resume`,
      expected: { revision: held.revision, generation: held.generation } }))
      .toMatchObject({ status: 'pending', operationRef: ref, ...at, retryable: false,
        failure: { code: 'incomplete' } });
    recovered = await adoptChecks(row);
  });
  const [, original] = await Promise.all([gate, adoptChecks(row)]);
  expect(recovered).toMatchObject({ status: 'committed' });
  expect(original).toMatchObject({ status: 'committed' });
  const final = await readyAdoption(row, ref);
  expect(final).toMatchObject({ revision: 17, result: { status: 'committed' } });
  return { held, final };
}

let restoreSettings: (() => void) | undefined;
// `restoreMocks:true` restores every spy before each test, so the world must find the wrapper installed per test.
beforeEach(() => { restoreSettings = installS6B3SettingsSpy(); });
afterEach(async () => {
  await disposeS6B3SettingsWrapper();
  restoreSettings?.();
  restoreSettings = undefined;
});

describe('the service rows, deferred to the published owner calls (6b3-w3)', () => {
  it('read: a missing record is not_found and writes nothing', async () => {
    const exercise = () => inRow('read-missing', async row => {
      const ref = operationRef(row);
      expect(await adoptionOwner(row, 'read', { operationRef: ref })).toMatchObject({ status: 'not_found' });
      expect(await adoptionOwner(row, 'read', { operationRef: ref })).toMatchObject({ status: 'not_found' });
    });
    await exercise();
  });

  it('read: a store failure is rejected unavailable', async () => {
    const exercise = () => inRow('read-failure', async row => {
      const ref = operationRef(row);
      armS6B3ReadManyFault(row.world, { ref, effect: 'throw-once' });
      expect(await adoptionOwner(row, 'read', { operationRef: ref }))
        .toMatchObject({ status: 'rejected', code: 'unavailable' });
      // The fault threw once: the next read reaches the store, where this operation was never born.
      expect(await adoptionOwner(row, 'read', { operationRef: ref })).toMatchObject({ status: 'not_found' });
    });
    await exercise();
  });

  it('resume: a stale revision or generation is revision_conflict', async () => {
    const exercise = () => inRow('resume-stale', async row => {
      const ref = operationRef(row);
      expect(await adoptionOwner(row, 'accept', bodyOf(row))).toMatchObject({ status: 'accepted' });
      const stale = await readyAdoption(row, ref);
      expect(await adoptionOwner(row, 'accept', bodyOf(row, { commandId: `${row.commandId}-2` })))
        .toMatchObject({ status: 'accepted', replayed: false });
      const settled = await adoptionOwner(row, 'read', { operationRef: ref }) as AdoptionRead;
      expect(await adoptionOwner(row, 'resume', { operationRef: ref, commandId: `${row.commandId}-resume`,
        expected: { revision: stale.revision, generation: stale.generation } }))
        .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      expect(settled).toEqual(await adoptionOwner(row, 'read', { operationRef: ref }));
    });
    await exercise();
  });

  it('resume: no stop and no committed result is the synthesized pending acknowledgement', async () => {
    const exercise = () => inRow('resume-pending', async row => {
      const ref = operationRef(row);
      expect(await adoptionOwner(row, 'accept', bodyOf(row))).toMatchObject({ status: 'accepted' });
      const read = await readyAdoption(row, ref);
      expect(await adoptionOwner(row, 'resume', { operationRef: ref, commandId: `${row.commandId}-resume`,
        expected: { revision: read.revision, generation: read.generation } }))
        .toMatchObject({ status: 'pending', operationRef: ref, stage: 'admission', completedSteps: [],
          retryable: false, failure: { code: 'incomplete' } });
      expect(await readyAdoption(row, ref)).toEqual(read);
    });
    await exercise();
  });

  it('accept: a replay returns the original accepted receipt with replayed true', async () => {
    const exercise = () => inRow('accept-replay', async row => {
      const first = await adoptionOwner(row, 'accept', bodyOf(row)) as Accepted;
      expect(first).toMatchObject({ status: 'accepted', generation: 1, replayed: false });
      const replay = await adoptionOwner(row, 'accept', bodyOf(row)) as Accepted;
      expect(replay.status).toBe('accepted');
      expect(replay.generation).toBe(first.generation);
      expect(replay.cursor).toEqual(first.cursor);
      expect(replay.replayed).toBe(true);
    });
    await exercise();
  });

  it('accept: an existing record with a new commandId and the same basis does not read the answer facts',
    async () => {
      const exercise = () => inRow('accept-existing', async row => {
        expect(await adoptionOwner(row, 'accept', bodyOf(row)))
          .toMatchObject({ status: 'accepted', generation: 1, replayed: false });
        // Armed right before the accept it proves: a read of the saved answer's record would throw.
        const answerReads = armS6B3ReadManyFault(row.world, { ref: row.answer.ref, effect: 'throw-once' });
        expect(await adoptionOwner(row, 'accept', bodyOf(row, { commandId: `${row.commandId}-2` })))
          .toMatchObject({ status: 'accepted', generation: 2, replayed: false });
        expect(answerReads.calls()).toBe(0);
        // The arm is live: a real read of that answer hits it.
        expect(await postChecks(row, 'queries/answer', row.answer.ref))
          .toMatchObject({ status: 'rejected', code: 'unavailable' });
        expect(answerReads.calls()).toBe(1);
      });
      await exercise();
    });

  it('saveBefore/saveAfter: a committed identity whose record has since moved replays its receipt directly',
    async () => {
      const exercise = () => inRow('phase-replay', async row => {
        expect(await adoptChecks(row)).toMatchObject({ status: 'committed' });
        const { before, after } = await firstStageWrites(row);
        const beforeFirst = await adoptionOwner(row, 'saveBefore', before) as StageWrite;
        expect(beforeFirst).toMatchObject({ status: 'committed', replayed: true });
        const afterFirst = await adoptionOwner(row, 'saveAfter', after) as StageWrite;
        expect(afterFirst).toMatchObject({ status: 'committed', replayed: true });
        expect(await adoptionOwner(row, 'accept', bodyOf(row, { commandId: `${row.commandId}-2` })))
          .toMatchObject({ status: 'accepted', replayed: false });
        expect(await adoptionOwner(row, 'saveBefore', before)).toEqual(beforeFirst);
        expect(await adoptionOwner(row, 'saveAfter', after)).toEqual(afterFirst);
      });
      await exercise();
    });

  it('saveBefore/saveAfter: a stored before-mark or completed mark answers unchanged with no new revision',
    async () => {
      const exercise = () => inRow('phase-unchanged', async row => {
        const save = await settingsWithChecks(row.world, {
          scope: row.scope, answerRef: row.answer.ref, effect: 'hang-notify', entry: 'narrow',
          goal: row.goal, commandId: row.commandId,
        });
        if (save.entry !== 'narrow' || save.held === null) {
          throw new Error('the checks save was not held at its notify point');
        }
        await save.held.reached;
        const ref = operationRef(row);
        const mark = markOf(await readyAdoption(row, ref), 'checks');
        if (mark.outcome !== null) throw new Error('the held adopt has no checks before-mark');
        expect(await adoptionOwner(row, 'accept', bodyOf(row, { commandId: `${row.commandId}-2` })))
          .toMatchObject({ status: 'accepted', replayed: false });
        const moved = await readyAdoption(row, ref);
        const unchanged = await adoptionOwner(row, 'saveBefore', {
          commandId: `${ref.operationId}:checks:-:before:${String(moved.generation)}-new`,
          operationRef: ref, stage: 'checks', generation: moved.generation,
          child: mark.child, savedInput: mark.savedInput, pins: mark.pins,
        }) as { status: string; cursor?: unknown };
        expect(unchanged).toMatchObject({ status: 'unchanged' });
        expect(unchanged.cursor).toBeUndefined();
        expect((await readyAdoption(row, ref)).revision).toBe(moved.revision);
        save.release();
        await save.done.catch(() => undefined);
      });
      await exercise();
    });

  it('saveBefore: a stopped mark under the old generation keeps the stored stop', async () => {
    const exercise = () => inRow('phase-stopped', async row => {
      const pending = await adoptViaRoute(row, 'fail-notify');
      expect(pending).toMatchObject({ status: 'pending', stage: 'checks', retryable: false });
      if (pending.status !== 'pending') throw new Error(`the stopped adopt did not answer pending: ${pending.status}`);
      const ref = pending.operationRef;
      const read = await readyAdoption(row, ref);
      // The stored stop and the resume answer are the first pending itself, failure included.
      expect(read.result).toEqual(pending);
      expect(await adoptionOwner(row, 'resume', { operationRef: ref, commandId: `${row.commandId}-resume`,
        expected: { revision: read.revision, generation: read.generation } })).toEqual(pending);
      expect(await readyAdoption(row, ref)).toEqual(read);
      const mark = markOf(read, 'checks');
      const before = await adoptionOwner(row, 'saveBefore', {
        commandId: `${ref.operationId}:checks:-:before:${String(read.generation)}`,
        operationRef: ref, stage: 'checks', generation: read.generation,
        child: mark.child, savedInput: mark.savedInput, pins: mark.pins,
      }) as StageWrite;
      expect(before).toMatchObject({ status: 'committed', replayed: true });
      // The before receipt is the record as that before write committed it, not the later stopped record.
      expect(before.value?.result).toBeNull();
    });
    await exercise();
  });

  it('crash after saveBefore and before the child recovers the same frozen input, pins and child', async () => {
    const exercise = () => inRow('crash-before', async row => {
      const { held, final } = await recoverAt(row, 'after-before',
        { stage: 'architecture', completedSteps: ['admission', 'freeze'] }, async read => {
          // The before-write landed and its mark is open; the child's adoption has not committed.
          expect(markOf(read, 'architecture')).toMatchObject({ outcome: null, result: null });
          expect(await postChecks(row, 'architecture/read', { selection: { kind: 'current' } }))
            .toMatchObject({ status: 'not_found' });
        });
      const { child, savedInput, pins } = markOf(held, 'architecture');
      expect(markOf(final, 'architecture')).toMatchObject({ outcome: 'installed', child, savedInput, pins });
    });
    await exercise();
  });

  it('crash after the child commit and before saveAfter writes the after identity once', async () => {
    const exercise = () => inRow('crash-child', async row => {
      const { held, final } = await recoverAt(row, 'after-child',
        { stage: 'architecture', completedSteps: ['admission', 'freeze'] }, async read => {
          // The child's adoption committed; the after-write has not landed, so the mark is still open.
          expect(markOf(read, 'architecture')).toMatchObject({ outcome: null, result: null });
          expect(await postChecks(row, 'architecture/read', { selection: { kind: 'current' } }))
            .toMatchObject({ status: 'ready' });
        });
      // The recovery drive's child call replayed the original commit (a second adoption is refused), so its
      // after-write carries the same child receipt as the held one, which then replays instead of writing again.
      const { child, savedInput, pins } = markOf(held, 'architecture');
      expect(markOf(final, 'architecture')).toMatchObject({ outcome: 'installed', child, savedInput, pins,
        result: { kind: 'ledger', receipt: { commandId: `${operationRef(row).operationId}/architecture` } } });
    });
    await exercise();
  });

  it('crash after saveAfter and before the next resume keeps the extended prefix durable', async () => {
    const exercise = () => inRow('crash-after', async row => {
      const { held, final } = await recoverAt(row, 'after-after',
        { stage: 'policy_install', completedSteps: ['admission', 'freeze', 'architecture'] }, read => {
          // The after-write landed: the prefix is extended and the architecture mark is complete.
          expect(markOf(read, 'architecture')).toMatchObject({ outcome: 'installed' });
        });
      // The recovery drive went on from the next stage: the architecture mark was never written again.
      expect(markOf(final, 'architecture')).toEqual(markOf(held, 'architecture'));
    });
    await exercise();
  });

  it('stop failed unavailable is pending retryable:true and a new accept raises the generation', async () => {
    const exercise = () => inRow('stop-retryable', async row => {
      const ref = operationRef(row);
      armS6B3ChildCommitFault(row.world, { operationRef: ref, stage: 'architecture', effect: 'throw-once' });
      const stopped = await adoptChecks(row);
      // The arm fires only on L's child label; under another label the fault never fires and this stop is missing.
      expect(stopped, `no unavailable stop: the child commit fault fires only on ${ref.operationId}/architecture`)
        .toMatchObject({ status: 'pending', operationRef: ref, stage: 'architecture',
          completedSteps: ['admission', 'freeze'], retryable: true, failure: { code: 'unavailable' } });
      const read = await readyAdoption(row, ref);
      expect(read.result).toEqual(stopped);
      expect(markOf(read, 'architecture')).toMatchObject({ outcome: 'failed' });
      expect(await adoptionOwner(row, 'accept', bodyOf(row, { commandId: `${row.commandId}-2` })))
        .toMatchObject({ status: 'accepted', generation: 2, replayed: false });
      // Only the generation and revision move; the stop and the prefix stay.
      expect(await readyAdoption(row, ref)).toMatchObject({ revision: read.revision + 1, generation: 2,
        completedSteps: ['admission', 'freeze'], result: stopped });
    });
    await exercise();
  });

  it('stop failed with a non-retryable code is pending retryable:false', async () => {
    const exercise = () => inRow('stop-non-retryable', async row => {
      const ref = operationRef(row);
      // The gate is armed first and holds the answer of the real architecture before-write; it adopts nothing.
      const gate = holdS6B3AdoptionGate(row.world, { operationRef: ref, stage: 'architecture', point: 'after-before' },
        async () => {
          // The before-write landed: its mark is open and stores no child result.
          expect(markOf(await readyAdoption(row, ref), 'architecture')).toMatchObject({ outcome: null, result: null });
          const registration = await postChecks(row, 'workspaces/registration', row.scope) as {
            value?: { project: { revision: number }; workspace: { revision: number } } };
          if (registration.value === undefined) throw new Error('the workspace registration read was not ready');
          // A real competing adoption of another baseline commits first, through its public route.
          expect((await row.world.host.post('architecture/adopt-initial', graphWrite(row.scope, {
            ...setup.architecture, baselineId: 's6b3-adoption-service-competing',
          }, `${row.commandId}-competing`, [
            { ref: { aggregateType: 'Project', projectId: row.scope.projectId },
              revision: registration.value.project.revision },
            { ref: { aggregateType: 'Workspace', ...row.scope }, revision: registration.value.workspace.revision },
          ]))).body).toMatchObject({ status: 'committed' });
        });
      const [, stopped] = await Promise.all([gate, adoptChecks(row)]);
      expect(stopped).toMatchObject({ status: 'pending', operationRef: ref, stage: 'architecture',
        completedSteps: ['admission', 'freeze'], retryable: false, failure: { code: 'revision_conflict' } });
      const read = await readyAdoption(row, ref);
      expect(read.result).toEqual(stopped);
      expect(markOf(read, 'architecture')).toMatchObject({ outcome: 'failed' });
    });
    await exercise();
  });

  it('AJ-02: replaying a committed phase write answers its own receipt without reading the current record',
    async () => {
      const exercise = () => inRow('aj-02', async row => {
        expect(await adoptChecks(row)).toMatchObject({ status: 'committed' });
        const ref = operationRef(row);
        const { before, after } = await firstStageWrites(row);
        const beforeReceipt = await adoptionOwner(row, 'saveBefore', before);
        expect(beforeReceipt).toMatchObject({ status: 'committed', replayed: true });
        const afterReceipt = await adoptionOwner(row, 'saveAfter', after);
        expect(afterReceipt).toMatchObject({ status: 'committed', replayed: true });
        // From here every read of the operation's own record throws.
        const recordReads = armS6B3ReadManyFault(row.world, { ref, effect: 'throw-always' });
        expect(await adoptionOwner(row, 'saveBefore', before)).toEqual(beforeReceipt);
        expect(await adoptionOwner(row, 'saveAfter', after)).toEqual(afterReceipt);
        expect(recordReads.calls()).toBe(0);
        // The arm is live: the published read of the same record hits it.
        expect(await adoptionOwner(row, 'read', { operationRef: ref }))
          .toMatchObject({ status: 'rejected', code: 'unavailable' });
        expect(recordReads.calls()).toBe(1);
      });
      await exercise();
    });
});

// AJ-03 unproven: no public step puts a second legal Host person in one store; the human and system contexts share
// one owner; the system route is refused by the person guard as `forbidden` first; a hand-built ctx is not allowed.
describe('rejects: the adoption service refusals, deferred to the published owner calls (6b3-w3)', () => {
  it('accept: the same commandId with different input is idempotency_conflict', async () => {
    const exercise = () => inRow('same-command', async row => {
      expect(await adoptChecks(row)).toMatchObject({ status: 'committed', replayed: false });
      const before = await goalRevisionOf(row);
      const ref = operationRef(row);
      const adoptionBefore = await readyAdoption(row, ref);
      expect(await adoptChecks(row, { expectedAnswerDigest: sha256Hex('another saved answer') }))
        .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
      expect(await goalRevisionOf(row)).toBe(before);
      expect(await readyAdoption(row, ref)).toEqual(adoptionBefore);
    });
    await exercise();
  });

  it('accept: a new submission whose basis moved is revision_conflict', async () => {
    const exercise = () => inRow('moved-basis', async row => {
      expect(await adoptChecks(row)).toMatchObject({ status: 'committed' });
      const before = await goalRevisionOf(row);
      const ref = operationRef(row);
      const adoptionBefore = await readyAdoption(row, ref);
      expect(await adoptChecks(row, { commandId: `${row.commandId}-2`,
        expectedAnswerDigest: sha256Hex('a moved basis') }))
        .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      expect(await goalRevisionOf(row)).toBe(before);
      expect(await readyAdoption(row, ref)).toEqual(adoptionBefore);
    });
    await exercise();
  });

  it('accept: needs_decision is invalid and writes no record', async () => {
    const exercise = () => inRow('needs-decision', async row => {
      const bare = row.bare;
      const decision = row.decision;
      if (bare === null || decision === null) throw new Error('the row lacks its needs_decision prerequisite');
      const before = await goalRevisionOf(row, bare.goal);
      const source = { kind: 'prepared_goal' as const, answerRef: decision.answerRef };
      const expectedGoal = { ref: bare.goal, revision: bare.revision };
      expect(await adoptChecks(row, {
        commandId: `${row.commandId}-decision`,
        source,
        expectedAnswerDigest: sha256Hex(decision.answerText),
        expectedGoal,
      })).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(await goalRevisionOf(row, bare.goal)).toBe(before);
      expect(await adoptionOwner(row, 'read', { operationRef: operationRef(row, source, expectedGoal) }))
        .toMatchObject({ status: 'not_found' });
    }, { bare: true, decision: true });
    await exercise();
  });

  it('accept: no setup with either governance read missing is incomplete', async () => {
    const exercise = () => inRow('missing-governance', async row => {
      const bare = row.bare;
      if (bare === null) throw new Error('the row lacks its bare prepared answer');
      const before = await goalRevisionOf(row, bare.goal);
      const source = { kind: 'prepared_goal' as const, answerRef: bare.answer.ref };
      const expectedGoal = { ref: bare.goal, revision: bare.revision };
      expect(await adoptChecks(row, {
        commandId: `${row.commandId}-bare`,
        source,
        expectedAnswerDigest: bare.answer.digest,
        expectedGoal,
      })).toMatchObject({ status: 'rejected', code: 'incomplete' });
      expect(await goalRevisionOf(row, bare.goal)).toBe(before);
      expect(await adoptionOwner(row, 'read', { operationRef: operationRef(row, source, expectedGoal) }))
        .toMatchObject({ status: 'not_found' });
    }, { bare: true });
    await exercise();
  });

  it('accept: a digest other than sha256Hex(answerText) is source_stale', async () => {
    const exercise = () => inRow('wrong-digest', async row => {
      const before = await goalRevisionOf(row);
      expect(await adoptChecks(row, { expectedAnswerDigest: sha256Hex('not the saved answer') }))
        .toMatchObject({ status: 'rejected', code: 'source_stale' });
      expect(await goalRevisionOf(row)).toBe(before);
      expect(await adoptionOwner(row, 'read', { operationRef: operationRef(row) }))
        .toMatchObject({ status: 'not_found' });
    });
    await exercise();
  });

  it('accept: expectedGoal different from the source-resolved Goal is revision_conflict', async () => {
    const exercise = () => inRow('goal-mismatch', async row => {
      const before = await goalRevisionOf(row);
      expect(await adoptChecks(row, { expectedGoal: { ref: row.goal, revision: row.goalRevision + 1 } }))
        .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      expect(await goalRevisionOf(row)).toBe(before);
      expect(await adoptionOwner(row, 'read', { operationRef: operationRef(row) }))
        .toMatchObject({ status: 'not_found' });
    });
    await exercise();
  });

  it('accept: a binding or source read failure is the literal rejection, never a bare ReadResult', async () => {
    const exercise = () => inRow('read-failure-accept', async row => {
      const before = await goalRevisionOf(row);
      const missingSource = { kind: 'prepared_goal' as const,
        answerRef: { ...row.answer.ref, answerId: 's6b3-missing-answer' } };
      const bindingSource = { kind: 'binding' as const, answerRef: row.answer.ref, draftIndex: 0 };
      expect(await adoptChecks(row, { source: missingSource }))
        .toMatchObject({ status: 'rejected', code: 'not_found' });
      expect(await adoptChecks(row, { commandId: `${row.commandId}-binding`, source: bindingSource }))
        .toMatchObject({ status: 'rejected', code: 'source_stale' });
      expect(await goalRevisionOf(row)).toBe(before);
      // Neither refusal is born as an operation: each source's own locator reads not_found.
      expect(await adoptionOwner(row, 'read', { operationRef: operationRef(row, missingSource) }))
        .toMatchObject({ status: 'not_found' });
      expect(await adoptionOwner(row, 'read', { operationRef: operationRef(row, bindingSource) }))
        .toMatchObject({ status: 'not_found' });
    });
    await exercise();
  });

  it('saveBefore: a new stage-write identity under an old generation is revision_conflict', async () => {
    const exercise = () => inRow('old-generation', async row => {
      expect(await adoptChecks(row)).toMatchObject({ status: 'committed' });
      const ref = operationRef(row);
      const { before } = await firstStageWrites(row);
      expect(await adoptionOwner(row, 'accept', bodyOf(row, { commandId: `${row.commandId}-2` })))
        .toMatchObject({ status: 'accepted', replayed: false });
      const settled = await adoptionOwner(row, 'read', { operationRef: ref }) as AdoptionRead;
      expect(await adoptionOwner(row, 'saveBefore', { ...before, commandId: `${before.commandId}-new` }))
        .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      expect(await adoptionOwner(row, 'read', { operationRef: ref })).toEqual(settled);
    });
    await exercise();
  });
});
