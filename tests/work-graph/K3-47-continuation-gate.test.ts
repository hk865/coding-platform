/**
 * K3 row K3-47 (二) / L11 at the owner layer: a CONTINUATION claim (TASK-02)
 * whose Task carries an unreadable review record is refused `unavailable`
 * before any write, exactly like an ordinary claim.
 *
 * The precondition is produced by the platform itself, never by hand: session A
 * is claimed through the public claim owner and its Run is entered by the
 * production Runtime (`createK3_35Runtime` / `runtime.port.startRun` after the
 * production `prepareContinuation`). The scripted model calls the REAL
 * `send_session_message` mailbox tool with `replyMode: 'wait'`, so the Runtime
 * itself saves the message and books the yielded `wait_reply` terminal. The
 * recipient's Run is a second real claim, entered by the same Runtime path and
 * held in flight by §5.1's read stand-in; it answers through the real mailbox
 * owner `respondMessage`. The continuation claim request is then built from the
 * real yielded Run, the real saved message and the real saved response.
 *
 * The only injected state is the store fault: ANY batch read whose keys include
 * a review key fails `unavailable` (a wrapper around the real store). Memory and
 * SQLite through the same shared Host chain.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import { readCanonicalTaskFacts, readGoalPlanWindow } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { GOAL_B, PLAN_B2, T } from '../helpers/S5-decision-fixture.js';
import { openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { openRealRunHarness } from '../helpers/K3-35-continuation-fixture.js';
import { createK3_35Runtime } from '../helpers/K3-35-runtime.js';
import { prepareContinuation } from '../helpers/K3-35-prepare.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { readToolSeam } from '../helpers/K3-tool-seams.js';
import { realOwners } from '../helpers/S5-user-message-support.js';

// §5.1's read stand-in keeps the replying Run genuinely in flight while the real
// mailbox owner answers; it is an injected dependency, never a fact.
const seams = vi.hoisted(() => ({
  readToolSeam: undefined as unknown as typeof import('../helpers/K3-tool-seams.js').readToolSeam,
}));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/read/read-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/read/read-tool.js')>();
  return { ...actual,
    createReadToolDefinition: (workspace: Parameters<typeof actual.createReadToolDefinition>[0]) =>
      seams.readToolSeam.enabled ? seams.readToolSeam.definition() : actual.createReadToolDefinition(workspace) };
});
seams.readToolSeam = readToolSeam;

const TASK = 'k3-20-a';
const REPLY_TASK = 'k3-20-b';

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => {
  readToolSeam.release();
  for (const world of worlds.splice(0)) await world.close();
});

async function open(kind: 'memory' | 'sqlite'): Promise<K3ReviewCardWorld> {
  const world = await openK3ReviewCardWorld(kind);
  worlds.push(world);
  return world;
}

/**
 * The store fault (L7): every readMany naming a review key is `unavailable`;
 * every other read is the real store, and no write is intercepted.
 */
function failReviewReads(world: K3ReviewCardWorld) {
  return {
    ...world.records,
    readMany: async (keys: string[]) => keys.some(key => key.includes('UnknownCallReview'))
      ? { status: 'rejected' as const, code: 'unavailable' as const,
        reason: 'injected unavailable review read failure' }
      : world.records.readMany(keys),
  };
}

/** The real Workspace revision the Runtime's snapshot must agree with. */
async function workspaceRevisionOf(world: K3ReviewCardWorld): Promise<number> {
  const read = await world.records.readMany([JSON.stringify({ aggregateType: 'Workspace',
    projectId: world.fixture.base.scope.projectId, workspaceId: world.fixture.base.scope.workspaceId })]);
  if (read.status !== 'ready') throw new Error(`the Workspace is not readable: ${JSON.stringify(read)}`);
  const record = read.value.records[0];
  if (record === undefined) throw new Error('the Workspace snapshot is missing');
  return (JSON.parse(record.json) as { revision: number }).revision;
}

