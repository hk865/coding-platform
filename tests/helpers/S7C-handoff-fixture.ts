/**
 * The H handoff world (fixture spec v2 FH-1/FH-2): one real consume world (FX-1) with the original twelve-task
 * plan, the two real `create_member` children (a secretary Query child with the pin, a Work child with the
 * ceiling), the extra Goals and duty lines the later handoff rows need, and one real source Run whose own
 * `record_note` wrote its goal understanding.
 *
 * Every state is a public step: `sessions/link` closes and opens the task links, the real secretary Query round
 * and the real Work Run call `create_member`, `workflow/advance` claims and starts the source Run, and the source
 * Run's scripted model calls the real `record_note`. Nothing is read from or written to the store, no operation,
 * envelope or record is built, and no call context is made here.
 */
import type { AttentionScopeV1 } from '../../src/app/attention-observer.js';
import type { WorkbenchRuntimeBinding } from '../../src/app/runtime-configuration.js';
import type { RoleBindingRefV1, RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { RoleConfigurationRef, SessionRef } from '../../src/contracts/core/identity.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { NoteAnchorV1 } from '../../src/contracts/note.js';
import type { NoteItemV1 } from '../../src/core/work-graph/model/note-contracts.js';
import type { SessionFactsV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { plainSessionRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { advanceUntil, driveWorkflow } from './A2-restart-fixture.js';
import { graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from './S6A-cards-fixture.js';
import { byIdentityPrefix, commitBarrier } from './S6A-commit-barrier.js';
import { crashS7AHost } from './S7A-fixture.js';
import { vi } from 'vitest';
import * as handoffEntryModule from '../../src/business/workflow/handoff-tool-entry.js';

import {
  S6A_SCRIBE_ROLE, S6A_SCOPE, S6A_WORK_ROLE, S6A_SECRETARY_ROLE,
  type S6ABackend, type S6AExtraBinding, type S6ASession,
} from './S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, holdS6BRequestRound, understandingPointer } from './S6B1-fixture.js';
import { understandingNote } from './S4C2-note-card-fixture.js';
import { openS7B2ConsumeWorld, type S7B2ConsumeWorld } from './S7B2-consumable-sessions.js';
import { ready, sessionOf, S7A_REPLY_TOOLS, committed } from './S7A-fixture.js';

const CREATOR_ROLE: Extract<RoleConfigurationRef, { kind: 'legacy_template' }> =
  { kind: 'legacy_template', templateId: 's7c-handoff-creator', templateRevision: '1' };
const ADVISER_ROLE = platformRoleProfile('adviser').template;
const EXECUTOR_ROLE = platformRoleProfile('executor').template;
const WORK_TOOLS = ['read', 'record_note'] as const;
const CREATOR_TOOLS = ['read', 'create_member', 'record_note'] as const;

type LegacyRole = Extract<RoleConfigurationRef, { kind: 'legacy_template' }>;

function workflowBinding(id: string, role: LegacyRole): WorkflowHostConfiguration['bindings'][number] {
  const roleBinding: RoleBindingRefV1 = { schemaVersion: 1, bindingId: id, templateId: role.templateId,
    templateRevision: role.templateRevision, bindingVersion: 1, policyRevision: 'legacy-template' };
  return { workspace: S6A_SCOPE, sessionRole: structuredClone(role), roleBinding,
    budget: { tokenBudget: 1_000_000, deadline: null } };
}

/** The Goal's autonomy through `goals/settings/set`; the identity names this Goal, so two Goals never collide. */
async function setAutonomy(world: S7CHandoffWorld['world'], goal: GoalRef,
  autonomy: 'after_plan_confirmation'): Promise<void> {
  const read = ready<{ goal: { revision: number } }>(await world.post('goals/read', plain(S6A_SCOPE, goal)),
    `the goal ${goal.goalId}`);
  committed(await world.post('goals/settings/set', graphWrite(S6A_SCOPE, {
    goalRef: goal, autonomy, waitForGoalRef: null,
  }, `s7c-handoff-autonomy-${goal.goalId}`, [{ ref: goal, revision: read.goal.revision }])),
  `the ${autonomy} setting of ${goal.goalId}`);
}

/** A runtime binding of the Host input shape; only the id, Role, tools and the `createMember` grant differ. */
function runtimeBinding(id: string, role: LegacyRole, tools: readonly string[],
  createMember = false): WorkbenchRuntimeBinding {
  const template = { ...S7A_REPLY_TOOLS.binding };
  return {
    ...structuredClone(template), id, label: `S7C ${id}`, role: structuredClone(role),
    configurationRevision: `${id}@1`,
    model: { ...template.model, revision: `${id}-model@1`, model: `s7c-scripted-${id}` },
    grant: {
      ...structuredClone(template.grant), tools: [...tools],
      hostTemplate: { templateId: role.templateId, revision: role.templateRevision,
        digest: template.grant.hostTemplate!.digest },
      ...(createMember ? { createMember: true } : {}),
    },
  };
}

export type S7CHandoffLines = {
  /** The executor line whose Run wrote the understanding and handed its own line. */
  readonly source: S6ASession;
  /** The real secretary Query `create_member` child: the `secretaryCreated` pin and no ceiling. */
  readonly secretarySource: S6ASession;
  /** The real Work `create_member` child: its creator's accepted permissions as `delegationCeiling`, no pin. */
  readonly existing: S6ASession;
  readonly creator: S6ASession;
  readonly adviser: S6ASession;
  readonly adviserRun: RunRef;
  readonly scribe: S6ASession;
  readonly fixed: S6ASession;
};

export type S7CHandoffWorld = {
  readonly consume: S7B2ConsumeWorld;
  readonly world: S7B2ConsumeWorld['world'];
  /** The entry the platform built for THIS world, captured during its construction. */
  readonly handoffEntry: ReturnType<typeof handoffEntryModule.createHandoffToolEntry>;
  readonly goal: GoalRef;
  readonly plan: NonNullable<Awaited<ReturnType<S6ACardsWorkspace['activePlan']>>>;
  readonly tasks: readonly TaskTriple[];
  /** The two note-free Goals' Tasks: H-entry's missing/foreign/other-Run variants hand these. */
  readonly clean: { readonly goal: GoalRef; readonly task: TaskTriple };
  readonly other: { readonly goal: GoalRef; readonly task: TaskTriple };
  readonly lines: S7CHandoffLines;
  readonly sourceRun: RunRef;
  readonly note: NoteItemV1;
  close(): Promise<void>;
};

export async function linkTask(world: S7CHandoffWorld['world'], card: SessionCard, task: TaskTriple, active: boolean,
  requestId: string): Promise<void> {
  const target = { kind: 'task' as const, ref: task };
  const link = card.links.find(candidate => candidate.ref.relation === 'responsible'
    && candidate.ref.target.kind === 'task' && plainSessionRefKey({ projectId: task.projectId,
      sessionId: candidate.ref.target.ref.taskId }) !== '' && candidate.ref.target.ref.goalId === task.goalId
    && candidate.ref.target.ref.taskId === task.taskId);
  const expected = [{ ref: card.record.ref, revision: card.record.revision },
    { ref: link?.ref ?? { ...card.record.ref, aggregateType: 'SessionWorkLink' as const, target,
      relation: 'responsible' as const }, revision: link?.revision ?? 0 }];
  const sessionRef = { projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId };
  committed(await world.post('sessions/link', graphWrite(S6A_SCOPE, {
    sessionRef, target, relation: 'responsible', active,
  }, requestId, expected)), `the link ${requestId}`);
}

/** The Session cards the world's directory gained since `before`. */
async function newCards(world: S7CHandoffWorld['world'], before: readonly SessionCard[]): Promise<SessionCard[]> {
  const keys = new Set(before.map(card => plainSessionRefKey(card.record.ref)));
  return (await world.listSessions()).filter(card => !keys.has(plainSessionRefKey(card.record.ref)));
}

function executorChild(cards: readonly SessionCard[]): SessionCard {
  // L1's member child takes its Role from the Task's plan assignment, so the Session record's own marker is the
  // child fact: a Work caller's child carries the creator's `delegationCeiling`, a secretary's child
  // `secretaryCreated`. The Role name is no longer the platform executor template.
  const child = cards.find(card => card.record.delegationCeiling !== undefined
    || card.record.secretaryCreated === true);
  if (child === undefined) throw new Error(`S7C: the create_member call created no member line: ${JSON.stringify(
    cards.map(card => ({ role: card.record.role, secretaryCreated: card.record.secretaryCreated,
      delegationCeiling: card.record.delegationCeiling })))}`);
  return child;
}

export async function openS7CHandoffWorld(options: { backend?: S6ABackend;
  attention?: readonly AttentionScopeV1[] } = {}): Promise<S7CHandoffWorld> {
  const creator = runtimeBinding('s7c-handoff-creator-binding', CREATOR_ROLE, CREATOR_TOOLS, true);
  const executor = runtimeBinding('s7c-handoff-executor-binding', EXECUTOR_ROLE, WORK_TOOLS);
  const adviser = runtimeBinding('s7c-handoff-adviser-binding', ADVISER_ROLE, WORK_TOOLS);
  const bindings: S6AExtraBinding[] = [
    { binding: creator, workflow: workflowBinding(creator.id, CREATOR_ROLE) },
    { binding: executor, workflow: workflowBinding(executor.id, EXECUTOR_ROLE) },
    { binding: adviser, workflow: workflowBinding(adviser.id, ADVISER_ROLE) },
    // The secretary Query's own class registers `create_member`; the Work line gains the note name.
    { binding: { ...S7A_REPLY_TOOLS.binding, id: 's6a-secretary-binding', role: structuredClone(S6A_SECRETARY_ROLE) },
      mergeTools: ['create_member'] },
    { binding: S7A_REPLY_TOOLS.binding, mergeTools: ['record_note'] },
  ];

  // The platform's own entry is the one closure the production composition builds; capture it from the real
  // factory call instead of constructing a second entry with stand-in reads.
  const buildEntry = handoffEntryModule.createHandoffToolEntry;
  let handoffEntry: ReturnType<typeof handoffEntryModule.createHandoffToolEntry> | null = null;
  const entrySpy = vi.spyOn(handoffEntryModule, 'createHandoffToolEntry').mockImplementation(deps => {
    const built = buildEntry(deps);
    handoffEntry = built;
    return built;
  });
  let consume: S7B2ConsumeWorld;
  try {
    consume = await openS7B2ConsumeWorld({
      ...(options.backend === undefined ? {} : { backend: options.backend }),
      ...(options.attention === undefined ? {} : { attention: options.attention }),
      extraBindings: bindings });
  } finally {
    entrySpy.mockRestore();
  }
  const builtEntry = handoffEntry;
  if (builtEntry === null) throw new Error('S7C: the platform built no handoff tool entry');
  const world = consume.world;
  try {
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const goal = world.goals.first;
    const plan = await main.activePlan(goal);
    if (plan === null) throw new Error('S7C: the consume world has no adopted Plan');
    const tasks: TaskTriple[] = plan.tasks.map(task => ({ projectId: goal.projectId, goalId: goal.goalId,
      taskId: task.taskId }));
    const [t1, t2, t3] = tasks;
    if (t1 === undefined || t2 === undefined || t3 === undefined) {
      throw new Error('S7C: the consume world has fewer than three Tasks');
    }

    // H-08: close the consume seed's own links to t1..t3 through the real route; the seed is untouched.
    for (const card of await world.listSessions()) {
      for (const task of [t1, t2, t3]) {
        const open = card.links.some(link => link.ref.relation === 'responsible' && link.until === null
          && link.ref.target.kind === 'task' && link.ref.target.ref.taskId === task.taskId);
        if (open) await linkTask(world, card, task, false, `s7c-handoff-close-${card.record.ref.sessionId}-${task.taskId}`);
      }
    }

    // H-07: the extra Goal's first Plan gives the new creator binding a matching Task; the twelve Task plan stays.
    const creatorGoal = (await main.createGoal('s7c-handoff-creator-goal', 'S7C handoff creator goal')).ref;
    const creatorTask = (await adoptS6BPlan(main, creatorGoal, { label: 's7c-handoff-creator',
      taskIds: ['s7c-handoff-creator-task'], role: CREATOR_ROLE.templateId })).tasks[0]!;
    await setAutonomy(world, creatorGoal, 'after_plan_confirmation');
    const creatorLine = await sessionOf(world, await createS6BLine(main, { label: 's7c-handoff-creator',
      role: CREATOR_ROLE, tasks: [creatorTask] }));

    const creatorAnchor: NoteAnchorV1 = { kind: 'goal', goalId: creatorGoal.goalId };
    const creatorPointer = await understandingPointer(world, creatorAnchor);
    const creatorDraft = understandingNote({ anchor: creatorAnchor, topic: 's7c-handoff-creator-understanding',
      conclusion: 'the creator Run wrote this', structural: false,
      replaces: creatorPointer.noteId === null ? [] : [creatorPointer.noteId] });
    if (creatorDraft.kind !== 'understanding') throw new Error('S7C: the creator note is not an understanding');
    await world.scripted.script(creatorLine, [
      { kind: 'calls', calls: [{ callId: 's7c-handoff-creator-create', name: 'create_member', args: {
        duty: 'executor', scope: { kind: 'task', task: { ...creatorTask } }, reason: 'S7C handoff existing target' } }] },
      { kind: 'calls', calls: [{ callId: 's7c-handoff-creator-note', name: 'record_note', args: {
        op: 'write', kind: creatorDraft.kind, topic: creatorDraft.topic, conclusion: creatorDraft.conclusion,
        anchor: creatorDraft.anchor, sections: creatorDraft.sections, structural: creatorDraft.structural,
        replaces: creatorDraft.replaces, expectedPointerRevision: creatorPointer.revision } }] },
      { kind: 'text', text: 'S7C handoff creator answer' },
    ]);
    const beforeCreator = await world.listSessions();
    const creatorClaim = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: creatorGoal,
      flowId: 's7c-handoff-creator-run', sessionHint: creatorLine.ref, kind: 'select_work',
      taskId: creatorTask.taskId }, 'claim_task');
    const creatorReceipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(world.ag2b, creatorClaim, { stopBefore: 'open_checks', receipts: creatorReceipts });
    const fresh = await newCards(world, beforeCreator);
    const existingCard = executorChild(fresh);
    const existingRef: SessionRef = { projectId: existingCard.record.ref.projectId,
      sessionId: existingCard.record.ref.sessionId };
    const existing = await sessionOf(world, { label: 's7c-handoff-existing', ref: existingRef } as never);

    // The responsible adviser the secretary's `create_member` admission resolves; its Run comes after the round.
    const adviserLine = await sessionOf(world, await createS6BLine(main, { label: 's7c-handoff-adviser',
      role: ADVISER_ROLE }));

    // The secretary Query child on t1: the real `create_member` path, with the pin and no ceiling.
    await setAutonomy(world, goal, 'after_plan_confirmation');
    const beforeRound = await world.listSessions();
    await holdS6BRequestRound(world, { label: 's7c-handoff-secretary', goalId: goal.goalId,
      replies: () => [
        { kind: 'calls', calls: [{ callId: 's7c-handoff-secretary-create', name: 'create_member', args: {
          duty: 'executor', scope: { kind: 'task', task: { ...t1 } }, reason: 'S7C handoff pin source' } }] },
        { kind: 'text', text: 'S7C handoff secretary answer' },
      ] }, async () => undefined);
    const secretaryCard = executorChild(await newCards(world, beforeRound));
    const secretaryRef: SessionRef = { projectId: secretaryCard.record.ref.projectId,
      sessionId: secretaryCard.record.ref.sessionId };
    const secretarySource = await sessionOf(world, { label: 's7c-handoff-secretary-source',
      ref: secretaryRef } as never);
    // The child's task scope opens a responsible link to t1. The chooser reads eligibility only (not the hint), so
    // that link would take the source Run's claim; close it here and reopen it after the source Run has entered.
    await linkTask(world, await world.readSession(secretarySource.ref), t1, false, 's7c-handoff-secretary-close');

    // The executor source line: responsible for t1..t3, one real claim and start of t1, its own understanding note.
    const source = await sessionOf(world, await createS6BLine(main, { label: 's7c-handoff-source',
      role: S6A_WORK_ROLE, tasks: [t1] }));
    for (const [index, task] of [t2, t3].entries()) {
      const card = await world.readSession(source.ref);
      await linkTask(world, card, task, true, `s7c-handoff-source-link-${index + 1}`);
    }
    // Two note-free Goals for H-entry's missing/foreign/other-Run understanding variants; the source holds their
    // only Tasks, so the entry's admission passes and the understanding check is the one rule under test.
    const cleanGoal = (await main.createGoal('s7c-handoff-clean-goal', 'S7C handoff clean goal')).ref;
    const cleanTask = (await adoptS6BPlan(main, cleanGoal, { label: 's7c-handoff-clean',
      taskIds: ['s7c-handoff-clean-task'], role: S6A_WORK_ROLE.templateId })).tasks[0]!;
    await linkTask(world, await world.readSession(source.ref), cleanTask, true, 's7c-handoff-clean-link');
    const otherGoal = (await main.createGoal('s7c-handoff-other-goal', 'S7C handoff other goal')).ref;
    const otherTask = (await adoptS6BPlan(main, otherGoal, { label: 's7c-handoff-other',
      taskIds: ['s7c-handoff-other-task'], role: S6A_WORK_ROLE.templateId })).tasks[0]!;
    await linkTask(world, await world.readSession(source.ref), otherTask, true, 's7c-handoff-other-link');

    const anchor: NoteAnchorV1 = { kind: 'goal', goalId: goal.goalId };
    const pointer = await understandingPointer(world, anchor);
    const draft = understandingNote({ anchor, topic: 's7c-handoff-understanding',
      conclusion: 'S7C handoff source understanding', structural: false,
      replaces: pointer.noteId === null ? [] : [pointer.noteId] });
    if (draft.kind !== 'understanding') throw new Error('S7C: the note draft is not an understanding');
    await world.scripted.script(source, [
      { kind: 'calls', calls: [{ callId: 's7c-handoff-source-note', name: 'record_note', args: {
        op: 'write', kind: draft.kind, topic: draft.topic, conclusion: draft.conclusion, anchor: draft.anchor,
        sections: draft.sections, structural: draft.structural, replaces: draft.replaces,
        expectedPointerRevision: pointer.revision } }] },
      { kind: 'text', text: 'S7C handoff source answer' },
    ]);
    const claim = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: goal,
      flowId: 's7c-handoff-source-run', sessionHint: source.ref, kind: 'select_work', taskId: t1.taskId },
    'claim_task');
    const entered = await world.gates.modelRequest(source);
    const started = driveWorkflow(world.ag2b, claim, { stopBefore: 'open_checks' });
    await entered.reached;
    const facts = ready<SessionFactsV1>(await world.post('sessions/facts', plain(S6A_SCOPE, source.ref)),
      'the source line facts');
    if (facts.latestWork === null) throw new Error('S7C: the source line has no Work claim');
    const sourceRun = facts.latestWork.runRef;
    const execution = ready<TaskExecutionRecord>(await world.post('executions/read', plain(S6A_SCOPE, sourceRun)),
      'the source Run');
    if (execution.run.status !== 'running' || execution.run.startedSince === null) {
      throw new Error(`S7C: the source Run is not entered: ${execution.run.status}`);
    }
    entered.release();
    await started;
    const note = await readNote(world, anchor, sourceRun);

    // The secretary child is responsible for the same handoff tasks (the pin source keeps t1..t3).
    for (const [index, task] of [t1, t2, t3].entries()) {
      const card = await world.readSession(secretarySource.ref);
      const open = card.links.some(link => link.ref.relation === 'responsible' && link.until === null
        && link.ref.target.kind === 'task' && link.ref.target.ref.taskId === task.taskId);
      if (!open) await linkTask(world, card, task, true, `s7c-handoff-pin-link-${index + 1}`);
    }

    // The remaining duty lines: the adviser with its real Run, the scribe and the fixed worker.
    const adviserGoal = (await main.createGoal('s7c-handoff-adviser-goal', 'S7C handoff adviser goal')).ref;
    const adviserTask = (await adoptS6BPlan(main, adviserGoal, { label: 's7c-handoff-adviser',
      taskIds: ['s7c-handoff-adviser-task'], role: ADVISER_ROLE.templateId })).tasks[0]!;
    await setAutonomy(world, adviserGoal, 'after_plan_confirmation');
    await linkTask(world, await world.readSession(adviserLine.ref), adviserTask, true, 's7c-handoff-adviser-task');
    // The adviser's own understanding: its Run owns adviserGoal, so this note is accepted and is the real
    // adviser-source pointer (a note anchored in another Goal is refused by the note ownership rule).
    const adviserAnchor: NoteAnchorV1 = { kind: 'goal', goalId: adviserGoal.goalId };
    const adviserPointer = await understandingPointer(world, adviserAnchor);
    const adviserDraft = understandingNote({ anchor: adviserAnchor, topic: 's7c-handoff-adviser-understanding',
      conclusion: 'the adviser Run wrote this', structural: false,
      replaces: adviserPointer.noteId === null ? [] : [adviserPointer.noteId] });
    if (adviserDraft.kind !== 'understanding') throw new Error('S7C: the adviser note is not an understanding');
    const otherAnchor: NoteAnchorV1 = { kind: 'goal', goalId: otherGoal.goalId };
    const otherPointer = await understandingPointer(world, otherAnchor);
    const otherDraft = understandingNote({ anchor: otherAnchor, topic: 's7c-handoff-other-understanding',
      conclusion: 'another Run wrote this', structural: false,
      replaces: otherPointer.noteId === null ? [] : [otherPointer.noteId] });
    if (otherDraft.kind !== 'understanding') throw new Error('S7C: the other-Run note is not an understanding');
    await world.scripted.script(adviserLine, [
      { kind: 'calls', calls: [
        { callId: 's7c-handoff-adviser-own-note', name: 'record_note', args: {
          op: 'write', kind: adviserDraft.kind, topic: adviserDraft.topic, conclusion: adviserDraft.conclusion,
          anchor: adviserDraft.anchor, sections: adviserDraft.sections, structural: adviserDraft.structural,
          replaces: adviserDraft.replaces, expectedPointerRevision: adviserPointer.revision } },
        { callId: 's7c-handoff-adviser-note', name: 'record_note', args: {
          op: 'write', kind: otherDraft.kind, topic: otherDraft.topic, conclusion: otherDraft.conclusion,
          anchor: otherDraft.anchor, sections: otherDraft.sections, structural: otherDraft.structural,
          replaces: otherDraft.replaces, expectedPointerRevision: otherPointer.revision } },
      ] },
      { kind: 'text', text: 'S7C handoff adviser answer' },
    ]);
    const adviserClaim = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: adviserGoal,
      flowId: 's7c-handoff-adviser-run', sessionHint: adviserLine.ref, kind: 'select_work',
      taskId: adviserTask.taskId }, 'claim_task');
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(world.ag2b, adviserClaim, { stopBefore: 'open_checks', receipts });
    const adviserRun = claimRunOf(receipts);
    const scribe = await sessionOf(world, await createS6BLine(main, { label: 's7c-handoff-scribe',
      role: S6A_SCRIBE_ROLE }));
    const fixed = await sessionOf(world, await createS6BLine(main, { label: 's7c-handoff-fixed',
      role: EXECUTOR_ROLE }));

    return {
      consume, world, handoffEntry: builtEntry, goal, plan, tasks,
      clean: { goal: cleanGoal, task: cleanTask }, other: { goal: otherGoal, task: otherTask },
      lines: { source, secretarySource, existing, creator: creatorLine, adviser: adviserLine,
      adviserRun, scribe, fixed },
      sourceRun, note,
      close: () => consume.world.close(),
    };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

