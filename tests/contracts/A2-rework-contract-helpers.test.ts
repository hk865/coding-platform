/**
 * A.2 step 1 (spec §15.2 第 1 步): the pure contract helpers shared by the
 * WorkGraph owners, the state machines and the RUN-02 guard.
 *
 * - `reworkActorClassOf` / `isAutomationActor` (spec §1 C1, §4 TD-6): only the
 *   closed `PLATFORM_AUTOMATION_ACTORS` list is `system`; a Host started with a
 *   `kind:'system'` actor is still an operator (`human`).
 * - `newBasisInputProblem` (§13 ND-9): platform bodies are never a new basis;
 *   only a stored Artifact or a responded SessionMessage is.
 * - `continuationBriefDigest` / `continuationBriefMarker` /
 *   `continuationBriefShapeProblem` / `compareSourceCheckpoints` /
 *   `renderContinuationBriefZh` (§6.1 (e), C3).
 *
 * No I/O, no RecordStore, no model.
 */
import { describe, expect, it } from 'vitest';
import {
  CONTINUATION_BRIEF_LIMITS, compareSourceCheckpoints, continuationBriefDigest, continuationBriefMarker,
  continuationBriefShapeProblem, renderContinuationBriefZh, type BoundedTextV1, type ContinuationBriefV1,
  type ContinuationToolCallV1,
} from '../../src/contracts/continuation-brief.js';
import type { CorePrincipal } from '../../src/contracts/core/call-context.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import {
  MANIFEST_CONTENT_TYPE, PLATFORM_GENERATED_CONTENT_TYPES, QUERY_MANIFEST_CONTENT_TYPE, REPORT_CONTENT_TYPE,
  newBasisInputProblem, type NewBasisInputRefV1,
} from '../../src/contracts/no-progress.js';
import {
  DEFAULT_AUTO_REWORK_LIMIT, DEFAULT_TASK_AUTOMATION_POLICY, GOAL_FAN_OUT_ACTOR, MAX_AUTO_REWORK_LIMIT,
  PLATFORM_AUTOMATION_ACTORS, SESSION_ARCHIVE_AUTOMATION_ACTOR, WORKFLOW_AUTOMATION_ACTOR, isAutomationActor, reworkActorClassOf,
} from '../../src/contracts/task-requeue.js';
import { PREPARED_MANIFEST_CONTENT_TYPE } from '../../src/core/agent-runtime/execution-preparation.js';
import { QUERY_MANIFEST_CONTENT_TYPE as RUNTIME_QUERY_MANIFEST_CONTENT_TYPE } from '../../src/core/agent-runtime/query-preparation.js';
import { MANIFEST_CONTENT_TYPE as WORK_GRAPH_MANIFEST_CONTENT_TYPE } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { QUERY_MANIFEST_CONTENT_TYPE as WORK_GRAPH_QUERY_MANIFEST_CONTENT_TYPE } from '../../src/core/work-graph/queries/query-execution.js';

const P = 'a2-project', G = 'a2-goal', T = 'a2-task', W = 'a2-workspace';
const sha = (c: string): string => c.repeat(64);
const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });
const roleBinding = { schemaVersion: 1 as const, bindingId: 'b-1', templateId: 'worker', templateRevision: 'r1',
  bindingVersion: 1, policyRevision: 'p1' };
const artifact = (contentType: string, digest = sha('a')): ArtifactRef =>
  ({ kind: 'artifact', contentType, digest, sizeBytes: 12, source: { kind: 'workspace', refId: W, revision: '3' } });

