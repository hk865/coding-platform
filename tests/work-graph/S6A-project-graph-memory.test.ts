/**
 * The project graph and the project memory of a no-goal request, over the real
 * Host and its core routes. Graph reads go through
 * `world.dispatch('graph/look' | 'graph/find', world.humanContext(), …)` (the
 * real route bindings, not `world.post`, which needs the page token).
 *
 * Expected values are fixture literals (`S6A_MEMORY_TEXTS`, the catalog's two
 * module names and paths, the seeded goal objectives) or hand-computed from the
 * rules: a no-goal look of the architecture serves the project modules and the
 * project understanding with its norms; a no-goal look that names a goal reads
 * exactly that goal's own universe; the project memory material is the project
 * understanding plus the norms and nothing goal-scoped.
 *
 * The refusal rows use the real Goal, the real Plan (with its Stage), the real
 * Task and the real Run that public steps produced: a plan draft through
 * `plans/propose` + `plans/apply`, then the Workflow's own advance of that Task
 * on a Work Session. The round row's Host also has a valid check configuration
 * with no checks (a Host input), so the same advance opens the Run's real
 * VerificationRound and runs no check command; its ref is the one the public
 * `open_checks` receipt returned. Each row follows with public reads showing
 * nothing moved.
 *
 * The material factory spy captures the production port the composition root
 * built (the S4C2 pattern); the assertion still calls the production owner.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkbenchActor } from '../../src/app/core-http-types.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { TrustedCheckConfiguration, VerificationRoundRef } from '../../src/contracts/verification.js';
import type { NoteMemoryMaterialPort } from '../../src/core/work-graph/model/note-contracts.js';
import type {
  GraphFindRequestV1, GraphLookRequestV1, GraphReadPageV1, NodeCardV1,
} from '../../src/core/work-graph/model/graph-context-contracts.js';
import * as materialModule from '../../src/core/work-graph/notes/note-memory-material.js';
import {
  openS6ARequestWorld, S6A_GOAL_1, S6A_GOAL_2, S6A_SCOPE,
  type S6ABackend, type S6ARequestWorld,
} from '../helpers/S6A-request-fixture.js';
import { openS6AHostWorld, type S6AHostWorld, type S6AHostWorldOptions } from '../helpers/S6A-host-fixture.js';
import { seedS6AMemory, S6A_MEMORY_TEXTS, type S6AMemory } from '../helpers/S6A-memory-fixture.js';
import {
  ag2bPlanDraft, graphWrite, permissionRevision, AG2B_WORK_TASK_ID,
} from '../helpers/AG2b-collaboration-fixture.js';
import { driveWorkflow, workRow } from '../helpers/A2-restart-fixture.js';

const BACKENDS: readonly S6ABackend[] = ['memory', 'sqlite'];

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(worlds.splice(0).map(world => world.close()));
});

function remember<T extends S6ARequestWorld>(world: T): T {
  worlds.push(world);
  return world;
}

async function seededWorld(backend: S6ABackend): Promise<{ world: S6ARequestWorld; memory: S6AMemory }> {
  const world = remember(await openS6ARequestWorld({ backend }));
  const memory = await seedS6AMemory(world, { architecture: true, policy: true });
  return { world, memory };
}

async function seededHostWorld(backend: S6ABackend, options: Omit<S6AHostWorldOptions, 'backend'> = {}):
  Promise<{ world: S6AHostWorld; memory: S6AMemory }> {
  const world = remember(await openS6AHostWorld({ ...options, backend }));
  const memory = await seedS6AMemory(world, { architecture: true, policy: true });
  return { world, memory };
}

/** The material port the composition root built, captured while the Host starts. */
async function worldWithMaterial(backend: S6ABackend): Promise<{
  world: S6ARequestWorld; memory: S6AMemory; material: NoteMemoryMaterialPort }> {
  const original = materialModule.createNoteMemoryMaterial;
  const captured: { port: NoteMemoryMaterialPort | null } = { port: null };
  const spy = vi.spyOn(materialModule, 'createNoteMemoryMaterial').mockImplementation(reads => {
    const port = original(reads);
    captured.port = port;
    return port;
  });
  let world: S6ARequestWorld;
  try {
    world = await openS6ARequestWorld({ backend });
  } finally {
    spy.mockRestore();
  }
  remember(world);
  if (captured.port === null) throw new Error('the note memory material port was not composed');
  const memory = await seedS6AMemory(world, { architecture: true, policy: true });
  return { world, memory, material: captured.port };
}

