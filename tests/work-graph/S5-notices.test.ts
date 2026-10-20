/** SPEC §5.3 NR01–NR07. Real store, notice reader, display token and settings owner. */
import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { NoticeCategoryV1, NoticePositionV1 } from '../../src/contracts/goal-decisions.js';
import type { TaskAutomationPolicyV1 } from '../../src/contracts/task-requeue.js';
import { createHostSettings, type HostSettingsAssembly } from '../../src/app/host-settings.js';
import type { BootstrapResponse } from '../../src/app/core-http-types.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { EncodedRecord } from '../../src/core/record-store/ports.js';
import type { DecisionNoticeSourcePort, NoticeItemV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { DecisionReadRecordsPort } from '../../src/core/work-graph/views/goal-conflicts.js';
import type { RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { createDecisionSettingsService } from '../../src/core/work-graph/configuration/decision-settings-service.js';
import { createDecisionReadModel } from '../../src/core/work-graph/views/decision-read-model.js';
import { createGoalConflictAssembler } from '../../src/core/work-graph/views/goal-conflicts.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { createGoalExecutedFilesReader } from '../../src/core/work-graph/tasks/goal-executed-files-reader.js';
import { createAutomaticReworkNoticeSource } from '../../src/core/work-graph/views/automatic-rework-notices.js';
import { createNoticeDisplayToken } from '../../src/core/work-graph/views/notice-display-token.js';
import { createNoticePositionComparator } from '../../src/core/work-graph/views/notice-position.js';
import { decodeNoticeOrigin } from '../../src/core/work-graph/persistence/decision-record-codecs.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { decodeSessionMessageRecord } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { GOAL_B, OPERATOR, WORKSPACE, WORKSPACE_SCOPE, openS5DecisionFixture,
  type S5DecisionFixture, type S5FixtureKind } from '../helpers/S5-decision-fixture.js';
import { automationContext, committed, key, mailboxDependencies, modelRequestCounts, noticeWork, pin, ready,
  storedRecord, workContext, workspaceSnapshot } from '../helpers/S5-queue-support.js';

const fixtures: S5DecisionFixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
const open = async (kind: S5FixtureKind) => { const f = await openS5DecisionFixture(kind); fixtures.push(f); return f; };
const pos = (n: number, itemKey: string): NoticePositionV1 => ({ kind: 'commit', cursor: makeCommitCursor(n), itemKey });
const item = (category: NoticeCategoryV1, itemKey: string, n: number): NoticeItemV1 =>
  ({ itemKey, category, goalRef: GOAL_B, position: pos(n, itemKey), summary: itemKey, objects: [], rework: null });

/** Narrow upstream category pages for the pagination rows; the merger/token/
 * markSeen code under test is always the production implementation. */
async function sourcePage(f: S5DecisionFixture, items: readonly NoticeItemV1[], input: Parameters<DecisionNoticeSourcePort['readPage']>[1]) {
  const positions = createNoticePositionComparator();
  const remaining = items.filter(item => input.after === undefined || positions.compare(item.position, input.after) > 0);
  const offset = input.page.cursor === undefined ? 0 : Number(input.page.cursor);
  const end = Math.min(remaining.length, offset + input.page.limit);
  return { status: 'ready' as const, value: { availability: 'available' as const, items: remaining.slice(offset, end),
    nextCursor: end < remaining.length ? String(end) : null, sourceCursor: ready(await f.records.readMany([])).readThrough } };
}
const fixedSource = (f: S5DecisionFixture, category: NoticeCategoryV1, items: readonly NoticeItemV1[]): DecisionNoticeSourcePort => ({
  category, readPage(_ctx, input) { return sourcePage(f, items, input); },
});
const pageSources = (f: S5DecisionFixture) => [fixedSource(f, 'member_notice', [item('member_notice', 'm10', 10), item('member_notice', 'm11', 11)]),
  fixedSource(f, 'automatic_rework', [item('automatic_rework', 'r12', 12)])];

function harness(f: S5DecisionFixture, sources: readonly DecisionNoticeSourcePort[]) {
  const displayTokens = createNoticeDisplayToken(new Uint8Array(32));
  const positions = createNoticePositionComparator();
  const settings = createDecisionSettingsService({ records: f.records, now: f.now, newId: f.newId,
    displayTokens, positions, operatorActor: OPERATOR });
  const reads = createDecisionReadModel({ records: f.records, cardSources: [], noticeSources: sources,
    conflicts: createGoalConflictAssembler({ records: f.records,
      catalog: createArchitectureCatalogService({ records: f.records }),
      executedFiles: createGoalExecutedFilesReader({ records: f.records }) }), positions, displayTokens });
  const page = async (options: { categories?: NoticeCategoryV1[]; limit?: number } = {}) => ready(await reads.queryDecisionQueue(f.ctx,
    { workspace: WORKSPACE_SCOPE, sections: ['notices'], ...(options.categories === undefined ? {} : { categories: options.categories }),
      page: { limit: options.limit ?? 50 } }));
  const mark = async (displayToken: string | null, seenThrough: Partial<Record<NoticeCategoryV1, NoticePositionV1>>) => {
    if (displayToken === null) throw new Error('the delivered page must have a token');
    return settings.markNoticesSeen(f.ctx, { input: { workspace: WORKSPACE_SCOPE, displayToken, seenThrough },
      meta: { requestId: f.newId(), expected: [await pin(f.records, WORKSPACE)] } });
  };
  return { page, mark, displayTokens };
}
/** The public Host settings step (C8 `automation/save`) installs the live policy. */
async function saveAutomationPolicy(f: S5DecisionFixture,
  holder: { current: TaskAutomationPolicyV1 }, autoReworkLimit: number): Promise<TaskAutomationPolicyV1> {
  const assembly: HostSettingsAssembly = {
    listWorkspaces: () => [], secretConfigured: () => false,
    bootstrap: () => ({}) as BootstrapResponse,
    async openWorkspace() { return { status: 'rejected', code: 'unsupported', reason: 'not used by S5 notices' }; },
  };
  let installed: TaskAutomationPolicyV1 | null = null;
  const settings = await createHostSettings({ settingsDirectory: join(f.base.directory, 'host-settings'), assembly },
    { onConfigurationChanged(snapshot) { installed = snapshot.automation; } });
  const saved = await settings.call('automation/save', { autoReworkLimit, resumeOnStartup: true });
  if (saved.status !== 'ready') throw new Error(`automation/save was not ready: ${JSON.stringify(saved)}`);
  if (installed === null) throw new Error('automation/save did not install the policy');
  holder.current = installed;
  return installed;
}

const readRework = async (f: S5DecisionFixture, records: DecisionReadRecordsPort & RecordOrderedLookupPort = f.records) =>
  createAutomaticReworkNoticeSource({ records }).readPage(f.ctx, { workspace: WORKSPACE_SCOPE, page: { limit: 50 } });

async function messages(f: S5DecisionFixture, refs: readonly SessionMessageRef[]) {
  return Promise.all(refs.map(async ref => {
    const decoded = decodeSessionMessageRecord(await storedRecord(f.records, ref));
    if (decoded.status !== 'decoded') throw new Error(decoded.reason);
    return { ref, status: decoded.value.status, response: decoded.value.response, application: decoded.value.application ?? null };
  }));
}

/** Corruption stays at the read boundary, never a codec-rejected fixture write. */
function corruptOrigin(records: DecisionReadRecordsPort, targetKey: string): DecisionReadRecordsPort & RecordOrderedLookupPort {
  const corrupt = (record: EncodedRecord): EncodedRecord => record.refKey !== targetKey ? record
    : { ...record, json: JSON.stringify({ ...JSON.parse(record.json) as Record<string, unknown>, since: null }) };
  const ordered = records as DecisionReadRecordsPort & RecordOrderedLookupPort;
  return { async readMany(refs) {
    const result = await records.readMany(refs);
    if (result.status !== 'ready') return result;
    return { status: 'ready', value: { ...result.value, records: result.value.records.map(corrupt) } };
  }, async lookup(request) {
    const result = await records.lookup(request);
    if (result.status !== 'ready') return result;
    return { status: 'ready', value: { ...result.value, records: result.value.records.map(corrupt) } };
  }, async lookupOrdered(request) {
    const result = await ordered.lookupOrdered(request);
    if (result.status !== 'ready') return result;
    return { status: 'ready', value: { ...result.value, records: result.value.records.map(corrupt) } };
  } };
}

/** The production read model projects these saved user notifications. No
 * test-side member source is injected into NR04 or NR06. */
async function sendUserNotice(f: S5DecisionFixture, text: string) {
  const result = await createSessionMailbox(mailboxDependencies(f)).sendUserMessage(workContext(f, f.claimRA), {
    input: { goalRef: GOAL_B, intent: 'notify', text, needsReply: false, waitAfterSend: false, options: [], objects: [] },
    meta: { requestId: f.newId(), expected: [] } });
  const sent = committed(result);
  expect(sent).toMatchObject({ goalRef: GOAL_B, recipient: { kind: 'user', ...WORKSPACE_SCOPE },
    sender: { kind: 'work_run', sessionRef: f.sessionS, runRef: f.claimRA.runRef }, intent: 'notify', revision: 1,
    status: 'pending', response: null });
  expect(sent.application ?? null).toBeNull();
  expect(sent.decision?.syntheticAnswer ?? false).toBe(false);
  if (result.status !== 'committed') throw new Error('user notification must commit');
  return result;
}

type Case = readonly [string, string, (f: S5DecisionFixture, kind: S5FixtureKind) => Promise<void>];
const CASES: readonly Case[] = [
  ['NR01', 'system and agent requeues plus a reverify yield three distinct notices', async f => {
    const work = await noticeWork(f);
    const controller = await work.start('controller');
    const system = await work.requeue('system', automationContext(f));
    const agent = await work.requeue('agent', workContext(f, controller));
    const human = await work.requeue('human', f.ctx);
    const chain = await work.rounds(1);
    expect(system.automation).toMatchObject({ automatic: true, autoCount: 1, cap: 3 });
    expect(agent.automation).toMatchObject({ automatic: true, autoCount: 1, cap: 3 });
    expect(human.automation.automatic).toBe(false);
    const items = ready(await readRework(f)).items;
    expect(items).toHaveLength(3);
    expect(items.map(notice => notice.category)).toEqual(['automatic_rework', 'automatic_rework', 'automatic_rework']);
    expect(new Set(items.map(notice => notice.itemKey)).size).toBe(3);
    expect(items.map(notice => key(notice.rework!.sourceRef)).sort()).toEqual([key(system.ref), key(agent.ref), key(chain.head.ref)].sort());
    for (const [ref, operation, actorClass] of [[system.ref, 'requeue', 'system'], [agent.ref, 'requeue', 'agent'],
      [chain.head.ref, 'reverify', 'system']] as const) {
      expect(items.find(notice => key(notice.rework!.sourceRef) === key(ref))?.rework)
        .toMatchObject({ sourceRef: ref, operation, actorClass, count: 1, cap: 3 });
    }
    expect(items.map(notice => key(notice.rework!.sourceRef))).not.toContain(key(human.ref));
    // NR08 (TP-167): the automatic successor recorded cap 3; raising the current
    // policy to 7 through the public settings step must not rewrite history.
    const installed = await saveAutomationPolicy(f, work.automationPolicy, 7);
    expect(installed.autoReworkLimit).toBe(7);
    const after = ready(await readRework(f)).items;
    expect(after).toEqual(items);
    expect(after.find(notice => key(notice.rework!.sourceRef) === key(chain.head.ref))?.rework)
      .toMatchObject({ operation: 'reverify', cap: 3 });
  }],
  ['NR02', 'marking a one-item member page leaves the later member and rework notices', async f => {
    const h = harness(f, pageSources(f));
    const first = await h.page({ categories: ['member_notice'], limit: 1 });
    expect(first.notices.map(e => e.itemKey)).toEqual(['m10']);
    expect(first.seenThrough).toEqual({ member_notice: pos(10, 'm10') });
    committed(await h.mark(first.displayToken, first.seenThrough));
    expect((await workspaceSnapshot(f)).decisionSettings?.noticeSeen).toEqual({ member_notice: pos(10, 'm10') });
    expect((await h.page()).notices.map(e => e.itemKey)).toEqual(['m11', 'r12']);
  }],
  ['NR03', 'a merged truncated page never authorizes an undelivered rework item', async f => {
    const h = harness(f, pageSources(f));
    const first = await h.page({ limit: 1 }); // BOTH categories compete before truncation
    expect(first.notices.map(e => e.itemKey)).toEqual(['m10']);
    expect(first.seenThrough).toEqual({ member_notice: pos(10, 'm10') });
    if (first.displayToken === null) throw new Error('missing real display token');
    const payload = h.displayTokens.verify(first.displayToken);
    expect(payload).toMatchObject({ returnedKeys: ['m10'], seenThrough: { member_notice: pos(10, 'm10') } });
    expect(payload?.seenThrough.automatic_rework).toBeUndefined();
    const before = await f.storeSnapshot();
    const models = await modelRequestCounts(f);
    expect(models).toEqual({ workAttempts: 0, queryAdmissions: 0 });
    expect(await h.mark(first.displayToken, { automatic_rework: pos(12, 'r12') })).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await f.storeSnapshot()).toEqual(before);
    expect(await modelRequestCounts(f)).toEqual(models);
    committed(await h.mark(first.displayToken, first.seenThrough));
    expect((await h.page()).notices.map(e => e.itemKey)).toEqual(['m11', 'r12']);
  }],
  ['NR04', 'acknowledging a real user notice keeps its creation position and does not redisplay it', async f => {
    const sent = await sendUserNotice(f, 'A member update.');
    const h = harness(f, []);
    const first = await h.page({ categories: ['member_notice'] });
    expect(first.notices).toHaveLength(1);
    const itemKey = first.notices[0]!.itemKey;
    const creation: NoticePositionV1 = { kind: 'commit', cursor: sent.cursor, itemKey };
    expect(first.notices.map(e => e.position)).toEqual([creation]);
    expect(first.seenThrough).toEqual({ member_notice: creation });
    const original = await storedRecord(f.records, sent.value.ref);
    // A later real commit must not replace the message's creation position.
    await f.createS5Session('nr04-later-commit');
    const laterCursor = (await f.storeSnapshot()).lastCursor;
    expect(laterCursor).not.toEqual(sent.cursor);
    const later = await h.page({ categories: ['member_notice'] });
    expect(later.sourceCursor).toEqual(laterCursor);
    expect(later.notices).toEqual(first.notices);
    expect(later.seenThrough).toEqual({ member_notice: creation });
    // Round-2 lead decision: for a user-recipient notify the acknowledgement
    // is markNoticesSeen, not the Session-only mailbox ackMessage entry.
    const acknowledged = await h.mark(later.displayToken, later.seenThrough);
    expect(committed(acknowledged).decisionSettings?.noticeSeen).toEqual({ member_notice: creation });
    if (acknowledged.status !== 'committed') throw new Error('ack must commit');
    expect(acknowledged.cursor).not.toEqual(sent.cursor);
    expect(acknowledged.cursor).not.toEqual(laterCursor);
    expect((await h.page()).notices).toEqual([]);
    const after = await storedRecord(f.records, sent.value.ref);
    expect(after).toEqual(original);
    expect(decodeNoticeOrigin(after)).toMatchObject({ status: 'decoded', value: { since: sent.cursor } });
  }],
  ['NR05', 'a bound creation position and a corrupt null origin is unavailable', async f => {
    const work = await noticeWork(f);
    const fresh = await work.requeue('agent', automationContext(f));
    const freshWire = await storedRecord(f.records, fresh.ref);
    const origin = decodeNoticeOrigin(freshWire);
    if (origin.status !== 'decoded') throw new Error(origin.reason);
    expect(origin.value.since).toEqual((await f.storeSnapshot()).lastCursor);
    const items = ready(await readRework(f)).items;
    expect(items).toHaveLength(1);
    expect(items[0]!.position).toEqual({ kind: 'commit', cursor: origin.value.since, itemKey: items[0]!.itemKey });
    const before = await f.storeSnapshot();
    expect(await readRework(f, corruptOrigin(f.records, key(fresh.ref)))).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(await f.storeSnapshot()).toEqual(before);
  }],
  ['NR06', 'two saved category positions survive reopen without changing stored message facts', async (f, kind) => {
    const member1 = await sendUserNotice(f, 'First saved member notification.');
    const member2 = await sendUserNotice(f, 'Second saved member notification.');
    const work = await noticeWork(f);
    const requeue = await work.requeue('system', automationContext(f));
    const refs = [member1.value.ref, member2.value.ref];
    const beforeMessages = await messages(f, refs);
    expect(beforeMessages).toEqual(refs.map(ref => ({ ref, status: 'pending', response: null, application: null })));
    const beforeRecords = await Promise.all(refs.map(ref => storedRecord(f.records, ref)));
    const h = harness(f, [createAutomaticReworkNoticeSource({ records: f.records })]);
    const members = await h.page({ categories: ['member_notice'] });
    expect(members.notices).toHaveLength(2);
    const [firstMember, secondMember] = members.notices;
    if (firstMember === undefined || secondMember === undefined) throw new Error('both saved notifications must be projected');
    const firstPosition: NoticePositionV1 = { kind: 'commit', cursor: member1.cursor, itemKey: firstMember.itemKey };
    const secondPosition: NoticePositionV1 = { kind: 'commit', cursor: member2.cursor, itemKey: secondMember.itemKey };
    expect(members.notices.map(e => e.position)).toEqual([firstPosition, secondPosition]);
    const first = await h.page({ categories: ['member_notice'], limit: 1 });
    expect(first.notices).toEqual([firstMember]);
    expect(first.seenThrough).toEqual({ member_notice: firstPosition });
    committed(await h.mark(first.displayToken, first.seenThrough));
    expect((await workspaceSnapshot(f)).decisionSettings?.noticeSeen).toEqual({ member_notice: firstPosition });
    const rework = await h.page({ categories: ['automatic_rework'] });
    expect(rework.notices).toHaveLength(1);
    expect(rework.notices[0]!.rework).toMatchObject({ operation: 'requeue', sourceRef: requeue.ref, actorClass: 'system', count: 1, cap: 3 });
    const origin = decodeNoticeOrigin(await storedRecord(f.records, requeue.ref));
    if (origin.status !== 'decoded' || origin.value.since === undefined || origin.value.since === null) throw new Error('requeue needs its creation position');
    const reworkPosition: NoticePositionV1 = { kind: 'commit', cursor: origin.value.since, itemKey: rework.notices[0]!.itemKey };
    expect(rework.notices[0]!.position).toEqual(reworkPosition);
    expect(rework.seenThrough).toEqual({ automatic_rework: reworkPosition });
    committed(await h.mark(rework.displayToken, rework.seenThrough));
    const saved = { member_notice: firstPosition, automatic_rework: reworkPosition };
    expect((await workspaceSnapshot(f)).decisionSettings?.noticeSeen).toEqual(saved);
    expect(await messages(f, refs)).toEqual(beforeMessages);
    expect(await Promise.all(refs.map(ref => storedRecord(f.records, ref)))).toEqual(beforeRecords);
    if (kind === 'sqlite') await f.reopen();
    expect((await workspaceSnapshot(f)).decisionSettings?.noticeSeen).toEqual(saved);
    const after = await harness(f, [createAutomaticReworkNoticeSource({ records: f.records })]).page();
    expect(after.notices).toEqual([secondMember]);
    expect(after.seenThrough).toEqual({ member_notice: secondPosition }); // delivery watermark, not saved settings
    expect((await workspaceSnapshot(f)).decisionSettings?.noticeSeen).toEqual(saved);
    expect(await messages(f, refs)).toEqual(beforeMessages);
    expect(await Promise.all(refs.map(ref => storedRecord(f.records, ref)))).toEqual(beforeRecords);
  }],
  ['NR07', 'the task projects only the head while notices retain all three automatic successors', async f => {
    const work = await noticeWork(f);
    const { history, head } = await work.rounds(3);
    const graph = ready(await work.plans.queryTaskGraph(f.ctx, { goalRef: work.goalRef }));
    const task = graph.tasks.find(row => row.ref.taskId === 'round');
    expect(task?.failure?.round).toMatchObject({ roundRef: head.ref, revision: 1, status: 'open', ordinal: 4, autoCount: 3 });
    const items = ready(await readRework(f)).items;
    expect(items).toHaveLength(3);
    expect(items.map(e => e.rework!.sourceRef)).toEqual(history.slice(1).map(round => round.ref));
    expect(items.map(e => e.rework!.count)).toEqual([1, 2, 3]);
    expect(items.map(e => e.rework!.operation)).toEqual(['reverify', 'reverify', 'reverify']);
    expect(head.chain?.basisDigests).toEqual(history.slice(1).map(round => round.chain!.reverify!.basis.digest));
  }],
];
describe.each(['memory', 'sqlite'] as const)('S5 notices (%s)', kind => {
  for (const [id, title, run] of CASES) it(`${id}: ${title}`, async () => { await run(await open(kind), kind); });
});