// ------------------------------------------------------------------------ //
// Actor classification                                                      //
// ------------------------------------------------------------------------ //
describe('rework actor classification (C1, TD-6)', () => {
  const operatorAsSystem: ActorRef = { kind: 'system', id: 'local-host' };
  const human: ActorRef = { kind: 'human', id: 'user-1' };
  const hostAs = (actor: Extract<ActorRef, { kind: 'human' | 'system' }>): CorePrincipal => ({ kind: 'host', actor });
  const workRun = (ref: RunRef): CorePrincipal => ({ kind: 'work_run', runRef: ref, roleBinding });
  const queryRun: CorePrincipal = { kind: 'query_run', initiator: { kind: 'human', id: 'user-1' },
    queryRunRef: { aggregateType: 'QueryRun', projectId: P, workspaceId: W, queryJobId: 'q-1', runId: 'qr-1' } };

  it('isAutomationActor accepts exactly the closed platform automation list, by value', () => {
    // Slice 1 §3.3 (S:596, lead update 2026-10-09): the session-archive automation actor joins the closed list.
    expect(PLATFORM_AUTOMATION_ACTORS).toEqual([WORKFLOW_AUTOMATION_ACTOR, GOAL_FAN_OUT_ACTOR, SESSION_ARCHIVE_AUTOMATION_ACTOR]);
    expect(SESSION_ARCHIVE_AUTOMATION_ACTOR).toEqual({ kind: 'system', id: 'workflow:session-archive' });
    expect(WORKFLOW_AUTOMATION_ACTOR).toEqual({ kind: 'system', id: 'workflow:auto-rework' });
    expect(GOAL_FAN_OUT_ACTOR).toEqual({ kind: 'system', id: 'host:goal-fan-out' });
    expect(isAutomationActor(WORKFLOW_AUTOMATION_ACTOR)).toBe(true);
    expect(isAutomationActor(GOAL_FAN_OUT_ACTOR)).toBe(true);
    // A structurally equal copy is the same actor (canonical equality, not identity).
    expect(isAutomationActor({ kind: 'system', id: 'workflow:auto-rework' })).toBe(true);
    expect(isAutomationActor({ kind: 'system', id: 'host:goal-fan-out' })).toBe(true);
    expect(isAutomationActor(operatorAsSystem)).toBe(false);
    expect(isAutomationActor({ kind: 'system', id: 'workflow:auto-rework ' })).toBe(false);
    expect(isAutomationActor({ kind: 'human', id: 'workflow:auto-rework' })).toBe(false);
    expect(isAutomationActor({ kind: 'agent', id: 'host:goal-fan-out', runRef: runRef('r-1') })).toBe(false);
  });

  it('a host principal is human unless its actor is a platform automation actor; a kind:system Host is an operator', () => {
    expect(reworkActorClassOf(hostAs({ kind: 'human', id: 'user-1' }), human)).toBe('human');
    expect(reworkActorClassOf(hostAs({ kind: 'system', id: 'local-host' }), operatorAsSystem)).toBe('human');
    expect(reworkActorClassOf(hostAs(WORKFLOW_AUTOMATION_ACTOR), WORKFLOW_AUTOMATION_ACTOR)).toBe('system');
    expect(reworkActorClassOf(hostAs(GOAL_FAN_OUT_ACTOR), { kind: 'system', id: 'host:goal-fan-out' })).toBe('system');
  });

  it('an actor that does not belong to the principal, or a query principal, has no class', () => {
    // A Host may not act as another actor (not even as a platform automation actor).
    expect(reworkActorClassOf(hostAs({ kind: 'system', id: 'local-host' }), WORKFLOW_AUTOMATION_ACTOR)).toBeNull();
    expect(reworkActorClassOf(hostAs({ kind: 'human', id: 'user-1' }), { kind: 'system', id: 'user-1' })).toBeNull();
    expect(reworkActorClassOf(hostAs({ kind: 'human', id: 'user-1' }), { kind: 'agent', id: 'user-1', runRef: runRef('r-1') })).toBeNull();
    expect(reworkActorClassOf(workRun(runRef('r-1')), human)).toBeNull();
    expect(reworkActorClassOf(queryRun, human)).toBeNull();
    expect(reworkActorClassOf(queryRun, { kind: 'agent', id: 'a-1', runRef: runRef('r-1') })).toBeNull();
  });

  it('a work_run principal is agent only for an agent actor of its own Run', () => {
    expect(reworkActorClassOf(workRun(runRef('r-1')), { kind: 'agent', id: 'a-1', runRef: runRef('r-1') })).toBe('agent');
    expect(reworkActorClassOf(workRun(runRef('r-1')), { kind: 'agent', id: 'a-1', runRef: runRef('r-2') })).toBeNull();
    expect(reworkActorClassOf(workRun(runRef('r-1')),
      { kind: 'agent', id: 'a-1', runRef: { ...runRef('r-1'), goalId: 'other-goal' } })).toBeNull();
    expect(reworkActorClassOf(workRun(runRef('r-1')), WORKFLOW_AUTOMATION_ACTOR)).toBeNull();
  });

  it('a recorded actor (null principal) is classified by the same rule', () => {
    expect(reworkActorClassOf(null, human)).toBe('human');
    expect(reworkActorClassOf(null, operatorAsSystem)).toBe('human');
    expect(reworkActorClassOf(null, WORKFLOW_AUTOMATION_ACTOR)).toBe('system');
    expect(reworkActorClassOf(null, GOAL_FAN_OUT_ACTOR)).toBe('system');
    expect(reworkActorClassOf(null, { kind: 'agent', id: 'a-1', runRef: runRef('r-1') })).toBe('agent');
  });

  it('the automation policy defaults are 3 automatic reworks (max 10) and resume on start-up', () => {
    expect(DEFAULT_AUTO_REWORK_LIMIT).toBe(3);
    expect(MAX_AUTO_REWORK_LIMIT).toBe(10);
    expect(DEFAULT_TASK_AUTOMATION_POLICY).toEqual({ schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: true });
  });
});