function look(world: S6ARequestWorld, input: GraphLookRequestV1): Promise<unknown> {
  return world.dispatch('graph/look', world.humanContext(), { scope: world.scope, input });
}

function find(world: S6ARequestWorld, input: GraphFindRequestV1): Promise<unknown> {
  return world.dispatch('graph/find', world.humanContext(), { scope: world.scope, input });
}

function readValue<T>(answer: unknown): T {
  const result = answer as { status?: string; value?: T; code?: string; reason?: string };
  expect(result.status, JSON.stringify(answer)).toBe('ready');
  if (result.status !== 'ready') throw new Error(`not ready: ${JSON.stringify(answer)}`);
  return result.value as T;
}

function rejection(answer: unknown): { status: string; code?: string; reason?: string } {
  return answer as { status: string; code?: string; reason?: string };
}

function committedValue<T>(answer: { body: unknown }, what: string): T {
  const body = answer.body as { status?: string; value?: T };
  expect(body.status, JSON.stringify(answer.body)).toBe('committed');
  if (body.status !== 'committed' || body.value === undefined) throw new Error(`not committed: ${what}`);
  return body.value;
}

async function goalSettings(world: S6ARequestWorld, goal: GoalRef): Promise<{ revision: number }> {
  const value = readValue<{ goal: { revision: number } }>(await world.dispatch('goals/settings', world.humanContext(),
    { scope: world.scope, input: { goalRef: goal } }));
  return { revision: value.goal.revision };
}

async function acceptedNotes(world: S6ARequestWorld, goalId: string): Promise<string[]> {
  const value = readValue<{ items: { noteId: string; version: number }[] }>(await world.dispatch('notes/list',
    world.humanContext(), { scope: world.scope, input: { goalId, state: 'accepted', limit: 20, cursor: null } }));
  return value.items.map(item => `${item.noteId}@${String(item.version)}`);
}

const page = { afterCursor: null, limit: 20 } as const;

type RealObjects = { planRef: PlanRevisionRef; stageId: string; taskId: string; runRef: RunRef };

/** The round row's Host actor: it drives the Workflow, so it is the check configuration's executor. */
const ROUND_ACTOR: WorkbenchActor = { kind: 'human', id: 's6a-round-operator' };

/** A valid check configuration with no checks (a Host input): a round opens and no check command runs. The
 * permission revision binds the executor to the world's workspace and its read prefix `.`. */
const EMPTY_CHECKS: TrustedCheckConfiguration = {
  configurationRevision: 's6a-empty-checks@1', workspace: { aggregateType: 'Workspace', ...S6A_SCOPE },
  executor: ROUND_ACTOR, permissionRevision: permissionRevision(ROUND_ACTOR, S6A_SCOPE, ['.']),
  sourceAccess: 'verification_workspace', processAccess: 'all_except_denied', deniedPrefixes: ['.git'], checks: [],
};

/** A Goal's real Plan, Stage, Task and Run, each made by a public step: the
 * plan draft through its proposal and application, then the Workflow's own
 * advance of the draft's work Task on a real Work Session. The advance's
 * receipts go to `receipts`. */
