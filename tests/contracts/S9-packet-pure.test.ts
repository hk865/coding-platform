/**
 * P1-packet (slice 9 G1; rulings §4.2 P1, TS §3.2; book 1243; SPEC §3.2③ :187-197): `execReviewPacketOfRound` reads
 * the seven header members from the frozen round only; `execReviewPacketText` writes the first line, the seven labels
 * in order, a blank line and the fixed body; `execReviewPacketOfText` reads it back, and a missing line, an extra
 * line or bad JSON is `invalid`.
 *
 * World `W-pure` (rule sheet A5): a hand-written RoundSnapshot. The builder reads `ref`, `adoptedPlanRef`, `subject`,
 * `subjectRunRef`, `checks`, `identity.sourceDigest` and the reviewer items of `verificationPlan.checks` (SPEC :281);
 * `identity` and `verificationPlan` are partial literals cast to their types, as in
 * `tests/work-graph/A2-step1-codecs.test.ts:372-374`. `taskBasisRef` is a different Plan so a builder that reads it
 * instead of `adoptedPlanRef` is red.
 *
 * Expected by hand: checks `b` (finished, report b), `a` (finished, report a), `c` (interrupted, report c) and `d`
 * (finished, no report) give `[art-a, art-b]`; the reviewer pairs `[o2/r1, o1/r1, o1/r1]` give `[o1/r1, o2/r1]` and the
 * static plan item's `o3/r9` is not a reviewer pair. The label lines are the canonical JSON (sorted keys, no spaces)
 * written out by hand; the body is the fixed prose of TS §3.2.
 *
 * Named mutations: take `checkRefs` from a check that is not `finished` or has no `reportRef` (the `checkRefs` toEqual
 * is red); leave the coverage unsorted or not deduped (the `coverage` toEqual is red); read `taskBasisRef` (or any
 * plan other than `adoptedPlanRef`) as `planRevisionRef` (the packet toEqual is red).
 */
import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { RoundCheckSnapshot, RoundSnapshot, VerificationPlanV1 } from '../../src/contracts/verification.js';
import {
  execReviewPacketOfRound, execReviewPacketOfText, execReviewPacketText, type ExecReviewPacketV1,
} from '../../src/core/work-graph/tasks/exec-review-packet.js';

const P = 's9-project', W = 's9-workspace', G = 's9-goal', T = 's9-task';
const ROUND_REF = { aggregateType: 'VerificationRound', projectId: P, workspaceId: W, goalId: G, taskId: T,
  runId: 'run-1', roundId: 'round-1' } as const;