async function runOf(world: K3ReviewCardWorld, claim: TaskClaim) {
  const read = await createRunStateReader({ records: world.records })
    .readExecution(world.fixture.ctx, claim.runRef);
  if (read.status !== 'ready') throw new Error(`the Run is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

async function runsOf(world: K3ReviewCardWorld) {
  const window = await readGoalPlanWindow(world.records, GOAL_B);
  if (window.status !== 'ready' || window.plan === null) throw new Error('the Goal plan window is not readable');
  const facts = await readCanonicalTaskFacts(world.records, GOAL_B, window.plan, TASK);
  if (facts.status !== 'ready') throw new Error(`the projection must read: ${JSON.stringify(facts)}`);
  return facts.value.runsByTaskId.get(TASK) ?? [];
}

async function continuationRequest(world: K3ReviewCardWorld, claimA: TaskClaim,
  messageRef: SessionMessageRef, responseRef: ArtifactRef) {
  const base = world.fixture.b2.base;
  const goal = await base.plans.queryGoal(world.fixture.ctx, GOAL_B);
  if (goal.status !== 'ready') throw new Error(`the Goal is not readable: ${JSON.stringify(goal)}`);
  const session = await base.sessionsPort.readSession(world.fixture.ctx, claimA.sessionRef);
  if (session.status !== 'ready') throw new Error(`the Session is not readable: ${JSON.stringify(session)}`);
  return {
    input: {
      goalRef: GOAL_B, planRef: PLAN_B2, taskId: TASK, sessionRef: claimA.sessionRef,
      roleBinding: base.roleBinding, budget: base.budget,
      consumedWait: { runRef: claimA.runRef, messageRef, responseRef },
    },
    meta: { requestId: 'k3-47-continuation-refused', expected: [
      { ref: GOAL_B, revision: goal.value.goal.revision },
      { ref: world.fixture.base.workspaceRef, revision: await workspaceRevisionOf(world) },
      { ref: plainSessionRefToAggregate(claimA.sessionRef), revision: session.value.record.revision },
    ] },
  };
}

describe.each(['memory', 'sqlite'] as const)(
  'K3-47 (二) L11: a review-read failure refuses a continuation claim (%s)', (kind) => {
    it('K3-47 (二): a real yield + formal reply followed by an unavailable review read refuses the continuation, with no Run and zero writes', async () => {
      const world = await open(kind);
      const owners = realOwners(world.fixture, world.fixture.duties);
      const harness = await openRealRunHarness(world);
      try {
        const replySession = await world.fixture.createS5Session('k3-47-continuation-reply');
        let seq = 0;
        const eventId = () => `k3-47-continuation-event-${String(++seq)}`;
        const newId = () => `k3-47-continuation-id-${String(++seq)}`;

        // ---- the real yielded Run: public claim + real prepare + Runtime entry --
        const runSession = await world.fixture.createS5Session('k3-47-continuation-run');
        const claimA = await harness.claimRun({ sessionRef: runSession, planRef: PLAN_B2, taskId: TASK,
          requestId: 'k3-47-continuation-claim-a' });
        const yieldTools = ['send_session_message'];
        const yieldModel = createScriptedModel([
          { kind: 'calls', calls: [{ callId: 'k3-47-continuation-send', name: 'send_session_message',
            args: { recipient: replySession, text: 'Which file should this work use?', replyMode: 'wait' } }] },
          { kind: 'text', text: 'the inquiry is durably saved' },
        ]);
        const yieldRuntime = createK3_35Runtime(world, {
          model: yieldModel, tools: yieldTools, writeScope: [], now: () => T, eventId, newId,
          kernelStores: harness.kernelStores, workspaceRevision: () => workspaceRevisionOf(world),
          messages: owners.mailbox,
        });
        const yieldPrepared = await prepareContinuation({ world, records: world.records, task: claimA.task,
          runRef: claimA.runRef, tools: yieldTools, writeScope: [], now: () => T });
        const yielded = await yieldRuntime.runtime.port.startRun(world.fixture.ctx,
          { prepared: yieldPrepared.prepared, consumerId: 'k3-47-continuation-consumer-a',
            requestId: 'k3-47-continuation-start-a' });
        if (yielded.status !== 'ready') throw new Error(`the yielding Run did not settle: ${JSON.stringify(yielded)}`);
        expect(yielded.value.run).toMatchObject({ status: 'ended', outcome: 'yielded',
          continuation: { kind: 'wait_reply' } });
        const continuation = yielded.value.run.continuation;
        if (continuation === undefined) throw new Error('the yielded Run must carry its continuation');
        const messageRef = continuation.messageRef;

        // ---- the real saved reply: a second real Run answers through the owner --
        const replyClaim = await harness.claimRun({ sessionRef: replySession, planRef: PLAN_B2, taskId: REPLY_TASK,
          requestId: 'k3-47-continuation-claim-reply' });
        const replyTools = ['read', 'respond_session_message'];
        const replyModel = createScriptedModel([
          { kind: 'calls', calls: [{ callId: 'k3-47-continuation-reply-read', name: 'read',
            args: { path: 'unused.txt' } }] },
          { kind: 'text', text: 'the formal reply is saved' },
        ]);
        const replyRuntime = createK3_35Runtime(world, {
          model: replyModel, tools: replyTools, writeScope: [], now: () => T, eventId, newId,
          kernelStores: harness.kernelStores, workspaceRevision: () => workspaceRevisionOf(world),
          messages: owners.mailbox,
        });
        readToolSeam.arm();
        const replyPrepared = await prepareContinuation({ world, records: world.records, task: replyClaim.task,
          runRef: replyClaim.runRef, tools: replyTools, writeScope: [], now: () => T });
        const replyStarted = replyRuntime.runtime.port.startRun(world.fixture.ctx,
          { prepared: replyPrepared.prepared, consumerId: 'k3-47-continuation-consumer-reply',
            requestId: 'k3-47-continuation-start-reply' });
        try {
          await readToolSeam.waitForCall();
          // The reply is written by the real mailbox owner from the real second Run.
          const current = await owners.mailbox.readMessage(world.fixture.ctx, messageRef);
          if (current.status !== 'ready') throw new Error(`the saved wait message is not readable: ${JSON.stringify(current)}`);
          const replyRun = await runOf(world, replyClaim);
          const replied = await owners.mailbox.respondMessage({
            ...world.fixture.ctx,
            principal: { kind: 'work_run', runRef: replyClaim.runRef,
              roleBinding: replyRun.run.roleBinding },
            materialReader: { kind: 'run', requester: replyClaim.runRef },
          }, { input: { messageRef, text: 'Use result.txt.' },
            meta: { requestId: 'k3-47-continuation-reply', expected: [{ ref: messageRef, revision: current.value.revision }] } });
          if (replied.status !== 'committed' || replied.value.response === null) {
            throw new Error(`the formal reply was not saved: ${JSON.stringify(replied)}`);
          }
          const responseRef = replied.value.response.bodyRef;
          readToolSeam.release();
          const replyResult = await replyStarted;
          if (replyResult.status !== 'ready') throw new Error(`the reply Run did not settle: ${JSON.stringify(replyResult)}`);

          // ---- the continuation claim over the real yielded Run and saved reply --
          const request = await continuationRequest(world, claimA, messageRef, responseRef);
          const commitsBefore = world.fixture.counts.commits;
          const claim = await world.fixture.b2.base.makeService(failReviewReads(world))
            .claimTask(world.fixture.ctx, request);
          expect(claim).toMatchObject({ status: 'rejected', code: 'unavailable' });
          expect(world.fixture.counts.commits, 'the refused claim commits nothing').toBe(commitsBefore);
          expect((await runsOf(world)).map(run => run.ref.runId)).toEqual([claimA.runRef.runId]);
        } finally {
          readToolSeam.release();
          await replyStarted.catch(() => undefined);
        }
      } finally {
        await harness.closeUnion();
      }
    });
  },
);
