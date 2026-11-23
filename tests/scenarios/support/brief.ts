/**
 * Help code of the A.2 step 6 "brief" scenario group (docs/refactor/STATE-MACHINES-SPEC.md §15.2
 * "第 6 步": C3-brief-idempotency, C3-workspace-changed, C3-not-entered-chain,
 * C3-reply-other-session), on top of the shared harness (../harness.ts) and the help code other
 * groups use too (./common.ts: the Run and brief reads, the operator's requeue, the W-02 crash point
 * `authorizeWithoutBegin`):
 *
 * - Run 1's scripted replies (the notes file it writes through its tools);
 * - Host route helpers: `workflow/consultation`, `sessions/link` + `sessions/archive`;
 * - `wakeLineRound`: the recipient line's own woken round on a line question (P2), on a work root;
 *   `answerLineRound` is the same round on a platform the caller already holds;
 * - readers over the scenario files: the prepared manifest a `prepare` stored (artifacts.sqlite,
 *   content addressed), the Kernel `run.input_accepted` events of SessionMessage inputs;
 * - the workspace: a Git baseline commit;
 * - W-25's `transient` Kernel read: the Kernel store held by the test (`lockKernelStore`).
 *
 * Scripted model replies only; no real model is called.
 */
import { execFile } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ArtifactRef } from '../../../src/contracts/artifact.js';
import type { SessionRef } from '../../../src/app/core-http-types.js';
import type { SessionMessageRef } from '../../../src/contracts/core/session-message.js';
import type { PreparedTaskManifestV1 } from '../../../src/contracts/core/prepared-execution.js';
import type { ReadResult, WriteResult } from '../../../src/contracts/core/results.js';
import type { ContinuationBriefV1 } from '../../../src/contracts/continuation-brief.js';
import type { SessionMessage } from '../../../src/core/work-graph/model/communication-contracts.js';
import type { ScriptedReply } from '../../helpers/B2-runtime-fixture.js';
import {
  AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_QUERY_BUDGET, AG2B_QUERY_ROLE_BINDING, AG2B_RUNTIME_BUDGET, AG2B_SCOPE, graphWrite, plain,
} from '../../helpers/AG2b-collaboration-fixture.js';
import { interventionClosingNoticeRequest } from '../../../src/app/host-notices.js';
import { PLATFORM_NOTICE_ACTOR } from '../../../src/contracts/core/session-message.js';
import { createScriptedModel } from '../../helpers/B2-runtime-fixture.js';
import type { CoreCallContext } from '../../../src/contracts/core/call-context.js';
import type { WorkbenchActor } from '../../../src/app/core-http-types.js';
import { assertInvariants, hostCtx, readSqlite, type HostScenario, type Platform } from '../harness.js';
import { kernelRecordRows, NOTES_FILE, openWorkRoot, stepOf } from './common.js';
import { storeDirOf } from '../../helpers/KLS1B-host-store.js';

const execute = promisify(execFile);

/** Run 1: writes the notes file through `edit`, then answers without the result file, so the static check FAILs. */
export function notesThenText(label: string): ScriptedReply[] {
  return [
    { kind: 'calls', calls: [{ callId: `${label}-notes`, name: 'edit', args: { mode: 'create', path: NOTES_FILE,
      newText: `${label}: Run 1 notes, the result file is still missing\n` } }] },
    { kind: 'text', text: `${label}: Run 1 answers without the result file` }];
}

// ---------------------------------------------------------------------------
// Host routes
// ---------------------------------------------------------------------------

/** `workflow/consultation`: the recipient Session answers `messageRef` through one read-only Query (one query model call). */
export async function consult(h: HostScenario, messageRef: SessionMessageRef): Promise<Record<string, unknown>> {
  return await h.answer('workflow/consultation', plain(AG2B_SCOPE, { schemaVersion: 1, messageRef, goalRef: AG2B_GOAL_REF,
    roleBinding: AG2B_QUERY_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET, budget: AG2B_QUERY_BUDGET,
    consumerId: AG2B_CONSUMER_ID }));
}

/**
 * P2 (p2-frozen.md:133, :141-142; design-frozen.md:210, :262): a line question (`answeredBy: 'line'`) is answered by
 * the recipient line's own woken round, never by a copy, and that round's closing writes the reply. A Host scenario's
 * idle consumption runs on the 60 s default heartbeat (`host.ts:4122-4123`), so this step calls the one Workflow entry
 * that pass calls for the line (`workflow.handleIntervention` with the line's query profile and its stage loop,
 * `host.ts:3313-3325`) on a work root over the scenario files, closed before it returns, then the Host's close-out of
 * an answered round in its order: the one fixed closing notice under the platform notice identity, then the same
 * entry's `associate_answer` that writes the reply slot (`host.ts:3342-3372`). Its own query model answers `answer`
 * (one call); answers the round's result and that model's call count.
 */
export async function wakeLineRound(h: HostScenario, messageRef: SessionMessageRef, answer: string):
  Promise<{ status: string; modelCalls: number }> {
  const queryModel = createScriptedModel([{ kind: 'text', text: answer }]);
  const root = await openWorkRoot(h, createScriptedModel([]), undefined, queryModel);
  try {
    return { status: await answerLineRound(root, hostCtx, messageRef), modelCalls: queryModel.calls() };
  } finally {
    await root.close();
  }
}

