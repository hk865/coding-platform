/**
 * R's first commit: the formal `maintainer_assignment` arm, its operation codec and the
 * `MaintainerAssignmentRecorded` event, plus the archive stored-choice module arm. Pure values only; every
 * expected value is a hand-computed literal from the frozen shape.
 */
import { describe, expect, it } from 'vitest';
import type { DecisionChangeProofV1 } from '../../src/contracts/goal-decisions.js';
import type { MaintainerAssignmentOperationV1 } from '../../src/core/work-graph/model/session-contracts.js';
import { SESSION_RECORD_SCHEMAS, checkSessionArchiveRequest, decodeSessionOperationRecord, encodeSessionOperationRecord,
  maintainerAssignmentRecordedCodec } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import {
  acceptedMaintainerAssignment, advancedMaintainerAssignment,
  type MaintainerAssignmentActionV1, type MaintainerAssignmentStepV1,
} from '../../src/core/work-graph/state/module-maintainer-assignment.js';

const OPERATION_REF = { aggregateType: 'CoreOperation' as const, projectId: 'P', operationId: 'op-1' };
const MODULE = { projectId: 'P', moduleId: 'M-1' };
const LINE = { projectId: 'P', sessionId: 'L-1' };
const ANSWER = { aggregateType: 'SessionMessage' as const, projectId: 'P', workspaceId: 'W', messageId: 'msg-1' };
const LINK = {
  aggregateType: 'SessionWorkLink' as const, projectId: 'P', sessionId: 'L-1',
  target: { kind: 'module' as const, ref: MODULE },
  relation: 'responsible' as const,
};
const CALLER = {
  kind: 'work' as const,
  actor: {
    kind: 'agent' as const, id: 'agent-1',
    runRef: { aggregateType: 'Run' as const, projectId: 'P', goalId: 'G', runId: 'R-1' },
  },
  session: LINE,
  run: { aggregateType: 'Run' as const, projectId: 'P', goalId: 'G', runId: 'R-1' },
};
const INPUT = {
  moduleRef: MODULE,
  line: LINE,
  reason: 'assign M-1 to L-1',
  caller: CALLER,
};

const ACCEPTED: MaintainerAssignmentActionV1 = {
  kind: 'maintainer_assignment',
  input: INPUT,
  progress: { stage: 'accepted', decision: null, outcome: null, lastRefusal: null },
};
const AWAITING: MaintainerAssignmentActionV1 = {
  ...ACCEPTED,
  progress: {
    ...ACCEPTED.progress,
    stage: 'awaiting_decision',
    decision: { verdict: 'needs_decision', cardKey: 'card-1', answer: null, answerRef: null },
  },
};
const DONE: MaintainerAssignmentActionV1 = {
  ...AWAITING,
  progress: {
    ...AWAITING.progress,
    stage: 'done',
    decision: { ...AWAITING.progress.decision!, answer: 'approve', answerRef: ANSWER },
    outcome: { kind: 'assigned', link: LINK },
  },
};

describe('the maintainer assignment operation arm', () => {
  it('accepts the frozen input and starts at the accepted stage', () => {
    expect(acceptedMaintainerAssignment(INPUT)).toEqual({
      action: {
        kind: 'maintainer_assignment',
        input: INPUT,
        progress: { stage: 'accepted', decision: null, outcome: null, lastRefusal: null },
      },
      phase: 'accepted',
    });
  });

  const phases = ['accepted', 'running', 'completed', 'failed', 'unknown'] as const;
  type Phase = (typeof phases)[number];
  const cases: readonly {
    name: string; from: MaintainerAssignmentActionV1; phaseIn: Phase;
    step: MaintainerAssignmentStepV1; expected: MaintainerAssignmentActionV1; phase: Phase;
  }[] = [
    {
      name: 'awaiting_decision', from: ACCEPTED, phaseIn: 'accepted',
      step: { kind: 'awaiting_decision', cardKey: 'card-1' },
      expected: AWAITING, phase: 'running',
    },
    {
      name: 'auto_applied', from: ACCEPTED, phaseIn: 'accepted',
      step: { kind: 'auto_applied', outcome: { kind: 'assigned', link: LINK } },
      expected: {
        ...ACCEPTED,
        progress: {
          ...ACCEPTED.progress, stage: 'done',
          decision: { verdict: 'automatic', cardKey: null, answer: null, answerRef: null },
          outcome: { kind: 'assigned', link: LINK },
        },
      },
      phase: 'completed',
    },
    {
      name: 'decided approve', from: AWAITING, phaseIn: 'running',
      step: { kind: 'decided', answer: 'approve', answerRef: ANSWER, stale: false,
        outcome: { kind: 'assigned', link: LINK } },
      expected: DONE, phase: 'completed',
    },
    {
      name: 'decided reject', from: AWAITING, phaseIn: 'running',
      step: { kind: 'decided', answer: 'reject', answerRef: ANSWER },
      expected: {
        ...AWAITING,
        progress: { ...AWAITING.progress, stage: 'rejected',
          decision: { ...AWAITING.progress.decision!, answer: 'reject', answerRef: ANSWER } },
      },
      phase: 'failed',
    },
    {
      name: 'refused', from: AWAITING, phaseIn: 'running',
      step: { kind: 'refused', refusal: { code: 'unavailable', reason: 'the claim could not be taken' } },
      expected: {
        ...AWAITING,
        progress: { ...AWAITING.progress,
          lastRefusal: { code: 'unavailable', reason: 'the claim could not be taken' } },
      },
      phase: 'running',
    },
  ];
  it.each(cases)('advances $name exactly as the frozen table', ({ from, phaseIn, step, expected, phase }) => {
    expect(advancedMaintainerAssignment(from, phaseIn, step)).toEqual({ action: expected, phase });
  });
});

