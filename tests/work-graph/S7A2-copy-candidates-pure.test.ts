/**
 * CR5.3: the pure candidate table (7a:603–:619), one `it.each`; expected rows are the book's hand-written
 * table. No store, platform, Host, Workflow, Runtime or fixture is imported.
 */
import { describe, expect, it } from 'vitest';
import type { DecisionMessageMetadataV1, SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { CopyInterventionCandidateV1 } from '../../src/contracts/goal-copy-retraction.js';
import { copyInterventionCandidateOf, type CopyInterventionFactsV1 } from '../../src/core/work-graph/state/copy-intervention.js';

const projectId = 'P';
const at = '2026-10-27T00:00:00.000Z';
const sourceGoalRef = { aggregateType: 'Goal' as const, projectId, goalId: 'g1' };
const messageRef: SessionMessageRef = { aggregateType: 'SessionMessage', projectId, workspaceId: 'W', messageId: 'm1' };
const workRunSender = { kind: 'work_run' as const, sessionRef: { projectId, sessionId: 's1' }, generation: 1,
  roleBinding: { schemaVersion: 1 as const, bindingId: 'b1', templateId: 't1', templateRevision: '1', bindingVersion: 1, policyRevision: '1' },
  runRef: { aggregateType: 'Run' as const, projectId, goalId: 'g1', runId: 'r1' } };
const decision: DecisionMessageMetadataV1 = {
  schemaVersion: 1, objects: [], options: [], syntheticAnswer: false, forwardedFrom: null,
  source: { kind: 'message', key: 'd1', subject: { kind: 'goal', goalRef: sourceGoalRef }, pins: [] },
};

type FactsInput = { message?: Partial<CopyInterventionFactsV1['message']>; delivered?: boolean; copiedElsewhere?: boolean };
type Expected = Pick<CopyInterventionCandidateV1, 'state' | 'selectable' | 'reason' | 'retractable' | 'retractReason'>;
const facts = (input: FactsInput = {}): CopyInterventionFactsV1 => ({
  message: { ref: messageRef, revision: 9, goalRef: sourceGoalRef, originalRef: null, transferredTo: null,
    sender: { kind: 'host', actor: { kind: 'human', id: 'u1' } },
    withdrawnAt: null, appliedAt: null, rejectedAt: null, ...input.message },
  delivered: input.delivered ?? false, copiedElsewhere: input.copiedElsewhere ?? false,
});
const disposed = (state: 'withdrawn' | 'applied' | 'rejected'): Expected => ({ state, selectable: false, reason: state, retractable: false, retractReason: state });
const copied: Expected = { state: 'copied', selectable: false, reason: 'copied', retractable: false, retractReason: 'copied' };

const cases: Array<[string, FactsInput, Expected | null]> = [
  ['another goal', { message: { goalRef: { ...sourceGoalRef, goalId: 'g2' } } }, null],
  ['no goal ref', { message: { goalRef: null } }, null],
  ['a work-run sender', { message: { sender: workRunSender } }, null],
  ['a host system sender', { message: { sender: { kind: 'host', actor: { kind: 'system', id: 'sys' } } } }, null],
  ['a decision message', { message: { decision } }, null],
  ['a forwarding record', { message: { originalRef: messageRef } }, null],
  ['withdrawn, not delivered', { message: { withdrawnAt: at } }, disposed('withdrawn')],
  ['applied, not delivered', { message: { appliedAt: at } }, disposed('applied')],
  ['rejected and responded, so delivered', { message: { rejectedAt: at }, delivered: true }, disposed('rejected')],
  ['copied elsewhere and delivered', { copiedElsewhere: true, delivered: true }, copied],
  ['transferred to another line, not delivered', { message: { transferredTo: { aggregateType: 'SessionMessage', projectId, workspaceId: 'W', messageId: 'm2' } } }, copied],
  ['copied elsewhere and withdrawn', { copiedElsewhere: true, message: { withdrawnAt: at } }, disposed('withdrawn')],
  ['delivered', { delivered: true }, { state: 'delivered', selectable: true, reason: null, retractable: false, retractReason: 'delivered' }],
  ['not delivered', {}, { state: 'not_delivered', selectable: true, reason: null, retractable: true, retractReason: null }],
];

describe('copyInterventionCandidateOf', () => {
  it.each(cases)('%s', (_label, input, expected) => {
    const built = facts(input);
    const candidate = copyInterventionCandidateOf(sourceGoalRef, built);
    if (expected === null) expect(candidate).toBeNull();
    else {
      expect(candidate?.version).toBe(built.message.revision);
      expect(candidate).toEqual({ messageRef: built.message.ref, version: built.message.revision, ...expected });
    }
  });
});
