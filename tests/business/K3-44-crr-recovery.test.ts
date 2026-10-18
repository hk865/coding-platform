/**
 * K3-44 recovery rows F-072 and F-073 (G2): a CRR answer saved at ① whose ② did
 * not commit is still readable and is applied by the ordinary re-drive.
 *
 * The prior state is reached through public steps only: a real blocked Run
 * (`blockedRecord`), the real `requestRerun` owner, the real CRR card source and
 * the real decision coordinator. The only injected behaviour is an A2/A3
 * DELEGATING wrapper around the world's ONE real records port: it either throws
 * on the ② Goal-basis read (F-072) or fails the one `crr-answer:` commit before
 * it reaches the real backend (F-073). Every other call delegates unchanged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readUnappliedAnswers } from '../../src/core/work-graph/tasks/unknown-call-review-answers.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { DecisionSelectionV1 } from '../../src/contracts/goal-decisions.js';
import type { CommandRerunRequestV1 } from '../../src/contracts/command-rerun-request.js';
import { openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { blockedRecord, CRR_COMMAND, crrCardOf, requestRerunOf } from '../helpers/B2-crr-world.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { GOAL_B } from '../helpers/S5-decision-fixture.js';

// §5.1's blocking `shell` stand-in, hoisted per test file: the record Run's
// real Kernel Turn holds its first call so RUN-20/RUN-22 read a real
// unresolved call. The stand-in is an injected dependency, never a fact.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of worlds.splice(0)) await world.close();
});

/**
 * Hand-computed canonical GoalRef key for GOAL_B: the store refKey the ②
 * Goal-basis read requests (`canonicalJson` sorts object keys by code unit).
 * GOAL_B = { aggregateType: 'Goal', projectId: 'P', goalId: 'B' }.
 */
const GOAL_B_REF_KEY = '{"aggregateType":"Goal","goalId":"B","projectId":"P"}';

type CrrFaults = {
  /** Fail the next N ② answer commits whose identity is the CRR application. */
  answerCommits: number;
  /** Armed by the test right before the coordinator call; ① is its first commit. */
  awaitAnswer: boolean;
  /** Set by the wrapper once the ① synthetic answer commit lands. */
  answerCommitted: boolean;
  /** Goal reads seen since ①; the run below fails exactly `failGoalReadAt`. */
  goalReadsSeen: number;
  /** 2 = the ② Goal-basis read (the Task-closure window read is the 1st). */
  failGoalReadAt: number;
};

/**
 * The A2/A3 wrapper: every call delegates to the ONE real backend except the two
 * named faults. The `crr-answer:` identity is the ② application commit (the
 * codecs' one identity helper); the ① synthetic answer message commit is the
 * gate for the Goal-read fault, so ①'s own source read is never touched.
 */
function faultingRecords(
  backend: K3ReviewCardWorld['records'], faults: CrrFaults,
): K3ReviewCardWorld['records'] {
  return {
    ...backend,
    async commit(batch: Parameters<K3ReviewCardWorld['records']['commit']>[0]) {
      if (faults.answerCommits > 0 && batch.identityKey.startsWith('crr-answer:')) {
        faults.answerCommits -= 1;
        return { status: 'rejected' as const, code: 'unavailable' as const,
          reason: 'injected ② commit failure' };
      }
      const receipt = await backend.commit(batch);
      if (faults.awaitAnswer && receipt.status === 'committed') {
        // The first records commit after arming is ①'s synthetic answer message.
        faults.awaitAnswer = false;
        faults.answerCommitted = true;
      }
      return receipt;
    },
    async readMany(refKeys: Parameters<K3ReviewCardWorld['records']['readMany']>[0]) {
      if (faults.answerCommitted && faults.failGoalReadAt > 0 && refKeys.includes(GOAL_B_REF_KEY)) {
        faults.goalReadsSeen += 1;
        if (faults.goalReadsSeen === faults.failGoalReadAt) {
          throw new Error(`injected Goal read failure #${String(faults.goalReadsSeen)}`);
        }
      }
      return backend.readMany(refKeys);
    },
  } as K3ReviewCardWorld['records'];
}

