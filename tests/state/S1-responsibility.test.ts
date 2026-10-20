/**
 * Slice 1 §3.5 `state/session-responsibility.ts` (spec §5.2 UT11–UT15/UT51):
 * the pure responsibility transfer/close machine. The owner service binds the
 * two links and both Session revisions to one commit cursor; this file only
 * checks the constructed effect and the pending (to-be-bound) links.
 *
 * Pure: no RecordStore, no Kernel, no clock (spec §5.1 fixtures p/w, S/D, A).
 */
import { describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { RoleConfigurationRef, SessionRef, WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { SessionRecord, SessionWorkLink } from '../../src/contracts/core/session.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import {
  transitionResponsibility,
  type PendingResponsibleLinkV1,
  type ResponsibilityEffectV1,
  type ResponsibilityGuardV1,
  type ResponsibilityStateV1,
} from '../../src/core/work-graph/state/session-responsibility.js';

// --------------------------------------------------------------------------
// Fixtures (spec §5.1: project p, workspace w, source S, destination D, task A)
// --------------------------------------------------------------------------

const PROJECT = 'p';
const GOAL = 'g';
const WORKSPACE = 'w';
const T0 = '2026-10-08T00:00:00.000Z';

const TASK_A: TaskTriple = { projectId: PROJECT, goalId: GOAL, taskId: 'A' };
const TARGET_A: WorkLinkTarget = { kind: 'task', ref: TASK_A };
const ROLE: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'worker', templateRevision: 'r1' };
const SESSION_S: SessionRef = { projectId: PROJECT, sessionId: 'S' };
const SESSION_D: SessionRef = { projectId: PROJECT, sessionId: 'D' };
const MESSAGE_M: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: PROJECT, workspaceId: WORKSPACE, messageId: 'm' };

function sessionRecord(sessionId: string, revision: number, over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    ref: { aggregateType: 'Session', projectId: PROJECT, sessionId },
    revision,
    kernel: { adapterId: 'coding-agent', kernelSessionId: `k-${sessionId}` },
    lifecycle: 'active',
    health: 'available',
    role: ROLE,
    workspaceId: WORKSPACE,
    lastExecutionRef: null,
    occupancy: null,
    historyCursor: null,
    createdAt: T0,
    archivedAt: null,
    provenance: { schemaVersion: 1, kind: 'new' },
    ...over,
  };
}

function responsibleLink(sessionId: string, revision: number, since: CommitCursor): SessionWorkLink {
  return {
    ref: { aggregateType: 'SessionWorkLink', projectId: PROJECT, sessionId, target: TARGET_A, relation: 'responsible' },
    revision,
    since,
    until: null,
  };
}

function openDestinationLink(): SessionWorkLink {
  return { ...responsibleLink('D', 4, makeCommitCursor(7)) };
}

function stateOf(over: Partial<ResponsibilityStateV1> = {}): ResponsibilityStateV1 {
  return {
    source: sessionRecord('S', 4),
    destination: sessionRecord('D', 4),
    sourceLink: responsibleLink('S', 2, makeCommitCursor(1)),
    destinationLink: null,
    ...over,
  };
}

function guards(over: Partial<ResponsibilityGuardV1> = {}): ResponsibilityGuardV1 {
  return {
    sameScope: true, targetValid: true, taskTerminal: false,
    writerStopped: true, destinationEligible: true, pinsMatch: true,
    ...over,
  };
}

const TRANSFER = { kind: 'responsibility_transferred', to: SESSION_D } as const;

function writeOf(effects: readonly ResponsibilityEffectV1[]) {
  const write = effects.find(
    (effect): effect is Extract<ResponsibilityEffectV1, { kind: 'write_responsibility' }> =>
      effect.kind === 'write_responsibility',
  );
  if (write === undefined) throw new Error('the transition did not construct the responsibility write');
  return write;
}

const emittedEvent: ResponsibilityEffectV1 = { kind: 'emit_event', eventType: 'SessionResponsibilityChanged' };

// --------------------------------------------------------------------------
// UT11–UT15, UT51
// --------------------------------------------------------------------------