function claimRunOf(receipts: readonly WorkflowStepReceipt[]): RunRef {
  for (const receipt of receipts) {
    if (receipt.kind === 'claim_task' && receipt.result.status === 'committed') return receipt.result.value.runRef;
  }
  throw new Error('S7C: the adviser Run has no claim');
}

async function readNote(world: S7CHandoffWorld['world'], anchor: NoteAnchorV1, run: RunRef): Promise<NoteItemV1> {
  const page = ready<{ items: NoteItemV1[] }>(await world.post('notes/list', plain(S6A_SCOPE, {
    goalId: anchor.kind === 'goal' ? anchor.goalId : null, state: 'accepted', limit: 20, cursor: null,
  })), 'the understanding notes');
  const note = page.items.find(item => item.kind === 'understanding' && item.anchor.kind === 'goal'
    && item.anchor.goalId === (anchor.kind === 'goal' ? anchor.goalId : '')
    && item.source.kind === 'agent' && item.source.runRef !== null
    && item.source.runRef.runId === run.runId);
  if (note === undefined) throw new Error('S7C: the source Run wrote no understanding note');
  return note;
}

// ---------------------------------------------------------------------------
// FH-2 — the successor's entered-commit restart
// ---------------------------------------------------------------------------

/** The existing `b2-entry-entered:` identity prefix the barrier matches. */
export const S7C_SUCCESSOR_ENTERED_PREFIX = 'b2-entry-entered:';

