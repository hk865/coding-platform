/**
 * The module-overlap gate service over real worlds, and record 4's storage half.
 *
 * `N-owner` opens the real L46 Host (`openS7BL46World`), adopts a real module-scoped Plan revision through
 * `plans/propose` + `plans/apply`, runs its module task through the public Workflow, and holds that Run at its model
 * request (`world.gates.modelRequest`) while `executions/read` / `tasks/query` answer its `startedSince` and the waiting
 * Task's `currentAttempt`. It builds `createOverlapGateService` with the Host's own records, the real F1 duty resolver,
 * 7A's real mailbox send, the real note current-version read and the world clock. Notes, releases and requeues are
 * public routes/owners.
 *
 * `N-records` opens a store with `open(...)` and `MODULE_OVERLAP_GATE_SCHEMAS` only; it keeps the same real Host front
 * and swaps only the service's store. It asserts through the service's public reads, never a store row.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef, GoalSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { WriteNoteEnvelopeV1 } from '../../src/core/work-graph/model/note-contracts.js';
import type { TaskRow } from '../../src/core/work-graph/model/plan-contracts.js';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { ModuleOverlapGateV1 } from '../../src/core/work-graph/persistence/module-overlap-gate-codecs.js';
import { MODULE_OVERLAP_GATE_SCHEMAS } from '../../src/core/work-graph/persistence/module-overlap-gate-codecs.js';
import { compareCursors } from '../../src/contracts/ledger.js';
import { noteHeadRefKey } from '../../src/core/work-graph/persistence/note-record-codecs.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { workspaceOf } from '../../src/core/work-graph/tasks/request-service.js';
import { createOverlapGateService, type OpenOverlapGateInputV1, type OpenOverlapGateResultV1,
  type OverlapGatePort, type OverlapGateServiceDependencies } from '../../src/core/work-graph/tasks/overlap-gates.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { draftFrom } from '../scenarios/support/common.js';
import { driveWorkflow, readExecution } from '../helpers/A2-restart-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { open } from '../helpers/S4B-text-search-support.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE, S6A_SECRETARY_ROLE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { claimedRunOf, committed, ready, sessionOf } from '../helpers/S7A-fixture.js';
import { openS7BL46World } from '../helpers/S7B-L46-fixture.js';
import { dutyOf } from '../helpers/S7C-duty-fixture.js';

// The real commit barrier wraps both backends for this file (the N-03 read-fault row and N-06's send fault arm it).
vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const ADVISER = platformRoleProfile('adviser').template;
const MODULE = 's6a-core';
const STAGE = 's7c-stage';
const NOTE_TEXT = PLATFORM_PROMPT_PACK_V1.strings['overlap.noteRequest']!;

/** The service over the real Host records (or an N-records row's explicit bundle), the real resolver, mailbox and clock. */
function serviceOf(world: S6AHostWorld,
  records: OverlapGateServiceDependencies['records'] = world.platform.disconnect.records): OverlapGatePort {
  const duty = dutyOf(world);
  return createOverlapGateService({
    records,
    resolveRecipient: (ctx, _goalRef, name) => duty.resolveDutyRecipient(ctx, { workspace: workspaceOf(ctx), duty: name }),
    sendMessage: (ctx, write) => world.platform.messages.sendMessage(ctx, write),
    // DR-02 wiring, not a stand-in: the Host's own current-version read, projected into the service's deps shape.
    readNotes: async (ctx, { moduleId }) => {
      const read = await world.platform.notes.listCurrentVersions(ctx,
        { anchor: { kind: 'module', moduleId }, limit: 100, cursor: null });
      return read.status === 'ready' ? { status: 'ready', value: read.value.items } : read;
    },
    noteRequestText: NOTE_TEXT,
    now: () => world.clock.now(),
  });
}

const triple = (goal: GoalRef, taskId: string): TaskTriple =>
  ({ projectId: goal.projectId, goalId: goal.goalId, taskId });

/** A fresh module-scoped Plan revision on the L46 Host; every module task names `s6a-core` and `s7c-stage`. */
async function adoptModulePlan(ws: S6ACardsWorkspace, goal: GoalRef, label: string,
  extraRunTasks: readonly string[] = []): Promise<PlanRevisionSnapshot> {
  const current = await ws.activePlan(goal);
  if (current === null) throw new Error(`S7C: ${goal.goalId} has no active Plan to revise`);
  const moduleTaskIds = ['s7c-run', 's7c-wait', ...extraRunTasks];
  const draft: PlanRevisionDraft = draftFrom(current, `s7c-plan-${label}`, source => ({
    ...source,
    stages: source.stages.some(stage => stage.stageId === STAGE)
      ? source.stages : [...source.stages, { stageId: STAGE, title: 'S7C module stage' }],
    tasks: [...source.tasks.filter(task => !moduleTaskIds.includes(task.taskId)),
      ...moduleTaskIds.map(taskId => ({ taskId, title: `S7C ${taskId} on ${MODULE}`,
        requirementLevel: 'required' as const, taskKind: 'work' as const, disposition: 'active' as const,
        phase: 'pending' as const, executionIntent: 'request_execution' as const,
        scope: { kind: 'module' as const, stageId: STAGE, moduleRef: MODULE } }))],
    assignments: [...(source.assignments ?? []).filter(entry => !moduleTaskIds.includes(entry.taskId)),
      ...moduleTaskIds.map(taskId => ({
        taskId, role: S6A_WORK_ROLE.templateId, instruction: `S7C ${taskId} on ${MODULE}` }))],
    obligations: source.obligations.map((obligation, index) => index === 0
      ? { ...obligation, taskIds: [...new Set([...obligation.taskIds, ...moduleTaskIds])] } : obligation),
  }));
  const proposed = committed<{ ref: unknown; revision: number }>(await ws.post('plans/propose', graphWrite(ws.scope, {
    goalRef: goal, basedOn: current?.ref ?? null, draft, reason: { text: `S7C N plan ${label}`, sources: [] },
  }, `s7c-plan-${label}-propose`)), `the S7C Plan ${label}`);
  committed(await ws.post('plans/apply', graphWrite(ws.scope, {
    proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
  }, `s7c-plan-${label}-apply`)), `the adoption of the S7C Plan ${label}`);
  const plan = await ws.activePlan(goal);
  if (plan === null) throw new Error(`S7C: ${goal.goalId} has no Plan after ${label}`);
  return plan;
}