/** Answer the real CRR card through the public coordinator; ② fails by the fault. */
async function answerWithFailedApplication(
  world: K3ReviewCardWorld, faults: CrrFaults, optionId: 'allow_rerun' | 'deny', label: string,
) {
  const record = await blockedRecord(world, 'k3-20-a', label, [{ callId: `${label}-call`, command: CRR_COMMAND }]);
  const request = await requestRerunOf(world, record, `${label}-request`);
  const card = await crrCardOf(world);
  faults.awaitAnswer = true;
  const answered = await world.decisionActions.resolveDecision(world.fixture.ctx, {
    input: { source: card.source, selection: { kind: 'option', optionId }, text: '', annotations: [] },
    meta: { requestId: `${label}-answer`, expected: card.source.pins },
  });
  return { record, request, card, answered };
}

/** The public reads of the ① answer and the still-pending ② request. */
async function savedAnswerAndRequest(world: K3ReviewCardWorld, label: string,
  request: CommandRerunRequestV1,
  source: Parameters<K3ReviewCardWorld['decisions']['readDecisionAnswer']>[1]['source']) {
  const answer = await world.decisions.readDecisionAnswer(world.fixture.ctx, { source });
  expect(answer.status, `${label}: the ① answer read`).toBe('ready');
  if (answer.status !== 'ready' || answer.value.message === null || answer.value.body === null) {
    throw new Error(`${label}: the saved answer is not readable: ${JSON.stringify(answer)}`);
  }
  const read = await world.commandRerun.readRequest(world.fixture.ctx, { ref: request.ref });
  expect(read.status, `${label}: the request read`).toBe('ready');
  if (read.status !== 'ready') throw new Error(JSON.stringify(read));
  return { message: answer.value.message, body: answer.value.body, request: read.value };
}

/** The re-drive the rewrap performs: enumerate the saved answer, then apply it. */
async function redrive(world: K3ReviewCardWorld, label: string,
  answerMessageRef: SessionMessageRef, selection: DecisionSelectionV1, requestId: string) {
  const hits = await readUnappliedAnswers({ records: world.records }, world.fixture.ctx,
    { kind: 'command_rerun_request', goalRef: GOAL_B });
  expect(hits.status, `${label}: the answer enumeration`).toBe('ready');
  if (hits.status !== 'ready') throw new Error(JSON.stringify(hits));
  expect(hits.value.answers, `${label}: the unapplied ① answer must be enumerated`).toHaveLength(1);
  const hit = hits.value.answers[0]!;
  expect(hit.kind).toBe('command_rerun_request');
  if (hit.kind !== 'command_rerun_request') throw new Error(JSON.stringify(hit));
  expect(hit.answerMessageRef).toEqual(answerMessageRef);
  expect(hit.requestRef.requestId).toBe(requestId);
  const advanced = await world.decisionActions.advanceReviewDisposition(world.fixture.ctx, {
    input: { source: hit.source, selection, decisionMessageRef: hit.answerMessageRef },
    meta: { requestId: `${label}-redrive`, expected: [] },
  });
  return advanced;
}