// ------------------------------------------------------------------------ //
// New basis inputs                                                          //
// ------------------------------------------------------------------------ //
describe('newBasisInputProblem (ND-9)', () => {
  const messageInput: NewBasisInputRefV1 = { kind: 'session_message',
    ref: { aggregateType: 'SessionMessage', projectId: P, workspaceId: W, messageId: 'm-1' } };

  it('declares each platform body type once, with the same value the services write', () => {
    expect(PLATFORM_GENERATED_CONTENT_TYPES).toEqual([MANIFEST_CONTENT_TYPE, QUERY_MANIFEST_CONTENT_TYPE, REPORT_CONTENT_TYPE]);
    expect(MANIFEST_CONTENT_TYPE).toBe(PREPARED_MANIFEST_CONTENT_TYPE);
    expect(MANIFEST_CONTENT_TYPE).toBe(WORK_GRAPH_MANIFEST_CONTENT_TYPE);
    expect(QUERY_MANIFEST_CONTENT_TYPE).toBe(RUNTIME_QUERY_MANIFEST_CONTENT_TYPE);
    expect(QUERY_MANIFEST_CONTENT_TYPE).toBe(WORK_GRAPH_QUERY_MANIFEST_CONTENT_TYPE);
    expect(REPORT_CONTENT_TYPE).toBe('application/vnd.coding-platform.verification-check-report+json;version=1');
  });

  it('refuses every platform-generated body before looking at the read result', () => {
    for (const contentType of PLATFORM_GENERATED_CONTENT_TYPES) {
      const input: NewBasisInputRefV1 = { kind: 'artifact', ref: artifact(contentType) };
      expect(newBasisInputProblem(input, { kind: 'artifact' }), contentType).toMatch(/platform-generated .* never a new basis/);
      expect(newBasisInputProblem(input, { kind: 'not_found' }), contentType).toMatch(/never a new basis/);
    }
  });

  it('accepts a stored Artifact and refuses one the store does not hold', () => {
    const input: NewBasisInputRefV1 = { kind: 'artifact', ref: artifact('text/markdown') };
    expect(newBasisInputProblem(input, { kind: 'artifact' })).toBeNull();
    expect(newBasisInputProblem(input, { kind: 'not_found' })).toMatch(/is not stored/);
    expect(newBasisInputProblem(input, { kind: 'session_message', status: 'responded' })).toMatch(/is not stored/);
  });

  it('accepts only a responded SessionMessage', () => {
    expect(newBasisInputProblem(messageInput, { kind: 'session_message', status: 'responded' })).toBeNull();
    expect(newBasisInputProblem(messageInput, { kind: 'session_message', status: 'pending' })).toMatch(/is pending; only a responded/);
    expect(newBasisInputProblem(messageInput, { kind: 'session_message', status: 'read' })).toMatch(/is read; only a responded/);
    expect(newBasisInputProblem(messageInput, { kind: 'not_found' })).toMatch(/m-1 was not found/);
    expect(newBasisInputProblem(messageInput, { kind: 'artifact' })).toMatch(/was not found/);
  });
});

// ------------------------------------------------------------------------ //
// Continuation brief                                                        //
// ------------------------------------------------------------------------ //
function toolCall(callId: string, changedPaths: string[] = ['src/a.ts']): ContinuationToolCallV1 {
  return { callId, name: 'write_file', target: { text: changedPaths[0] ?? 'n/a', truncated: false }, result: 'success',
    sideEffect: 'confirmed', changedPaths, changedPathsOmitted: 0, error: null };
}

