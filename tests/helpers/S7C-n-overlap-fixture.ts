/**
 * Slice 7C N's pure overlap inputs (A5): the waiting and running triples, the frozen basis and its digest, and the
 * two frozen gate records. Values are the ruling's literals; this helper imports `makeCommitCursor` and types only,
 * so a `*-pure.test.ts` may use it and no store, platform, Host, Workflow or Runtime is reached.
 */
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import type { ModuleOverlapGateV1 } from '../../src/core/work-graph/persistence/module-overlap-gate-codecs.js';
import type { OverlapBasisV1 } from '../../src/core/work-graph/tasks/overlap-gates.js';

export const S7C_WAITING: TaskTriple = { projectId: 'p1', goalId: 'g1', taskId: 't1' };

export const S7C_RUNNING_1: { task: TaskTriple; run: RunRef } = {
  task: { projectId: 'p1', goalId: 'g1', taskId: 't2' },
  run: { aggregateType: 'Run', projectId: 'p1', goalId: 'g1', runId: 'r1' },
};

export const S7C_RUNNING_2: { task: TaskTriple; run: RunRef } = {
  task: { projectId: 'p1', goalId: 'g1', taskId: 't3' },
  run: { aggregateType: 'Run', projectId: 'p1', goalId: 'g1', runId: 'r2' },
};

export const S7C_BASIS: OverlapBasisV1 = {
  planRevision: 3,
  waitingAttempt: 'a1',
  running: [
    { ...S7C_RUNNING_1, startCursor: makeCommitCursor(10) },
    { ...S7C_RUNNING_2, startCursor: null },
  ],
};

export const S7C_BASIS_DIGEST = 'b5fc25c250bfe46f77b1b4ef44802215766910c251030fff1efa3fd8a73f48d0';

const S7C_GATE_REF = {
  aggregateType: 'ModuleOverlapGate', projectId: 'p1', goalId: 'g1', taskId: 't1', moduleId: 'm1',
} as const;

/** The gate before any note has been requested: no recipient, a null start cursor, no release. */
export const S7C_GATE_UNSENT: ModuleOverlapGateV1 = {
  ref: S7C_GATE_REF,
  revision: 2,
  workspaceId: 'w1',
  waiting: S7C_WAITING,
  waitingAttempt: 'a1',
  moduleId: 'm1',
  running: S7C_BASIS.running,
  planRevision: 3,
  basisDigest: S7C_BASIS_DIGEST,
  incomplete: ['start_cursor'],
  noteRequest: { recipient: null, reason: 'no_adviser_or_secretary' },
  release: null,
  since: makeCommitCursor(20),
};

/** The same gate after the adviser note was requested and a person released it. */
export const S7C_GATE_SENT: ModuleOverlapGateV1 = {
  ...S7C_GATE_UNSENT,
  noteRequest: {
    recipient: { projectId: 'p1', sessionId: 's1' },
    duty: 'adviser',
    messageRef: { aggregateType: 'SessionMessage', projectId: 'p1', workspaceId: 'w1', messageId: 'msg1' },
  },
  release: {
    by: { kind: 'human', id: 'u1' },
    at: '2026-10-27T21:00:00Z',
    reason: 'interface agreed',
    commandId: 'cmd-1',
    revision: 1,
  },
};

/** FX-05: the second basis (one running entry after the rework's attempt) and its frozen JCS+sha256 digest. */
export const S7C_BASIS_2: OverlapBasisV1 = {
  planRevision: 3,
  waitingAttempt: 'a2',
  running: [{ ...S7C_RUNNING_1, startCursor: makeCommitCursor(30) }],
};

export const S7C_BASIS_2_DIGEST = 'b5846e2fa575153127a4e718c8b4d793bc69d4a35c70b2e8e4248675050e2bc2';