const PLAN_REF = { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-1' } as const;
const TASK = { projectId: P, goalId: G, taskId: T };
const RUN_REF = { aggregateType: 'Run', projectId: P, goalId: G, runId: 'run-1' } as const;
const art = (name: string): ArtifactRef => ({ kind: 'artifact', contentType: 'text/plain', digest: `digest-${name}`,
  sizeBytes: 10, source: { kind: 'workspace', refId: W, revision: '4' } });
const check = (checkId: string, phase: RoundCheckSnapshot['phase'], reportRef: ArtifactRef | null): RoundCheckSnapshot =>
  ({ checkId, definition: { checkId, kind: 'static', command: 'true', cwd: '.', timeoutMs: 1000, taskIds: 'all' },
    coverage: [], phase, invocationId: `inv-${checkId}`, outcome: phase === 'finished' ? 'PASS' : null, reportRef,
    sourceStatus: phase === 'finished' ? 'matched' : null });

const ROUND: RoundSnapshot = {
  ref: ROUND_REF, revision: 3, schemaVersion: 1, subject: TASK, subjectRunRef: RUN_REF, adoptedPlanRef: PLAN_REF,
  taskBasisRef: { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-0' },
  executor: { kind: 'system', id: 'local-host' },
  configuration: { configurationRevision: 'checks-1', workspace: { aggregateType: 'Workspace', projectId: P,
    workspaceId: W }, executor: { kind: 'system', id: 'local-host' }, permissionRevision: 'perm-1',
  sourceAccess: 'verification_workspace', processAccess: 'all_except_denied', deniedPrefixes: [], checks: [] },
  configurationDigest: 'config-digest',
  identity: { schemaVersion: 1, sourceDigest: 'source-digest-1' } as unknown as RoundSnapshot['identity'],
  sourceProof: { kind: 'current-workspace-only', runBaselineKnown: false },
  verificationPlan: { schemaVersion: 1, planId: 'vplan-1', planDigest: 'vplan-1', checks: [
    { checkId: 's9-static', kind: 'static', satisfiesKind: 'static', satisfactionPath: 'predicate',
      coverage: [{ obligationId: 'o3', requirementId: 'r9' }] },
    { checkId: 'review-packet', kind: 'reviewer', satisfiesKind: 'reviewer', satisfactionPath: 'review-packet',
      coverage: [{ obligationId: 'o2', requirementId: 'r1' }, { obligationId: 'o1', requirementId: 'r1' },
        { obligationId: 'o1', requirementId: 'r1' }] },
  ] } as unknown as VerificationPlanV1,
  checks: [check('b', 'finished', art('b')), check('a', 'finished', art('a')), check('c', 'interrupted', art('c')),
    check('d', 'finished', null)],
  status: 'open', outcome: null, gaps: [], evidenceRefs: [], stagedRepairs: [], until: null,
  chain: { rounds: [] } as unknown as RoundSnapshot['chain'],
};

const PACKET: ExecReviewPacketV1 = {
  roundRef: ROUND_REF, planRevisionRef: PLAN_REF, taskRef: TASK, subjectRunRef: RUN_REF,
  checkRefs: [art('a'), art('b')], sourceDigest: 'source-digest-1',
  coverage: [{ obligationId: 'o1', requirementId: 'r1' }, { obligationId: 'o2', requirementId: 'r1' }],
};

const ART_JSON = (name: string) => `{"contentType":"text/plain","digest":"digest-${name}","kind":"artifact",`
  + `"sizeBytes":10,"source":{"kind":"workspace","refId":"s9-workspace","revision":"4"}}`;
/** The first line, the seven label lines in order and the blank line (TS §3.2 fixed head). */
const HEAD = [
  'execreview:round-1',
  'roundRef: {"aggregateType":"VerificationRound","goalId":"s9-goal","projectId":"s9-project","roundId":"round-1",'
    + '"runId":"run-1","taskId":"s9-task","workspaceId":"s9-workspace"}',
  'planRevisionRef: {"aggregateType":"PlanRevision","planId":"plan-1","projectId":"s9-project"}',
  'taskRef: {"goalId":"s9-goal","projectId":"s9-project","taskId":"s9-task"}',
  'subjectRunRef: {"aggregateType":"Run","goalId":"s9-goal","projectId":"s9-project","runId":"run-1"}',
  `checkRefs: [${ART_JSON('a')},${ART_JSON('b')}]`,
  'sourceDigest: source-digest-1',
  'coverage: [{"obligationId":"o1","requirementId":"r1"},{"obligationId":"o2","requirementId":"r1"}]',
  '',
];
const BODY = 'Read the workspace, the graph’s Task/Run/round cards, and the original execution history. '
  + 'Return exactly one verdict (pass or fix) with basis and report. For a check with no reportRef, '
  + 'read its result from the round card; do not invent one.';

describe('P1-packet: the frozen exec review packet', () => {
  it('builds the seven members from the frozen round only', () => {
    expect(execReviewPacketOfRound(ROUND)).toEqual({ status: 'ready', value: PACKET });
  });

  // Lead ruling 11-12 (G1 reply item 1; TS §3.2 "空 coverage → invalid，不发送"). Named mutation: build the packet
  // with an empty `coverage` -> `ready` (red).
  it('refuses a round whose reviewer item has no coverage pair as invalid', () => {
    const verificationPlan = { ...ROUND.verificationPlan, checks: ROUND.verificationPlan.checks.map(item =>
      (item.kind === 'reviewer' ? { ...item, coverage: [] } : item)) };
    expect(execReviewPacketOfRound({ ...ROUND, verificationPlan }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
  });

  it('writes the fixed head and body, and reads the same packet back', () => {
    const text = execReviewPacketText(PACKET);
    expect(text.split('\n').slice(0, HEAD.length)).toEqual(HEAD);
    expect(execReviewPacketOfText(text)).toEqual({ status: 'ready', value: { packet: PACKET, body: BODY } });
  });

  const lines = (): string[] => execReviewPacketText(PACKET).split('\n');
  it.each([
    ['the third line (planRevisionRef) is missing', () => lines().filter((_, index) => index !== 2)],
    ['a ninth line follows the seven labels', () => [...lines().slice(0, 8), 'extra: 1', ...lines().slice(8)]],
    ['the second line carries bad JSON', () => lines().map((line, index) => (index === 1 ? 'roundRef: {' : line))],
  ])('rejects a text where %s as invalid', (_case, edit) => {
    expect(execReviewPacketOfText(edit().join('\n'))).toMatchObject({ status: 'rejected', code: 'invalid' });
  });
});