/** The waiting Task's `currentAttempt?.attemptId ?? 'none'` through the public graph read. */
async function waitingAttemptOf(world: S6AHostWorld, goal: GoalRef, taskId: string): Promise<string> {
  const graph = ready<{ tasks: TaskRow[] }>(await world.post('tasks/query',
    plain(S6A_SCOPE, { goalRef: goal })), `the graph of ${goal.goalId}`);
  const row = graph.tasks.find(candidate => candidate.ref.taskId === taskId);
  if (row === undefined) throw new Error(`S7C: the Task ${taskId} is not in the graph`);
  return row.currentAttempt?.attemptId ?? 'none';
}

/** The Run's real `startedSince` through the public execution read (null until the Kernel entry commits). */
async function startedSinceOf(world: S6AHostWorld, run: RunRef): Promise<CommitCursor | null> {
  return (await readExecution(world.ag2b, run)).run.startedSince;
}

/** The person's real module note (`notes/write`, accepted at once). */
async function writeModuleNote(world: S6AHostWorld, goal: GoalRef, topic: string): Promise<WriteNoteEnvelopeV1> {
  const body = await world.post('notes/write', plain(S6A_SCOPE, {
    commandId: `s7c-note-${topic}`, goalId: goal.goalId, expectedPointerRevision: null,
    note: { kind: 'convention', topic, conclusion: `S7C module note ${topic}`,
      anchor: { kind: 'module', moduleId: MODULE }, extraAnchors: [], facts: [], basisFiles: [],
      structural: false, replaces: [], contradicts: [], coexistWith: [], body: `S7C body ${topic}` },
  }));
  const envelope = (body as { body?: unknown }).body as WriteNoteEnvelopeV1 | undefined;
  if (envelope === undefined) throw new Error(`S7C: notes/write did not answer an envelope: ${JSON.stringify(body)}`);
  if (envelope.write.status !== 'accepted') throw new Error(`S7C: the note was not accepted: ${JSON.stringify(envelope)}`);
  return envelope;
}

/** A conflicting Run held at a real gate: `running` at its model request, `entering` after its start commit. */
type RunHold = { run: RunRef; startedSince: CommitCursor | null };

type NOwnerBase = {
  world: S6AHostWorld;
  ws: S6ACardsWorkspace;
  goal: GoalRef;
  plan: PlanRevisionSnapshot;
  runTask: TaskTriple;
  waitTask: TaskTriple;
  l46Run: RunRef;
  l46Task: TaskTriple;
  runLine: Awaited<ReturnType<typeof createS6BLine>>;
  start: Awaited<ReturnType<typeof driveWorkflow>>[number]['next'];
  service: OverlapGatePort;
  close(): Promise<void>;
};

type NOwnerOptions = {
  adviser?: boolean;
  secretary?: boolean;
  /** An N-records row's explicit schema bundle: only the service's store is swapped, every other dependency is real. */
  store?: { records: OverlapGateServiceDependencies['records']; close(): Promise<void> };
};

/**
 * The shared real world of the N rows: the L46 Host, a module Plan, the Run line and the Workflow stopped before
 * `start`. `startRun` performs the real start and answers the running Run; `startRunBeforeEntry` answers its public
 * read after the start commit and before the Kernel entry. Both hold the conflict until `close`.
 */