export type S7CHandoffCrashRead = {
  readonly run: RunRef;
  readonly execution: TaskExecutionRecord;
  /** The frozen prepared manifest's text, opened through `materials/open`. */
  readonly material: string;
};

/**
 * SQLite FH-2: hold the successor's first Run's entered commit before the platform commit, run the real composite
 * to that Run's prepare/start, crash the Host once the hold is reached, reopen the same database, continue the
 * same `workflow/advance`, and read the first Run through `executions/read` and `materials/open`.
 */
export async function openS7CHandoffCrash(input: {
  world: S7CHandoffWorld;
  /** The successor Session; its `latestWork` is the first Run after the reopen. */
  session: SessionRef;
  /** The real composite up to the successor's `prepare`/`start`; it stays pending while the entered commit is held. */
  start: () => Promise<void>;
  /** The continuation after the reopen (the same public `workflow/advance`). */
  advance: () => Promise<void>;
}): Promise<S7CHandoffCrashRead> {
  const world = input.world.world;
  const hold = commitBarrier.hold(byIdentityPrefix(S7C_SUCCESSOR_ENTERED_PREFIX), 'the successor entered commit');
  const started = input.start();
  started.catch(() => undefined);
  try {
    await hold.reached;
    await crashS7AHost(world, hold);
    await world.reopen();
    await input.advance();
    const facts = ready<SessionFactsV1>(await world.post('sessions/facts', plain(S6A_SCOPE, input.session)),
      'the successor Session facts');
    if (facts.latestWork === null) throw new Error('S7C: the successor has no Work claim after the restart');
    const run = facts.latestWork.runRef;
    const execution = ready<TaskExecutionRecord>(await world.post('executions/read', plain(S6A_SCOPE, run)),
      'the successor first Run');
    const bundleRef = execution.run.envelope?.bundleRef;
    if (bundleRef === undefined) throw new Error('S7C: the successor first Run has no prepared bundle');
    const material = ready<{ body: string }>(await world.post('materials/open', plain(S6A_SCOPE, {
      ref: bundleRef, usage: 'historical_explanation',
    })), 'the successor prepared manifest');
    return { run, execution, material: material.body };
  } finally {
    commitBarrier.reset();
    await started.catch(() => undefined);
  }
}

/** The adviser's exact Role binding: the same value the world's Workflow binding carries. */
export function s7cAdviserRoleBinding(): RoleBindingRefV1 {
  return workflowBinding('s7c-handoff-adviser-binding', ADVISER_ROLE).roleBinding;
}