describe('F-072/F-073: an answer saved at ① survives a failed ② and is re-driven', () => {
  it.each(['memory', 'sqlite'] as const)('F-072 (%s): a throw inside ② keeps ① readable, writes nothing, and the re-drive applies it once', async kind => {
    // The ① answer commits; the 2nd Goal read after it (the ② Goal-basis read at
    // `command-rerun-request-service.ts:1027`) throws once.
    const faults: CrrFaults = { answerCommits: 0, awaitAnswer: false, answerCommitted: false, goalReadsSeen: 0, failGoalReadAt: 2 };
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true,
      wrapRecords: records => faultingRecords(records, faults) });
    worlds.push(world);
    const label = `f072-${kind}`;
    const { request, card, answered } = await answerWithFailedApplication(world, faults, 'deny', label);

    // The coordinator turns the ② throw into a structured failure; ① stays committed.
    expect(answered, JSON.stringify(answered)).toMatchObject({ status: 'ready', value: {
      state: 'application_not_recorded', answer: { status: 'committed' }, application: null } });
    if (answered.status !== 'ready' || answered.value.answer.status !== 'committed') {
      throw new Error(JSON.stringify(answered));
    }
    const action = answered.value.action as { status: string; code?: string; reason?: string };
    expect(action.status).toBe('rejected');
    expect(action.code).toBe('unavailable');
    // The adapter's F-072 guard names the thrown read; it did not escape.
    expect(action.reason).toContain('injected Goal read failure #2');

    // The public ① read returns the saved answer; ② wrote nothing.
    const before = await savedAnswerAndRequest(world, label, request, card.source);
    expect(before.message.ref.messageId).toBe(answered.value.answer.value.ref.messageId);
    expect(before.message.application).toBeNull();
    expect(before.body.selection).toEqual({ kind: 'option', optionId: 'deny' });
    expect(before.request.state).toBe('pending');
    expect(before.request.revision).toBe(request.revision);

    // The re-drive: enumerate the saved answer and apply ② once, then ③.
    const advanced = await redrive(world, label, before.message.ref, before.body.selection,
      request.ref.requestId);
    expect(advanced, JSON.stringify(advanced)).toMatchObject({ status: 'ready', value: {
      state: 'applied', action: { status: 'committed' }, application: { status: 'committed' } } });

    const after = await savedAnswerAndRequest(world, label, request, card.source);
    expect(after.request.state).toBe('denied');
    expect(after.request.revision).toBe(request.revision + 1);
    expect(after.message.application).not.toBeNull();
    expect(after.message.revision).toBe(before.message.revision + 1);
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)('F-073/G2 (%s): the ① answer with the ② commit failed is enumerated and the advance applies ② once', async kind => {
    // Only the one ② commit (identity `crr-answer:`) fails, before the real backend.
    const faults: CrrFaults = { answerCommits: 1, awaitAnswer: false, answerCommitted: false, goalReadsSeen: 0, failGoalReadAt: 0 };
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true,
      wrapRecords: records => faultingRecords(records, faults) });
    worlds.push(world);
    const label = `f073-${kind}`;
    const { request, card, answered } = await answerWithFailedApplication(world, faults, 'allow_rerun', label);

    expect(answered, JSON.stringify(answered)).toMatchObject({ status: 'ready', value: {
      state: 'application_not_recorded', answer: { status: 'committed' }, application: null,
      action: { status: 'rejected', code: 'unavailable' } } });
    if (answered.status !== 'ready' || answered.value.answer.status !== 'committed') {
      throw new Error(JSON.stringify(answered));
    }
    expect(faults.answerCommits).toBe(0);

    // Public state after ①: the answer exists with no application; the request is pending.
    const before = await savedAnswerAndRequest(world, label, request, card.source);
    expect(before.message.application).toBeNull();
    expect(before.body.selection).toEqual({ kind: 'option', optionId: 'allow_rerun' });
    expect(before.request.state).toBe('pending');
    expect(before.request.revision).toBe(request.revision);

    // G2: an answer saved at ① with ② not committed must be enumerated by the reader.
    const advanced = await redrive(world, label, before.message.ref, before.body.selection,
      request.ref.requestId);
    expect(advanced, JSON.stringify(advanced)).toMatchObject({ status: 'ready', value: {
      state: 'applied', action: { status: 'committed' }, application: { status: 'committed' } } });

    const after = await savedAnswerAndRequest(world, label, request, card.source);
    expect(after.request.state).toBe('allowed');
    expect(after.request.revision).toBe(request.revision + 1);
    expect(after.message.application).not.toBeNull();
    expect(after.message.revision).toBe(before.message.revision + 1);
  }, 120_000);
});