async function openNOwner(options: NOwnerOptions = {}): Promise<NOwnerBase & {
  startRun(): Promise<RunHold>;
  startRunBeforeEntry(): Promise<RunHold>;
}> {
  const opened = await openS7BL46World({ backend: 'memory' });
  const world = opened.world;
  const ws = s6aCardsWorkspace(world, S6A_SCOPE);
  const goal = opened.goalRef;
  let pendingRelease: (() => Promise<void>) | null = null;
  const close = async () => {
    const release = pendingRelease;
    pendingRelease = null;
    try {
      if (release !== null) await release();
    } finally {
      try {
        await world.close();
      } finally {
        await options.store?.close();
      }
    }
  };
  try {
    const plan = await adoptModulePlan(ws, goal, 'one');
    const runTask = triple(goal, 's7c-run');
    const waitTask = triple(goal, 's7c-wait');
    const runLine = await createS6BLine(ws, { label: 's7c-run-line', role: S6A_WORK_ROLE, tasks: [runTask] });
    if (options.adviser === true) await createS6BLine(ws, { label: 's7c-adviser', role: ADVISER });
    if (options.secretary === true) await createS6BLine(ws, { label: 's7c-secretary', role: S6A_SECRETARY_ROLE });
    const prepared = await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 's7c-run',
      sessionHint: runLine.ref, kind: 'select_work', taskId: runTask.taskId }, { stopBefore: 'start' });
    const start = prepared.at(-1)?.next ?? null;
    if (start === null) throw new Error('S7C: the module Run prepared without a start step');
    const runStart: WorkflowAdvanceInput = start;
    const service = serviceOf(world, options.store?.records);

    async function holdRun(gate: 'model' | 'entry'): Promise<RunHold> {
      const session = await sessionOf(world, runLine);
      world.scripted.script(session, [{ kind: 'text', text: 'S7C conflicting module Run answered' }]);
      const hold = gate === 'model'
        ? await world.gates.modelRequest(session)
        : await world.gates.beforeKernel(session);
      const drive = driveWorkflow(world.ag2b, runStart);
      try {
        await Promise.race([hold.reached, drive]);
        const run = await ws.taskRun(goal, runTask.taskId);
        if (run === null) throw new Error(`S7C: the Task ${runTask.taskId} has no running Run`);
        const startedSince = await startedSinceOf(world, run);
        if (gate === 'model' && startedSince === null) {
          throw new Error(`S7C: the running Run ${run.runId} has no startedSince`);
        }
        const release = async () => { try { hold.release(); } finally { await drive; } };
        pendingRelease = release;
        return { run, startedSince };
      } catch (error) {
        hold.release();
        await drive.catch(() => undefined);
        throw error;
      }
    }

    const base = { world, ws, goal, plan, runTask, waitTask, l46Run: opened.run, l46Task: opened.tasks.A,
      runLine, start, service, close };
    return {
      ...base,
      startRun: () => holdRun('model'),
      startRunBeforeEntry: () => holdRun('entry'),
    };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}

function basisInput(base: { goal: GoalRef; runTask: TaskTriple; waitTask: TaskTriple },
  running: { run: RunRef; startedSince: CommitCursor | null }, planRevision: number, waitingAttempt: string,
  task = base.waitTask): OpenOverlapGateInputV1 {
  return { goalRef: base.goal, task, moduleId: MODULE,
    running: [{ task: base.runTask, run: running.run, startCursor: running.startedSince }],
    planRevision, waitingAttempt };
}

/** An N-records gate input over the same real conflict and a real Task of the adopted Plan. */
function recordsBasisOf(base: NOwnerBase, task: TaskTriple, running: RunHold, waitingAttempt: string):
  OpenOverlapGateInputV1 {
  return basisInput(base, running, base.plan.planRevision, waitingAttempt, task);
}

const human = (base: NOwnerBase) => base.world.humanContext();
const system = (base: NOwnerBase) => base.world.systemContext();

/** The gate ref the service derives from the waiting Task and module. */
const gateRefOf = (base: NOwnerBase) => ({ aggregateType: 'ModuleOverlapGate' as const,
  projectId: base.goal.projectId, goalId: base.goal.goalId, taskId: base.waitTask.taskId, moduleId: MODULE });

async function readGate(base: NOwnerBase): Promise<ModuleOverlapGateV1> {
  const read = await base.service.readOverlapGate(system(base), { gate: gateRefOf(base) });
  expect(read.status).toBe('ready');
  if (read.status !== 'ready') throw new Error('S7C: the gate read is not ready');
  return read.value;
}