async function realObjects(world: S6AHostWorld, receipts: WorkflowStepReceipt[] = []): Promise<RealObjects> {
  const draft = { ...ag2bPlanDraft(), stages: [{ stageId: 's6a-stage', title: 'S6A stage' }] };
  const proposal = committedValue<{ ref: unknown; revision: number }>(await world.post('plans/propose',
    graphWrite(S6A_SCOPE, {
      goalRef: S6A_GOAL_1, basedOn: null, draft, reason: { text: 'S6A refusal plan', sources: [] },
    }, 's6a-refusal-propose', [])), 'the Plan proposal');
  const applied = committedValue<{ ref: PlanRevisionRef }>(await world.post('plans/apply',
    graphWrite(S6A_SCOPE, {
      proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [],
    }, 's6a-refusal-apply', [])), 'the Plan application');
  const session = await world.createWorkSession('refusal-work');
  await world.scripted.script(session, [
    { kind: 'text', text: 'S6A refusal work answer one' },
    { kind: 'text', text: 'S6A refusal work answer two' },
  ]);
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: S6A_GOAL_1, flowId: 's6a-refusal-flow',
    sessionHint: session.ref, kind: 'select_work', taskId: AG2B_WORK_TASK_ID }, { receipts });
  const row = await workRow(world.ag2b);
  if (row.execution === null) throw new Error('the real Work Run was not recorded');
  return { planRef: applied.ref, stageId: 's6a-stage', taskId: AG2B_WORK_TASK_ID, runRef: row.execution };
}

/** The round the Workflow's advance opened, exactly as its public `open_checks` receipt returned it. */
function openedRound(receipts: readonly WorkflowStepReceipt[]): VerificationRoundRef {
  const opened = receipts.find((receipt): receipt is Extract<WorkflowStepReceipt, { kind: 'open_checks' }> =>
    receipt.kind === 'open_checks');
  if (opened === undefined || opened.result.status !== 'committed') {
    throw new Error(`the Workflow did not open a round: ${JSON.stringify(receipts.map(receipt => receipt.kind))}`);
  }
  return opened.result.value.ref;
}