describe('the maintainer assignment operation record', () => {
  const record = {
    ref: OPERATION_REF,
    revision: 1,
    workspaceId: 'W',
    action: ACCEPTED,
    phase: 'accepted' as const,
    requestedAt: '2026-11-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    observation: null,
    failure: null,
  };

  it('round-trips the stored operation through the public encode path', () => {
    const decoded = decodeSessionOperationRecord(encodeSessionOperationRecord(record));
    if (decoded.status !== 'decoded') throw new Error(`the maintainer operation does not round-trip: ${decoded.reason}`);
    expect(decoded.value).toEqual(record);
  });
});

describe('the MaintainerAssignmentRecorded event', () => {
  const EVENT = {
    eventId: 'evt-1',
    eventType: 'MaintainerAssignmentRecorded' as const,
    schemaVersion: 1 as const,
    occurredAt: '2026-11-02T00:00:01.000Z',
    projectId: 'P',
    workspaceId: 'W',
    operationRef: OPERATION_REF,
    revision: 2,
    phase: 'completed' as const,
    action: DONE,
  };
  const ACTOR = { kind: 'human' as const, id: 'operator' };
  const PROOF: DecisionChangeProofV1 = {
    acknowledgementRef: ANSWER,
    capturedPins: [{ ref: OPERATION_REF, revision: 1 }],
    changes: [{ before: { ref: OPERATION_REF, revision: 1 }, after: { ref: OPERATION_REF, revision: 2 } }],
    basisRebases: [],
  };
  const cases = [
    { name: 'actor and proof', body: { ...EVENT, actor: ACTOR, proof: PROOF } },
    { name: 'actor without proof', body: { ...EVENT, actor: ACTOR } },
    { name: 'neither actor nor proof', body: EVENT },
  ];
  it.each(cases)('round-trips $name', ({ body }) => {
    const encoded = maintainerAssignmentRecordedCodec.encode(body);
    const decoded = maintainerAssignmentRecordedCodec.decode(encoded);
    if (decoded.status !== 'decoded') throw new Error(`the event does not round-trip: ${decoded.reason}`);
    expect(decoded.value).toEqual(body);
  });

  it('is registered in the Session record schemas', () => {
    const registration = SESSION_RECORD_SCHEMAS.events.find(
      (entry) => entry.eventType === 'MaintainerAssignmentRecorded');
    expect(registration).toBeDefined();
    const encoded = maintainerAssignmentRecordedCodec.encode({ ...EVENT, actor: ACTOR, proof: PROOF });
    expect(registration!.validate(encoded).status).toBe('decoded');
  });
});

describe('the archive stored choice module arm', () => {
  const request = {
    schemaVersion: 1,
    requestId: 'req-1',
    requestedBy: { kind: 'human', id: 'operator' },
    requestedAt: '2026-11-02T00:00:00.000Z',
    reason: 'archive the line',
    mode: 'operator',
    condition: null,
    tasks: [{ target: { kind: 'module', ref: MODULE }, disposition: { kind: 'drop' } }],
    wait: null,
    execution: { kind: 'none' },
    executionPins: [],
    confirmUnknownStopped: false,
    receipt: { identityKey: 'identity-1', fingerprint: 'fingerprint-1' },
  };

  it('accepts a module choice in the project', () => {
    expect(checkSessionArchiveRequest(request, 'P')).toBeNull();
  });

  describe('rejects: a bad module choice', () => {
    it('refuses an unknown disposition', () => {
      expect(checkSessionArchiveRequest({
        ...request,
        tasks: [{ target: { kind: 'module', ref: MODULE }, disposition: { kind: 'bogus' } }],
      }, 'P')).toBe('archiveRequest task choice: archive task choice disposition kind is not recognized');
    });

    it('refuses a module of another project', () => {
      expect(checkSessionArchiveRequest({
        ...request,
        tasks: [{ target: { kind: 'module', ref: { projectId: 'Q', moduleId: 'M-1' } },
          disposition: { kind: 'drop' } }],
      }, 'P')).toBe('archiveRequest task choice: archive task choice target belongs to another project');
    });
  });
});
