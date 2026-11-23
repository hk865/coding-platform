/**
 * PL source lineage (slice-PL-SPEC §6.3.1; ruling C.1): a table-driven pure walk
 * over injected read ports. `planfix:` reads the parent candidate and continues
 * from its source message; `planresume:` reads the original QueryJob. Every read
 * failure is returned unchanged, and a second fix never overwrites the nearest
 * `fixBase`.
 */
import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { rejected } from '../../src/contracts/core/rejections.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { SourceRefV1 } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import { SYSTEM_ROUND_ACTOR } from '../../src/contracts/plan-round.js';
import type { MessageBody } from '../../src/core/work-graph/model/communication-contracts.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import { createSessionMessageRecord } from '../../src/core/work-graph/state/message-machine.js';
import {
  planSourceLineageOf,
  type PlanSourceLineageDeps,
  type PlanSourceLineageV1,
} from '../../src/core/work-graph/tasks/plan-lineage.js';
import { systemRoundMessageRef } from '../helpers/system-round-ref.js';

const PROJECT = 'project-1';
const WORKSPACE = 'workspace-1';
const AT = '2026-10-25T00:00:00.000Z';
const SOURCE: SourceRefV1 = { kind: 'workspace', refId: WORKSPACE, revision: '1' };
const BODY: ArtifactRef = { kind: 'artifact', contentType: 'text/plain', digest: 'd', sizeBytes: 1, source: SOURCE };
const GOAL: GoalRef = { aggregateType: 'Goal', projectId: PROJECT, goalId: 'goal-1' };
const RECIPIENT = { projectId: PROJECT, sessionId: 'line-1' };

function messageRef(messageId: string): SessionMessageRef {
  return { aggregateType: 'SessionMessage', projectId: PROJECT, workspaceId: WORKSPACE, messageId };
}

/** One Host-sent system round: its own send receipt ref and the request id the Host's outbox records. */
type Round = { ref: SessionMessageRef; requestId: string };

function round(requestId: string): Round {
  const ref = systemRoundMessageRef({ projectId: PROJECT, workspaceId: WORKSPACE }, requestId);
  if (ref.status !== 'ready') throw new Error(`the system round ref for ${requestId} could not be built`);
  return { ref: ref.value, requestId };
}

/** The second line of a `planresume:` round is the original Query's source message. */
function planResumeText(queryJobId: string, original: SessionMessageRef): string {
  return `planresume:goal-1:${queryJobId}\noriginalQueryRef: ${JSON.stringify(original)}`;
}

