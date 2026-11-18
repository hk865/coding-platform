/**
 * D4 (Q frozen row; 121-146, R5 graph context): every card source reported `read_failed` gets one index row with
 * the new prefix, including a kind outside the nine the old `not_available` filter lists. `not_available` rows keep
 * their old text. Today both cells are red: `planning_question` has no `read_failed` row at all, and
 * `command_rerun_request` is swallowed by the nine-kind filter.
 *
 * The context reader is the public module boundary; the queue is its A2 double with a page the row names.
 */
import { describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { ContextExtensionsV1 } from '../../src/contracts/graph-context.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { SessionAnomalyViewV1 } from '../../src/contracts/session-anomaly.js';
import type {
  DecisionQueuePreparedReader, DecisionQueueReadV1, DecisionReadPort,
} from '../../src/core/work-graph/model/decision-contracts.js';
import type { ContextReadRequestV1 } from '../../src/core/work-graph/model/graph-context-contracts.js';
import type { SessionPage } from '../../src/core/work-graph/model/session-contracts.js';
import type { SessionAnomalyPort } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import { hostCtx } from '../helpers/KLS1A-project-store-fixture.js';
import { createContextExtensionsReader } from '../../src/core/work-graph/views/context-extensions.js';

const PROJECT_ID = 'q-d4-p';
const WORKSPACE_ID = 'q-d4-w';
const GOAL: GoalRef = { aggregateType: 'Goal', projectId: PROJECT_ID, goalId: 'q-d4-goal' };
const CURSOR = 'q-d4-cursor' as CommitCursor;
const HOST_ACTOR = { kind: 'system' as const, id: 'q-d4-host' };
const REQUEST: ContextReadRequestV1 = { goalRef: GOAL, focusTaskIds: [] };

type Capabilities = DecisionQueueReadV1['capabilities'];

function anomalyDouble(): Pick<SessionAnomalyPort, 'listSessionAnomalies'> {
  return { async listSessionAnomalies(): Promise<ReadResult<SessionPage<SessionAnomalyViewV1>>> {
    return { status: 'ready', value: { items: [], nextCursor: null, sourceCursor: CURSOR } };
  } };
}

function decisionsDouble(capabilities: Capabilities): Pick<DecisionReadPort, 'queryDecisionQueue'> & DecisionQueuePreparedReader {
  const page: DecisionQueueReadV1 = {
    waitingAnswer: [], answeredPendingApplication: [], history: [], notices: [],
    counts: { waitingAnswer: 0, answeredPendingApplication: 0, notices: {} }, countsComplete: false,
    nextCursor: null, sourceCursor: CURSOR, seenThrough: {}, displayToken: null,
    capabilities,
  };
  return {
    async queryDecisionQueue() { return { status: 'ready', value: page }; },
    // The context reader prepares the queue once before its pages (R-window); no catalog and no source files here.
    async prepareDecisionQueue() {
      return { status: 'ready', value: { architecture: null, readFailed: [], attempt: { cache: new Map() } } };
    },
    async queryDecisionQueuePrepared() { return { status: 'ready', value: page }; },
  };
}

async function rowsOf(capabilities: Capabilities) {
  const reader = createContextExtensionsReader({ anomalies: anomalyDouble(), hostActor: HOST_ACTOR,
    decisions: decisionsDouble(capabilities) });
  const result = await reader(hostCtx(PROJECT_ID, WORKSPACE_ID), REQUEST);
  if (result.status !== 'ready') throw new Error(`expected a ready context read, got ${JSON.stringify(result)}`);
  return (result.value as ContextExtensionsV1).decisions.rows;
}

describe('D4 the graph-context decision rows for read_failed sources', () => {
  it.each<{ name: string; capabilities: Capabilities; key: string; text: string }>([
    { name: 'a formal card source', capabilities: [
      { source: 'planning_question', availability: 'read_failed', reason: 'injected source failure' },
      { source: 'note_review', availability: 'not_available' },
    ], key: 'decision:read_failed:planning_question', text: '待决来源暂时读不到：planning_question' },
    { name: 'a card kind outside the nine', capabilities: [
      { source: 'command_rerun_request', availability: 'read_failed', reason: 'injected source failure' },
    ], key: 'decision:read_failed:command_rerun_request', text: '待决来源暂时读不到：command_rerun_request' },
  ])('writes the prefix row for $name', async ({ capabilities, key, text }) => {
    const rows = await rowsOf(capabilities);
    expect(rows).toContainEqual({ key, node: { kind: 'goal', ref: GOAL }, text, sources: [] });
    if (capabilities.some(entry => entry.source === 'note_review')) {
      expect(rows).toContainEqual({ key: 'decision:not_available:note_review', node: { kind: 'goal', ref: GOAL },
        text: '待决来源尚未接入：note_review', sources: [] });
    }
  });
});
