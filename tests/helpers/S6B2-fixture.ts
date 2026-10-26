/**
 * Steps for the secretary lifecycle scenes, reusing the host, request, workspace-handle and line/round fixtures.
 * Facts come from public steps; the record store is never read.
 * An absent optional owner throws a named error.
 * After a reached hold the world crashes once and takes a new owner.
 * Old calls are asserted first, then reset, awaited and the world closed.
 * A model gate is released and awaited in `finally`.
 */
import { principalIdentity } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { RunExecutionHistoryV1 } from '../../src/contracts/core/execution-history.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { Page, ReadResult } from '../../src/contracts/core/results.js';
import type { PreparedQueryExecution, PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { QueryRunRef } from '../../src/contracts/query-job.js';
import { isRecord } from '../../src/contracts/validation/common.js';
import type { SessionHistoryEntry } from '../../src/core/agent-runtime/session-operations.js';
import type {
  HandoffProgressV1, HandoffStageV1, SecretaryArchiveProgressV1, SecretaryArchiveStageV1,
  SessionHandoffWorkflowPort,
} from '../../src/core/work-graph/model/session-handoff-contracts.js';
import { advanceWriteKeys, savedHostPrincipal } from '../../src/core/work-graph/sessions/session-handoff-service.js';
import type { PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import type { SessionOperationRecord } from '../../src/core/work-graph/model/session-contracts.js';
import { sessionRecordSchema, type ToolResult } from '../../vendor/coding-agent/dist/public-api.js';
import { readQuery } from './A2-restart-fixture.js';
import { AG2B_CONSUMER_ID, graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { claimWithSecretaryProfile } from './request-claim-steps.js';
import { understandingNote } from './S4C2-note-card-fixture.js';
import { commitBarrier, type CommitHold, type CommitMatch } from './S6A-commit-barrier.js';
import { s6aCardsWorkspace, type S6ARequest } from './S6A-cards-fixture.js';
import {
  openS6AHostWorld, usageOf, type S6AHostWorld, type S6AHostWorldOptions, type S6AReply,
} from './S6A-host-fixture.js';
import { createSessionDutyResolver } from '../../src/composition/session-duty.js';
import {
  S6A_SCOPE, S6A_SECRETARY_PROFILE_ID, type S6ASession,
} from './S6A-request-fixture.js';
import {
  holdS6BRequestRound, understandingPointer,
} from './S6B1-fixture.js';

const field = (body: unknown, key: string): unknown => isRecord(body) ? body[key] : undefined;

/** The `value` of a route answer whose status is `status`; any other answer throws with what the platform said. */
function valueOf<T>(body: unknown, status: 'ready' | 'committed' | 'completed' | 'queued', what: string): T {
  if (field(body, 'status') !== status) throw new Error(`S6B2: ${what} is not ${status}: ${JSON.stringify(body)}`);
  return field(body, 'value') as T;
}

/** Open one secretary world over the shared host fixture. */
export async function openS6B2World(options: S6AHostWorldOptions) {
  const world = await openS6AHostWorld(options);
  return {
    world,
    main: s6aCardsWorkspace(world, S6A_SCOPE),
    clock: world.clock,
    close: () => world.close(),
  };
}

/** The platform's real duty resolver over a Session's own role facts: the one secretary test the owner rows reuse. */
export const s6b2Duty = createSessionDutyResolver({
  readRoleSpec: async () => ({ status: 'not_found' }), configuration: undefined,
});

/** The real Workflow owner the advance and the understanding round call; absent until the composition publishes it. */
function sessionHandoffOwner(world: S6AHostWorld): SessionHandoffWorkflowPort {
  const owner = world.platform.workflow.sessionHandoff;
  if (owner === undefined) throw new Error('S6B2: sessionHandoff is not published yet (6b2-w2)');
  return owner;
}

/** `sessions/operation` of the trusted read owner: the operation as the platform recorded it, nothing built. */
async function readOperation(world: S6AHostWorld, ref: OperationRef): Promise<SessionOperationRecord> {
  const answer = await world.post('sessions/operation', plain(S6A_SCOPE, ref));
  const result = answer.body as ReadResult<SessionOperationRecord>;
  if (result.status !== 'ready') {
    throw new Error(`S6B2: the operation ${ref.operationId} is not readable: ${JSON.stringify(result)}`);
  }
  return result.value;
}

/** Accept the handoff with a real source and either the secretary's one create assignment or an existing target. */
async function acceptSecretaryHandoff(world: S6AHostWorld, input: {
  commandId: string; source: SessionRef; trigger: 'too_long' | 'manual';
  target?: SessionRef; tasks?: readonly TaskTriple[];
}): Promise<OperationRef> {
  const tasks = [...(input.tasks ?? [])];
  const assignment = input.target === undefined
    ? { target: { kind: 'create' as const, duty: 'secretary' as const }, tasks }
    : { target: { kind: 'existing' as const, session: input.target }, tasks };
  const ctx = input.trigger === 'manual' ? world.humanContext() : world.systemContext();
  const result = await world.platform.sessionHandoff.acceptHandoff(ctx, {
    commandId: input.commandId, workspace: { ...S6A_SCOPE }, source: input.source, trigger: input.trigger,
    assignments: [assignment],
  });
  if (result.status !== 'committed') {
    throw new Error(`S6B2: the handoff accept was refused: ${JSON.stringify(result)}`);
  }
  return result.value.operation;
}

/** A valid answer of each execution kind, so a released round ends normally. Public model input, not a fact. */
function roundAnswer(manifest: PreparedQueryManifestV1): string {
  return manifest.request?.executionKind === 'initial_coordination'
    ? JSON.stringify({ schemaVersion: 2, kind: 'needs_decision', summary: 'S6B2 summary', questions: ['S6B2 question'] })
    : JSON.stringify({ schemaVersion: 1, body: 'S6B2 answer', ideas: [], goalCardDrafts: [] });
}

/** Run the secretary round to its end and check its window and usage publicly. */
export async function seedS6BTooLongSecretary(world: S6AHostWorld, input: {
  windowTokens: number; inputTokens: number; label?: string;
}) {
  const profile = (await world.readProfiles()).find(candidate => candidate.id === S6A_SECRETARY_PROFILE_ID);
  if (profile === undefined) throw new Error('S6B2: the world publishes no secretary profile');
  if (profile.runtimeBudget.contextWindowTokens !== input.windowTokens) {
    throw new Error(`S6B2: the secretary window is ${profile.runtimeBudget.contextWindowTokens}, not ${input.windowTokens}`);
  }
  const label = input.label ?? 'too-long';
  const { value: materials } = await holdS6BRequestRound(world, {
    label, goalId: null,
    replies: manifest => [{ kind: 'text', text: roundAnswer(manifest), usage: usageOf(input.inputTokens) }],
  }, async round => round);
  const query = await readQuery(world.ag2b, materials.request.round);
  const requests = query.run.run.executionState?.requests ?? [];
  const reported = [...requests].reverse().find(request => request.inputTokens !== null)?.inputTokens ?? null;
  if (reported !== input.inputTokens) {
    throw new Error(`S6B2: the ended round reports ${String(reported)} input tokens, not ${input.inputTokens}`);
  }
  return { secretary: materials.secretary, request: materials.request, prepared: materials.prepared,
    manifest: materials.manifest, query };
}

/** Keep the given secretary's round inside `use`; release and await it in `finally`. */
async function inS6B2Round<T>(world: S6AHostWorld, input: {
  secretary: S6ASession; runRef: QueryRunRef; id: string;
  replies: (manifest: PreparedQueryManifestV1) => readonly S6AReply[];
}, use: (held: { prepared: PreparedQueryExecution; manifest: PreparedQueryManifestV1; runRef: QueryRunRef }) => Promise<T>) {
  const prepared = valueOf<PreparedQueryExecution>((await world.post('queries/prepare', plain(S6A_SCOPE, {
    queryRunRef: input.runRef, requestId: `${input.id}-prepare`,
  }))).body, 'ready', 'the round preparation');
  const opened = valueOf<{ body: string }>((await world.post('materials/open', plain(S6A_SCOPE, {
    ref: prepared.bundleRef, usage: 'historical_explanation',
  }))).body, 'ready', 'the frozen manifest');
  const manifest = JSON.parse(opened.body) as PreparedQueryManifestV1;
  await world.scripted.script(input.secretary, input.replies(manifest));
  const gate = await world.gates.modelRequest(input.secretary);
  const started = world.post('queries/start', plain(S6A_SCOPE, { prepared, consumerId: AG2B_CONSUMER_ID,
    requestId: `${input.id}-start` })).then(answer => answer.body);
  const endedFirst = started.then(body => {
    throw new Error(`S6B2: the round ended before its model request: ${JSON.stringify(body)}`);
  });
  endedFirst.catch(() => undefined);
  let value!: T;
  let failure: unknown;
  let startBody: unknown;
  try {
    await Promise.race([gate.reached, endedFirst]);
    value = await use({ prepared, manifest, runRef: input.runRef });
  } catch (error) {
    failure = error;
  } finally {
    gate.release();
    startBody = await started;
  }
  if (failure !== undefined) throw failure;
  return { value, started: startBody };
}

/** The Kernel record body of one history entry, exactly the shape `sessions/history` publishes. */
function kernelHistoryBody(body: SessionHistoryEntry['body']):
  body is { encoding: 'kernel_session_record_json'; text: string } {
  return isRecord(body) && (body as { encoding?: unknown }).encoding === 'kernel_session_record_json'
    && typeof (body as { text?: unknown }).text === 'string';
}

/** One started tool call of the Run's own turn, from its `tool.started` event. */
type S6B2StartedCall = { callId: string; name: string; arguments: Record<string, unknown> };

/** The calls and results of one run's own Kernel turn, read through the public history and locator. */
type S6B2RunTurn = { calls: readonly S6B2StartedCall[]; results: Map<string, ToolResult[]> };

/** The public execution-history locator of the given QueryRun, read exactly. */
async function queryHistoryOf(world: S6AHostWorld, run: QueryRunRef): Promise<RunExecutionHistoryV1> {
  const read = await world.platform.reconcile.readQueryExecution(world.systemContext(), run);
  if (read.status !== 'ready') throw new Error(`S6B2: the QueryRun ${run.runId} is not readable: ${JSON.stringify(read)}`);
  const history = read.value.run.run.executionState?.history;
  if (history === null || history === undefined) {
    throw new Error(`S6B2: the QueryRun ${run.runId} has no public execution-history locator`);
  }
  return history;
}

/** Page by the public locator and keep this turn's calls and results. */
async function readS6BTurn(world: S6AHostWorld, history: RunExecutionHistoryV1): Promise<S6B2RunTurn> {
  if (history.endPosition === null) {
    throw new Error(`S6B2: the ended run ${history.kernel.runId} has no terminal history position`);
  }
  const identity = { runId: history.kernel.runId, turnId: history.kernel.turnId };
  const range = { adapterId: history.kernel.adapterId, kernelSessionId: history.kernel.kernelSessionId,
    startPosition: history.startPosition, throughPosition: history.endPosition };
  const calls = new Map<string, S6B2StartedCall>();
  const results = new Map<string, ToolResult[]>();
  let turnStart: number | null = null;
  let after: string | null = null;
  for (;;) {
    const answer = await world.post('sessions/history', plain(S6A_SCOPE, {
      sessionRef: history.sessionRef, afterCursor: after, throughCursor: null, limit: 200, range,
    }));
    const page = answer.body as ReadResult<Page<SessionHistoryEntry>>;
    if (page.status !== 'ready') throw new Error(`S6B2: the Run history is not readable: ${JSON.stringify(page)}`);
    for (const item of page.value.items) {
      if (!kernelHistoryBody(item.body)) continue;
      const record = sessionRecordSchema.parse(JSON.parse(item.body.text));
      if (record.recordType === 'turn.started') {
        if (record.payload.run.runId === identity.runId
          && record.payload.run.turn.turnId === identity.turnId) {
          turnStart = item.source.position;
        }
        continue;
      }
      if (record.recordType !== 'agent.event') continue;
      const event = record.payload.event;
      if (event.meta.runId !== identity.runId || event.meta.turnId !== identity.turnId) continue;
      if (event.type === 'tool.started') {
        calls.set(event.payload.call.callId, { callId: event.payload.call.callId,
          name: event.payload.call.name, arguments: event.payload.call.arguments as Record<string, unknown> });
        continue;
      }
      if (event.type !== 'tool.completed' && event.type !== 'tool.failed' && event.type !== 'tool.cancelled') continue;
      const list = results.get(event.payload.callId) ?? [];
      list.push(event.payload.result);
      results.set(event.payload.callId, list);
    }
    after = page.value.nextCursor;
    if (after === null) break;
  }
  if (turnStart === null) {
    throw new Error(`S6B2: the run history holds no turn.started for ${identity.runId}/${identity.turnId}`);
  }
  return { calls: [...calls.values()], results };
}

/** The `{ noteId, version }` a successful `record_note` output reports, or null when the write was refused. */
function successfulNoteWrite(result: ToolResult): { noteId: string; version: number } | null {
  if (result.status !== 'success') return null;
  for (const part of result.output) {
    if (part.kind !== 'json' || !isRecord(part.value)) continue;
    const write = part.value['write'];
    if (!isRecord(write) || write['status'] === 'rejected') continue;
    if (typeof write['noteId'] === 'string' && typeof write['version'] === 'number') {
      return { noteId: write['noteId'], version: write['version'] };
    }
  }
  return null;
}

/** Match each goal's one successful `record_note` write in the turn to the pointer and pointed version read publicly. */
async function matchNotePointers(world: S6AHostWorld, turn: S6B2RunTurn, goals: readonly GoalRef[]) {
  const pointers = [];
  for (const goal of goals) {
    const calls = turn.calls.filter(call => call.name === 'record_note'
      && call.arguments['op'] === 'write' && isRecord(call.arguments['anchor'])
      && call.arguments['anchor']['kind'] === 'goal' && call.arguments['anchor']['goalId'] === goal.goalId);
    if (calls.length !== 1) {
      throw new Error(`S6B2: goal ${goal.goalId} has ${calls.length} record_note calls in the Run's own turn, not 1`);
    }
    const results = turn.results.get(calls[0]!.callId) ?? [];
    if (results.length !== 1) {
      throw new Error(`S6B2: goal ${goal.goalId} has ${results.length} results for ${calls[0]!.callId}, not 1`);
    }
    const written = successfulNoteWrite(results[0]!);
    if (written === null) {
      throw new Error(`S6B2: the record_note for ${goal.goalId} reported no successful write: ${JSON.stringify(results[0])}`);
    }
    const read = await readS6BNote(world, { kind: 'goal', goalId: goal.goalId });
    if (read.pointer.noteId !== written.noteId || read.version !== written.version) {
      throw new Error(`S6B2: goal ${goal.goalId} wrote ${written.noteId} v${written.version}, but the public pointer`
        + ` reads ${String(read.pointer.noteId)} v${read.version}`);
    }
    pointers.push({ goal, ...read });
  }
  return pointers;
}

/** Check the given QueryRun's writes, pointers and versions. */
async function verifyS6BUnderstandingNotes(world: S6AHostWorld, input: {
  run: QueryRunRef; goals: readonly GoalRef[];
}) {
  return await matchNotePointers(world, await readS6BTurn(world, await queryHistoryOf(world, input.run)),
    input.goals);
}

/** The current understanding pointer and its note, read exactly through the public note read. */
async function readS6BNote(world: S6AHostWorld, anchor: { kind: 'goal'; goalId: string }) {
  const pointer = await understandingPointer(world, anchor);
  if (pointer.noteId === null) throw new Error(`S6B2: the written note is not listed: ${anchor.goalId}`);
  const read = await world.platform.notes.readNote(world.humanContext(), { noteId: pointer.noteId });
  if (read.status !== 'ready') throw new Error(`S6B2: the written note is not readable: ${JSON.stringify(read)}`);
  return { pointer, note: read.value, version: read.value.version };
}

/** One real tool call per Goal, using the public pointer revision. */
async function understandingNoteCalls(world: S6AHostWorld, secretary: S6ASession, goals: readonly GoalRef[]) {
  const calls: Array<{ callId: string; name: string; args: Record<string, unknown> }> = [];
  for (const [index, goal] of goals.entries()) {
    const pointer = await understandingPointer(world, { kind: 'goal', goalId: goal.goalId });
    const note = understandingNote({ anchor: { kind: 'goal', goalId: goal.goalId }, topic: 's6b2-understanding',
      conclusion: `S6B2 understanding ${secretary.label} ${index + 1}`, structural: false,
      replaces: pointer.noteId === null ? [] : [pointer.noteId] });
    if (note.kind !== 'understanding') throw new Error('S6B2: the note draft is not an understanding');
    calls.push({ callId: `s6b2-understanding-note-${index + 1}`, name: 'record_note', args: {
      op: 'write', kind: note.kind, topic: note.topic, conclusion: note.conclusion, anchor: note.anchor,
      sections: note.sections, structural: note.structural, replaces: note.replaces,
      expectedPointerRevision: pointer.revision,
    } });
  }
  return calls;
}

/** Write in the old secretary's understanding round and check it after it ends. */
export async function holdS6BUnderstandingRound(world: S6AHostWorld, input: {
  secretary: S6ASession; goals: readonly GoalRef[];
}) {
  const owner = sessionHandoffOwner(world);
  const operation = await acceptSecretaryHandoff(world, {
    commandId: `s6b2-understanding-${input.secretary.label}`, source: input.secretary.ref, trigger: 'too_long',
  });
  let progress: HandoffProgressV1 | null = null;
  for (let step = 0; step < 8; step += 1) {
    const advanced = await owner.advance(world.systemContext(), { operation });
    if (advanced.status !== 'ready') {
      throw new Error(`S6B2: the handoff advance is not ready: ${JSON.stringify(advanced)}`);
    }
    progress = advanced.value;
    if (progress.stage === 'understanding' || progress.phase === 'failed' || progress.phase === 'completed') break;
  }
  if (progress === null || progress.stage !== 'understanding') {
    throw new Error(`S6B2: the handoff did not reach its understanding stage: ${JSON.stringify(progress)}`);
  }
  const record = await readOperation(world, operation);
  const entry = record.action.kind === 'handoff' ? record.action.progress.understanding.at(-1) : undefined;
  const round = entry?.round ?? null;
  if (round === null) throw new Error('S6B2: the understanding stage appended no round');
  const read = await readQuery(world.ag2b, round);
  if (read.run.run.executionState === undefined) {
    const claimed = await claimWithSecretaryProfile(world, round, input.secretary,
      `s6b2-understanding-claim-${input.secretary.label}`);
    if (claimed['status'] !== 'committed') {
      throw new Error(`S6B2: the understanding round was not claimed: ${JSON.stringify(claimed)}`);
    }
  }
  const run = (await readQuery(world.ag2b, round)).run;
  const calls = await understandingNoteCalls(world, input.secretary, input.goals);
  const { value, started } = await inS6B2Round(world, {
    secretary: input.secretary, runRef: run.ref, id: `s6b2-understanding-${input.secretary.label}`,
    replies: manifest => [
      { kind: 'calls', calls },
      { kind: 'text', text: roundAnswer(manifest) },
    ],
  }, async held => ({ operation, round, prepared: held.prepared, manifest: held.manifest, queryRun: held.runRef }));
  const ended = valueOf<{ answer: unknown; run: { run: { status: string } } }>(started, 'ready',
    'the understanding round start');
  if (ended.answer === null || ended.run.run.status !== 'answered') {
    throw new Error(`S6B2: the understanding round did not answer: ${JSON.stringify(ended.run)}`);
  }
  const pointers = await verifyS6BUnderstandingNotes(world, { run: value.queryRun, goals: input.goals });
  return { ...value, pointers };
}

/** One point the driver holds, located by the complete operation and commit token. */
export type S6B2HandoffHold = {
  stage: HandoffStageV1 | SecretaryArchiveStageV1; item: string; phase: 'before' | 'after'; generation: number;
};

/** The per-item receipts and facts an operation read exposes; the record is read through `sessions/operation`. */
function receiptsOf(record: SessionOperationRecord) {
  if (record.action.kind === 'handoff') {
    const progress = record.action.progress;
    return {
      transfers: progress.assignments.flatMap(assignment => assignment.transfers.map(transfer => transfer.receipt)),
      routing: progress.routing === null ? [] : progress.routing.roots.map(root => root.receipt),
      understanding: progress.understanding.map(entry => ({ generation: entry.generation, round: entry.round })),
    };
  }
  if (record.action.kind === 'secretary_archive') {
    return { items: record.action.progress.items.map(item => ({ requestRoot: item.requestRoot, outcome: item.outcome,
      routingRound: item.routingRound, cursor: item.cursor })) };
  }
  return { creation: record.action };
}

/** Whether this handoff result ends the drive: done, waiting for the writer, or a recorded refusal. */
function handoffStopped(progress: HandoffProgressV1): boolean {
  return progress.phase === 'completed' || progress.phase === 'failed' || progress.stage === 'finished'
    || progress.stage === 'wait_writer' || progress.lastRefusal !== null;
}

/** Whether this archive result ends the drive: done or a recorded refusal. */
function archiveStopped(progress: SecretaryArchiveProgressV1): boolean {
  return progress.phase === 'completed' || progress.phase === 'failed' || progress.stage === 'finished'
    || progress.lastRefusal !== null;
}

/** One installed crash hold: the real commit gate plus its one-shot bookkeeping. */
type S6B2Held = { gate: CommitHold; reached: boolean; consumed: boolean };

/** Drive to completion, the writer wait or a refusal; the old resources go to teardown after assertions. */
export async function driveS6BHandoff(world: S6AHostWorld, input: {
  operation: OperationRef; hold?: readonly S6B2HandoffHold[];
}) {
  let archive = false;
  /**
   * The commit a hold names: the advance write's R2 identity for the full stage/item/phase/generation. The identity is
   * the operation/scope/principal/commandId hash, so the arm and the saved actor come from the real operation read and
   * the held write's own fingerprint input is not needed to locate it.
   */
  function holdMatcherOf(record: SessionOperationRecord, hold: S6B2HandoffHold): CommitMatch {
    const action = record.action;
    if (action.kind === 'create') throw new Error('S6B2: a create operation has no advance write to hold');
    const principal = savedHostPrincipal(action.input.actor);
    if (principal === null) throw new Error('S6B2: the held operation has no saved Host actor');
    const keys = advanceWriteKeys({
      principal: principalIdentity(principal),
      scope: { projectId: record.ref.projectId, workspaceId: record.workspaceId },
      kind: action.kind === 'secretary_archive' ? 'secretaryArchive.advance' : 'handoff.advance',
      operation: input.operation, stage: hold.stage, item: hold.item, phase: hold.phase,
      generation: hold.generation, fingerprintInput: null,
    });
    return commit => commit.identityKey === keys.keys.identityKey;
  }
  let holds: S6B2Held[] = [];
  let owner!: SessionHandoffWorkflowPort;
  let calls: Promise<unknown>[] = [];
  const abandoned: Promise<unknown>[] = [];
  let progress: HandoffProgressV1 | null = null;
  type Settled = { ok: true; value: ReadResult<HandoffProgressV1 | SecretaryArchiveProgressV1> }
    | { ok: false; error: unknown };
  const settle = (call: Promise<ReadResult<HandoffProgressV1 | SecretaryArchiveProgressV1>>): Promise<Settled> =>
    call.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
  const execute = async (start: () => Promise<ReadResult<HandoffProgressV1 | SecretaryArchiveProgressV1>>) => {
    for (;;) {
      const call = settle(start());
      calls.push(call);
      const live = holds.filter(entry => !entry.consumed);
      const outcome = await Promise.race([
        call.then(value => ({ kind: 'done' as const, value })),
        ...live.map(entry => entry.gate.reached.then(() => ({ kind: 'reached' as const }))),
      ]);
      if (outcome.kind === 'done') {
        if (!outcome.value.ok) throw outcome.value.error;
        const result = outcome.value.value;
        if (result.status !== 'ready') {
          throw new Error(`S6B2: the ${archive ? 'archive' : 'handoff'} advance is not ready: ${JSON.stringify(result)}`);
        }
        return result.value;
      }
      await world.crash();
      abandoned.push(...calls);
      calls = [];
      for (const entry of holds) if (entry.reached) entry.consumed = true;
      owner = sessionHandoffOwner(world);
    }
  };
  try {
    owner = sessionHandoffOwner(world);
    const held = await readOperation(world, input.operation);
    archive = held.action.kind === 'secretary_archive';
    holds = (input.hold ?? []).map((hold, index) => {
      const gate = commitBarrier.hold(holdMatcherOf(held, hold), `S6B2 hold #${index + 1}`);
      const entry: S6B2Held = { gate, reached: false, consumed: false };
      gate.reached.then(() => { entry.reached = true; });
      return entry;
    });
    if (!archive) {
      progress = (await execute(() => owner.continueHandoff(world.systemContext(),
        { operation: input.operation }))) as HandoffProgressV1;
    }
    for (let step = 0; step < 32 && (archive || progress === null || !handoffStopped(progress)); step += 1) {
      if (archive) {
        const value = await execute(() => owner.manualArchive(world.systemContext(),
          { operation: input.operation })) as SecretaryArchiveProgressV1;
        if (archiveStopped(value)) break;
        continue;
      }
      progress = await execute(() => owner.advance(world.systemContext(),
        { operation: input.operation })) as HandoffProgressV1;
    }
    if (holds.some(entry => !entry.reached)) {
      throw new Error('S6B2: requested handoff hold was not reached');
    }
    const operation = await readOperation(world, input.operation);
    return { operation, receipts: receiptsOf(operation), progress, abandoned };
  } catch (error) {
    // A failure path cannot hand the row a usable handle: release every hold and await every call, old and current.
    for (const entry of holds) entry.gate.release();
    await Promise.all([...abandoned, ...calls].map(call => call.then(() => undefined, () => undefined)));
    throw error;
  }
}

/** Release every hold the crash protocol kept, then await the abandoned instance's calls; called after assertions. */
export async function teardownS6BHandoff(drive: Awaited<ReturnType<typeof driveS6BHandoff>>): Promise<void> {
  commitBarrier.reset();
  await Promise.all(drive.abandoned.map(call => call.then(() => undefined, () => undefined)));
}

/** Two processing requests on the same secretary's two goals, the second moved by a real manual route. */
export async function seedS6BTwoProcessingRoots(world: S6AHostWorld, input: {
  secretary?: S6ASession; label?: string;
} = {}) {
  const ws = s6aCardsWorkspace(world, S6A_SCOPE);
  const label = input.label ?? 'two';
  const recipient = input.secretary?.ref ?? null;
  const first = await ws.submit({ label: `${label}-1`, goalId: world.goals.first.goalId, recipient });
  // The first root holds the given secretary's intake until its round ends, so the second root is opened on its
  // own secretary and moved by the scene's real manual route; a second submit to the same recipient is refused busy.
  const second = await ws.submit({ label: `${label}-2`, goalId: world.goals.second.goalId, recipient: null });
  const owner = input.secretary === undefined ? first.secretary : input.secretary.ref;
  if (owner === null) throw new Error(`S6B2: the first request ${first.label} has no secretary`);
  if (second.secretary === null || second.secretary.sessionId !== owner.sessionId) {
    const routed = await world.route({ commandId: `s6b2-two-route-${label}`, round: second.round, to: owner });
    if (routed.status !== 'routed') {
      throw new Error(`S6B2: the second request was not routed to the owner: ${JSON.stringify(routed)}`);
    }
  }
  const candidate = await ws.proposeCandidate({ label: `${label}-2-candidate`, goal: world.goals.second, request: second });
  const firstView = await ws.readRequest(first.requestRoot);
  const secondView = await ws.readRequest(second.requestRoot);
  if (firstView['processing'] !== true || secondView['processing'] !== true) {
    throw new Error(`S6B2: the two roots are not both processing: ${JSON.stringify([firstView, secondView])}`);
  }
  if (secondView['candidate'] === null || secondView['candidate'] === undefined) {
    throw new Error(`S6B2: the second root has no candidate: ${JSON.stringify(secondView)}`);
  }
  return { secretary: owner, requests: [first, second] as const, candidate, views: { first: firstView, second: secondView } };
}

/** Adopt another proposal and confirm the request's original candidate is stale. */
export async function seedS6BStaleCandidate(world: S6AHostWorld, input: { request: S6ARequest; label?: string }) {
  if (input.request.goalId === null) throw new Error('S6B2: a stale candidate needs a request with a goal');
  const goal: GoalRef = { aggregateType: 'Goal', projectId: S6A_SCOPE.projectId, goalId: input.request.goalId };
  const ws = s6aCardsWorkspace(world, S6A_SCOPE);
  const label = input.label ?? 'stale';
  // A request the scene already proposed for keeps that live proposal as its original candidate.
  const before = await ws.readRequest(input.request.requestRoot);
  const current = before['candidate'];
  const original: PlanProposalRef = isRecord(current) && isRecord(current['proposalRef'])
    ? current['proposalRef'] as PlanProposalRef
    : (await ws.proposeCandidate({ label: `${label}-original`, goal, request: input.request })).proposal.ref;
  const other = await ws.proposeCandidate({ label: `${label}-other`, goal, request: null });
  const adopted = await ws.post('plans/apply', graphWrite(ws.scope, {
    proposalRef: other.proposal.ref, expectedProposalRevision: other.proposal.revision, decisionRefs: [],
  }, `s6b2-stale-apply-${label}`));
  if (field(adopted, 'status') !== 'committed') {
    throw new Error(`S6B2: the second proposal was not adopted: ${JSON.stringify(adopted)}`);
  }
  const view = await ws.readRequest(input.request.requestRoot);
  const candidate = view['candidate'];
  if (!isRecord(candidate) || candidate['stale'] !== true) {
    throw new Error(`S6B2: the request's candidate is not stale: ${JSON.stringify(candidate)}`);
  }
  const ref = candidate['proposalRef'];
  if (!isRecord(ref) || ref['proposalId'] !== original.proposalId) {
    throw new Error(`S6B2: the stale candidate is not the request's original proposal: ${JSON.stringify(candidate)}`);
  }
  return { original, other, view, candidate };
}