/**
 * `wakeLineRound`'s round and close-out on a platform the caller holds (a platform scenario's own root), under the
 * caller's Host context; the round's model is that platform's query model. Answers the round's last status.
 */
export async function answerLineRound(platform: Pick<Platform, 'workflow' | 'messages'>,
  ctx: (actor?: WorkbenchActor) => CoreCallContext, messageRef: SessionMessageRef): Promise<string> {
  const handle = platform.workflow.handleIntervention;
  if (handle === undefined) throw new Error('the platform publishes no handleIntervention');
  const input = { messageRef, roleBinding: AG2B_QUERY_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET,
    budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID };
  let result = await handle.call(platform.workflow, ctx(), input);
  for (let step = 1; step < 8 && result.status === 'progressed'; step += 1) {
    result = await handle.call(platform.workflow, ctx(), input);
  }
  if (result.status === 'answer_ready') {
    const source = await platform.messages.readMessage(ctx(), messageRef);
    if (source.status !== 'ready' || 'kind' in source.value.recipient) throw new Error('the woken line question is not readable');
    // As the Host: a `questions` close-out sends no notice (the cards carry the questions).
    if (result.reason !== 'questions') {
      const notice = await platform.messages.sendMessage(ctx(PLATFORM_NOTICE_ACTOR), interventionClosingNoticeRequest({
        recipient: source.value.recipient, messageRef, reason: result.reason, part: 'message', hasReplySlot: true }));
      if (notice.status !== 'committed') throw new Error(`the closing notice did not commit: ${JSON.stringify(notice)}`);
    }
    const closed = await handle.call(platform.workflow, ctx(), { ...input, completion: 'associate_answer', replySlot: 'both' });
    if (closed.status === 'rejected') throw new Error(`the woken round's reply did not close: ${JSON.stringify(closed)}`);
  }
  return result.status;
}

type SessionCardLike = { record: { ref: SessionRef & { aggregateType: string }; revision: number; lifecycle?: string };
  links: Array<{ ref: { target: unknown; relation: string }; revision: number; until: string | null }> };

/**
 * The operator closes a Session's open work links and archives it (`sessions/link` active:false, then
 * `sessions/archive`), as tests/composition/A2-requeue-platform.test.ts does in process: a requeue whose
 * afterRun Session is archived is claimed in another Session (§12.2 W-21, `chooseSession(hint=null)`).
 * Every one of these owner writes is its own commit, so the §11 invariants are checked after each.
 */
export async function archiveSession(h: HostScenario, sessionRef: SessionRef, label: string): Promise<void> {
  const read = async (): Promise<SessionCardLike> => {
    const card = await h.post<ReadResult<SessionCardLike>>('sessions/read', plain(AG2B_SCOPE, sessionRef));
    if (card.status !== 'ready') throw new Error(`the Session must be readable: ${JSON.stringify(card)}`);
    return card.value;
  };
  for (const [index, link] of (await read()).links.filter(candidate => candidate.until === null).entries()) {
    const card = await read();
    const unlinked = await h.post<WriteResult<unknown>>('sessions/link', graphWrite(AG2B_SCOPE,
      { sessionRef, target: link.ref.target, relation: link.ref.relation, active: false }, `${label}-unlink-${String(index)}`,
      [{ ref: card.record.ref, revision: card.record.revision }, { ref: link.ref, revision: link.revision }]));
    if (unlinked.status !== 'committed') throw new Error(`unlink: ${JSON.stringify(unlinked)}`);
    const step = `${label}: Session link ${String(index)} closed`;
    await assertInvariants(h, step, stepOf(h, 'other', step));
  }
  const card = await read();
  const archived = await h.post<WriteResult<{ lifecycle: string }>>('sessions/archive', graphWrite(AG2B_SCOPE,
    { sessionRef, reason: 'retire the Session before the requeue' }, `${label}-archive`,
    [{ ref: card.record.ref, revision: card.record.revision }]));
  if (archived.status !== 'committed') throw new Error(`archive: ${JSON.stringify(archived)}`);
  const step = `${label}: Session archived`;
  await assertInvariants(h, step, stepOf(h, 'other', step));
}

// ---------------------------------------------------------------------------
// Scenario files: artifacts and Kernel records
// ---------------------------------------------------------------------------

/** The stored artifact bodies (artifacts.sqlite rows; content addressed, so a replayed put adds none). */
export function artifactCount(database: string): number {
  return readSqlite(join(storeDirOf(database), 'artifacts.sqlite'),
    db => Number((db.prepare('SELECT COUNT(*) AS n FROM artifacts').get() as { n: number }).n), 0);
}

