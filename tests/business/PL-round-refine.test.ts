/**
 * PL slice P1: the pure refinement and send-request rules (§5.1.4, §5.2.2,
 * §5.2.3, §5.2.5, §5.2.7). Every expected literal is written from the spec or
 * hand-computed, never read back from the function under test. No store, no
 * Host, no fabricated context.
 *
 * K3L-2 §3 R5 (decisions 121-109/121-110): the `ucr:` round's request id, its platform-written `subject:` line and
 * its `taskRef`; all three are red today (`unknown_call` is not a round yet) and green when K3L-2 §2.2/§2.3 lands.
 *
 * R7（B20）：`person to an executor` 守人发给执行者线的干预是 `plan_round`；`work run to an executor` 守只改人这一支。
 */
import { describe, expect, it } from 'vitest';
import {
  planOnlyTargetOf, planningAnswerShapeOf, refinementRoundOf, systemRoundSendInput,
} from '../../src/business/workflow/plan-round.js';
import type { GoalWaitBasisV1 } from '../../src/business/workflow/contracts.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanningAnswerShapeV1 } from '../../src/contracts/query-job.js';
import type { SystemRoundV1 } from '../../src/contracts/plan-round.js';

const PROJECT = 'proj-1';
const WORKSPACE = 'ws-1';

const goalRef: GoalRef = { aggregateType: 'Goal', projectId: PROJECT, goalId: 'goal-1' };

const originalMessageRef = {
  aggregateType: 'SessionMessage' as const,
  projectId: PROJECT,
  workspaceId: WORKSPACE,
  messageId: 'm-original',
};

const taskRef = { projectId: PROJECT, goalId: 'goal-1', taskId: 'task-2' };

function basis(reasons: readonly string[]): GoalWaitBasisV1 {
  return { projectId: PROJECT, goalId: 'goal-1', recordKinds: ['Goal', 'PlanRevision'], reasons };
}

function readyOf(result: ReturnType<typeof systemRoundSendInput>) {
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error('expected a ready send request');
  return result.value;
}

describe('planOnlyTargetOf: only the basis reasons, task marker before stage (§5.1.4)', () => {
  it.each([
    ['no basis at all', undefined, undefined],
    ['no plan_only marker', basis(['wait_reply', 'running']), undefined],
    ['bare stage token', basis(['plan_only:']), undefined],
    ['stage token', basis(['plan_only:stage-7']), { kind: 'stage', stageId: 'stage-7' }],
    ['task token', basis(['plan_only_task:task-9']), { kind: 'task', taskId: 'task-9' }],
    ['empty task id', basis(['plan_only_task:']), undefined],
    ['task marker wins over an earlier stage marker',
      basis(['plan_only:stage-7', 'plan_only_task:task-9']), { kind: 'task', taskId: 'task-9' }],
  ] as const)('%s', (_name, input, expected) => {
    expect(planOnlyTargetOf(input)).toEqual(expected);
  });
});

describe('refinementRoundOf: exactly the one refine round (§5.2.2)', () => {
  it.each([
    ['stage target',
      { basis: basis(['plan_only:stage-7']), target: { kind: 'stage' as const, stageId: 'stage-7' }, planRevision: 3 },
      { kind: 'refine', goalRef, target: { kind: 'stage', stageId: 'stage-7' }, planRevision: 3 }],
    ['task target',
      { basis: basis(['plan_only_task:task-9']), target: { kind: 'task' as const, taskId: 'task-9' }, planRevision: 4 },
      { kind: 'refine', goalRef, target: { kind: 'task', taskId: 'task-9' }, planRevision: 4 }],
  ] as const)('%s', (_name, input, expected) => {
    expect(refinementRoundOf({ ...input, goalRef })).toEqual(expected);
  });

  it('target null -> null', () => {
    expect(refinementRoundOf({
      basis: basis(['plan_only:stage-7']), goalRef, planRevision: 3, target: null,
    })).toBeNull();
  });

  it('planRevision null -> null', () => {
    expect(refinementRoundOf({
      basis: basis(['plan_only:stage-7']), goalRef, planRevision: null,
      target: { kind: 'stage', stageId: 'stage-7' },
    })).toBeNull();
  });
});