/** A complete brief of a `check_failed` rework continuing in another, seeded Session. */
function brief(): ContinuationBriefV1 {
  const previousRun = runRef('run-1');
  const roundRef = { aggregateType: 'VerificationRound' as const, projectId: P, workspaceId: W, goalId: G, taskId: T,
    runId: 'run-1', roundId: 'round-1' };
  return {
    schemaVersion: 1,
    runRef: runRef('run-2'),
    task: { projectId: P, goalId: G, taskId: T },
    requeueRef: { aggregateType: 'TaskRequeue', projectId: P, goalId: G, taskId: T, afterRunId: 'run-1' },
    mode: 'rework',
    failureClass: 'check_failed',
    trigger: { actorClass: 'system', goalResume: false, requeueNumber: 2, autoRework: { count: 1, cap: 3 },
      earlierRequeues: [{ afterRunId: 'run-0', failureClass: 'run_failed' }] },
    previous: {
      runRef: previousRun,
      attemptRef: { aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId: T, attemptId: 'attempt-1' },
      sessionRef: { projectId: P, sessionId: 'session-1' },
      outcome: 'completed', origin: 'observed', interruption: null, cancelledBy: null, error: null, limit: null, budget: null,
      wait: { messageRef: { aggregateType: 'SessionMessage', projectId: P, workspaceId: W, messageId: 'm-1' }, status: 'responded' },
      unacceptedSteers: [{ intentRef: { aggregateType: 'ControlIntent', projectId: P, workspaceId: W, intentId: 'i-1' },
        text: { text: 'use the new helper', truncated: false } }],
      endedAt: '2026-10-03T00:00:00.000Z',
    },
    factsFrom: { runRef: previousRun, hops: 0, truncated: false },
    stoppedAt: { kernel: 'read', reason: null, turnStatus: 'completed', lastPosition: 42,
      lastToolGroup: { sourceMessageId: 'msg-9', calls: 2 }, lastAssistant: { text: 'Done.', truncated: false },
      window: { fromPosition: 1, throughPosition: 42, omittedRecords: 0 } },
    toolCalls: { confirmed: [toolCall('call-1')], notExecuted: [], unknown: [],
      confirmedOmitted: 0, notExecutedOmitted: 0, unknownOmitted: 0 },
    acceptedInputs: { steers: [], steersOmitted: 0,
      messages: [{ messageRef: { aggregateType: 'SessionMessage', projectId: P, workspaceId: W, messageId: 'm-1' },
        part: 'response', excerpt: { text: 'answer', truncated: false } }], messagesOmitted: 0 },
    checks: { roundRef, roundOrdinal: 1,
      failing: [{ checkId: 'lint', phase: 'finished', outcome: 'FAIL', cause: null, reportRef: artifact(REPORT_CONTENT_TYPE) }],
      gapCodes: [] },
    requeue: { reason: { text: 'auto-rework: check_failed', truncated: false }, reasonAuthor: 'system',
      newInputs: [{ kind: 'artifact', ref: artifact('text/markdown', sha('c')), body: { text: 'diagnosis', truncated: false } },
        { kind: 'session_message', ref: { aggregateType: 'SessionMessage', projectId: P, workspaceId: W, messageId: 'm-2' },
          replyBody: null }] },
    workspace: {
      selfChanged: { status: 'known', confirmed: ['src/a.ts'], possible: [], omitted: 0 },
      checkpoints: [
        { kind: 'round_open', at: '2026-10-03T00:01:00.000Z', workspaceRevision: 4, sourceDigest: sha('d'), unavailableReason: null },
        { kind: 'requeue', at: '2026-10-03T00:02:00.000Z', workspaceRevision: null, sourceDigest: null, unavailableReason: 'too many files' },
        { kind: 'brief', at: '2026-10-03T00:03:00.000Z', workspaceRevision: 5, sourceDigest: sha('e'), unavailableReason: null },
      ],
      segments: [{ from: 0, to: 1, verdict: 'unknown', reason: 'the later checkpoint has no source digest' },
        { from: 1, to: 2, verdict: 'unknown', reason: 'the earlier checkpoint has no source digest' }],
      unobserved: { from: 'previous_run_end', to: 0, previousEndedAt: '2026-10-03T00:00:00.000Z' },
      uncommitted: { status: 'git', baseCommit: 'abc123', paths: ['src/a.ts'], omitted: 0, reason: null },
    },
    session: { continuity: 'other_session_seeded', sessionRef: { projectId: P, sessionId: 'session-2' },
      seededFrom: { sessionRef: { projectId: P, sessionId: 'session-1' }, throughPosition: 40 }, boundaryPosition: null },
    standingInstructionVersion: 1,
  };
}