/** The prepared manifest a `prepare` stored, by its digest (`inputBinding.manifestDigest`). */
export function manifestOf(database: string, digest: string): PreparedTaskManifestV1 {
  const rows = readSqlite(join(storeDirOf(database), 'artifacts.sqlite'), db => db.prepare('SELECT record FROM artifacts WHERE key LIKE ?')
    .all(`%|${digest}|%`) as Array<{ record: string }>, []);
  if (rows.length !== 1) throw new Error(`exactly one stored body must have digest ${digest}: ${String(rows.length)}`);
  return JSON.parse((JSON.parse(rows[0]!.record) as { body: string }).body) as PreparedTaskManifestV1;
}

/**
 * K3 9(b): the prepared manifest Artifact read through the public
 * `materials/open` route (never SQLite). `executions/brief` cannot answer before
 * a Run's `begin` binds `inputBinding.continuationBriefDigest`
 * (`src/core/agent-runtime/runtime.ts:467`; the binding is written at
 * `src/core/work-graph/state/run-machine.ts:838-842`), so at the stop-before-
 * `start` step the prepared-manifest Artifact is the public read.
 */
export async function preparedManifestOf(h: HostScenario, bundleRef: ArtifactRef): Promise<PreparedTaskManifestV1> {
  const read = await h.post<ReadResult<{ body: string }>>('materials/open',
    plain(AG2B_SCOPE, { ref: bundleRef, usage: 'historical_explanation' }));
  if (read.status !== 'ready') throw new Error(`the prepared manifest must be openable: ${JSON.stringify(read)}`);
  return JSON.parse(read.value.body) as PreparedTaskManifestV1;
}

/** K3 9(b): the continuation brief the prepared manifest carries, read through the public route. */
export async function preparedBriefOf(h: HostScenario, bundleRef: ArtifactRef): Promise<ContinuationBriefV1> {
  const manifest = await preparedManifestOf(h, bundleRef);
  const brief = manifest.continuationBrief;
  if (brief === undefined) throw new Error('the prepared manifest must carry the continuation brief');
  return brief;
}

/** K3 9(b): the messages SENT BY one Session, through the public `messages/outbox` route. */
export async function outboxMessages(h: HostScenario, senderSession: SessionRef): Promise<SessionMessage[]> {
  const read = await h.post<ReadResult<{ items: SessionMessage[] }>>('messages/outbox',
    plain(AG2B_SCOPE, { senderSession, page: { limit: 100 } }));
  if (read.status !== 'ready') throw new Error(`the outbox must be readable: ${JSON.stringify(read)}`);
  return read.value.items;
}

/** Every Kernel `run.input_accepted` whose source is a SessionMessage part (the unified input channel). */
export function acceptedMessageInputs(database: string): Array<{ runId: string; messageId: string; part: string; text: string }> {
  return kernelRecordRows(database).flatMap((row) => {
    if (row.recordType !== 'agent.event') return [];
    const event = (JSON.parse(row.json) as { payload: { event?: { type: string; meta: { runId: string };
      payload: { input?: { text: string; sourceRef?: { kind?: string; messageRef?: { messageId: string }; part?: string } } } } } })
      .payload.event;
    const input = event?.payload.input;
    if (event?.type !== 'run.input_accepted' || input?.sourceRef?.kind !== 'SessionMessage') return [];
    return [{ runId: event.meta.runId, messageId: input.sourceRef.messageRef?.messageId ?? '', part: input.sourceRef.part ?? '',
      text: input.text }];
  });
}

/** How often `needle` occurs in `text`. */
export function occurrences(text: string, needle: string): number {
  return needle.length === 0 ? 0 : text.split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// Workspace and Kernel store
// ---------------------------------------------------------------------------

const GIT_IDENTITY = ['-c', 'user.name=C3 scenario', '-c', 'user.email=c3-scenario@example.invalid'];

/** Makes the workspace a Git repository with one baseline commit of what is there now; answers its HEAD. */
export async function gitBaseline(root: string): Promise<string> {
  await execute('git', ['-C', root, 'init', '-q'], { windowsHide: true });
  await execute('git', ['-C', root, 'add', '-A'], { windowsHide: true });
  await execute('git', ['-C', root, ...GIT_IDENTITY, 'commit', '-q', '-m', 'C3 baseline'], { windowsHide: true });
  return (await execute('git', ['-C', root, 'rev-parse', 'HEAD'], { windowsHide: true })).stdout.trim();
}

/**
 * W-25's `transient` probe (§12.2, SD-2) without a seam: the test's own connection holds the Kernel store's exclusive
 * lock (`locking_mode = EXCLUSIVE` and an open `BEGIN EXCLUSIVE`), as another process holding the file would, so every
 * Kernel read of the Host fails with `database is locked` (a probe proves nothing: H-03; a brief read is not possible
 * now). Nothing is written. While it is held, read the scenario's ledger only (`counts()` reads the Kernel store too).
 * `release()` rolls back and closes the connection.
 */
export function lockKernelStore(database: string): { release(): void } {
  const kernel = new DatabaseSync(join(database, 'kernel.sqlite'));
  kernel.exec('PRAGMA locking_mode = EXCLUSIVE');
  kernel.exec('BEGIN EXCLUSIVE');
  return { release() {
    if (kernel.isTransaction) kernel.exec('ROLLBACK');
    kernel.close();
  } };
}
