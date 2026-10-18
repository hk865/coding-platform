/**
 * K3-39 / decision 72 (U1): the ONE request-id algorithm's frozen identity.
 *
 * The live execution driver, the review draft and every owner lookup must
 * derive byte-identical tokens from a resolved call. These expectations are NOT
 * computed with `toolCommitRequestId`: the literal below is hand-computed from
 * the canonical JSON shown in the comment, so any drift in the algorithm fails.
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import {
  agentActorOf, recordDecisionApplicationInput, toolCommitRequestId,
} from '../../src/core/work-graph/model/tool-commit-arguments.js';

describe('K3-39 request-id identity (decision 72 U1)', () => {
  it('K3-39 a fixed claim-Session / run / tool / callId tuple freezes the literal request id', () => {
    // sha256 of the canonical JSON (RFC 8785 key order):
    // {"callId":"k3-39-frozen-call","operation":"propose_future_plan",
    //  "runRef":{"aggregateType":"Run","goalId":"g-frozen","projectId":"p-frozen","runId":"r-frozen"},
    //  "sessionRef":{"projectId":"p-frozen","sessionId":"s-frozen"}}
    const requestId = toolCommitRequestId({
      origin: {
        runRef: { aggregateType: 'Run', projectId: 'p-frozen', goalId: 'g-frozen', runId: 'r-frozen' },
        sessionRef: { projectId: 'p-frozen', sessionId: 's-frozen' },
        generation: 1, workspaceId: 'w-frozen',
      },
      toolName: 'propose_future_plan', kernelCallId: 'k3-39-frozen-call',
    });
    expect(requestId).toBe('c2-tool:7c4852d94d9f6b7304e2a42e67d661fdf6bd91873c89b2ca1d705a6ae3d9c5f0');
  });

  it('K3-39 an aggregate Session ref and extra Run fields hash like the plain production refs', () => {
    const plain = {
      runRef: { aggregateType: 'Run' as const, projectId: 'p', goalId: 'g', runId: 'r' },
      sessionRef: { projectId: 'p', sessionId: 's' }, generation: 1, workspaceId: 'w',
    };
    const aggregate = { ...plain, sessionRef: { ...plain.sessionRef, aggregateType: 'Session' as const } };
    expect(toolCommitRequestId({ origin: aggregate, toolName: 'send_session_message', kernelCallId: 'c1' }))
      .toBe(toolCommitRequestId({ origin: plain, toolName: 'send_session_message', kernelCallId: 'c1' }));
  });

  it('K3-39 the shared agent actor pins the literal session id and the four Run fields', () => {
    const actor = agentActorOf(
      { projectId: 'p-frozen', sessionId: 's-frozen', aggregateType: 'Session' } as never,
      { aggregateType: 'Run', projectId: 'p-frozen', goalId: 'g-frozen', runId: 'r-frozen' },
    );
    expect(actor).toEqual({
      kind: 'agent',
      id: 'session:39197b3db213b4320f1c5ac734a288129c605be153c622ee9a9f17410d87c8fb',
      runRef: { aggregateType: 'Run', projectId: 'p-frozen', goalId: 'g-frozen', runId: 'r-frozen' },
    });
  });

  it('K3-39 the decision payload picks the four messageRef fields', () => {
    // `sha256Hex(canonicalJson(...))` over the picked fields is what the live
    // writer and the lookup hash; an extra kernel-argument field must not leak.
    const payload = recordDecisionApplicationInput({
      messageRef: { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'w', messageId: 'm',
        extra: 'not part of the ref' } as never,
      receipt: { identityKey: 'i', fingerprint: 'f', cursor: 'c' as never },
    });
    expect(payload.messageRef).toEqual({
      aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'w', messageId: 'm',
    });
    expect(canonicalJson(payload.messageRef as never))
      .toBe(canonicalJson({ aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'w', messageId: 'm' } as never));
  });
});
