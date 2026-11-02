/**
 * PL source lineage (slice-PL-SPEC §6.3.1; ruling C.1): a table-driven pure walk
 * over injected read ports. `planfix:` reads the parent candidate and continues
 * from its source message; `planresume:` reads the original QueryJob. Every read
 * failure is returned unchanged, and a second fix never overwrites the nearest
 * `fixBase`.
 */
import { describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { rejected } from '../../src/contracts/core/rejections.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { MessageBody } from '../../src/core/work-graph/model/communication-contracts.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import {
  planSourceLineageOf,
  type PlanSourceLineageDeps,
  type PlanSourceLineageV1,
} from '../../src/core/work-graph/tasks/plan-lineage.js';

const PROJECT = 'project-1';
const WORKSPACE = 'workspace-1';

function messageRef(messageId: string): SessionMessageRef {
  return { aggregateType: 'SessionMessage', projectId: PROJECT, workspaceId: WORKSPACE, messageId };
}

function proposal(
  proposalId: string,
  sourceMessageRef: SessionMessageRef | null,
  basedOn: PlanRevisionRef | null = null,
): PlanProposal {
  return {
    ref: { aggregateType: 'PlanProposal', projectId: PROJECT, workspaceId: WORKSPACE, proposalId },
    revision: 1,
    basedOn,
    sourceMessageRef,
  } as unknown as PlanProposal;
}

const ctx: CoreCallContext = {
  projectId: PROJECT,
  workspaceId: WORKSPACE,
  principal: { kind: 'host', actor: { kind: 'system', id: 'test-host' } },
  materialReader: { kind: 'host', projectId: PROJECT, workspaceId: WORKSPACE,
    actor: { kind: 'system', id: 'test-host' } },
  signal: new AbortController().signal,
};

function isReadResult<T>(value: T | ReadResult<T>): value is ReadResult<T> {
  if (typeof value !== 'object' || value === null || !('status' in value)) return false;
  return ['ready', 'not_found', 'not_ready', 'rejected'].includes((value as { status: string }).status);
}

function depsOf(options: {
  bodies: Record<string, string | ReadResult<MessageBody>>;
  jobs?: Record<string, SessionMessageRef | ReadResult<QueryJobRecord>>;
  proposals?: Record<string, PlanProposal | ReadResult<PlanProposal>>;
}): PlanSourceLineageDeps {
  return {
    messages: {
      readMessage: async () => rejected('unsupported', 'the lineage walk reads the saved body only'),
      readMessageBody: async (_ctx, input) => {
        const entry = options.bodies[input.messageRef.messageId];
        if (entry === undefined) return rejected('not_found', `no body for ${input.messageRef.messageId}`);
        if (typeof entry === 'string') {
          return { status: 'ready', value: { messageRef: input.messageRef, part: 'message',
            text: entry } as unknown as MessageBody };
        }
        return entry;
      },
    },
    queries: {
      readQueryJob: async (_ctx, ref) => {
        const entry = options.jobs?.[ref.queryJobId];
        if (entry === undefined) return rejected('not_found', `no QueryJob ${ref.queryJobId}`);
        if ('status' in entry) return entry;
        return { status: 'ready', value: { job: { job: { intent: { execution: {
          kind: 'intervention_planning', sourceMessageRef: entry } } } } } as unknown as QueryJobRecord };
      },
    },
    plans: {
      readPlanProposal: async (_ctx, ref) => {
        const entry = options.proposals?.[ref.proposalId];
        if (entry === undefined) return rejected('not_found', `no proposal ${ref.proposalId}`);
        return isReadResult<PlanProposal>(entry) ? entry : { status: 'ready', value: entry };
      },
    },
  };
}

const BODY_FAILURE = rejected('unavailable', 'the saved body could not be read');
const JOB_FAILURE = rejected('not_found', 'the original QueryJob is missing');
const PROPOSAL_FAILURE = rejected('unavailable', 'the parent candidate could not be read');

type Case = {
  name: string;
  source: SessionMessageRef;
  deps: PlanSourceLineageDeps;
  expected: ReadResult<PlanSourceLineageV1>;
  exact?: boolean;
};

const rows: Case[] = [
  {
    name: 'a planfix over a Work Run candidate stops at the fix round',
    source: messageRef('m-fix-run'),
    deps: depsOf({
      bodies: { 'm-fix-run': 'planfix:p-run:1\nrepair the run candidate' },
      proposals: { 'p-run': proposal('p-run', null) },
    }),
    expected: { status: 'ready', value: {
      rootMessage: messageRef('m-fix-run'), fixRound: messageRef('m-fix-run'), fixBase: proposal('p-run', null),
    } },
  },
  {
    name: 'planfix one hop reaches the parent source',
    source: messageRef('m-fix-1'),
    deps: depsOf({
      bodies: { 'm-fix-1': 'planfix:p-1:1\nrepair the plan', 'm-root': 'execute this plan' },
      proposals: { 'p-1': proposal('p-1', messageRef('m-root')) },
    }),
    expected: { status: 'ready', value: {
      rootMessage: messageRef('m-root'), fixRound: messageRef('m-fix-1'), fixBase: proposal('p-1', messageRef('m-root')) } },
  },
  {
    name: 'planresume follows the original QueryJob to a planfix hop',
    source: messageRef('m-resume-1'),
    deps: depsOf({
      bodies: {
        'm-resume-1': 'planresume:goal-1:q-1\nresume the round',
        'm-fix-1': 'planfix:p-1:1\nrepair the plan',
        'm-root': 'execute this plan',
      },
      jobs: { 'q-1': messageRef('m-fix-1') },
      proposals: { 'p-1': proposal('p-1', messageRef('m-root')) },
    }),
    expected: { status: 'ready', value: {
      rootMessage: messageRef('m-root'), fixRound: messageRef('m-fix-1'), fixBase: proposal('p-1', messageRef('m-root')) } },
  },
  {
    name: 'two consecutive fixes keep the nearest fixBase',
    source: messageRef('m-fix-2'),
    deps: depsOf({
      bodies: {
        'm-fix-2': 'planfix:p-2:1\nrepair the second candidate',
        'm-resume-1': 'planresume:goal-1:q-1\nresume the first fix',
        'm-fix-1': 'planfix:p-1:1\nrepair the first candidate',
        'm-root': 'execute this plan',
      },
      jobs: { 'q-1': messageRef('m-fix-1') },
      proposals: {
        'p-2': proposal('p-2', messageRef('m-resume-1')),
        'p-1': proposal('p-1', messageRef('m-root')),
      },
    }),
    expected: { status: 'ready', value: {
      rootMessage: messageRef('m-root'), fixRound: messageRef('m-fix-2'), fixBase: proposal('p-2', messageRef('m-resume-1')) } },
  },
  {
    name: 'an ordinary message is its own root',
    source: messageRef('m-root'),
    deps: depsOf({ bodies: { 'm-root': 'execute this plan' } }),
    expected: { status: 'ready', value: {
      rootMessage: messageRef('m-root'), fixRound: null, fixBase: null } },
  },
  {
    name: 'message read failure is returned as-is',
    source: messageRef('m-resume-1'),
    deps: depsOf({ bodies: { 'm-resume-1': BODY_FAILURE } }),
    expected: BODY_FAILURE,
    exact: true,
  },
  {
    name: 'QueryJob read failure is returned as-is',
    source: messageRef('m-resume-1'),
    deps: depsOf({
      bodies: { 'm-resume-1': 'planresume:goal-1:q-1\nresume the round' },
      jobs: { 'q-1': JOB_FAILURE },
    }),
    expected: JOB_FAILURE,
    exact: true,
  },
  {
    name: 'parent proposal read failure is returned as-is',
    source: messageRef('m-fix-1'),
    deps: depsOf({
      bodies: { 'm-fix-1': 'planfix:p-1:1\nrepair the plan' },
      proposals: { 'p-1': PROPOSAL_FAILURE },
    }),
    expected: PROPOSAL_FAILURE,
    exact: true,
  },
];

describe('planSourceLineageOf', () => {
  it.each(rows)('$name', async (row) => {
    const result = await planSourceLineageOf(ctx, row.deps, row.source);
    if (row.exact === true) expect(result).toBe(row.expected);
    else expect(result).toEqual(row.expected);
  });
});