describe('N-owner', () => {
  it('opens once and replays the same basis without a second note request', async () => {
    const base = await openNOwner({ adviser: true });
    try {
      const running = await base.startRun();
      const input = basisInput(base, running, base.plan.planRevision, await waitingAttemptOf(base.world, base.goal, base.waitTask.taskId));
      const first = await base.service.openOverlapGate(system(base), input);
      expect(first).toMatchObject({ status: 'opened', replayed: false, noteRequest: 'sent' });
      if (first.status !== 'opened') return;
      const adviser = await dutyOf(base.world).resolveDutyRecipient(human(base),
        { workspace: workspaceOf(human(base)), duty: 'adviser' });
      if (adviser.status !== 'ready' || adviser.value === null) throw new Error('S7C: the adviser must resolve');
      const inboxBefore = ready<{ items: unknown[] }>(await base.world.post('messages/inbox',
        plain(S6A_SCOPE, { recipient: { projectId: adviser.value.projectId, sessionId: adviser.value.sessionId },
          page: { limit: 20 } })), 'the adviser inbox');
      expect(inboxBefore.items).toHaveLength(1);

      const second = await base.service.openOverlapGate(system(base), input);
      expect(second).toMatchObject({ status: 'opened', replayed: true });
      if (second.status !== 'opened') return;
      expect(second.gate.revision).toBe(first.gate.revision);
      const inboxAfter = ready<{ items: unknown[] }>(await base.world.post('messages/inbox',
        plain(S6A_SCOPE, { recipient: { projectId: adviser.value.projectId, sessionId: adviser.value.sessionId },
          page: { limit: 20 } })), 'the adviser inbox');
      expect(inboxAfter.items).toHaveLength(1);
    } finally {
      await base.close();
    }
  });

  it.each(['memory', 'sqlite'] as const)(
    '%s: replays the same conflict set in a different order instead of an idempotency conflict',
    async (kind: 'memory' | 'sqlite') => {
      const store = await open(kind, { schemas: MODULE_OVERLAP_GATE_SCHEMAS });
      const base = await openNOwner({ adviser: true, store: { records: store.backend.records,
        close: () => store.backend.close() } });
      const releases: Array<() => Promise<void>> = [];
      try {
        // The second running Run is a second real module Task on the same Plan. Both starts are prepared under the
        // adopted revision, so each claim pins the Goal's active Plan; a Plan revision adopted after a start was
        // prepared would make that start stale.
        const secondTask = triple(base.goal, 's7c-run2');
        const plan = await adoptModulePlan(base.ws, base.goal, 'two-runs', ['s7c-run2']);
        const prepare = async (flowId: string, task: TaskTriple,
          line: Awaited<ReturnType<typeof createS6BLine>>): Promise<WorkflowAdvanceInput> => {
          const steps = await driveWorkflow(base.world.ag2b, { schemaVersion: 1, goalRef: base.goal, flowId,
            sessionHint: line.ref, kind: 'select_work', taskId: task.taskId }, { stopBefore: 'start' });
          const next = steps.at(-1)?.next ?? null;
          if (next === null) throw new Error(`S7C: the module Run ${task.taskId} prepared without a start step`);
          return next;
        };
        const firstStart = await prepare('s7c-run', base.runTask, base.runLine);
        const secondLine = await createS6BLine(base.ws, { label: 's7c-run2-line', role: S6A_WORK_ROLE, tasks: [secondTask] });
        const hold = async (task: TaskTriple, line: Awaited<ReturnType<typeof createS6BLine>>,
          start: WorkflowAdvanceInput): Promise<RunHold> => {
          const session = await sessionOf(base.world, line);
          base.world.scripted.script(session, [{ kind: 'text', text: `S7C ${task.taskId} answered` }]);
          const gate = await base.world.gates.modelRequest(session);
          const drive = driveWorkflow(base.world.ag2b, start);
          try {
            await Promise.race([gate.reached, drive]);
            const run = await base.ws.taskRun(base.goal, task.taskId);
            if (run === null) throw new Error(`S7C: the Task ${task.taskId} has no running Run`);
            const startedSince = (await readExecution(base.world.ag2b, run)).run.startedSince;
            if (startedSince === null) throw new Error(`S7C: the running Run ${run.runId} has no startedSince`);
            releases.push(async () => { try { gate.release(); } finally { await drive; } });
            return { run, startedSince };
          } catch (error) {
            gate.release();
            await drive.catch(() => undefined);
            throw error;
          }
        };
        // L1-23: the first Run starts and stays running; the second Run reaches its real module gate first.
        const firstRun = await hold(base.runTask, base.runLine, firstStart);
        const gateReceipts: WorkflowStepReceipt[] = [];
        await driveWorkflow(base.world.ag2b, { schemaVersion: 1, goalRef: base.goal, flowId: 's7c-run2-gate',
          sessionHint: secondLine.ref, kind: 'select_work', taskId: secondTask.taskId },
        { stopBefore: 'request_overlap_note', receipts: gateReceipts });
        const openedGate = gateReceipts.find(receipt => receipt.kind === 'open_overlap_gate');
        const gate = (openedGate as { result?: { gate?: ModuleOverlapGateV1 } } | undefined)?.result?.gate;
        if (gate === undefined) throw new Error('S7C: the second Run did not open the module gate');
        const released = await base.world.post('goals/overlap-release', plain(S6A_SCOPE, {
          commandId: 's7c-run2-gate-release', gate: gate.ref, revision: gate.revision,
          reason: 'S7C person releases the second Run',
        }));
        if ((released.body as { status?: string }).status !== 'released') {
          throw new Error(`S7C: the person's gate release did not commit: ${JSON.stringify(released.body)}`);
        }
        const secondStart = await prepare('s7c-run2', secondTask, secondLine);
        const secondRun = await hold(secondTask, secondLine, secondStart);
        const input = basisInput(base, firstRun, plan.planRevision, await waitingAttemptOf(base.world, base.goal, base.waitTask.taskId));
        const twoRuns: OpenOverlapGateInputV1 = { ...input, running: [
          { task: base.runTask, run: firstRun.run, startCursor: firstRun.startedSince },
          { task: secondTask, run: secondRun.run, startCursor: secondRun.startedSince },
        ] };
        const first = await base.service.openOverlapGate(system(base), twoRuns);
        expect(first).toMatchObject({ status: 'opened', replayed: false });
        if (first.status !== 'opened') return;
        const reordered = await base.service.openOverlapGate(system(base),
          { ...twoRuns, running: [...twoRuns.running].reverse() });
        expect(reordered).toMatchObject({ status: 'opened', replayed: true });
        if (reordered.status !== 'opened') return;
        expect(reordered.gate.revision).toBe(first.gate.revision);
      } finally {
        try {
          for (const release of releases.reverse()) await release();
        } finally {
          await base.close();
        }
      }
    });

  it.each([
    { state: 'adviser', adviser: true, secretary: false, duty: 'adviser' as const },
    { state: 'secretary', adviser: false, secretary: true, duty: 'secretary' as const },
    { state: 'none', adviser: false, secretary: false, duty: null },
  ])('requests the note from the real $state recipient state and saves the plain SessionRef', async entry => {
    const base = await openNOwner({ adviser: entry.adviser, secretary: entry.secretary });
    try {
      const running = await base.startRun();
      const opened = await base.service.openOverlapGate(system(base), basisInput(base, running, base.plan.planRevision, await waitingAttemptOf(base.world, base.goal, base.waitTask.taskId)));
      expect(opened.status).toBe('opened');
      if (opened.status !== 'opened') return;
      const gate = await readGate(base);
      if (entry.duty === null) {
        expect(opened.noteRequest).toBe('none');
        expect(opened.gate.noteRequest).toEqual({ recipient: null, reason: 'no_adviser_or_secretary' });
        expect(gate.noteRequest).toEqual({ recipient: null, reason: 'no_adviser_or_secretary' });
        return;
      }
      expect(opened.noteRequest).toBe('sent');
      const resolved = await dutyOf(base.world).resolveDutyRecipient(system(base),
        { workspace: workspaceOf(system(base)), duty: entry.duty });
      if (resolved.status !== 'ready' || resolved.value === null) throw new Error(`S7C: the ${entry.state} must resolve`);
      const recipient: SessionRef = { projectId: resolved.value.projectId, sessionId: resolved.value.sessionId };
      expect(gate.noteRequest).toMatchObject({ recipient, duty: entry.duty });
      expect(gate.noteRequest?.recipient).toEqual(recipient);
      expect(gate.noteRequest?.recipient).not.toHaveProperty('aggregateType');
    } finally {
      await base.close();
    }
  });

  it('is satisfied by a real module note written after the conflicting Run started', async () => {
    const base = await openNOwner();
    try {
      const running = await base.startRun();
      await writeModuleNote(base.world, base.goal, 'after-start');
      const opened = await base.service.openOverlapGate(system(base), basisInput(base, running, base.plan.planRevision, await waitingAttemptOf(base.world, base.goal, base.waitTask.taskId)));
      expect(opened.status).toBe('opened');
      if (opened.status !== 'opened') return;
      const check = await base.service.checkOverlapGate(system(base), { gate: gateRefOf(base) });
      expect(check).toEqual({ status: 'ready', value: { status: 'satisfied', by: 'note' } });
    } finally {
      await base.close();
    }
  });

  it('releases the gate, moves the revision by one and reads the released gate back', async () => {
    const base = await openNOwner();
    try {
      const running = await base.startRun();
      const opened = await base.service.openOverlapGate(system(base), basisInput(base, running, base.plan.planRevision, await waitingAttemptOf(base.world, base.goal, base.waitTask.taskId)));
      expect(opened.status).toBe('opened');
      if (opened.status !== 'opened') return;
      const before = opened.gate;
      const released = await base.service.releaseOverlapGate(human(base), {
        commandId: 's7c-n-release', gate: gateRefOf(base), revision: before.revision, reason: 'interface agreed',
      });
      expect(released).toMatchObject({ status: 'released' });
      if (released.status !== 'released') return;
      expect(released.gate.revision).toBe(before.revision + 1);
      expect(released.gate.release).toMatchObject({ commandId: 's7c-n-release', reason: 'interface agreed',
        by: { kind: 'human' }, revision: before.revision });
      expect(await readGate(base)).toEqual(released.gate);
    } finally {
      await base.close();
    }
  });

  it.each(['memory', 'sqlite'] as const)(
    '%s: replays the original note request result instead of a revision conflict after it committed',
    async (kind: 'memory' | 'sqlite') => {
      const store = await open(kind, { schemas: MODULE_OVERLAP_GATE_SCHEMAS });
      const base = await openNOwner({ adviser: true, store: { records: store.backend.records,
        close: () => store.backend.close() } });
      try {
        const running = await base.startRun();
        // The send fault leaves the first open's gate at a real revision with no note request written; releasing it
        // lets this row send once and then replay that exact platform-issued input.
        const fault = commitBarrier.failCommitOnce(byIdentityPrefix('session-message-send:'));
        let opened: OpenOverlapGateResultV1;
        try {
          opened = await base.service.openOverlapGate(system(base), basisInput(base, running, base.plan.planRevision, await waitingAttemptOf(base.world, base.goal, base.waitTask.taskId)));
        } finally {
          fault.release();
        }
        expect(opened).toMatchObject({ status: 'opened', noteRequest: 'unavailable' });
        if (opened.status !== 'opened') return;
        expect(opened.gate.noteRequest).toBeNull();
        const original = { gate: opened.gate.ref, revision: opened.gate.revision,
          basisDigest: opened.gate.basisDigest };
        const first = await base.service.requestOverlapNote(system(base), original);
        expect(first).toMatchObject({ status: 'sent' });
        const replayed = await base.service.requestOverlapNote(system(base), original);
        expect(replayed).toEqual(first);
      } finally {
        await base.close();
      }
    });

  it.each(['memory', 'sqlite'] as const)(
    '%s: replays the original release result instead of a revision conflict after it committed',
    async (kind: 'memory' | 'sqlite') => {
      const store = await open(kind, { schemas: MODULE_OVERLAP_GATE_SCHEMAS });
      const base = await openNOwner({ store: { records: store.backend.records,
        close: () => store.backend.close() } });
      try {
        const running = await base.startRun();
        const opened = await base.service.openOverlapGate(system(base), basisInput(base, running, base.plan.planRevision, await waitingAttemptOf(base.world, base.goal, base.waitTask.taskId)));
        expect(opened.status).toBe('opened');
        if (opened.status !== 'opened') return;
        const original = { commandId: 's7c-n-replay-release', gate: gateRefOf(base),
          revision: opened.gate.revision, reason: 'the interface was agreed' };
        const released = await base.service.releaseOverlapGate(human(base), original);
        expect(released).toMatchObject({ status: 'released' });
        if (released.status !== 'released') return;
        const replayed = await base.service.releaseOverlapGate(human(base), original);
        expect(replayed).toEqual({ status: 'released', gate: released.gate });
      } finally {
        await base.close();
      }
    });

  it('refuses a release of a satisfied gate with the read-back revision', async () => {
    const base = await openNOwner();
    try {
      const running = await base.startRun();
      await writeModuleNote(base.world, base.goal, 'satisfied-release');
      const opened = await base.service.openOverlapGate(system(base), basisInput(base, running, base.plan.planRevision, await waitingAttemptOf(base.world, base.goal, base.waitTask.taskId)));
      expect(opened.status).toBe('opened');
      if (opened.status !== 'opened') return;
      const before = await readGate(base);
      const refused = await base.service.releaseOverlapGate(human(base), {
        commandId: 's7c-n-satisfied-release', gate: gateRefOf(base), revision: before.revision, reason: 'try',
      });
      expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(await readGate(base)).toEqual(before);
    } finally {
      await base.close();
    }
  });

  it('refuses a second release of an already released gate with the read-back revision', async () => {
    const base = await openNOwner();
    try {
      const running = await base.startRun();
      const opened = await base.service.openOverlapGate(system(base), basisInput(base, running, base.plan.planRevision, await waitingAttemptOf(base.world, base.goal, base.waitTask.taskId)));
      expect(opened.status).toBe('opened');
      if (opened.status !== 'opened') return;
      const first = await base.service.releaseOverlapGate(human(base), {
        commandId: 's7c-n-release-once', gate: gateRefOf(base), revision: opened.gate.revision, reason: 'first',
      });
      expect(first).toMatchObject({ status: 'released' });
      if (first.status !== 'released') return;
      const before = await readGate(base);
      const second = await base.service.releaseOverlapGate(human(base), {
        commandId: 's7c-n-release-twice', gate: gateRefOf(base), revision: before.revision, reason: 'second',
      });
      expect(second).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(await readGate(base)).toEqual(before);
    } finally {
      await base.close();
    }
  });

  it('refuses the old revision after a re-open with revision_conflict and leaves the gate open', async () => {
    const base = await openNOwner();
    try {
      const running = await base.startRun();
      const opened = await base.service.openOverlapGate(system(base), basisInput(base, running, base.plan.planRevision, await waitingAttemptOf(base.world, base.goal, base.waitTask.taskId)));
      expect(opened.status).toBe('opened');
      if (opened.status !== 'opened') return;
      const firstRelease = await base.service.releaseOverlapGate(human(base), {
        commandId: 's7c-n-old-release', gate: gateRefOf(base), revision: opened.gate.revision, reason: 'first',
      });
      expect(firstRelease).toMatchObject({ status: 'released' });
      if (firstRelease.status !== 'released') return;
      const oldRevision = firstRelease.gate.release!.revision;
      const nextPlan = await adoptModulePlan(base.ws, base.goal, 'two');
      const reopened = await base.service.openOverlapGate(system(base),
        basisInput(base, running, nextPlan.planRevision, await waitingAttemptOf(base.world, base.goal, base.waitTask.taskId)));
      expect(reopened).toMatchObject({ status: 'opened', replayed: false });
      if (reopened.status !== 'opened') return;
      expect(reopened.gate.revision).toBeGreaterThan(firstRelease.gate.revision);
      const refused = await base.service.releaseOverlapGate(human(base), {
        commandId: 's7c-n-old-revision', gate: gateRefOf(base), revision: oldRevision, reason: 'old',
      });
      expect(refused).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      const after = await readGate(base);
      expect(after.revision).toBe(reopened.gate.revision);
      expect(after.release).toBeNull();
    } finally {
      await base.close();
    }
  });

  it('makes a changed digest a new pending revision that does not reuse the old release', async () => {
    const base = await openNOwner({ adviser: true });
    try {
      const running = await base.startRun();
      const opened = await base.service.openOverlapGate(system(base), basisInput(base, running, base.plan.planRevision, await waitingAttemptOf(base.world, base.goal, base.waitTask.taskId)));
      expect(opened).toMatchObject({ status: 'opened', noteRequest: 'sent' });
      if (opened.status !== 'opened') return;
      const released = await base.service.releaseOverlapGate(human(base), {
        commandId: 's7c-n-changed-digest-old', gate: gateRefOf(base), revision: opened.gate.revision, reason: 'old',
      });
      expect(released).toMatchObject({ status: 'released' });
      if (released.status !== 'released') return;
      const nextPlan = await adoptModulePlan(base.ws, base.goal, 'changed-digest');
      const fault = commitBarrier.failCommitOnce(byIdentityPrefix('session-message-send:'));
      try {
        const reopened = await base.service.openOverlapGate(system(base),
          basisInput(base, running, nextPlan.planRevision, await waitingAttemptOf(base.world, base.goal, base.waitTask.taskId)));
        expect(reopened).toMatchObject({ status: 'opened', replayed: false, noteRequest: 'unavailable' });
        if (reopened.status !== 'opened') return;
        expect(reopened.gate.revision).toBeGreaterThan(released.gate.revision);
        expect(reopened.gate.basisDigest).not.toBe(released.gate.basisDigest);
        expect(reopened.gate.release).toBeNull();
        expect(reopened.gate.noteRequest).toBeNull();
        const check = await base.service.checkOverlapGate(system(base), { gate: gateRefOf(base) });
        expect(check).toEqual({ status: 'ready', value: { status: 'not_satisfied' } });
      } finally {
        fault.release();
      }
    } finally {
      await base.close();
    }
  });

  it('opens a new pending revision after the waiting Task is reworked (DR-03)', async () => {
    const base = await openNOwner();
    try {
      const running = await base.startRun();
      const initial = basisInput(base, running, base.plan.planRevision, await waitingAttemptOf(base.world, base.goal, base.waitTask.taskId));
      expect(initial.waitingAttempt).toBe('none');
      const opened = await base.service.openOverlapGate(system(base), initial);
      expect(opened.status).toBe('opened');
      if (opened.status !== 'opened') return;
      const released = await base.service.releaseOverlapGate(human(base), {
        commandId: 's7c-n-rework-initial', gate: gateRefOf(base), revision: opened.gate.revision, reason: 'initial',
      });
      expect(released).toMatchObject({ status: 'released' });
      if (released.status !== 'released') return;

      // The waiting Task really runs on a real line and fails.
      const waitLine = await createS6BLine(base.ws, { label: 's7c-wait-line', role: S6A_WORK_ROLE, tasks: [base.waitTask] });
      const waitSession = await sessionOf(base.world, waitLine);
      base.world.scripted.script(waitSession, [{ kind: 'fail', message: 'S7C waiting task fails' }]);
      const waitReceipts: Parameters<typeof claimedRunOf>[0][number][] = [];
      await driveWorkflow(base.world.ag2b, { schemaVersion: 1, goalRef: base.goal, flowId: 's7c-wait',
        sessionHint: waitLine.ref, kind: 'select_work', taskId: base.waitTask.taskId },
      { stopBefore: 'requeue_task', receipts: waitReceipts });
      const { run: failedWaitRun } = claimedRunOf(waitReceipts, 'the S7C waiting Run');
      const attemptAfterFailure = await waitingAttemptOf(base.world, base.goal, base.waitTask.taskId);
      expect(attemptAfterFailure).not.toBe('none');

      const goalRead = ready<{ goal: GoalSnapshot }>(await base.world.post('goals/read',
        plain(S6A_SCOPE, base.goal)), 'the S7C Goal');
      const runRead = await readExecution(base.world.ag2b, failedWaitRun);
      const requeue = await base.world.post('tasks/requeue', graphWrite(S6A_SCOPE, {
        taskRef: base.waitTask, afterRunRef: failedWaitRun, reason: 'S7C N real rework',
      }, 's7c-n-requeue', [{ ref: base.goal, revision: goalRead.goal.revision },
        { ref: failedWaitRun, revision: runRead.run.revision }]));
      expect((requeue.body as { status?: string }).status).toBe('committed');

      const attemptAfterRequeue = await waitingAttemptOf(base.world, base.goal, base.waitTask.taskId);
      expect(attemptAfterRequeue).toBe(attemptAfterFailure);
      const basisAfter = basisInput(base, running, base.plan.planRevision, attemptAfterRequeue);
      const reopened = await base.service.openOverlapGate(system(base), basisAfter);
      expect(reopened).toMatchObject({ status: 'opened', replayed: false });
      if (reopened.status !== 'opened') return;
      expect(reopened.gate.revision).toBeGreaterThan(released.gate.revision);
      expect(reopened.gate.release).toBeNull();
      expect(reopened.gate.waitingAttempt).toBe(attemptAfterFailure);
    } finally {
      await base.close();
    }
  });

  it('refuses a non-person release as forbidden', async () => {
    const base = await openNOwner();
    try {
      const running = await base.startRun();
      const opened = await base.service.openOverlapGate(system(base), basisInput(base, running, base.plan.planRevision, await waitingAttemptOf(base.world, base.goal, base.waitTask.taskId)));
      expect(opened.status).toBe('opened');
      if (opened.status !== 'opened') return;
      const refused = await base.service.releaseOverlapGate(base.world.systemContext(), {
        commandId: 's7c-n-system-release', gate: gateRefOf(base), revision: opened.gate.revision, reason: 'system',
      });
      expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden' });
      expect((await readGate(base)).release).toBeNull();
    } finally {
      await base.close();
    }
  });
});