describe.each(BACKENDS)('the project graph and memory on the %s backend', backend => {
  it('looks the architecture modules from the project root when the request has no goal', async () => {
    const { world } = await seededWorld(backend);
    const result = readValue<GraphReadPageV1<NodeCardV1>>(await look(world, {
      goalRef: null, target: { kind: 'path', path: '.' }, relation: 'card', page,
    }));
    expect(result.items.map(item => item.node.kind)).toEqual(['module', 'module']);
    expect(result.items.map(item => item.name)).toEqual(['S6A core', 'S6A UI']);
    expect(result.items.map(item => item.paths)).toEqual([['src'], ['src/ui']]);
    expect(result.nextCursor).toBeNull();
  });

  it('carries the project understanding and norms on a no-goal architecture look', async () => {
    const { world } = await seededWorld(backend);
    const result = readValue<GraphReadPageV1<NodeCardV1>>(await look(world, {
      goalRef: null, target: { kind: 'path', path: '.' }, relation: 'card', page,
    }));
    const notes = result.items[0]?.indexes.notes;
    expect(notes?.availability).toBe('available');
    expect(notes?.understanding.rows.map(row => row.conclusion))
      .toEqual([S6A_MEMORY_TEXTS.projectUnderstanding.conclusion]);
    expect(notes?.understanding.rows.map(row => row.scope)).toEqual(['project']);
    expect(notes?.understanding.norms.map(row => row.conclusion)).toEqual([
      S6A_MEMORY_TEXTS.norms[1].conclusion,
      S6A_MEMORY_TEXTS.norms[0].conclusion,
    ]);
    expect(notes?.understanding.normsOmitted).toBe(0);
    expect(notes?.general).toEqual([]);
  });

  it('reads the project understanding and norms through a goal the request names with no goal', async () => {
    const { world } = await seededWorld(backend);
    const result = readValue<GraphReadPageV1<NodeCardV1>>(await look(world, {
      goalRef: null, target: { kind: 'node', node: { kind: 'goal', ref: world.goals.first } }, relation: 'card', page,
    }));
    expect(result.items).toHaveLength(1);
    const card = result.items[0]!;
    expect(card.node.kind).toBe('goal');
    expect(card.indexes.notes.availability).toBe('available');
    const notes = card.indexes.notes;
    expect(notes.understanding.rows[0]?.conclusion).toBe('S6A project understanding');
    expect(notes.understanding.norms.map(row => row.conclusion)).toEqual([
      S6A_MEMORY_TEXTS.norms[1].conclusion,
      S6A_MEMORY_TEXTS.norms[0].conclusion,
    ]);
  });

  it('reads the second goal understanding read-only when no goal is bound', async () => {
    const { world, memory } = await seededWorld(backend);
    const beforeSettings = await goalSettings(world, world.goals.second);
    const beforeNotes = await acceptedNotes(world, S6A_GOAL_2.goalId);
    const result = readValue<GraphReadPageV1<NodeCardV1>>(await look(world, {
      goalRef: null, target: { kind: 'node', node: { kind: 'goal', ref: world.goals.second } }, relation: 'card', page,
    }));
    expect(result.items).toHaveLength(1);
    const card = result.items[0]!;
    expect(card.node).toEqual({ kind: 'goal', ref: world.goals.second });
    expect(card.goal?.ref.goalId).toBe('s6a-goal-2');
    expect(card.indexes.notes.availability).toBe('available');
    const goalRow = card.indexes.notes.understanding.rows.find(row => row.scope === 'goal');
    expect(goalRow?.conclusion).toBe(memory.second.understanding?.conclusion);
    expect(goalRow?.conclusion).toBe('S6A goal two understanding: the second goal marker');
    const afterSettings = await goalSettings(world, world.goals.second);
    const afterNotes = await acceptedNotes(world, S6A_GOAL_2.goalId);
    expect(afterSettings.revision).toBe(beforeSettings.revision);
    expect(afterNotes).toEqual(beforeNotes);
  });

  it('finds project modules when the request has no goal', async () => {
    const { world } = await seededWorld(backend);
    const result = readValue<GraphReadPageV1<NodeCardV1>>(await find(world, {
      goalRef: null, needle: 'S6A UI', page,
    }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.node.kind).toBe('module');
    expect(result.items[0]?.name).toBe('S6A UI');
    expect(result.items[0]?.paths).toEqual(['src/ui']);
    expect(result.items[0]?.indexes.notes.understanding.rows.map(row => row.conclusion))
      .toEqual([S6A_MEMORY_TEXTS.projectUnderstanding.conclusion]);
  });

  it('keeps the goal branch unchanged when a goal is bound', async () => {
    const { world } = await seededWorld(backend);
    const looked = readValue<GraphReadPageV1<NodeCardV1>>(await look(world, {
      goalRef: world.goals.first,
      target: { kind: 'node', node: { kind: 'goal', ref: world.goals.first } }, relation: 'card', page,
    }));
    expect(looked.items).toHaveLength(1);
    const card = looked.items[0]!;
    expect(card.node).toEqual({ kind: 'goal', ref: world.goals.first });
    expect(card.name).toBe('S6A goal one');
    expect(card.paths).toEqual([]);
    expect(card.indexes.notes.availability).toBe('not_implemented');
    const found = readValue<GraphReadPageV1<NodeCardV1>>(await find(world, {
      goalRef: world.goals.first, needle: 'S6A goal one', page,
    }));
    expect(found.items.map(item => item.node.kind)).toEqual(['goal']);
    expect(found.items[0]?.goal?.ref.goalId).toBe(world.goals.first.goalId);
  });

  it('returns the project material with no goal', async () => {
    const { world, material } = await worldWithMaterial(backend);
    const read = await material.readMemoryMaterial(world.humanContext(), { goalId: null });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.value.projectUnderstanding?.conclusion).toBe('S6A project understanding');
    expect(read.value.norms.map(row => row.conclusion)).toEqual([
      S6A_MEMORY_TEXTS.norms[1].conclusion,
      S6A_MEMORY_TEXTS.norms[0].conclusion,
    ]);
    expect(read.value.normsOmitted).toBe(0);
    expect(read.value.localUnderstanding).toEqual([]);
    expect(read.value.general).toEqual([]);
    expect(read.value.reminders).toEqual([]);
  });
});