describe('systemRoundSendInput: the payload shape of §5.2.3', () => {
  const rounds: readonly { name: string; round: SystemRoundV1; requestId: string }[] = [
    {
      name: 'refine by stage',
      round: { kind: 'refine', goalRef, target: { kind: 'stage', stageId: 'stage-7' }, planRevision: 3 },
      requestId: 'refine:goal-1:stage-7:3',
    },
    {
      name: 'deviation',
      round: { kind: 'deviation', goalRef, taskId: 'task-2', cause: 'growth', planRevision: 4 },
      requestId: 'deviation:goal-1:task-2:growth:4',
    },
    {
      name: 'planreview',
      round: { kind: 'planreview', goalRef, proposalId: 'prop-1', proposalRevision: 2 },
      requestId: 'planreview:prop-1:2',
    },
    {
      name: 'planfix',
      round: { kind: 'planfix', goalRef, proposalId: 'prop-1', proposalRevision: 5 },
      requestId: 'planfix:prop-1:5',
    },
    {
      name: 'planresume',
      round: { kind: 'planresume', goalRef, queryJobId: 'query-1', originalMessageRef },
      requestId: 'planresume:goal-1:query-1',
    },
    // R5 (K3L-2 §3; §2.2/§2.3): the adviser round's request id is the full subject, digest included.
    { name: 'unknown_call', round: { kind: 'unknown_call', goalRef,
      subject: { reviewRef: { aggregateType: 'UnknownCallReview', projectId: PROJECT, goalId: 'goal-1',
        runId: 'run-1' }, revision: 3, phase: 'approval', goalBasisDigest: 'ab12' } },
      requestId: 'ucr:run-1:3:approval:ab12' },
  ];

  it.each(rounds)('$name: request id on the first line and in meta', ({ round, requestId }) => {
    const value = readyOf(systemRoundSendInput({
      round, recipient: { projectId: PROJECT, sessionId: 'session-1' }, text: `${requestId}\nbody`,
    }));
    expect(value.meta.requestId).toBe(requestId);
    expect(value.meta.expected).toEqual([]);
    expect(value.input.text.split('\n')[0]).toBe(requestId);
    expect(value.input.needsReply).toBe(true);
    expect(value.input.goalRef).toEqual(goalRef);
  });

  it('rejects text whose first line is not the request id', () => {
    expect(systemRoundSendInput({
      round: rounds[0]!.round,
      recipient: { projectId: PROJECT, sessionId: 'session-1' },
      text: 'refine:goal-1:stage-8:3\nbody',
    })).toEqual({
      status: 'rejected', code: 'invalid', reason: 'the system round text must start with its request id',
    });
  });

  // R5 named mutation: `taskRef` still only for `deviation` -> the unknown-call read has no taskRef, red.
  it('carries taskRef for deviation and the unknown-call round', () => {
    const deviation = readyOf(systemRoundSendInput({
      round: rounds[1]!.round, recipient: { projectId: PROJECT, sessionId: 'session-1' },
      text: `${rounds[1]!.requestId}\nbody`, taskRef,
    }));
    expect(deviation.input.taskRef).toEqual(taskRef);

    const refine = readyOf(systemRoundSendInput({
      round: rounds[0]!.round, recipient: { projectId: PROJECT, sessionId: 'session-1' },
      text: `${rounds[0]!.requestId}\nbody`, taskRef,
    }));
    expect(refine.input.taskRef).toBeUndefined();

    const advice = readyOf(systemRoundSendInput({
      round: rounds[5]!.round, recipient: { projectId: PROJECT, sessionId: 'session-1' },
      text: rounds[5]!.requestId, taskRef,
    }));
    expect(advice.input.taskRef).toEqual(taskRef);
  });

  it('carries followupOf only for planresume', () => {
    const resume = readyOf(systemRoundSendInput({
      round: rounds[4]!.round, recipient: { projectId: PROJECT, sessionId: 'session-1' },
      text: `${rounds[4]!.requestId}\nbody`, followupOf: originalMessageRef,
    }));
    expect(resume.input.followupOf).toEqual(originalMessageRef);

    const review = readyOf(systemRoundSendInput({
      round: rounds[2]!.round, recipient: { projectId: PROJECT, sessionId: 'session-1' },
      text: `${rounds[2]!.requestId}\nbody`, followupOf: originalMessageRef,
    }));
    expect(review.input.followupOf).toBeUndefined();
  });

  it('writes the planresume originalQueryRef line and the fixed request sentence', () => {
    const value = readyOf(systemRoundSendInput({
      round: rounds[4]!.round,
      recipient: { projectId: PROJECT, sessionId: 'session-1' },
      text: 'planresume:goal-1:query-1',
    }));
    expect(value.input.text).toBe(
      'planresume:goal-1:query-1\n'
      + 'originalQueryRef: {"aggregateType":"SessionMessage","messageId":"m-original",'
      + '"projectId":"proj-1","workspaceId":"ws-1"}\n'
      + '人已答完这一轮的问题卡；接着原规划轮写下一步：只输出这一段/这一版，平台会合并',
    );
  });

  // R5 named mutation: copy the caller's text -> the body is only the request id, red.
  it('writes the unknown-call subject line from the round', () => {
    const value = readyOf(systemRoundSendInput({
      round: rounds[5]!.round,
      recipient: { projectId: PROJECT, sessionId: 'session-1' },
      text: 'ucr:run-1:3:approval:ab12',
    }));
    expect(value.input.text).toBe(
      'ucr:run-1:3:approval:ab12\n'
      + 'subject: {"goalBasisDigest":"ab12","phase":"approval",'
      + '"reviewRef":{"aggregateType":"UnknownCallReview","goalId":"goal-1","projectId":"proj-1","runId":"run-1"},'
      + '"revision":3}',
    );
  });
});

