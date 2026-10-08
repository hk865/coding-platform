/** Slice 1 §2.6–2.7, §5.4: real Runtime histories, archive facts and saved inputs. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { PreparedTaskExecution, PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { ArchiveStepRefV1 } from '../../src/contracts/core/session-archive.js';
import type { ArchiveRequeueOriginV1, SessionAnomalyAnchorV1 } from '../../src/contracts/session-anomaly.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import { continuationBriefDigest, continuationBriefMarker, renderContinuationBriefZh } from '../../src/contracts/continuation-brief.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import { createArchiveChangedFilesReader } from '../../src/core/agent-runtime/session-anomaly-facts.js';
import { loadPreparedManifest } from '../../src/core/agent-runtime/execution-preparation.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createSessionHistoryCursorOwner } from '../../src/core/agent-runtime/session-operations.js';
import { reconcileRunAtStartup } from '../../src/core/agent-runtime/run-reconcile.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import { committed, installS1DateClock, ledgerCounts, openS1RuntimeFixture, ready, S1_T0 as t0 } from '../helpers/S1-runtime-scenario-fixture.js';

const WARNING = '工作区里还没提交的改动，可能混有别的执行的改动，不一定是这次执行改的';
const LAST_SENTENCE = '这些改动在工作区里，没撤销，也没核对；先看清它们再接着做。';
const key = (value: object) => canonicalJson(value as JsonValue);
type Fixture = Awaited<ReturnType<typeof openS1RuntimeFixture>>;
const opened: Fixture[] = [];
let restoreClock: (() => void) | undefined;
beforeEach(() => { restoreClock = installS1DateClock(); });
afterEach(async () => {
  try { for (const f of opened.splice(0)) await f.close(); } finally { restoreClock?.(); }
});
async function open(options: Parameters<typeof openS1RuntimeFixture>[0] = {}) {
  const f = await openS1RuntimeFixture(options);
  opened.push(f);
  return f;
}
async function missingKernelReader(f: Fixture) {
  // The adapter is registered and readable, but its store has no source Session.
  // This is Kernel missing, not an unregistered-adapter/Host configuration error.
  return createArchiveChangedFilesReader({ ...f.deps, kernelStores: await createKernelStoreRegistry({ entries: [{
    adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store', workspace: f.base.scope,
    databasePath: join(f.base.directory, 'missing-kernel.sqlite'),
  }] }) });
}

async function briefRow(count: number) {
  const f = await open({ replies: Array.from({ length: count }, () => ({ kind: 'text' as const, text: 'unreturned answer' })),
    beforeReply: async () => { throw new Error('S1 scripted provider failure'); } });
  const target = { kind: 'task' as const, ref: { projectId: f.base.scope.projectId, goalId: f.base.goalRef.goalId,
    taskId: f.base.tasks.first.taskId } };
  await f.linkResponsible(f.base.sessions.first, target);
  let current = await f.claim();
  const stopped: TaskClaim[] = [];
  // No anchors yet: earlier preparations cannot pick any up. Each execution
  // uses a distinct Session and its own real failed Kernel Turn.
  for (let i = 0; i < count; i++) {
    await f.run(current);
    expect((await f.read(current)).run).toMatchObject({ status: 'ended', outcome: 'crashed' });
    stopped.push(current);
    expect(await f.health.recordSessionHealth(f.base.ctx, { sessionRef: current.sessionRef,
      probe: { verdict: 'missing', activeRunId: null } })).toMatchObject({ status: 'observed', session: { health: 'unavailable' } });
    if (i + 1 < count) {
      const next = await f.requeue(current);
      const successorSession = await f.createSession();
      await f.linkResponsible(successorSession, target);
      current = await f.claim(successorSession, current.task.taskId, next.ref);
    }
  }
  const anchors: SessionAnomalyAnchorV1[] = [];
  let origin: ArchiveRequeueOriginV1 | undefined;
  for (const claim of stopped) {
    const session = committed(await f.lifecycle.requestSessionArchive(f.base.ctx, { input: {
      sessionRef: claim.sessionRef, reason: 'archive this retired stopped execution', tasks: [{ target, disposition: { kind: 'drop' } }], wait: null },
      meta: { requestId: f.newId(), expected: [await f.base.sessionPin(claim.sessionRef)] } }));
    const request = session.archiveRequest;
    if (!request) throw new Error('the real archive request is missing');
    const step = (kind: ArchiveStepRefV1['step'], subject: object): ArchiveStepRefV1 => ({ sessionRef: claim.sessionRef,
      archiveRequestId: request.requestId, requestReceipt: request.receipt, step: kind, subjectKey: key(subject) });
    f.setFiles([`changed-${anchors.length}`]);
    const files = ready(await (await missingKernelReader(f)).readArchiveChangedFiles(f.base.ctx, { runRef: claim.runRef }));
    expect(files.source).toBe('worktree');
    expect(files.reason).toContain(WARNING);
    const anchor = committed(await f.anomalies.recordSessionAnomaly(f.base.ctx, { step: step('anchor', claim.runRef), files }));
    anchors.push(anchor);
    const disposed = committed(await f.responsibilities.disposeArchiveResponsibility(f.base.ctx, step('responsibility', target)));
    expect(disposed.opened).toBeNull();
    expect(disposed.closed.until).not.toBeNull();
    expect(committed(await f.lifecycle.finishSessionArchive(f.base.ctx, step('archive', claim.sessionRef))))
      .toMatchObject({ lifecycle: 'archived', archiveRequest: null, occupancy: null });
    if (claim.runRef.runId === current.runRef.runId) origin = { kind: 'execution', anchorRef: anchor.ref,
      archiveSessionRef: claim.sessionRef, archiveRequestId: request.requestId };
  }
  const next = await f.requeue(current, origin);
  const successor = await f.claim(await f.createSession(), current.task.taskId, next.ref);
  expect(stopped.map(claim => claim.sessionRef.sessionId)).not.toContain(successor.sessionRef.sessionId);
  f.captures.length = 0; // Count preparation captures after all setup captures.
  const prepared = await f.prepare(successor);
  committed(await f.entry.authorizeRuntimeEntry(f.base.ctx, { input: { prepared, consumerId: 's1-runtime' },
    meta: { requestId: f.newId(), expected: [await f.pin(successor)] } }));
  anchors.sort((a, b) => a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : key(a.ref) < key(b.ref) ? -1 : 1);
  return { f, prepared, successor, anchors };
}

describe('S1 archive changed files and brief anomaly section', () => {
  it('IT01 confirmed edit a and an unobserved edit b produce kernel/partial', async () => {
    const f = await open({ replies: [
      { kind: 'calls', calls: [{ callId: 's1-edit-a', name: 'edit', args: { mode: 'create', path: 'a', newText: 'a\n' } }] },
      { kind: 'calls', calls: [{ callId: 's1-edit-b', name: 'edit', args: { mode: 'create', path: 'b', newText: 'changed b\n' } }] },
    ] });
    const claim = await f.claim();
    // Fail the durable Kernel sink after b has STARTED. A known edit rejection
    // is not an unknown effect. Keep the genuine prefix, including a's result.
    const db = new DatabaseSync(join(f.base.directory, 'kernel.sqlite'));
    db.exec(`CREATE TRIGGER s1_lost_result BEFORE INSERT ON session_records
      WHEN EXISTS (SELECT 1 FROM session_records WHERE json_extract(record_json, '$.payload.event.type') = 'tool.started'
        AND json_extract(record_json, '$.payload.event.payload.call.callId') = 's1-edit-b')
      BEGIN SELECT RAISE(ABORT, 'S1 lost tool result'); END;`);
    db.close();
    try { await f.run(claim); }
    finally {
      const drop = new DatabaseSync(join(f.base.directory, 'kernel.sqlite'));
      try { drop.exec('DROP TRIGGER s1_lost_result'); } finally { drop.close(); }
    }
    const history = new DatabaseSync(join(f.base.directory, 'kernel.sqlite'), { readOnly: true });
    try {
      const toolEvents = history.prepare(`SELECT json_extract(record_json, '$.payload.event.type') AS type,
        COALESCE(json_extract(record_json, '$.payload.event.payload.call.callId'),
          json_extract(record_json, '$.payload.event.payload.callId')) AS callId,
        json_extract(record_json, '$.payload.event.payload.result.status') AS status
        FROM session_records WHERE json_extract(record_json, '$.payload.event.type') LIKE 'tool.%' ORDER BY position`)
        .all() as Array<{ type: string; callId: string; status: string | null }>;
      expect(toolEvents).toEqual([
        { type: 'tool.started', callId: 's1-edit-a', status: null },
        { type: 'tool.completed', callId: 's1-edit-a', status: 'success' },
        { type: 'tool.started', callId: 's1-edit-b', status: null },
      ]);
    } finally { history.close(); }
    expect(await readFile(join(f.base.directory, 'a'), 'utf8')).toBe('a\n');
    expect(await readFile(join(f.base.directory, 'b'), 'utf8')).toBe('changed b\n');
    const owner = createSessionHistoryCursorOwner({ kernelStores: f.deps.kernelStores });
    const record = await f.read(claim);
    const reconcile = createRunReconcileService({ records: f.records, reads: f.reads,
      hostInstance: { hostInstanceId: 's1-after-crash', lease: 'owned' }, now: () => t0, eventId: f.newId });
    const report = await reconcileRunAtStartup({ owner, controls: f.controls, entry: f.entry, reconcile,
      now: () => t0, newId: f.newId }, f.base.ctx, { record, hostInstanceId: 's1-after-crash',
      probe: await owner.probe({ session: record.session, signal: f.base.ctx.signal }) });
    expect(report.status).toBe('reconciled');
    expect((await f.read(claim)).run.outcome).toBe('outcome_unknown');
    const value = ready(await createArchiveChangedFilesReader(f.deps).readArchiveChangedFiles(f.base.ctx, { runRef: claim.runRef }));
    expect({ source: value.source, confirmed: value.confirmed, possible: value.possible, status: value.status })
      .toEqual({ source: 'kernel', confirmed: ['a'], possible: ['b'], status: 'partial' });
    expect(f.captures).toEqual([]);
  });

  it('IT02 missing Kernel falls back to current HEAD a/b with a mixed-ownership warning', async () => {
    const f = await open();
    const claim = await f.claim();
    await f.run(claim);
    await writeFile(join(f.base.directory, 'a'), 'uncommitted a\n');
    await writeFile(join(f.base.directory, 'b'), 'uncommitted b\n');
    f.setFiles(['a', 'b']);
    const value = ready(await (await missingKernelReader(f)).readArchiveChangedFiles(f.base.ctx, { runRef: claim.runRef }));
    expect({ source: value.source, confirmed: value.confirmed, possible: value.possible, runBaselineKnown: value.runBaselineKnown })
      .toEqual({ source: 'worktree', confirmed: [], possible: ['a', 'b'], runBaselineKnown: false });
    expect(value.reason).toContain(WARNING);
    expect(f.captures).toEqual([f.base.directory]);
  });

  it('IT32 formally not-entered Run ignores other worktree changes without capture', async () => {
    const f = await open({ replies: [
      { kind: 'calls', calls: [{ callId: 'other-work-a', name: 'edit', args: { mode: 'create', path: 'a', newText: 'other work\n' } }] },
      { kind: 'text', text: 'other work done' },
    ] });
    const other = await f.claim(f.base.sessions.second, f.base.tasks.second.taskId);
    await f.run(other);
    expect((await f.read(other)).run.outcome).toBe('completed');
    expect(await readFile(join(f.base.directory, 'a'), 'utf8')).toBe('other work\n');
    const claim = await f.claim();
    f.setFiles(['a']);
    committed(await f.controls.submitControl(f.base.ctx, { input: { runRef: claim.runRef, kind: 'cancel', reason: 'cancel before entry' },
      meta: { requestId: f.newId(), expected: [await f.pin(claim)] } }));
    expect((await f.read(claim)).run).toMatchObject({ status: 'ended', outcome: 'cancelled', startedAt: null });
    const value = ready(await createArchiveChangedFilesReader(f.deps).readArchiveChangedFiles(f.base.ctx, { runRef: claim.runRef }));
    expect({ source: value.source, status: value.status, confirmed: value.confirmed, possible: value.possible,
      omitted: value.omitted, runBaselineKnown: value.runBaselineKnown })
      .toEqual({ source: 'kernel', status: 'not_entered', confirmed: [], possible: [], omitted: 0, runBaselineKnown: false });
    expect(f.captures).toEqual([]);
  });

  it('IT03 repeated prepare keeps r0 anchor refs and the saved digest with one capture', async () => {
    const { f, prepared, successor, anchors } = await briefRow(1);
    const original = ready(await loadPreparedManifest(f.bodies, prepared)).manifest;
    expect(original.continuationBrief?.anomalies?.anchors.map(anchor => anchor.ref)).toEqual([anchors[0]!.ref]);
    expect(prepared.inputBinding.anomalyAnchorRefs).toEqual([anchors[0]!.ref]);
    expect(prepared.inputBinding.continuationBriefDigest).toBe(continuationBriefDigest(original.continuationBrief!));
    expect(f.captures).toEqual([f.base.directory]);
    const counts = { ledger: ledgerCounts(f.base.directory), models: f.scripted.calls() };
    const repeated = await f.prepare(successor);
    expect({ ledger: ledgerCounts(f.base.directory), models: f.scripted.calls() }).toEqual(counts);
    expect(repeated).toEqual(prepared);
    expect(ready(await loadPreparedManifest(f.bodies, repeated)).manifest).toEqual(original);
    expect(f.captures).toEqual([f.base.directory]);
  });

  it('IT04 loading a frozen old manifest keeps the exact marker, digest and text with no new section', async () => {
    const bodies = new RawArtifactBodyStore();
    const manifest = JSON.parse(OLD_MANIFEST_JSON) as PreparedTaskManifestV1;
    const stored = await bodies.put({ body: OLD_MANIFEST_JSON, contentType: 'application/vnd.coding-platform.task-execution-manifest+json;version=1',
      sourceRefs: [{ kind: 'workspace', refId: 'w', revision: '1' }], origin: { kind: 'run', owner: manifest.claim.runRef }, requestedAt: t0 });
    if (stored.status !== 'ready') throw new Error(`old manifest: ${JSON.stringify(stored)}`);
    const prepared: PreparedTaskExecution = { kind: 'task', claim: manifest.claim,
      envelope: { schemaVersion: 1, envelopeId: 'old-envelope', projectId: 'p', workspaceId: 'w', goalId: 'g', taskId: 'A',
        runRef: manifest.claim.runRef, attemptRef: manifest.claim.attemptRef, planRef: manifest.claim.planRef,
        roleBinding: manifest.roleBinding, workspaceSnapshot: manifest.workspaceSnapshot, permissions: manifest.permissions,
        budget: manifest.budget, sourceRefs: [], bundleRef: stored.value.ref },
      inputBinding: { schemaVersion: 1, inputDigest: manifest.inputDigest, manifestDigest: stored.value.ref.digest,
        materialAccessRefs: [], deliveryRefs: [], continuationBriefDigest: OLD_DIGEST } };
    const loaded = ready(await loadPreparedManifest(bodies, prepared)).manifest;
    expect(loaded.input).toBe(OLD_INPUT);
    expect(loaded.continuationBrief?.anomalies).toBeUndefined();
    expect(continuationBriefDigest(loaded.continuationBrief!)).toBe(OLD_DIGEST);
    expect(continuationBriefMarker(OLD_DIGEST)).toBe(OLD_MARKER);
    expect(renderContinuationBriefZh(loaded.continuationBrief!, OLD_DIGEST)).toBe(OLD_TEXT);
    expect(loaded.inputDigest).toBe(sha256Hex(OLD_INPUT));
    const bytes = await bodies.read(stored.value.ref);
    if (bytes.status !== 'ready') throw new Error('the frozen manifest disappeared');
    expect(bytes.value.body).toBe(OLD_MANIFEST_JSON);
    expect(OLD_MANIFEST_JSON).not.toContain('anomalies');
  });

  it('IT05 nine distinct stopped Runs assemble the earliest eight anchors and leave the ninth unpicked', async () => {
    const { f, prepared, successor, anchors } = await briefRow(9);
    expect(new Set(anchors.map(anchor => key(anchor.runRef))).size).toBe(9);
    const brief = ready(await loadPreparedManifest(f.bodies, prepared)).manifest.continuationBrief!;
    expect(brief.anomalies).toEqual({ anchors: anchors.slice(0, 8), omitted: 1, instructionVersion: 1 });
    expect(prepared.inputBinding.anomalyAnchorRefs).toEqual(anchors.slice(0, 8).map(anchor => anchor.ref));
    await f.run(successor); // Actual entry picks only the eight bound refs.
    const views = ready(await f.anomalies.listSessionAnomalies(f.base.ctx, { goalRef: f.base.goalRef, page: { limit: 100 } }));
    expect(views.items.filter(view => anchors.slice(0, 8).some(anchor => key(anchor.ref) === key(view.anchor.ref)))
      .map(view => view.pickedUpBy)).toEqual(Array.from({ length: 8 }, () => successor.runRef));
    expect(views.items.filter(view => key(view.anchor.ref) === key(anchors[8]!.ref)))
      .toEqual([{ anchor: anchors[8], pickedUpBy: null }]);
    const text = renderContinuationBriefZh(brief, continuationBriefDigest(brief));
    expect(text).toContain(WARNING);
    expect(text).toContain(LAST_SENTENCE);
  }, 120_000);
});

// Frozen pre-S1 encodings: no current encoder/renderer constructs the oracle.
const OLD_DIGEST = "b0f9f0fc3a288e284475470606a59710b732b65bff1c61f7cfd669ba54976797";
const OLD_MARKER = "[continuation-brief v1 sha256:b0f9f0fc3a288e284475470606a59710b732b65bff1c61f7cfd669ba54976797]";
const OLD_TEXT = "## 接续说明\n[continuation-brief v1 sha256:b0f9f0fc3a288e284475470606a59710b732b65bff1c61f7cfd669ba54976797]\n这是任务 A 的接续执行（返工）：第 1 次重新入队，失败类别：执行失败，发起方：人工。\n接续方式：在新的 Session D 中继续，没有上一次的对话历史。\n\n### 上一次执行\n- 执行 r0（Session S）依据执行记录以 crashed 结束。\n\n### 停在哪里\n- 执行记录无法读取，停在哪里无法确定。\n\n### 工具调用\n- 执行记录无法读取，工具调用无法确定。\n\n### 重新入队\n- 原因（人工）：old retry\n- 没有新输入。\n\n### 工作区\n- 上一次执行经工具改动的文件：无法确定。\n- 上一次执行结束（时间未知）到本次执行开始之间：无法从持久记录确定是否有改动。\n- 未提交的改动无法读取。\n\n### 继续之前\n- 文件可能已经变化，编辑前先重新读取。\n- “结果未知”的工具调用可能已经产生副作用，重做之前先核实当前状态。\n- “没有执行”的工具调用没有产生结果，需要时重新发起。\n- 本说明只陈述持久记录中的事实；写明“无法确定”的地方不代表没有变化。";
const OLD_INPUT = "OLD INPUT\n\n## 接续说明\n[continuation-brief v1 sha256:b0f9f0fc3a288e284475470606a59710b732b65bff1c61f7cfd669ba54976797]\n这是任务 A 的接续执行（返工）：第 1 次重新入队，失败类别：执行失败，发起方：人工。\n接续方式：在新的 Session D 中继续，没有上一次的对话历史。\n\n### 上一次执行\n- 执行 r0（Session S）依据执行记录以 crashed 结束。\n\n### 停在哪里\n- 执行记录无法读取，停在哪里无法确定。\n\n### 工具调用\n- 执行记录无法读取，工具调用无法确定。\n\n### 重新入队\n- 原因（人工）：old retry\n- 没有新输入。\n\n### 工作区\n- 上一次执行经工具改动的文件：无法确定。\n- 上一次执行结束（时间未知）到本次执行开始之间：无法从持久记录确定是否有改动。\n- 未提交的改动无法读取。\n\n### 继续之前\n- 文件可能已经变化，编辑前先重新读取。\n- “结果未知”的工具调用可能已经产生副作用，重做之前先核实当前状态。\n- “没有执行”的工具调用没有产生结果，需要时重新发起。\n- 本说明只陈述持久记录中的事实；写明“无法确定”的地方不代表没有变化。";
const OLD_MANIFEST_JSON = "{\"schemaVersion\":1,\"kind\":\"task_execution\",\"claim\":{\"task\":{\"projectId\":\"p\",\"goalId\":\"g\",\"taskId\":\"A\"},\"planRef\":{\"aggregateType\":\"PlanRevision\",\"projectId\":\"p\",\"planId\":\"plan\"},\"workspaceId\":\"w\",\"sessionRef\":{\"projectId\":\"p\",\"sessionId\":\"D\"},\"sessionRevision\":2,\"generation\":2,\"runRef\":{\"aggregateType\":\"Run\",\"projectId\":\"p\",\"goalId\":\"g\",\"runId\":\"r1\"},\"attemptRef\":{\"aggregateType\":\"TaskAttempt\",\"projectId\":\"p\",\"goalId\":\"g\",\"taskId\":\"A\",\"attemptId\":\"a1\"},\"outboxRef\":{\"aggregateType\":\"DispatchOutboxEntry\",\"projectId\":\"p\",\"goalId\":\"g\",\"taskId\":\"A\",\"attemptId\":\"a1\"},\"claimedAt\":\"2026-10-08T00:00:00.000Z\"},\"role\":{\"status\":\"absent\",\"roleId\":\"builder\",\"reason\":\"old legacy binding\"},\"hostTemplate\":{\"templateId\":\"builder\",\"revision\":\"1\",\"digest\":\"e7a141b085ae7286ec1c757580704ae9c2d4348df66f33d23d296ef66ab7ab8a\"},\"roleBinding\":{\"schemaVersion\":1,\"bindingId\":\"old-builder\",\"templateId\":\"builder\",\"templateRevision\":\"1\",\"bindingVersion\":1,\"policyRevision\":\"legacy-template\"},\"hostConfigurationRevision\":\"old-host@1\",\"sessionRole\":{\"kind\":\"legacy_template\",\"templateId\":\"builder\",\"templateRevision\":\"1\"},\"workspaceSnapshot\":{\"workspaceId\":\"w\",\"revision\":1},\"permissions\":{\"policyRevision\":\"legacy-template\",\"tools\":[\"read\"],\"writeScope\":[]},\"budget\":{\"tokenBudget\":100000,\"deadline\":null},\"selectedTaskInputs\":[],\"materialBasis\":null,\"materialAccessRefs\":[],\"additionalMaterialRefs\":[],\"deliveryRefs\":[],\"sourceRefs\":[],\"continuationBrief\":{\"schemaVersion\":1,\"runRef\":{\"aggregateType\":\"Run\",\"projectId\":\"p\",\"goalId\":\"g\",\"runId\":\"r1\"},\"task\":{\"projectId\":\"p\",\"goalId\":\"g\",\"taskId\":\"A\"},\"requeueRef\":{\"aggregateType\":\"TaskRequeue\",\"projectId\":\"p\",\"goalId\":\"g\",\"taskId\":\"A\",\"afterRunId\":\"r0\"},\"mode\":\"rework\",\"failureClass\":\"run_failed\",\"trigger\":{\"actorClass\":\"human\",\"goalResume\":false,\"requeueNumber\":1,\"autoRework\":null,\"earlierRequeues\":[]},\"previous\":{\"runRef\":{\"aggregateType\":\"Run\",\"projectId\":\"p\",\"goalId\":\"g\",\"runId\":\"r0\"},\"attemptRef\":{\"aggregateType\":\"TaskAttempt\",\"projectId\":\"p\",\"goalId\":\"g\",\"taskId\":\"A\",\"attemptId\":\"a0\"},\"sessionRef\":{\"projectId\":\"p\",\"sessionId\":\"S\"},\"outcome\":\"crashed\",\"origin\":\"observed\",\"interruption\":null,\"cancelledBy\":null,\"error\":null,\"limit\":null,\"budget\":null,\"wait\":null,\"unacceptedSteers\":[],\"endedAt\":null},\"factsFrom\":{\"runRef\":{\"aggregateType\":\"Run\",\"projectId\":\"p\",\"goalId\":\"g\",\"runId\":\"r0\"},\"hops\":0,\"truncated\":false},\"stoppedAt\":{\"kernel\":\"unavailable\",\"reason\":null,\"turnStatus\":null,\"lastPosition\":null,\"lastToolGroup\":null,\"lastAssistant\":null,\"window\":null},\"toolCalls\":{\"confirmed\":[],\"notExecuted\":[],\"unknown\":[],\"confirmedOmitted\":0,\"notExecutedOmitted\":0,\"unknownOmitted\":0},\"acceptedInputs\":{\"steers\":[],\"steersOmitted\":0,\"messages\":[],\"messagesOmitted\":0},\"checks\":null,\"requeue\":{\"reason\":{\"text\":\"old retry\",\"truncated\":false},\"reasonAuthor\":\"human\",\"newInputs\":[]},\"workspace\":{\"selfChanged\":{\"status\":\"unavailable\",\"confirmed\":[],\"possible\":[],\"omitted\":0},\"checkpoints\":[],\"segments\":[],\"unobserved\":{\"from\":\"previous_run_end\",\"to\":null,\"previousEndedAt\":null},\"uncommitted\":{\"status\":\"unavailable\",\"baseCommit\":null,\"paths\":[],\"omitted\":0,\"reason\":null}},\"session\":{\"continuity\":\"other_session\",\"sessionRef\":{\"projectId\":\"p\",\"sessionId\":\"D\"},\"seededFrom\":null,\"boundaryPosition\":null},\"standingInstructionVersion\":1},\"input\":\"OLD INPUT\\n\\n## 接续说明\\n[continuation-brief v1 sha256:b0f9f0fc3a288e284475470606a59710b732b65bff1c61f7cfd669ba54976797]\\n这是任务 A 的接续执行（返工）：第 1 次重新入队，失败类别：执行失败，发起方：人工。\\n接续方式：在新的 Session D 中继续，没有上一次的对话历史。\\n\\n### 上一次执行\\n- 执行 r0（Session S）依据执行记录以 crashed 结束。\\n\\n### 停在哪里\\n- 执行记录无法读取，停在哪里无法确定。\\n\\n### 工具调用\\n- 执行记录无法读取，工具调用无法确定。\\n\\n### 重新入队\\n- 原因（人工）：old retry\\n- 没有新输入。\\n\\n### 工作区\\n- 上一次执行经工具改动的文件：无法确定。\\n- 上一次执行结束（时间未知）到本次执行开始之间：无法从持久记录确定是否有改动。\\n- 未提交的改动无法读取。\\n\\n### 继续之前\\n- 文件可能已经变化，编辑前先重新读取。\\n- “结果未知”的工具调用可能已经产生副作用，重做之前先核实当前状态。\\n- “没有执行”的工具调用没有产生结果，需要时重新发起。\\n- 本说明只陈述持久记录中的事实；写明“无法确定”的地方不代表没有变化。\",\"inputDigest\":\"871a3cf6c8e9a92404aec18a5ac3620b7aa94e5566e8a055f64341e7654c65fc\"}";
