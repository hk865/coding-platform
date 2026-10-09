/** Slice 5 §5.3 RC01–RC11: request-slot histories, real queue reads and both Stores. */
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import type { PlanProposalSnapshot } from '../../src/contracts/goal-change.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { PreparedCommit } from '../../src/core/record-store/ports.js';
import type { PlanProposal, PlanProposalRef, ProposedPlanRequestV1 } from '../../src/core/work-graph/model/plan-contracts.js';
import {
  PLAN_PROPOSAL_SCHEMA_ID, decodePlanProposalRecord, decodePlanProposalRecordedEvent,
} from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import { candidateRequestRef, enumerateGoalCandidates } from '../../src/core/work-graph/tasks/plan-readers.js';
import {
  CANDIDATE_U1, CANDIDATE_U2, GOAL_A, GOAL_B, OPERATOR, PLAN_A1, PLAN_B1, PLAN_B2,
  REQUEST_Q1, REQUEST_Q2, T, openS5DecisionFixture, type S5DecisionFixture, type S5Records,
} from '../helpers/S5-decision-fixture.js';
import {
  captureCommits, commitBarrier, committed, decoded, goalAt, keyOf, owners, pin, queue, ready, recordAt,
} from '../helpers/S5-application-support.js';

const slot = (requestRef: QueryJobRef) => `s5-request-candidate:${canonicalJson({ goalRef: GOAL_B, requestRef })}`;
const candidateKey = (requestRef: QueryJobRef) => decisionSourceKey({ kind: 'candidate', goalRef: GOAL_B, requestRef });
const candidate = (proposal: PlanProposal) => {
  if (proposal.kind !== 'candidate_v2') throw new Error('expected a v2 candidate fixture');
  return proposal;
};
const request = (f: S5DecisionFixture, extra: Partial<ProposedPlanRequestV1> = {}): ProposedPlanRequestV1 => ({
  goalRef: GOAL_B, basedOn: PLAN_B1, draft: candidate(f.candidates.U1).draft,
  reason: { text: 'RC candidate', sources: [] }, requestRef: REQUEST_Q1, ...extra,
});
async function propose(f: S5DecisionFixture, id: string, input: ProposedPlanRequestV1, records: S5Records = f.records) {
  return owners(f, records).plans.proposePlan(f.ctx, { input,
    meta: { requestId: `s5-${id}`, expected: [pin(input.goalRef, (await goalAt(records, input.goalRef)).revision)] },
  });
}
const head = (f: S5DecisionFixture, requestRef: QueryJobRef) =>
  owners(f).requests.readRequestCandidate(f.ctx, { goalRef: GOAL_B, requestRef });
async function abandon(f: S5DecisionFixture, ref: PlanProposalRef, id: string, records: S5Records = f.records) {
  return owners(f, records).requests.abandonPlanProposal(f.ctx, {
    input: { proposalRef: ref }, meta: { requestId: id, expected: [pin(ref, 1), pin(GOAL_B, 7)] },
  });
}
async function proposalAt(f: S5DecisionFixture, ref: PlanProposalRef) {
  return decoded(decodePlanProposalRecord(await recordAt(f.records, ref)));
}
async function allCandidates(f: S5DecisionFixture) {
  const read = await enumerateGoalCandidates(f.records, GOAL_B);
  expect(read).toMatchObject({ status: 'ready' });
  if (read.status !== 'ready') throw new Error(`candidate enumeration failed: ${JSON.stringify(read)}`);
  return read.proposals;
}