/** The same JSON value with every object's keys in reverse insertion order. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reverseKeys(entry)]));
}

describe('continuation brief digest and marker (C3)', () => {
  it('is sha256 over the canonical JSON, independent of key order and of a JSON round trip', () => {
    const value = brief();
    const digest = continuationBriefDigest(value);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).toBe(sha256Hex(canonicalJson(value as unknown as JsonValue)));
    expect(continuationBriefDigest(reverseKeys(value) as ContinuationBriefV1)).toBe(digest);
    expect(continuationBriefDigest(JSON.parse(JSON.stringify(value)) as ContinuationBriefV1)).toBe(digest);
  });

  it('changes with any field, including nested and null-valued ones', () => {
    const digest = continuationBriefDigest(brief());
    const nested = brief();
    nested.trigger.requeueNumber = 3;
    const nulled = brief();
    nulled.checks = null;
    const text = brief();
    text.requeue.reason = { text: 'auto-rework: check_failed', truncated: true };
    for (const changed of [nested, nulled, text]) expect(continuationBriefDigest(changed)).not.toBe(digest);
  });

  it('marks the digest on one line, distinct per digest', () => {
    const digest = continuationBriefDigest(brief());
    const marker = continuationBriefMarker(digest);
    expect(marker).toContain(digest);
    expect(marker).not.toMatch(/[\r\n]/);
    expect(continuationBriefMarker(digest)).toBe(marker);
    expect(continuationBriefMarker(sha('f'))).not.toBe(marker);
  });
});

describe('continuationBriefShapeProblem (C3)', () => {
  it('accepts a complete brief, its JSON round trip and a brief without checks', () => {
    expect(continuationBriefShapeProblem(brief())).toBeNull();
    expect(continuationBriefShapeProblem(JSON.parse(JSON.stringify(brief())))).toBeNull();
    expect(continuationBriefShapeProblem({ ...brief(), checks: null })).toBeNull();
  });

  it('accepts an interrupted brief only in resume_after_interruption mode, and vice versa', () => {
    const resumed = brief();
    resumed.failureClass = 'interrupted';
    resumed.mode = 'resume_after_interruption';
    resumed.previous.interruption = { kind: 'paused', kernelPaused: true, pausedBy: 'goal_fan_out' };
    resumed.previous.outcome = 'crashed';
    resumed.previous.origin = 'host_interrupted';
    expect(continuationBriefShapeProblem(resumed)).toBeNull();
    expect(continuationBriefShapeProblem({ ...resumed, mode: 'rework' })).toMatch(/mode must be resume_after_interruption exactly when/);
    expect(continuationBriefShapeProblem({ ...brief(), mode: 'resume_after_interruption' }))
      .toMatch(/mode must be resume_after_interruption exactly when/);
  });

  it('rejects unknown and missing fields at every level (every field is required)', () => {
    const missing = brief() as unknown as Record<string, unknown>;
    delete missing['checks'];
    const nestedExtra = brief() as unknown as { previous: Record<string, unknown> };
    nestedExtra.previous['note'] = 'not part of the brief';
    const nestedMissing = brief() as unknown as { session: Record<string, unknown> };
    delete nestedMissing.session['boundaryPosition'];
    expect(continuationBriefShapeProblem({ ...brief(), extra: 1 })).toMatch(/carries unknown field extra/);
    expect(continuationBriefShapeProblem(missing)).toMatch(/continuationBrief\.checks is required/);
    expect(continuationBriefShapeProblem(nestedExtra)).toMatch(/previous carries unknown field note/);
    expect(continuationBriefShapeProblem(nestedMissing)).toMatch(/session\.boundaryPosition is required/);
    expect(continuationBriefShapeProblem(null)).toMatch(/must be an object/);
    expect(continuationBriefShapeProblem([brief()])).toMatch(/must be an object/);
  });

  type Mutation = [string, (b: ContinuationBriefV1) => void, RegExp];
  const mutations: Mutation[] = [
    ['schemaVersion 2', b => { (b as { schemaVersion: number }).schemaVersion = 2; }, /schemaVersion must be 1/],
    ['standingInstructionVersion 2', b => { (b as { standingInstructionVersion: number }).standingInstructionVersion = 2; },
      /standingInstructionVersion must be 1/],
    ['unknown failure class', b => { (b as { failureClass: string }).failureClass = 'outcome_unknown'; }, /failureClass must be one of/],
    ['requeueNumber 0', b => { b.trigger.requeueNumber = 0; }, /requeueNumber must be a positive safe integer/],
    ['more than 5 earlier requeues', b => {
      b.trigger.earlierRequeues = Array.from({ length: CONTINUATION_BRIEF_LIMITS.earlierRequeues + 1 },
        (_, i) => ({ afterRunId: `run-${String(i)}`, failureClass: 'run_failed' as const }));
    }, /earlierRequeues holds more than 5 entries/],
    ['cancelledBy none', b => { (b.previous as { cancelledBy: string | null }).cancelledBy = 'none'; }, /cancelledBy must be one of/],
    ['unknown outcome', b => { (b.previous as { outcome: string }).outcome = 'outcome_unknown'; }, /previous\.outcome must be one of/],
    ['factsFrom beyond 4 hops', b => { b.factsFrom.hops = CONTINUATION_BRIEF_LIMITS.factsFromHops + 1; }, /hops must be an integer 0\.\.4/],
    ['inverted window', b => { b.stoppedAt.window = { fromPosition: 9, throughPosition: 3, omittedRecords: 0 }; },
      /fromPosition must not exceed throughPosition/],
    ['too many confirmed tool calls', b => {
      b.toolCalls.confirmed = Array.from({ length: CONTINUATION_BRIEF_LIMITS.confirmedToolCalls + 1 }, (_, i) => toolCall(`c-${String(i)}`));
    }, /confirmed holds more than 40 entries/],
    ['too many paths in one call', b => {
      b.toolCalls.confirmed = [toolCall('c-1', Array.from({ length: CONTINUATION_BRIEF_LIMITS.pathsPerCall + 1 }, (_, i) => `f${String(i)}.ts`))];
    }, /changedPaths holds more than 8 entries/],
    ['over-long bounded text', b => {
      b.requeue.reason = { text: 'x'.repeat(CONTINUATION_BRIEF_LIMITS.textChars + 1), truncated: true };
    }, new RegExp(`reason\\.text exceeds ${String(CONTINUATION_BRIEF_LIMITS.textChars)} characters`)],
    ['too many new inputs', b => {
      b.requeue.newInputs = Array.from({ length: CONTINUATION_BRIEF_LIMITS.newInputs + 1 },
        () => ({ kind: 'artifact' as const, ref: artifact('text/plain'), body: null }));
    }, new RegExp(`newInputs holds more than ${String(CONTINUATION_BRIEF_LIMITS.newInputs)} entries`)],
    ['an instruction input', b => {
      (b.requeue as { newInputs: unknown[] }).newInputs = [{ kind: 'instruction', text: 'do it differently' }];
    }, /kind must be session_message or artifact/],
    ['too many self-changed paths', b => {
      b.workspace.selfChanged.confirmed = Array.from({ length: 40 }, (_, i) => `c${String(i)}.ts`);
      b.workspace.selfChanged.possible = Array.from({ length: 25 }, (_, i) => `p${String(i)}.ts`);
    }, /lists more than 64 paths/],
    ['a checkpoint digest that is not sha256', b => {
      b.workspace.checkpoints[0]!.sourceDigest = 'sha256:' + sha('d');
    }, /sourceDigest must be a sha256 hex or null/],
    ['a segment outside the checkpoints', b => {
      b.workspace.segments = [{ from: 1, to: 3, verdict: 'changed', reason: 'differs' }];
    }, /from\/to must be checkpoint indexes/],
    ['unobserved.to outside the checkpoints', b => { b.workspace.unobserved.to = 3; }, /to must be a checkpoint index or null/],
    ['unknown continuity', b => { (b.session as { continuity: string }).continuity = 'fresh'; }, /continuity must be one of/],
  ];
  it.each(mutations)('rejects %s', (_label, mutate, problem) => {
    const value = brief();
    mutate(value);
    expect(continuationBriefShapeProblem(value)).toMatch(problem);
  });

  it('uses the bounds the spec fixes (§6.1 (e))', () => {
    expect(CONTINUATION_BRIEF_LIMITS).toMatchObject({ confirmedToolCalls: 40, notExecutedToolCalls: 20, unknownToolCalls: 20,
      paths: 64, pathsPerCall: 8, kernelRecords: 5000, renderedBytes: 16_384, earlierRequeues: 5, factsFromHops: 4 });
  });

  it('accepts the boundaries themselves', () => {
    const value = brief();
    value.trigger.earlierRequeues = Array.from({ length: CONTINUATION_BRIEF_LIMITS.earlierRequeues },
      (_, i) => ({ afterRunId: `run-${String(i)}`, failureClass: 'run_failed' as const }));
    value.factsFrom = { runRef: runRef('run-0'), hops: CONTINUATION_BRIEF_LIMITS.factsFromHops, truncated: true };
    value.requeue.reason = { text: 'x'.repeat(CONTINUATION_BRIEF_LIMITS.textChars), truncated: true };
    value.workspace.unobserved = { from: 'previous_run_end', to: null, previousEndedAt: null };
    expect(continuationBriefShapeProblem(value)).toBeNull();
  });
});

describe('compareSourceCheckpoints (C3)', () => {
  it('compares persisted source digests only', () => {
    expect(compareSourceCheckpoints({ sourceDigest: sha('d') }, { sourceDigest: sha('d') }))
      .toEqual({ verdict: 'unchanged', reason: 'the workspace source digest is identical' });
    expect(compareSourceCheckpoints({ sourceDigest: sha('d') }, { sourceDigest: sha('e') }))
      .toEqual({ verdict: 'changed', reason: 'the workspace source digest differs' });
    // A workspace revision is not a source comparison: the same digest is unchanged.
    const earlier = { workspaceRevision: 4, sourceDigest: sha('d'), unavailableReason: null };
    const later = { workspaceRevision: 9, sourceDigest: sha('d'), unavailableReason: null };
    expect(compareSourceCheckpoints(earlier, later).verdict).toBe('unchanged');
  });

  it('never claims a verdict it cannot decide', () => {
    expect(compareSourceCheckpoints(null, { sourceDigest: sha('d') }).verdict).toBe('unknown');
    expect(compareSourceCheckpoints({ sourceDigest: sha('d') }, null).verdict).toBe('unknown');
    const earlierMissing = compareSourceCheckpoints({ sourceDigest: null, unavailableReason: 'too many files' }, { sourceDigest: sha('d') });
    expect(earlierMissing).toEqual({ verdict: 'unknown', reason: 'the earlier checkpoint has no source digest: too many files' });
    const laterMissing = compareSourceCheckpoints({ sourceDigest: sha('d') }, { sourceDigest: null });
    expect(laterMissing).toEqual({ verdict: 'unknown', reason: 'the later checkpoint has no source digest' });
    expect(compareSourceCheckpoints({ sourceDigest: null }, { sourceDigest: null }).verdict).toBe('unknown');
  });
});

describe('renderContinuationBriefZh (C3, §6.1 (e))', () => {
  const bytes = (text: string): number => new TextEncoder().encode(text).length;
  const fixedBlock = ['### 继续之前', '- 文件可能已经变化，编辑前先重新读取。',
    '- “结果未知”的工具调用可能已经产生副作用，重做之前先核实当前状态。',
    '- “没有执行”的工具调用没有产生结果，需要时重新发起。',
    '- 本说明只陈述持久记录中的事实；写明“无法确定”的地方不代表没有变化。'].join('\n');
  const render = (value: ContinuationBriefV1): string => renderContinuationBriefZh(value, continuationBriefDigest(value));

  it('puts the marker on line 2 and always ends with the fixed instruction block', () => {
    const value = brief();
    const digest = continuationBriefDigest(value);
    const text = renderContinuationBriefZh(value, digest);
    const lines = text.split('\n');
    expect(lines[1]).toBe(continuationBriefMarker(digest));
    expect(text.endsWith(fixedBlock)).toBe(true);
    expect(text).toContain('文件可能已经变化，编辑前先重新读取');
    expect(bytes(text)).toBeLessThanOrEqual(CONTINUATION_BRIEF_LIMITS.renderedBytes);
    // Pure: the same brief renders the same text; only the marker follows the digest.
    expect(renderContinuationBriefZh(JSON.parse(JSON.stringify(value)) as ContinuationBriefV1, digest)).toBe(text);
    const other = renderContinuationBriefZh(value, sha('f')).split('\n');
    expect(other[1]).toBe(continuationBriefMarker(sha('f')));
    expect(other.slice(2)).toEqual(lines.slice(2));
  });

  it('renders the carried facts in Chinese, with "执行记录" for an observed ending', () => {
    const text = render(brief());
    for (const expected of [
      '失败类别：检查未通过', '发起方：系统自动', '自动返工 1/3', '更早的重新入队：run-0（执行失败）',
      '依据执行记录以 completed 结束', '没有被 Kernel 接受的引导 i-1：use the new helper', '等待的消息 m-1：已回复',
      'write_file（call-1）：成功；有副作用', 'lint：阶段 finished，结果 FAIL', '原因（系统自动）：auto-rework: check_failed',
      '在新的 Session session-2 中继续，带有 Session session-1 到位置 40 的历史', '检查轮次开始 → 重新入队：无法确定',
      '未提交的改动（相对 abc123）：src/a.ts', '消息 m-1（回复）：answer',
    ]) expect(text, expected).toContain(expected);
    expect(text).not.toContain('Kernel 记录');
  });

  it('writes the C3 workspace verdicts and never claims "no change" for an unobserved window', () => {
    const value = brief();
    value.workspace.segments = [{ from: 1, to: 2, verdict: 'changed', reason: 'the workspace source digest differs' }];
    value.workspace.unobserved = { from: 'previous_run_end', to: null, previousEndedAt: null };
    const text = render(value);
    expect(text).toContain('重新入队 → 本次执行开始前：有变化（具体文件无法从持久记录确定）');
    expect(text).toContain('上一次执行结束（时间未知）到本次执行开始之间：无法从持久记录确定是否有改动。');
    // Only the fixed block mentions "没有变化", and only to deny it.
    expect(text.slice(0, text.length - fixedBlock.length)).not.toMatch(/没有变化/);
  });

  it('renders not-entered, RUN-23 and attested endings', () => {
    const notEntered = brief();
    notEntered.failureClass = 'cancelled';
    notEntered.previous.outcome = 'cancelled';
    notEntered.stoppedAt = { kernel: 'not_entered', reason: null, turnStatus: null, lastPosition: null, lastToolGroup: null,
      lastAssistant: null, window: null };
    expect(render(notEntered)).toContain('没有进入 Kernel 就结束（cancelled）');
    expect(render(notEntered)).toContain('没有进入 Kernel，没有执行记录。');
    const atRestart = brief();
    atRestart.failureClass = 'cancelled';
    atRestart.previous.outcome = 'cancelled';
    atRestart.stoppedAt.reason = 'cancelled_at_reconcile';
    expect(render(atRestart)).toContain('Host 重启核对时按你的取消结束');
    const inProcess = brief();
    inProcess.failureClass = 'cancelled';
    inProcess.previous.outcome = 'cancelled';
    inProcess.stoppedAt.reason = 'cancelled_while_paused';
    expect(render(inProcess)).toContain('暂停后按取消请求结束');
    const attested = brief();
    attested.failureClass = 'run_failed';
    attested.previous.outcome = 'crashed';
    attested.previous.origin = 'human_attested';
    expect(render(attested)).toContain('由人工认定为 crashed');
    const interrupted = brief();
    interrupted.failureClass = 'interrupted';
    interrupted.mode = 'resume_after_interruption';
    interrupted.previous.outcome = 'crashed';
    interrupted.previous.origin = 'host_interrupted';
    interrupted.previous.interruption = { kind: 'paused', kernelPaused: true, pausedBy: 'human' };
    const text = render(interrupted);
    expect(text).toContain('（中断后继续）');
    expect(text).toContain('被 Host 重启中断，平台核对后记为 crashed');
    expect(text).toContain('中断时处于暂停，Kernel 已到达暂停点，暂停请求者：人工');
  });

  it('stays within renderedBytes: texts are cut first, then trailing lines, and the fixed block is kept', () => {
    const long = (): BoundedTextV1 => ({ text: '改'.repeat(CONTINUATION_BRIEF_LIMITS.textChars), truncated: true });
    const cut = brief();
    cut.previous.error = long();
    cut.stoppedAt.lastAssistant = long();
    cut.requeue.reason = long();
    cut.toolCalls.confirmed = Array.from({ length: 10 }, (_, i) => ({ ...toolCall(`c-${String(i)}`), target: long(), error: long() }));
    const shortened = render(cut);
    expect(bytes(shortened)).toBeLessThanOrEqual(CONTINUATION_BRIEF_LIMITS.renderedBytes);
    expect(shortened).toContain('…（已截断）');
    expect(shortened).not.toContain('其余');
    expect(shortened.endsWith(fixedBlock)).toBe(true);
    expect(shortened).toContain('### 工作区');

    const overflowing = brief();
    overflowing.toolCalls.confirmed = Array.from({ length: CONTINUATION_BRIEF_LIMITS.confirmedToolCalls }, (_, i) =>
      toolCall(`c-${String(i)}`, Array.from({ length: CONTINUATION_BRIEF_LIMITS.pathsPerCall }, (_, j) => `${'深'.repeat(200)}${String(j)}`)));
    const digest = continuationBriefDigest(overflowing);
    const kept = renderContinuationBriefZh(overflowing, digest);
    expect(bytes(kept)).toBeLessThanOrEqual(CONTINUATION_BRIEF_LIMITS.renderedBytes);
    expect(kept.split('\n')[1]).toBe(continuationBriefMarker(digest));
    expect(kept).toMatch(/其余 \d+ 行已省略/);
    expect(kept.endsWith(fixedBlock)).toBe(true);
  });

  it('keeps the §2 labels of the failure and actor classes', () => {
    const failureClass = { interrupted: '平台中断', cancelled: '已取消', check_failed: '检查未通过',
      run_failed: '执行失败', check_incomplete: '检查不完整' };
    const actorClass = { human: '人工', system: '系统自动', agent: 'Agent' };
    for (const [key, label] of Object.entries(failureClass)) {
      const value = brief();
      value.failureClass = key as ContinuationBriefV1['failureClass'];
      expect(render(value)).toContain(`失败类别：${label}`);
    }
    for (const [key, label] of Object.entries(actorClass)) {
      const value = brief();
      value.trigger.actorClass = key as ContinuationBriefV1['trigger']['actorClass'];
      expect(render(value)).toContain(`发起方：${label}`);
    }
  });
});
