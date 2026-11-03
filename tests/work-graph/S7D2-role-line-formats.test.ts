/**
 * 7D2 O1a: the role-line formats' pure half. The four orchestration records, their two lookups, the three new bound
 * cursors, the four `…Changed` events, the `role_line` operation arm and the `cold_start` payload.
 *
 * A5: a pure table. Every input is constructed here and every expected value is a hand-computed literal from the
 * ruling; no store, platform, Host, Workflow or stub port is imported.
 */
import { describe, expect, it } from 'vitest';
import { checkShape } from '../../src/contracts/validation/data-format.js';
import type { RoleLineSplitSavedV1 } from '../../src/contracts/role-lines.js';
import { RoleLineActionShape } from '../../src/core/work-graph/model/session-operation-arms.js';
import type { SessionOperationRecord } from '../../src/core/work-graph/model/session-contracts.js';
import {
  autonomyRuleCodec, autonomyRuleSetCodec, goalAdviserQueueCodec, roleCapacityEpisodeCodec,
  roleLineSplitSavedCodec,
} from '../../src/core/work-graph/sessions/role-line-orchestration-codecs.js';
import {
  autonomyRuleSetChangedCodec, goalAdviserQueueChangedCodec, roleCapacityEpisodeChangedCodec,
  roleLineOperationChangedCodec,
} from '../../src/core/work-graph/sessions/role-line-orchestration-codecs.js';
import {
  decodeSessionOperationRecord, encodeSessionOperationRecord,
} from '../../src/core/work-graph/sessions/session-record-codecs.js';

const GOAL = { aggregateType: 'Goal', projectId: 'p1', goalId: 'g1' } as const;
const MESSAGE = { aggregateType: 'SessionMessage', projectId: 'p1', workspaceId: 'w1', messageId: 'm1' } as const;

/** The queue entry's bound cursor is a real platform cursor: `c` plus ten digits. */
const CURSOR = 'c0000000001';

describe('the four orchestration records: encode then decode', () => {
  it.each<{ name: string; codec: typeof goalAdviserQueueCodec | typeof autonomyRuleCodec
    | typeof autonomyRuleSetCodec | typeof roleCapacityEpisodeCodec; value: Record<string, unknown> }>([
    {
      name: 'GoalAdviserQueue@1',
      codec: goalAdviserQueueCodec,
      value: {
        ref: { aggregateType: 'GoalAdviserQueue', projectId: 'p1' }, revision: 1,
        projectRef: { projectId: 'p1' },
        entries: [{ goalRef: GOAL, enqueuedAt: CURSOR, screening: null }],
      },
    },
    {
      name: 'AutonomyRule@1',
      codec: autonomyRuleCodec,
      value: {
        ref: { aggregateType: 'AutonomyRule', projectId: 'p1', ruleId: 'r1' }, revision: 1,
        projectRef: { projectId: 'p1' },
        actions: ['create_member', 'role_line_split'],
        scope: [{ kind: 'project' }, { kind: 'goal', goalRef: GOAL }],
        limits: { open: { adviser: 3 } },
        expiresAt: null,
        approvedBy: { kind: 'human', id: 'u1' },
        approvedFrom: { cardKey: 'card-1', answerMessageRef: MESSAGE },
        state: 'active',
      },
    },
    {
      name: 'AutonomyRuleSet@1',
      codec: autonomyRuleSetCodec,
      value: {
        ref: { aggregateType: 'AutonomyRuleSet', projectId: 'p1' }, revision: 1,
        projectRef: { projectId: 'p1' },
      },
    },
    {
      name: 'RoleCapacityEpisode@1',
      codec: roleCapacityEpisodeCodec,
      value: {
        ref: { aggregateType: 'RoleCapacityEpisode', projectId: 'p1', duty: 'adviser', episode: 1 }, revision: 1,
        projectRef: { projectId: 'p1' }, duty: 'adviser', episode: 1, capValue: 4,
        openedAt: CURSOR, closedAt: null,
      },
    },
  ])('$name round-trips unchanged', ({ codec, value }) => {
    const encoded = codec.encode(value as never);
    const decoded = codec.decode(encoded);
    expect(decoded.status).toBe('decoded');
    expect(decoded.status === 'decoded' ? decoded.value : null).toEqual(value);
  });
});

describe('the queue record carries its required projectRef', () => {
  it('refuses a queue value without projectRef', () => {
    expect(goalAdviserQueueCodec.check({
      ref: { aggregateType: 'GoalAdviserQueue', projectId: 'p1' }, revision: 1,
      entries: [{ goalRef: GOAL, enqueuedAt: CURSOR, screening: null }],
    })).toBe('GoalAdviserQueue.projectRef is missing');
  });
});

describe('the two lookups the shape tables expose', () => {
  it('the rule table is keyed by its project', () => {
    expect(autonomyRuleCodec.lookups).toEqual([{
      name: 'autonomy-rules-by-project', aggregateType: 'AutonomyRule', paths: ['ref.projectId'],
    }]);
  });
  it('the episode table is keyed by project and duty, ordered by episode', () => {
    expect(roleCapacityEpisodeCodec.lookups).toEqual([{
      name: 'role-capacity-episodes-by-project-duty', aggregateType: 'RoleCapacityEpisode',
      paths: ['ref.projectId', 'duty'], orderBy: { path: 'episode', valueType: 'integer' },
    }]);
  });
});