describe.each(BACKENDS)('a request round with no goal on the %s backend', backend => {
  it('claims the round with its Session secretary profile and keeps the null goal', async () => {
    const world = remember(await openS6ARequestWorld({ backend }));
    const session = await world.createSecretary('no-goal-claim');
    const submitted = await world.dispatch('requests/submit', world.humanContext(), { scope: world.scope,
      input: { commandId: 's6a-no-goal-claim-submit', goalId: null, text: 'S6A no-goal request',
        continues: null, recipient: null } });
    const queued = submitted as { status?: string; round?: QueryJobRef };
    expect(queued.status).toBe('queued');
    const round = queued.round!;
    const read = readValue<{ job: { revision: number; job: { goalId: string | null } };
      run: { ref: { queryJobId: string; runId: string }; revision: number } }>(
      await world.dispatch('queries/read', world.humanContext(), { scope: world.scope, input: round }));
    expect(read.job.job.goalId).toBeNull();
    const card = await world.readSession(session);
    const profile = world.platform.secretaryProfiles.forSession({
      workspace: world.scope, sessionRole: card.record.role,
    });
    expect(profile).not.toBeNull();
    if (profile === null) return;
    const claim = await world.dispatch('queries/claim', world.humanContext(), { scope: world.scope,
      request: { input: { queryRunRef: read.run.ref, sessionRef: session.ref, profile },
        meta: { requestId: 's6a-no-goal-claim', expected: [
          { ref: round, revision: read.job.revision },
          { ref: read.run.ref, revision: read.run.revision },
          { ref: card.record.ref, revision: card.record.revision },
        ] } } });
    expect((claim as { status?: string }).status, JSON.stringify(claim)).toBe('committed');
    const after = readValue<{ job: { job: { goalId: string | null } };
      run: { run: { executionState?: { phase: string } } } }>(
      await world.dispatch('queries/read', world.humanContext(), { scope: world.scope, input: round }));
    expect(after.job.job.goalId).toBeNull();
    expect(after.run.run.executionState?.phase).toBe('claimed');
  });
});