describe('transitionResponsibility (S1-LINK-01/02, §5.2 UT11–UT15/UT51)', () => {
  it('UT11 transfer closes the source link and opens the destination link, pending the commit cursor', () => {
    const sourceLink = responsibleLink('S', 2, makeCommitCursor(1));
    const result = transitionResponsibility(stateOf({ sourceLink }), TRANSFER, guards());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const write = writeOf(result.effects);
    expect(write.closed).toEqual({ ...sourceLink, revision: 3, until: null });
    expect(write.opened).toEqual({
      ref: { aggregateType: 'SessionWorkLink', projectId: PROJECT, sessionId: 'D', target: TARGET_A, relation: 'responsible' },
      revision: 1, since: null, until: null,
    });
    expect(write.openedBound).toBe('since');
    expect(write.destination).not.toBeNull();
    expect(write.destination?.revision).toBe(5);
    expect(write.source.revision).toBe(5);
    expect(result.next.source.revision).toBe(5);
    expect(result.next.destination?.revision).toBe(5);
    expect(result.next.sourceLink).toEqual({ ...sourceLink, revision: 3, until: null });
    expect(result.next.destinationLink).toEqual(write.opened);
    expect(result.effects).toContainEqual(emittedEvent);
  });

  it('UT12 refuses the transfer while the source task writer is still running', () => {
    const result = transitionResponsibility(stateOf(), TRANSFER, guards({ writerStopped: false }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('busy');
    expect('effects' in result).toBe(false);
  });

  it('UT13 keeps an already open destination link at its original revision and since', () => {
    const destinationLink = openDestinationLink();
    const sourceLink = responsibleLink('S', 2, makeCommitCursor(1));
    const result = transitionResponsibility(stateOf({ sourceLink, destinationLink }), TRANSFER, guards());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const write = writeOf(result.effects);
    expect(write.closed).toEqual({ ...sourceLink, revision: 3, until: null });
    expect(write.opened).toEqual(destinationLink);
    expect(write.openedBound).toBeNull();
    expect(result.next.sourceLink).toEqual({ ...sourceLink, revision: 3, until: null });
    expect(result.next.destinationLink).toEqual(destinationLink);
  });

  it('UT14 refuses the transfer to a retired destination', () => {
    // The row's destination is retired, not archived: its Kernel Turn was left open
    // (health unavailable / kernel_turn_open) and it has no successor.
    const destination = sessionRecord('D', 4, { health: 'unavailable', healthConclusion: 'kernel_turn_open' });
    const result = transitionResponsibility(
      stateOf({ destination }),
      TRANSFER,
      guards({ destinationEligible: false }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('unavailable');
    expect('effects' in result).toBe(false);
  });

  it('UT15 a terminal close closes the source link and opens nothing', () => {
    const sourceLink = responsibleLink('S', 2, makeCommitCursor(1));
    const pending: PendingResponsibleLinkV1 = { ...sourceLink, revision: 3, until: null };
    const result = transitionResponsibility(
      stateOf({ sourceLink }),
      { kind: 'responsibility_released', mode: 'terminal' },
      guards({ taskTerminal: true }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const write = writeOf(result.effects);
    expect(write.closed).toEqual(pending);
    expect(write.opened).toBeNull();
    expect(write.openedBound).toBeNull();
    expect(write.destination).toBeNull();
    expect(result.next.destination).toBeNull();
    expect(result.next.destinationLink).toBeNull();
    // The machine constructs only the link write and its event: no Task disposition/phase effect.
    expect([...result.effects].map((effect) => effect.kind).sort()).toEqual(['emit_event', 'write_responsibility']);
    expect(result.effects).toContainEqual(emittedEvent);
  });

  it('UT51 refuses the transfer to a readonly copy destination', () => {
    const destination = sessionRecord('D', 4, {
      provenance: { schemaVersion: 1, kind: 'readonly_copy', from: SESSION_S, messageRef: MESSAGE_M },
    });
    const result = transitionResponsibility(
      stateOf({ destination }),
      TRANSFER,
      guards({ destinationEligible: false }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('unavailable');
    expect('effects' in result).toBe(false);
  });
});