// ---------------------------------------------------------------------------
// N-note-read: the public current-version read over the Host's real store.
// ---------------------------------------------------------------------------

describe('N-note-read', () => {
  it('returns unavailable when the current-version read hits a storage fault', async () => {
    const base = await openNOwner();
    try {
      const note = await writeModuleNote(base.world, base.goal, 'current-read-fault');
      if (note.write.status === 'rejected') throw new Error('S7C: the module note was not accepted');
      const fault = commitBarrier.failReads(noteHeadRefKey({ aggregateType: 'NoteHead',
        projectId: base.goal.projectId, noteId: note.write.noteId }), 'throw-once');
      try {
        const read = await base.world.platform.notes.listCurrentVersions(system(base),
          { anchor: { kind: 'module', moduleId: MODULE }, limit: 100, cursor: null });
        expect(read).toMatchObject({ status: 'rejected', code: 'unavailable' });
        expect(fault.calls()).toBe(1);
      } finally {
        fault.release();
      }
    } finally {
      await base.close();
    }
  });
});

// ---------------------------------------------------------------------------
// N-records: record 4 and its three event codecs through the explicit schema bundle on the real Host front.
// ---------------------------------------------------------------------------

describe('N-records', () => {
  it.each(['memory', 'sqlite'] as const)(
    'N-records %s: two gates page in since order with a round-tripping cursor',
    async kind => {
      const store = await open(kind, { schemas: MODULE_OVERLAP_GATE_SCHEMAS });
      const base = await openNOwner({ store: { records: store.backend.records,
        close: () => store.backend.close() } });
      try {
        const running = await base.startRun();
        const first = await base.service.openOverlapGate(system(base), recordsBasisOf(base, base.waitTask, running,
          await waitingAttemptOf(base.world, base.goal, base.waitTask.taskId)));
        expect(first).toMatchObject({ status: 'opened', replayed: false });
        const second = await base.service.openOverlapGate(system(base), recordsBasisOf(base, base.l46Task, running,
          await waitingAttemptOf(base.world, base.goal, base.l46Task.taskId)));
        expect(second).toMatchObject({ status: 'opened', replayed: false });

        const pageOne = await base.service.readOverlapGates(system(base), { goalRef: base.goal, page: { limit: 1 } });
        expect(pageOne.status).toBe('ready');
        if (pageOne.status !== 'ready') return;
        expect(pageOne.value.gates).toHaveLength(1);
        expect(pageOne.value.nextCursor).not.toBeNull();

        const pageTwo = await base.service.readOverlapGates(system(base),
          { goalRef: base.goal, page: { limit: 1, cursor: pageOne.value.nextCursor! } });
        expect(pageTwo.status).toBe('ready');
        if (pageTwo.status !== 'ready') return;
        expect(pageTwo.value.gates).toHaveLength(1);
        expect(pageTwo.value.nextCursor).toBeNull();
        expect(pageOne.value.gates[0]!.ref.taskId).toBe(base.waitTask.taskId);
        expect(pageTwo.value.gates[0]!.ref.taskId).toBe(base.l46Task.taskId);
        expect(compareCursors(pageOne.value.gates[0]!.since, pageTwo.value.gates[0]!.since)).toBeLessThan(0);

        const all = await base.service.readOverlapGates(system(base), { goalRef: base.goal, page: { limit: 100 } });
        expect(all.status).toBe('ready');
        if (all.status !== 'ready') return;
        expect(all.value.gates.map(gate => gate.ref.taskId)).toEqual([base.waitTask.taskId, base.l46Task.taskId]);
        expect(all.value.nextCursor).toBeNull();
      } finally {
        await base.close();
      }
    });

  it.each(['memory', 'sqlite'] as const)(
    'N-records %s: record 4 round-trips a null start cursor as incomplete',
    async kind => {
      const store = await open(kind, { schemas: MODULE_OVERLAP_GATE_SCHEMAS });
      const base = await openNOwner({ store: { records: store.backend.records,
        close: () => store.backend.close() } });
      try {
        const running = await base.startRunBeforeEntry();
        const openedGate = await base.service.openOverlapGate(system(base), recordsBasisOf(base, base.waitTask, running,
          await waitingAttemptOf(base.world, base.goal, base.waitTask.taskId)));
        expect(openedGate).toMatchObject({ status: 'opened' });
        if (openedGate.status !== 'opened') return;
        const read = await base.service.readOverlapGate(system(base), { gate: openedGate.gate.ref });
        expect(read.status).toBe('ready');
        if (read.status !== 'ready') return;
        expect(read.value.incomplete).toEqual(['start_cursor']);
        expect(read.value.running).toHaveLength(1);
        expect(read.value.running[0]!.startCursor).toBeNull();
      } finally {
        await base.close();
      }
    });

  it.each(['memory', 'sqlite'] as const)(
    'N-records %s: a real release writes the released event and the gate round-trips',
    async kind => {
      const store = await open(kind, { schemas: MODULE_OVERLAP_GATE_SCHEMAS });
      const base = await openNOwner({ store: { records: store.backend.records,
        close: () => store.backend.close() } });
      try {
        const running = await base.startRun();
        const openedGate = await base.service.openOverlapGate(system(base), recordsBasisOf(base, base.waitTask, running,
          await waitingAttemptOf(base.world, base.goal, base.waitTask.taskId)));
        expect(openedGate).toMatchObject({ status: 'opened' });
        if (openedGate.status !== 'opened') return;
        const before = await base.service.readOverlapGate(system(base), { gate: openedGate.gate.ref });
        expect(before.status).toBe('ready');
        if (before.status !== 'ready') return;
        const released = await base.service.releaseOverlapGate(human(base), {
          commandId: 's7c-n-records-release', gate: openedGate.gate.ref, revision: before.value.revision,
          reason: 'the storage row release',
        });
        expect(released).toMatchObject({ status: 'released' });
        if (released.status !== 'released') return;
        expect(released.gate.revision).toBe(before.value.revision + 1);
        expect(released.gate.release).toMatchObject({ commandId: 's7c-n-records-release',
          reason: 'the storage row release', by: { kind: 'human', id: 's6a-operator' } });
        const read = await base.service.readOverlapGate(system(base), { gate: openedGate.gate.ref });
        expect(read).toEqual({ status: 'ready', value: released.gate });
      } finally {
        await base.close();
      }
    });
});