describe('planningAnswerShapeOf: sender identity, trusted round, overlap note and person fact (§5.2.7 (2))', () => {
  const systemRound = { kind: 'host' as const, actor: { kind: 'system' as const, id: 'host:plan-round' } };
  const otherSystem = { kind: 'host' as const, actor: { kind: 'system' as const, id: 'workflow:auto-rework' } };
  const person = { kind: 'host' as const, actor: { kind: 'human' as const, id: 'person-1' } };
  const planReview: SystemRoundV1 = { kind: 'planreview', goalRef, proposalId: 'p-1', proposalRevision: 1 };
  const planResume: SystemRoundV1 = {
    kind: 'planresume', goalRef, queryJobId: 'query-1', originalMessageRef,
  };

  const rows: readonly {
    name: string;
    sender: Parameters<typeof planningAnswerShapeOf>[0]['sender'];
    duty: Parameters<typeof planningAnswerShapeOf>[1];
    round: SystemRoundV1 | null;
    overlapNote: boolean;
    person: boolean;
    expected: PlanningAnswerShapeV1;
  }[] = [
    { name: 'system round to the reviewer', sender: systemRound, duty: 'reviewer', round: planReview, overlapNote: false, person: false, expected: 'plan_review' },
    { name: 'system round to the adviser', sender: systemRound, duty: 'adviser', round: planReview, overlapNote: false, person: false, expected: 'plan_round' },
    { name: 'system round to the secretary', sender: systemRound, duty: 'secretary', round: planReview, overlapNote: false, person: false, expected: 'plan_round' },
    { name: 'system round to an executor', sender: systemRound, duty: 'executor', round: planReview, overlapNote: false, person: false, expected: 'text' },
    // 依据：p5-frozen:492（T6 纯表）、lead ruling :19（只加两行）、design-frozen:433（A17 执行者线 planresume 给规划形状）。
    // 世界：纯 planningAnswerShapeOf 输入——可信 planresume 系统轮，收件线分别是执行者、书记。
    // 期望值：planresume 只对执行者线开规划形状；书记仍是文字形状，说明放开是窄的。
    // 具名变异：「所有系统轮都给执行者 plan_round」会让本表 planreview + executor 行变红（原有行保持不动）；
    // 「只改 workflow 发送门、不改形状函数」时 Query 仍是 text，本块执行者行变红。
    { name: 'planresume system round to an executor', sender: systemRound, duty: 'executor', round: planResume, overlapNote: false, person: false, expected: 'plan_round' },
    { name: 'planresume system round to the scribe', sender: systemRound, duty: 'scribe', round: planResume, overlapNote: false, person: false, expected: 'text' },
    { name: 'overlap-note host system sender with another id', sender: otherSystem, duty: 'adviser', round: null, overlapNote: true, person: false, expected: 'text' },
    { name: 'person to the adviser', sender: person, duty: 'adviser', round: null, overlapNote: false, person: true, expected: 'plan_round' },
    { name: 'person to an executor', sender: person, duty: 'executor', round: null, overlapNote: false, person: true, expected: 'plan_round' },
    { name: 'work run to an executor', sender: { kind: 'work_run' }, duty: 'executor', round: null, overlapNote: false, person: false, expected: 'text' },
    { name: 'person to the reviewer', sender: person, duty: 'reviewer', round: null, overlapNote: false, person: true, expected: 'text' },
    { name: 'work run to the secretary', sender: { kind: 'work_run' }, duty: 'secretary', round: null, overlapNote: false, person: false, expected: 'plan_round' },
    { name: 'secretary round to the adviser', sender: { kind: 'secretary_round' }, duty: 'adviser', round: null, overlapNote: false, person: false, expected: 'plan_round' },
    { name: 'a system message that carries no trusted round', sender: systemRound, duty: 'reviewer', round: null, overlapNote: false, person: false, expected: 'text' },
    { name: 'a work run notify to the adviser', sender: { kind: 'work_run' }, duty: 'adviser', round: null, overlapNote: false, person: false, expected: 'plan_round' },
  ];

  it.each(rows)('$name -> $expected', ({ sender, duty, round, overlapNote, person: isPerson, expected }) => {
    expect(planningAnswerShapeOf({ sender }, duty, round, overlapNote, isPerson)).toBe(expected);
  });
});