const FIX_RUN = round('planfix:p-run:1');
const FIX_ONE = round('planfix:p-1:1');
const RESUME = round('planresume:goal-1:q-1');
const FIX_TWO = round('planfix:p-2:1');
const ROOT = messageRef('m-root');

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
  rounds?: readonly Round[];
  jobs?: Record<string, SessionMessageRef | ReadResult<QueryJobRecord>>;
  proposals?: Record<string, PlanProposal | ReadResult<PlanProposal>>;
}): PlanSourceLineageDeps {
  const rounds = options.rounds ?? [];
  const refByMessageId = new Map(rounds.map((entry) => [entry.ref.messageId, entry.ref]));
  const refByRequestId = new Map(rounds.map((entry) => [entry.requestId, entry.ref]));
  const stored = (ref: SessionMessageRef) => createSessionMessageRecord({
    ref,
    sender: refByMessageId.has(ref.messageId)
      ? { kind: 'host', actor: { ...SYSTEM_ROUND_ACTOR } }
      : { kind: 'host', actor: { kind: 'human', id: 'operator' } },
    recipient: RECIPIENT,
    bodyRef: BODY,
    sourceRef: SOURCE,
    createdAt: AT,
    goalRef: GOAL,
    needsReply: false,
    waitAfterSend: false,
    wake: true,
    answeredBy: 'line',
  });
  return {
    messages: {
      readMessage: async (_ctx, ref) => {
        if (refByMessageId.has(ref.messageId) || options.bodies[ref.messageId] !== undefined) {
          return { status: 'ready', value: stored(refByMessageId.get(ref.messageId) ?? ref) };
        }
        return rejected('not_found', `no message ${ref.messageId}`);
      },
      readHostSendMessageRef: async (_ctx, input) => {
        const ref = refByRequestId.get(input.requestId);
        if (ref === undefined) return rejected('not_found', `no Host send for ${input.requestId}`);
        return { status: 'ready', value: ref };
      },
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
    source: FIX_RUN.ref,
    deps: depsOf({
      bodies: { [FIX_RUN.ref.messageId]: 'planfix:p-run:1\nrepair the run candidate' },
      rounds: [FIX_RUN],
      proposals: { 'p-run': proposal('p-run', null) },
    }),
    expected: { status: 'ready', value: {
      rootMessage: FIX_RUN.ref, fixRound: FIX_RUN.ref, fixBase: proposal('p-run', null),
    } },
  },
  {
    name: 'planfix one hop reaches the parent source',
    source: FIX_ONE.ref,
    deps: depsOf({
      bodies: { [FIX_ONE.ref.messageId]: 'planfix:p-1:1\nrepair the plan', [ROOT.messageId]: 'execute this plan' },
      rounds: [FIX_ONE],
      proposals: { 'p-1': proposal('p-1', ROOT) },
    }),
    expected: { status: 'ready', value: {
      rootMessage: ROOT, fixRound: FIX_ONE.ref, fixBase: proposal('p-1', ROOT) } },
  },
  {
    name: 'planresume follows the original QueryJob to a planfix hop',
    source: RESUME.ref,
    deps: depsOf({
      bodies: {
        [RESUME.ref.messageId]: planResumeText('q-1', ROOT),
        [FIX_ONE.ref.messageId]: 'planfix:p-1:1\nrepair the plan',
        [ROOT.messageId]: 'execute this plan',
      },
      rounds: [RESUME, FIX_ONE],
      jobs: { 'q-1': FIX_ONE.ref },
      proposals: { 'p-1': proposal('p-1', ROOT) },
    }),
    expected: { status: 'ready', value: {
      rootMessage: ROOT, fixRound: FIX_ONE.ref, fixBase: proposal('p-1', ROOT) } },
  },
  {
    name: 'two consecutive fixes keep the nearest fixBase',
    source: FIX_TWO.ref,
    deps: depsOf({
      bodies: {
        [FIX_TWO.ref.messageId]: 'planfix:p-2:1\nrepair the second candidate',
        [RESUME.ref.messageId]: planResumeText('q-1', ROOT),
        [FIX_ONE.ref.messageId]: 'planfix:p-1:1\nrepair the first candidate',
        [ROOT.messageId]: 'execute this plan',
      },
      rounds: [FIX_TWO, RESUME, FIX_ONE],
      jobs: { 'q-1': FIX_ONE.ref },
      proposals: {
        'p-2': proposal('p-2', RESUME.ref),
        'p-1': proposal('p-1', ROOT),
      },
    }),
    expected: { status: 'ready', value: {
      rootMessage: ROOT, fixRound: FIX_TWO.ref, fixBase: proposal('p-2', RESUME.ref) } },
  },
  {
    name: 'an ordinary message is its own root',
    source: ROOT,
    deps: depsOf({ bodies: { [ROOT.messageId]: 'execute this plan' } }),
    expected: { status: 'ready', value: {
      rootMessage: ROOT, fixRound: null, fixBase: null } },
  },
  {
    name: 'message read failure is returned as-is',
    source: RESUME.ref,
    deps: depsOf({ bodies: { [RESUME.ref.messageId]: BODY_FAILURE }, rounds: [RESUME] }),
    expected: BODY_FAILURE,
    exact: true,
  },
  {
    name: 'QueryJob read failure is returned as-is',
    source: RESUME.ref,
    deps: depsOf({
      bodies: { [RESUME.ref.messageId]: planResumeText('q-1', ROOT) },
      rounds: [RESUME],
      jobs: { 'q-1': JOB_FAILURE },
    }),
    expected: JOB_FAILURE,
    exact: true,
  },
  {
    name: 'parent proposal read failure is returned as-is',
    source: FIX_ONE.ref,
    deps: depsOf({
      bodies: { [FIX_ONE.ref.messageId]: 'planfix:p-1:1\nrepair the plan' },
      rounds: [FIX_ONE],
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