describe.each(BACKENDS)('rejects: a graph operation that needs a goal with no goal on the %s backend', backend => {
  it('rejects a look whose target is a stage', async () => {
    const { world } = await seededHostWorld(backend);
    const objects = await realObjects(world);
    const beforeSettings = await goalSettings(world, world.goals.first);
    const beforeNotes = await acceptedNotes(world, world.goals.first.goalId);
    const answer = await look(world, {
      goalRef: null,
      target: { kind: 'node', node: { kind: 'stage', planRef: objects.planRef, stageId: objects.stageId } },
      relation: 'card', page,
    });
    expect(rejection(answer)).toEqual({ status: 'rejected', code: 'invalid', reason: 'this request has no goal' });
    expect((await goalSettings(world, world.goals.first)).revision).toBe(beforeSettings.revision);
    expect(await acceptedNotes(world, world.goals.first.goalId)).toEqual(beforeNotes);
  });

  it('rejects a look whose target is a task', async () => {
    const { world } = await seededHostWorld(backend);
    const objects = await realObjects(world);
    const beforeSettings = await goalSettings(world, world.goals.first);
    const beforeNotes = await acceptedNotes(world, world.goals.first.goalId);
    const answer = await look(world, {
      goalRef: null,
      target: { kind: 'node', node: { kind: 'task',
        ref: { projectId: S6A_SCOPE.projectId, goalId: world.goals.first.goalId, taskId: objects.taskId },
        planRef: objects.planRef } },
      relation: 'card', page,
    });
    expect(rejection(answer)).toEqual({ status: 'rejected', code: 'invalid', reason: 'this request has no goal' });
    expect((await goalSettings(world, world.goals.first)).revision).toBe(beforeSettings.revision);
    expect(await acceptedNotes(world, world.goals.first.goalId)).toEqual(beforeNotes);
  });

  it('rejects a look whose target is a run', async () => {
    const { world } = await seededHostWorld(backend);
    const objects = await realObjects(world);
    const beforeSettings = await goalSettings(world, world.goals.first);
    const beforeNotes = await acceptedNotes(world, world.goals.first.goalId);
    const answer = await look(world, {
      goalRef: null, target: { kind: 'node', node: { kind: 'run', ref: objects.runRef } }, relation: 'card', page,
    });
    expect(rejection(answer)).toEqual({ status: 'rejected', code: 'invalid', reason: 'this request has no goal' });
    expect((await goalSettings(world, world.goals.first)).revision).toBe(beforeSettings.revision);
    expect(await acceptedNotes(world, world.goals.first.goalId)).toEqual(beforeNotes);
  });

  it('rejects a look whose target is a verification round', async () => {
    const { world } = await seededHostWorld(backend, { actor: ROUND_ACTOR, extraHostOptions: { checks: EMPTY_CHECKS } });
    const receipts: WorkflowStepReceipt[] = [];
    await realObjects(world, receipts);
    const roundRef = openedRound(receipts);
    const beforeSettings = await goalSettings(world, world.goals.first);
    const beforeNotes = await acceptedNotes(world, world.goals.first.goalId);
    const answer = await look(world, {
      goalRef: null, target: { kind: 'node', node: { kind: 'round', ref: roundRef } }, relation: 'card', page,
    });
    expect(rejection(answer)).toEqual({ status: 'rejected', code: 'invalid', reason: 'this request has no goal' });
    expect((await goalSettings(world, world.goals.first)).revision).toBe(beforeSettings.revision);
    expect(await acceptedNotes(world, world.goals.first.goalId)).toEqual(beforeNotes);
  });

  it('rejects the executions relation', async () => {
    const { world } = await seededWorld(backend);
    const beforeSettings = await goalSettings(world, world.goals.first);
    const beforeNotes = await acceptedNotes(world, world.goals.first.goalId);
    const answer = await look(world, {
      goalRef: null,
      target: { kind: 'node', node: { kind: 'module',
        ref: { projectId: S6A_SCOPE.projectId, moduleId: 's6a-core' } } },
      relation: 'executions', page,
    });
    expect(rejection(answer)).toEqual({ status: 'rejected', code: 'invalid', reason: 'this request has no goal' });
    expect((await goalSettings(world, world.goals.first)).revision).toBe(beforeSettings.revision);
    expect(await acceptedNotes(world, world.goals.first.goalId)).toEqual(beforeNotes);
  });

  it('rejects the checks relation', async () => {
    const { world } = await seededWorld(backend);
    const beforeSettings = await goalSettings(world, world.goals.first);
    const beforeNotes = await acceptedNotes(world, world.goals.first.goalId);
    const answer = await look(world, {
      goalRef: null,
      target: { kind: 'node', node: { kind: 'module',
        ref: { projectId: S6A_SCOPE.projectId, moduleId: 's6a-core' } } },
      relation: 'checks', page,
    });
    expect(rejection(answer)).toEqual({ status: 'rejected', code: 'invalid', reason: 'this request has no goal' });
    expect((await goalSettings(world, world.goals.first)).revision).toBe(beforeSettings.revision);
    expect(await acceptedNotes(world, world.goals.first.goalId)).toEqual(beforeNotes);
  });
});