describe.each(['memory', 'sqlite'] as const)('S5 request candidates (%s)', kind => {
  const opened: S5DecisionFixture[] = [];
  afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });
  const open = async () => { const f = await openS5DecisionFixture(kind, { operatorActor: { ...OPERATOR } }); opened.push(f); return f; };

  it('RC01 reads one live head per request and two real candidate queue cards', async () => {
    const f = await open();
    const before = await f.storeSnapshot(); const allocations = { ...f.allocationCounts };
    expect(ready(await head(f, REQUEST_Q1))).toEqual({ status: 'candidate', closedReason: null, head: f.candidates.U1 });
    expect(ready(await head(f, REQUEST_Q2))).toEqual({ status: 'candidate', closedReason: null, head: f.candidates.U2 });
    expect(await f.planProposalsByRequest('Q1')).toEqual([keyOf(CANDIDATE_U1)]);
    expect(await f.planProposalsByRequest('Q2')).toEqual([keyOf(CANDIDATE_U2)]);
    const page = await queue(f);
    expect(page.waitingAnswer.filter(card => card.source.kind === 'candidate').map(card => ({
      key: card.source.key, requestRef: card.requestRef, state: card.state, candidateStatus: card.candidateStatus,
    })).sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { key: candidateKey(REQUEST_Q1), requestRef: REQUEST_Q1, state: 'waiting_answer', candidateStatus: 'candidate' },
      { key: candidateKey(REQUEST_Q2), requestRef: REQUEST_Q2, state: 'waiting_answer', candidateStatus: 'candidate' },
    ].sort((a, b) => a.key.localeCompare(b.key)));
    expect(await f.storeSnapshot()).toEqual(before);
    expect(f.allocationCounts).toEqual(allocations);
  });

  it('RC02 two first writers of the empty Q1 slot reach commit together and leave no orphan candidate', async () => {
    const f = await open();
    // Release the shared fixture's existing Q1 head through its owner. Both
    // contenders below are first writes (no replaces) to the now-empty slot.
    const closed = committed(await abandon(f, CANDIDATE_U1, 's5-rc02-empty-q1'));
    expect(closed.value).toMatchObject({ revision: 2, status: 'not_adopted', notAdopted: { reason: 'abandoned' } });
    const before = await f.storeSnapshot();
    expect(before.claims.filter(claim => claim.claimKey === slot(REQUEST_Q1))).toEqual([]);
    const captured = captureCommits(f.records);
    const barrier = commitBarrier(captured.records);
    const results = await Promise.all(['a', 'b'].map(suffix => propose(f, `rc02-${suffix}`, request(f, {
      draft: { ...candidate(f.candidates.U1).draft, planId: `PB-RC02-${suffix}` },
    }), barrier.records)));
    expect(barrier.arrivals()).toBe(2);
    expect(results.filter(result => result.status === 'committed')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toEqual([
      expect.objectContaining({ status: 'rejected', code: 'revision_conflict' }),
    ]);
    const winner = results.find(result => result.status === 'committed');
    if (winner === undefined || winner.status !== 'committed') throw new Error('no first-write winner');
    expect(winner.value).toMatchObject({ revision: 1, status: 'candidate', requestRef: REQUEST_Q1 });
    expect(captured.commits).toHaveLength(1);
    expect(captured.commits[0]!.input.claims).toContainEqual({
      claimKey: slot(REQUEST_Q1), expectedOwner: null, nextOwner: keyOf(winner.value.ref),
    });
    expect(ready(await head(f, REQUEST_Q1))).toEqual({ status: 'candidate', closedReason: null, head: winner.value });
    const after = await f.storeSnapshot();
    expect(after.recordCount).toBe(before.recordCount + 1);
    expect(after.records.filter(record => !before.records.some(old => old.refKey === record.refKey)))
      .toEqual([{ refKey: keyOf(winner.value.ref), revision: 1 }]);
    expect(after.records.filter(record => record.refKey !== keyOf(winner.value.ref))).toEqual(before.records);
    expect(after.claims.filter(claim => claim.claimKey === slot(REQUEST_Q1)))
      .toEqual([{ claimKey: slot(REQUEST_Q1), owner: keyOf(winner.value.ref) }]);
    expect(after.claims.filter(claim => claim.claimKey !== slot(REQUEST_Q1))).toEqual(before.claims);
    expect((await allCandidates(f)).map(p => keyOf(p.ref)).sort())
      .toEqual([keyOf(CANDIDATE_U2), keyOf(winner.value.ref)].sort());
    expect(await proposalAt(f, CANDIDATE_U1)).toEqual(closed.value);
  });

  it('RC03 a replacement commit fault preserves U1 and its claim and writes no U3', async () => {
    const f = await open(); const before = await f.storeSnapshot();
    const faulted: PreparedCommit[] = [];
    const records: S5Records = { ...f.records, async commit(input) {
      if (input.claims.some(claim => claim.claimKey === slot(REQUEST_Q1))) {
        faulted.push(input);
        return { status: 'rejected', code: 'unavailable', reason: 'RC03 injected replacement commit fault' };
      }
      return f.records.commit(input);
    } };
    expect(await propose(f, 'rc03', request(f, { replaces: { proposalRef: CANDIDATE_U1, revision: 1 } }), records))
      .toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(faulted).toHaveLength(1);
    const batch = faulted[0]!;
    const nextRecord = batch.records.find(record => record.schemaId === PLAN_PROPOSAL_SCHEMA_ID && record.refKey !== keyOf(CANDIDATE_U1));
    if (nextRecord === undefined) throw new Error('replacement must include its new head');
    const next = decoded(decodePlanProposalRecord(nextRecord));
    expect(next).toMatchObject({ revision: 1, status: 'candidate', requestRef: REQUEST_Q1 });
    expect(batch.claims).toContainEqual({ claimKey: slot(REQUEST_Q1), expectedOwner: keyOf(CANDIDATE_U1), nextOwner: keyOf(next.ref) });
    const oldRecord = batch.records.find(record => record.refKey === keyOf(CANDIDATE_U1));
    if (oldRecord === undefined) throw new Error('replacement must include the closed old head');
    expect(decoded(decodePlanProposalRecord(oldRecord))).toEqual({ ...f.candidates.U1, revision: 2, status: 'not_adopted',
      notAdopted: { reason: 'replaced', requestedBy: OPERATOR, at: T, replacedBy: next.ref } });
    expect(await f.storeSnapshot()).toEqual(before);
    expect(await proposalAt(f, CANDIDATE_U1)).toEqual(f.candidates.U1);
    const missing = await f.records.readMany([keyOf(next.ref)]);
    expect(missing).toMatchObject({ status: 'ready', value: { records: [], missing: [keyOf(next.ref)] } });
    expect(before.claims.filter(claim => claim.claimKey === slot(REQUEST_Q1)))
      .toEqual([{ claimKey: slot(REQUEST_Q1), owner: keyOf(CANDIDATE_U1) }]);
  });

  it('RC04 one replacement receipt versions U1@2 and U3@1 and leaves Q2 byte-identical', async () => {
    const f = await open(); const u2Before = await recordAt(f.records, CANDIDATE_U2);
    const captured = captureCommits(f.records);
    const replacement = committed(await propose(f, 'rc04', request(f, { replaces: { proposalRef: CANDIDATE_U1, revision: 1 } }), captured.records));
    expect(captured.commits).toHaveLength(1);
    const batch = captured.commits[0]!;
    expect(batch.receipt.cursor).toBe(replacement.cursor);
    expect([...batch.receipt.versions].sort((a, b) => a.refKey.localeCompare(b.refKey))).toEqual([
      { refKey: keyOf(CANDIDATE_U1), revision: 2 }, { refKey: keyOf(replacement.value.ref), revision: 1 },
    ].sort((a, b) => a.refKey.localeCompare(b.refKey)));
    expect(batch.input.claims).toContainEqual({ claimKey: slot(REQUEST_Q1),
      expectedOwner: keyOf(CANDIDATE_U1), nextOwner: keyOf(replacement.value.ref) });
    expect(await proposalAt(f, CANDIDATE_U1)).toEqual({ ...f.candidates.U1, revision: 2, status: 'not_adopted',
      notAdopted: { reason: 'replaced', requestedBy: OPERATOR, at: T, replacedBy: replacement.value.ref } });
    expect(await proposalAt(f, replacement.value.ref)).toEqual(replacement.value);
    // D2 writes two complete proposal snapshots/events in this ONE receipt.
    expect(batch.receipt.eventIds).toEqual(batch.input.events.map(event => event.eventId));
    const eventProposals = batch.input.events.map(event => decoded(decodePlanProposalRecordedEvent(event)).payload.proposal)
      .sort((a, b) => keyOf(a.ref).localeCompare(keyOf(b.ref)));
    expect(eventProposals).toEqual([await proposalAt(f, CANDIDATE_U1), replacement.value]
      .sort((a, b) => keyOf(a.ref).localeCompare(keyOf(b.ref))));
    expect(replacement.value).toMatchObject({ revision: 1, status: 'candidate', requestRef: REQUEST_Q1 });
    expect(ready(await head(f, REQUEST_Q1))).toEqual({ head: replacement.value, status: 'candidate', closedReason: null });
    expect((await f.storeSnapshot()).claims.filter(claim => claim.claimKey === slot(REQUEST_Q1)))
      .toEqual([{ claimKey: slot(REQUEST_Q1), owner: keyOf(replacement.value.ref) }]);
    expect(await recordAt(f.records, CANDIDATE_U2)).toEqual(u2Before);
    expect(await f.planProposalsByRequest('Q2')).toEqual([keyOf(CANDIDATE_U2)]);
  });

  it('RC05 adopting Q1 leaves the unchanged Q2 head waiting with stale regenerate/abandon actions', async () => {
    const f = await open(); const u2Before = await recordAt(f.records, CANDIDATE_U2);
    const adopted = committed(await owners(f).plans.applyPlanChange(f.ctx, {
      input: { proposalRef: CANDIDATE_U1, expectedProposalRevision: 1, decisionRefs: [] },
      meta: { requestId: 's5-rc05', expected: [pin(GOAL_B, 7)] },
    }));
    expect(adopted.value).toMatchObject({ ref: PLAN_B2, revision: 1, planRevision: 2 });
    expect(await goalAt(f.records)).toMatchObject({ revision: 8, activePlanRevision: PLAN_B2 });
    expect(await proposalAt(f, CANDIDATE_U1)).toMatchObject({ status: 'accepted', revision: 2, requestRef: REQUEST_Q1 });
    const beforeRead = await f.storeSnapshot(); const allocations = { ...f.allocationCounts };
    expect(ready(await head(f, REQUEST_Q2))).toEqual({ status: 'stale', closedReason: null, head: f.candidates.U2 });
    const page = await queue(f);
    const stale = page.waitingAnswer.filter(card => card.source.key === candidateKey(REQUEST_Q2));
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ requestRef: REQUEST_Q2, state: 'waiting_answer', candidateStatus: 'stale', readOnly: false });
    expect(stale[0]!.actions).toEqual(expect.arrayContaining(['regenerate', 'abandon']));
    expect(stale[0]!.actions).not.toContain('adopt');
    expect(await recordAt(f.records, CANDIDATE_U2)).toEqual(u2Before);
    expect(ready(await head(f, REQUEST_Q1))).toEqual({ status: 'closed', closedReason: null, head: null });
    expect(beforeRead.claims.filter(claim => claim.claimKey === slot(REQUEST_Q1))).toEqual([]);
    expect(beforeRead.claims.filter(claim => claim.claimKey === slot(REQUEST_Q2)))
      .toEqual([{ claimKey: slot(REQUEST_Q2), owner: keyOf(CANDIDATE_U2) }]);
    expect(await f.storeSnapshot()).toEqual(beforeRead);
    expect(f.allocationCounts).toEqual(allocations);
  });

  it('RC06 abandon replays the original result and releases Q2 for a new first candidate', async () => {
    const f = await open(); const captured = captureCommits(f.records);
    const first = committed(await abandon(f, CANDIDATE_U2, 's5-rc06', captured.records));
    expect(first.value).toEqual({ ...f.candidates.U2, revision: 2, status: 'not_adopted',
      notAdopted: { reason: 'abandoned', requestedBy: OPERATOR, at: T, replacedBy: null } });
    expect(captured.commits).toHaveLength(1);
    const commit = captured.commits[0]!;
    expect(commit.receipt).toMatchObject({ cursor: first.cursor, versions: [{ refKey: keyOf(CANDIDATE_U2), revision: 2 }] });
    expect(commit.input.claims).toContainEqual({ claimKey: slot(REQUEST_Q2), expectedOwner: keyOf(CANDIDATE_U2), nextOwner: null });
    const event = await f.records.eventAt(first.cursor);
    if (event.status !== 'ready') throw new Error('abandon event missing');
    expect(decoded(decodePlanProposalRecordedEvent(event.value.event)).payload.proposal).toEqual(first.value);
    const beforeReplay = await f.storeSnapshot(); const allocations = { ...f.allocationCounts };
    const replay = committed(await abandon(f, CANDIDATE_U2, 's5-rc06', captured.records));
    expect(replay).toEqual({ ...first, replayed: true });
    expect(await f.storeSnapshot()).toEqual(beforeReplay);
    expect(f.allocationCounts).toEqual(allocations);
    expect(beforeReplay.claims.filter(claim => claim.claimKey === slot(REQUEST_Q2))).toEqual([]);
    expect(ready(await head(f, REQUEST_Q2))).toEqual({ status: 'closed', closedReason: null, head: null });
    const nextCapture = captureCommits(f.records);
    const next = committed(await propose(f, 'rc06-new-first', request(f, { requestRef: REQUEST_Q2 }), nextCapture.records));
    expect(nextCapture.commits).toHaveLength(1);
    expect(nextCapture.commits[0]!.input.claims).toContainEqual({ claimKey: slot(REQUEST_Q2), expectedOwner: null, nextOwner: keyOf(next.value.ref) });
    expect(ready(await head(f, REQUEST_Q2))).toEqual({ status: 'candidate', closedReason: null, head: next.value });
    expect(await proposalAt(f, CANDIDATE_U2)).toEqual(first.value);
    expect((await f.storeSnapshot()).claims.filter(claim => claim.claimKey === slot(REQUEST_Q2)))
      .toEqual([{ claimKey: slot(REQUEST_Q2), owner: keyOf(next.value.ref) }]);
  });

  it('RC07 a real request of another Goal is invalid with zero persisted writes', async () => {
    const f = await open(); const before = await f.storeSnapshot();
    const result = await propose(f, 'rc07', request(f, { goalRef: GOAL_A, basedOn: PLAN_A1,
      draft: { ...candidate(f.candidates.U1).draft, planId: 'PA-RC07', goalId: GOAL_A.goalId } }));
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await f.storeSnapshot()).toEqual(before);
    expect(await f.planProposalsByRequest('Q1')).toEqual([keyOf(CANDIDATE_U1)]);
  });

  it('RC08 owner-closed history and pointer-derived stale survive the same SQLite reopen or rebuilt memory services', async () => {
    const f = await open();
    const closed = committed(await abandon(f, CANDIDATE_U1, 's5-rc08-abandon'));
    // An independent future proposal legitimately moves PB1 to PB2; Q1 remains
    // abandoned and its slot stays released. Q2 is never rewritten.
    const independent = committed(await propose(f, 'rc08-independent', request(f, { requestRef: null })));
    const adopted = committed(await owners(f).plans.applyPlanChange(f.ctx, {
      input: { proposalRef: independent.value.ref, expectedProposalRevision: 1, decisionRefs: [] },
      meta: { requestId: 's5-rc08-adopt', expected: [pin(GOAL_B, 7)] },
    }));
    expect(adopted.value).toMatchObject({ ref: PLAN_B2, planRevision: 2 });
    const snapshot = async () => ({
      q1: ready(await head(f, REQUEST_Q1)), q2: ready(await head(f, REQUEST_Q2)),
      closed: ready(await owners(f).plans.readPlanProposal(f.ctx, CANDIDATE_U1)),
      live: (await allCandidates(f)).map(proposal => ({ ref: proposal.ref, revision: proposal.revision, status: proposal.status })),
    });
    const before = await snapshot();
    expect(before.q1).toEqual({ head: null, status: 'closed', closedReason: null });
    expect(before.q2).toEqual({ head: f.candidates.U2, status: 'stale', closedReason: null });
    expect(before.closed).toEqual(closed.value);
    expect(before.live).toEqual([{ ref: CANDIDATE_U2, revision: 1, status: 'candidate' }]);
    const stored = await f.storeSnapshot(); const allocations = { ...f.allocationCounts };
    expect(stored.claims.filter(claim => claim.claimKey === slot(REQUEST_Q1))).toEqual([]);
    if (kind === 'sqlite') await f.reopen();
    expect(await snapshot()).toEqual(before);
    expect(await f.storeSnapshot()).toEqual(stored);
    expect(f.allocationCounts).toEqual(allocations);
    expect(await goalAt(f.records)).toMatchObject({ revision: 8, activePlanRevision: PLAN_B2 });
  });

  it('RC09 an old v2 candidate gains neither optional fields nor a request claim on read', async () => {
    const f = await open();
    const { requestRef: oldRequest, notAdopted: oldClosure, ...body } = candidate(f.candidates.U1);
    void oldRequest; void oldClosure;
    const old: PlanProposal = { ...body, ref: { ...body.ref, proposalId: 'U9' } };
    const seeded = await f.seedCandidateProposal(old);
    expect(seeded.status).toBe('committed');
    const raw = await recordAt(f.records, old.ref);
    expect(JSON.parse(raw.json)).not.toHaveProperty('requestRef');
    expect(JSON.parse(raw.json)).not.toHaveProperty('notAdopted');
    const before = await f.storeSnapshot(); const allocations = { ...f.allocationCounts };
    const result = ready(await owners(f).plans.readPlanProposal(f.ctx, old.ref));
    expect(result).toEqual(old);
    expect(result).not.toHaveProperty('requestRef');
    expect(result).not.toHaveProperty('notAdopted');
    expect(candidateRequestRef(result)).toBeNull();
    expect(await recordAt(f.records, old.ref)).toEqual(raw);
    expect(await f.storeSnapshot()).toEqual(before);
    expect(f.allocationCounts).toEqual(allocations);
    expect(before.claims.filter(claim => claim.owner === keyOf(old.ref))).toEqual([]);
  });

  it('RC10 a foreign-Workspace request is forbidden before any foreign body read', async () => {
    const f = await open(); const foreign = { ...REQUEST_Q1, workspaceId: 'other-workspace' };
    const readKeys: string[] = [];
    const records: S5Records = { ...f.records, async readMany(keys) {
      readKeys.push(...keys); return f.records.readMany(keys);
    } };
    const before = await f.storeSnapshot(); const allocations = { ...f.allocationCounts };
    expect(await owners(f, records).requests.readRequestCandidate(f.ctx, { goalRef: GOAL_B, requestRef: foreign }))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(readKeys.filter(key => key.includes('other-workspace'))).toEqual([]);
    expect(await f.storeSnapshot()).toEqual(before);
    expect(f.allocationCounts).toEqual(allocations);
  });

  it('RC11 a legacy v1 proposal remains a read-only candidate without added request fields or claims', async () => {
    const f = await open();
    // Historical wire shape, deliberately not a new v2 candidate or an update.
    const legacy: PlanProposalSnapshot = {
      ref: { ...CANDIDATE_U1, proposalId: 'L1' }, revision: 1, schemaVersion: 1, recordedAt: T,
      proposal: {
        schemaVersion: 1, proposalId: 'L1', projectId: 'P', workspaceId: 'W',
        sourceGoalRef: GOAL_B, sourcePlanRef: PLAN_B1, sourcePlanRevision: 1, generatedAt: T,
        patch: {
          schemaVersion: 1, patchId: 'L1-patch', projectId: 'P', workspaceId: 'W',
          goalRef: GOAL_B, sourcePlanRef: PLAN_B1, sourcePlanRevision: 1,
          patchDraft: { objective: 'Deliver Goal B with clarified scope', obligationDeltas: [], taskHierarchy: null },
          inScope: ['Clarify the objective'], outOfScope: ['Change existing tasks'], generatedAt: T,
        },
        impact: { schemaVersion: 1, analysisId: 'L1-impact', patchRef: null, affectedWorks: [],
          staleAssumptions: [], materialsToRefresh: [], independentWork: [], generatedAt: T },
        alternatives: [{ optionId: 'clarify', summary: 'Clarify the objective', impactDelta: 'Keep existing tasks' }],
      },
    };
    const seeded = await f.seedCommit([{ refKey: keyOf(legacy.ref), schemaId: PLAN_PROPOSAL_SCHEMA_ID,
      revision: 1, json: JSON.stringify(legacy) }]);
    expect(seeded.status).toBe('committed');
    const raw = await recordAt(f.records, legacy.ref);
    const before = await f.storeSnapshot(); const allocations = { ...f.allocationCounts };
    const result = ready(await owners(f).plans.readPlanProposal(f.ctx, legacy.ref));
    expect(result).toEqual({ kind: 'legacy_v1', ref: legacy.ref, revision: 1, schemaVersion: 1,
      goalRef: GOAL_B, basedOn: PLAN_B1, draft: null, legacy, status: 'candidate', issues: [] });
    expect(result).not.toHaveProperty('requestRef');
    expect(result).not.toHaveProperty('notAdopted');
    expect(candidateRequestRef(result)).toBeNull();
    expect(JSON.parse(raw.json)).not.toHaveProperty('requestRef');
    expect(JSON.parse(raw.json)).not.toHaveProperty('notAdopted');
    expect(await recordAt(f.records, legacy.ref)).toEqual(raw);
    expect(await f.storeSnapshot()).toEqual(before);
    expect(f.allocationCounts).toEqual(allocations);
    expect(before.claims.filter(claim => claim.owner === keyOf(legacy.ref))).toEqual([]);
  });
});