describe('the three new bound cursors each codec declares to the Store', () => {
  it('the queue binds its entry timestamp', () => {
    expect(goalAdviserQueueCodec.registration.commitCursorFields).toEqual(['entries[].enqueuedAt']);
  });
  it('the episode binds its open and close timestamps', () => {
    expect(roleCapacityEpisodeCodec.registration.commitCursorFields).toEqual(['openedAt', 'closedAt']);
  });
});

describe('the four Changed events round-trip', () => {
  const header = { schemaVersion: 1, occurredAt: '2026-11-03T00:00:00Z', projectId: 'p1', workspaceId: 'w1',
    actor: { kind: 'system', id: 'host' }, revision: 1 } as const;
  it.each<{ name: string; codec: typeof goalAdviserQueueChangedCodec | typeof autonomyRuleSetChangedCodec
    | typeof roleCapacityEpisodeChangedCodec | typeof roleLineOperationChangedCodec;
    event: Record<string, unknown> }>([
    { name: 'GoalAdviserQueueChanged', codec: goalAdviserQueueChangedCodec,
      event: { ...header, eventId: 'e1', eventType: 'GoalAdviserQueueChanged' } },
    { name: 'AutonomyRuleSetChanged', codec: autonomyRuleSetChangedCodec,
      event: { ...header, eventId: 'e2', eventType: 'AutonomyRuleSetChanged' } },
    { name: 'RoleCapacityEpisodeChanged', codec: roleCapacityEpisodeChangedCodec,
      event: { ...header, eventId: 'e3', eventType: 'RoleCapacityEpisodeChanged' } },
    { name: 'RoleLineOperationChanged', codec: roleLineOperationChangedCodec,
      event: { ...header, eventId: 'e4', eventType: 'RoleLineOperationChanged',
        operationRef: { aggregateType: 'CoreOperation', projectId: 'p1', operationId: 'op1' } } },
  ])('$name round-trips unchanged', ({ codec, event }) => {
    const encoded = codec.encode(event as never);
    const decoded = codec.decode(encoded);
    expect(decoded.status).toBe('decoded');
    expect(decoded.status === 'decoded' ? decoded.value : null).toEqual(event);
  });
});

describe('the role_line operation arm', () => {
  it('a start_lines action with a registered step and no result decodes through the operation codec', () => {
    const action = {
      kind: 'role_line', action: 'start_lines', phase: 'registered', goalRef: null,
      steps: [{ key: 'secretary', duty: 'secretary', childOperation: null, state: 'registered' }],
      result: null,
    };
    const record: SessionOperationRecord = {
      ref: { aggregateType: 'CoreOperation', projectId: 'p1', operationId: 'op-role-line' },
      revision: 1, workspaceId: 'w1', action: action as never,
      phase: 'running', requestedAt: '2026-11-03T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z',
      observation: null, failure: null,
    };
    const decoded = decodeSessionOperationRecord(encodeSessionOperationRecord(record));
    expect(decoded.status).toBe('decoded');
    expect(decoded.status === 'decoded' ? decoded.value.action : null).toEqual(action);
  });
});

describe('the cold_start action carries its seven optional payload fields', () => {
  it('passes the stored check with every payload field present', () => {
    const queryRunRef = { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId: 'q1', runId: 'run1' };
    const answerRef = { aggregateType: 'QueryJobAnswer', projectId: 'p1', workspaceId: 'w1', queryJobId: 'q1',
      answerId: 'a1' };
    const action = {
      kind: 'role_line', action: 'cold_start', phase: 'proposals', goalRef: null, steps: [],
      result: { status: 'waiting', reason: null },
      lastCompleted: 'regions',
      candidate: { queryRunRef, answerRef },
      pendingRegions: [{ projectId: 'p1', moduleId: 'm1' }],
      explorations: [{
        queryRunRef, sessionRef: { projectId: 'p1', sessionId: 's1' }, messageRef: MESSAGE,
        operationRef: { aggregateType: 'CoreOperation', projectId: 'p1', operationId: 'op1' },
        segment: 'coarse_split',
      }],
      batchRefs: [{ aggregateType: 'ArchitectureProposalBatch', projectId: 'p1', batchId: 'b1' }],
      route: 'split',
      baseCatalogPin: {
        catalogRef: { aggregateType: 'ArchitectureCatalog', projectId: 'p1', baselineId: 'bl1', revision: 1 },
        baseline: {
          ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: 'p1', baselineId: 'bl1', revision: 1 },
          digest: 'a'.repeat(64),
        },
      },
    };
    expect(checkShape(RoleLineActionShape, action, 'stored')).toBeNull();
  });
});

describe('the split plan payload codec', () => {
  it('round-trips the one saved plan body and is its own identity key', () => {
    const saved: RoleLineSplitSavedV1 = {
      source: { projectId: 'p1', sessionId: 's1' },
      move: [{ kind: 'region', moduleRef: { projectId: 'p1', moduleId: 'm1' } }],
      keep: [{ kind: 'project' }],
      reason: 'too_long',
    };
    const text = roleLineSplitSavedCodec.encode(saved);
    expect(text).toBe('{"keep":[{"kind":"project"}],"move":[{"kind":"region","moduleRef":{"moduleId":"m1","projectId":"p1"}}],'
      + '"reason":"too_long","source":{"projectId":"p1","sessionId":"s1"}}');
    expect(roleLineSplitSavedCodec.decode(text)).toEqual(saved);
  });
});
