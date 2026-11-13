/**
 * RL-24 (`book-7d2-frozen.md:1327`; the frozen test brief of 11-06; C1-16): proposals become one frozen batch per
 * window, a late proposal is its own batch, a changed pin does not reuse an approval, and the cold start completes
 * only when every frozen batch is handled.
 *
 * World: `tests/helpers/S7D2-coldstart-world.ts` walked to `proposals` (the six phases of RL-23a, two free seats
 * granted so both region lines open at once). `Ls` is the `src` region line, `Ld` the `docs` line; both are read
 * from `role-lines/operations`' exploration entries.
 *
 * Named mutation (C1-16): approving batch1 applies the live proposals instead of the frozen members, so prop-b's
 * `set_responsibility` lands too; step 4 then reads `src`'s responsibility as `owns source`, red.
 *
 * Hand-computed identities (the 8C rule, C1a `proposal-service.ts:332–:346`; `decisionSourceKey`
 * `goal-decisions.ts:263`):
 *   batchId = sha256Hex(canonicalJson({ baseCatalogPin, members: [proposalRef] }))
 *   cardKey = decisionSourceKey({ kind: 'structural_proposal', batch: batchRef })
 * The batch body's `digest` has no public read (the proposal read returns only `{proposal, batchRef, cardKey}`), so
 * the row checks the observable batch id and card key; the digest stays unproven here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import type { ArchitectureProposalRef } from '../../src/contracts/architecture-proposal.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { RoleLineOperationReadV1 } from '../../src/core/work-graph/views/role-line-operations-read.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { PL_ADVISER_ROLE } from '../helpers/PL-consumption-fixture.js';
import { byIdentityPrefix, commitBarrier, type CommitMatch } from '../helpers/S6A-commit-barrier.js';
import type { S6AReply } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { readReady, valueOf } from '../helpers/S6B3-fixture.js';
import { jsonOf } from '../helpers/S7C-member-fixture.js';
import { S7D2_MODULE_IDS } from '../helpers/S7D2-role-line-world.js';
import {
  coarseSplitQueryRefs, holdColdStartPhase, openS7D2ColdStartWorld, type S7D2ColdStartWorld,
  type S7D2Exploration,
} from '../helpers/S7D2-coldstart-world.js';
import { coldStartOperationRef } from '../../src/core/work-graph/state/cold-start.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const P = S6A_SCOPE.projectId;
const worlds: S7D2ColdStartWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
  expect(left).toEqual([]);
});

const batchIdOf = (pin: unknown, members: readonly ArchitectureProposalRef[]): string =>
  sha256Hex(canonicalJson({ baseCatalogPin: pin, members } as never));

const proposalCardOf = (cards: readonly DecisionCardV1[], batchId: string): DecisionCardV1 => {
  const key = decisionSourceKey({ kind: 'structural_proposal', batch: { aggregateType: 'ArchitectureProposalBatch',
    projectId: P, batchId } });
  const found = cards.find(card => card.cardKey === key);
  if (found === undefined) throw new Error(`RL-24: no card for the batch ${batchId}`);
  return found;
};

/** One adviser Work Run's propose call and closing answer (the scripted model calls the real tool). */
const proposalReplies = (callId: string, pin: unknown, ops: readonly Record<string, unknown>[],
  reason: string): readonly S6AReply[] => [{ kind: 'calls', calls: [{ callId,
  name: 'propose_architecture_revision',
  args: { baseCatalogPin: pin, ops, responsibilityMoves: [], reason } }] },
{ kind: 'text', text: `C1T: ${reason}` }];

/** The `cold_start` record's completion commit: the one write that flips the record's outer phase to `completed`. */
const coldStartCompletionCommit: CommitMatch = commit => commit.records.some(record => {
  let value: unknown;
  try { value = JSON.parse(record.json) as unknown; } catch { return false; }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const ref = row['ref'];
  const action = row['action'];
  return typeof ref === 'object' && ref !== null
    && (ref as Record<string, unknown>)['aggregateType'] === 'CoreOperation'
    && (ref as Record<string, unknown>)['operationId'] === coldStartOperationRef(P).operationId
    && typeof action === 'object' && action !== null
    && (action as Record<string, unknown>)['action'] === 'cold_start'
    && row['phase'] === 'completed';
});

/** The `cold_start` write that saves the phase's exploration entry (the record's `batchRefs`/`explorations` grew). */
const coldStartEntryCommit = (phase: 'coarse_split' | 'region'): CommitMatch => commit =>
  commit.records.some(record => {
    let value: unknown;
    try { value = JSON.parse(record.json) as unknown; } catch { return false; }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    const ref = row['ref'];
    const action = row['action'];
    if (typeof ref !== 'object' || ref === null || typeof action !== 'object' || action === null) return false;
    const actionRow = action as Record<string, unknown>;
    return (ref as Record<string, unknown>)['aggregateType'] === 'CoreOperation'
      && (ref as Record<string, unknown>)['operationId'] === coldStartOperationRef(P).operationId
      && actionRow['action'] === 'cold_start' && actionRow['phase'] === phase
      && Array.isArray(actionRow['explorations']) && actionRow['explorations'].length > 0;
  });

/** The `cold_start` proposals write that saves frozen `batchRefs` (after the batch freeze commit landed). */
const coldStartBatchSaveCommit: CommitMatch = commit => commit.records.some(record => {
  let value: unknown;
  try { value = JSON.parse(record.json) as unknown; } catch { return false; }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const ref = row['ref'];
  const action = row['action'];
  if (typeof ref !== 'object' || ref === null || typeof action !== 'object' || action === null) return false;
  const actionRow = action as Record<string, unknown>;
  return (ref as Record<string, unknown>)['aggregateType'] === 'CoreOperation'
    && (ref as Record<string, unknown>)['operationId'] === coldStartOperationRef(P).operationId
    && actionRow['action'] === 'cold_start' && actionRow['phase'] === 'proposals'
    && Array.isArray(actionRow['batchRefs']) && actionRow['batchRefs'].length > 0;
});

describe('RL-24: the frozen proposal batch, the late proposal and the changed pin', () => {
  it.each(['memory', 'sqlite'] as const)('RL-24 (%s): one batch per window, a replay writes nothing, a changed pin is stale',
    async backend => {
    const cold = await openS7D2ColdStartWorld({ backend });
    worlds.push(cold);
    // The world's one cold-start operation exists before any round: the rest of the flow is its phases.
    const coldRows = (await cold.operations()).filter(row => row.action === 'role_line'
      && row.operation.operationId === coldStartOperationRef(P).operationId) as Extract<RoleLineOperationReadV1,
      { action: 'role_line' }>[];
    expect(coldRows).toHaveLength(1);
    expect(coldRows[0]?.actionPhase).toBe('candidates');
    const { goal } = await cold.initialize();
    await cold.advanceTo('regions');
    const holders = await cold.adviserHolders();
    // The `proposals` commit is held so both region lines are scripted before their rounds are claimed.
    const proposals = holdColdStartPhase('proposals', 'RL-24: after the proposals phase commit');
    await cold.setAdviserOpen(holders + 2, 'rl24-limits');
    const row = await cold.waitForExplorations(3);
    await proposals.reached;
    const entries = (row.explorations ?? []) as readonly S7D2Exploration[];
    const srcEntry = entries.find(entry => entry.segment === 'region' && entry.queryRunRef.runId.endsWith(':src'))!;
    const docsEntry = entries.find(entry => entry.segment === 'region' && entry.queryRunRef.runId.endsWith(':docs'))!;
    const ls = await cold.lineOf(srcEntry.sessionRef, 'rl24-src');
    const ld = await cold.lineOf(docsEntry.sessionRef, 'rl24-docs');
    const pin2 = await cold.pin();
    // Step 1: Ls proposes while `docs` is still running; the same round's out-of-region note is refused.
    await cold.host.scripted.script(ls, [{
      kind: 'calls', calls: [
        { callId: 'rl24-prop-a', name: 'propose_architecture_revision', args: { baseCatalogPin: pin2,
          ops: [{ op: 'set_module_name', moduleId: S7D2_MODULE_IDS.region, name: 'source' }],
          responsibilityMoves: [], reason: 'rename src' } },
        { callId: 'rl24-note-a', name: 'record_note', args: { op: 'write', kind: 'pitfall', body: '',
          topic: 'RL-24 out of region', conclusion: 'docs only', anchor: { kind: 'file', path: 'docs/guide.md' } } },
      ],
    }, { kind: 'text', text: 'RL-24: src explored' }]);
    const ldGate = await cold.host.gates.modelRequest(ld);
    await cold.host.scripted.script(ld, [{ kind: 'text', text: 'RL-24: docs explored' }]);
    proposals.release();
    // Ls answers; docs is held at its first model request.
    await cold.waitFor('the Ls proposal call', async () =>
      (await cold.host.scripted.requests(ls)).some(request =>
        request.messages.some(message => message.role === 'tool' && message.callId === 'rl24-prop-a')));
    const lsRequests = await cold.host.scripted.requests(ls);
    const propA = jsonOf(lsRequests, 'rl24-prop-a') as { status: string; proposalRef: ArchitectureProposalRef };
    expect(propA.status).toBe('pending_batch');
    expect(jsonOf(lsRequests, 'rl24-note-a')).toMatchObject({ write: { status: 'rejected', code: 'forbidden',
      reason: 'anchor_out_of_region' } });
    const pendingA = await cold.proposal(propA.proposalRef);
    expect(pendingA.proposal.state).toBe('pending');
    expect(pendingA.batchRef).toBeNull();
    expect(await ldGate.reached);

    // Step 2: `docs` answers; the first freeze takes prop-a alone.
    ldGate.release();
    await cold.waitFor('the first batch', async () => (await cold.proposal(propA.proposalRef)).batchRef !== null);
    const readA = await cold.proposal(propA.proposalRef);
    const batch1 = { aggregateType: 'ArchitectureProposalBatch' as const, projectId: P,
      batchId: batchIdOf(pin2, [propA.proposalRef]) };
    expect(readA.batchRef).toEqual(batch1);
    const cardsAfterFirst = await cold.proposalCards();
    expect(cardsAfterFirst).toHaveLength(1);
    const card1 = cardsAfterFirst[0]!;
    expect(card1.cardKey).toBe(decisionSourceKey({ kind: 'structural_proposal', batch: batch1 }));
    expect(card1.subject).toEqual({ kind: 'project', projectRef: { projectId: P } });
    expect(card1.state).toBe('waiting_answer');

    // Step 3: the Goal's own start on Ls at pin2 proposes prop-b; it becomes its own batch and its own card.
    // The line is scripted before `plans/apply` and the adopted task linked to it; the start after the adoption
    // consumes them (C1TR ruling 2), so the test never sends `select_work` itself.
    await cold.adoptWorkPlan({ goal, label: 'rl24-b', taskId: 'rl24-prop-b-work', line: ls, replies: [{
      kind: 'calls', calls: [{ callId: 'rl24-prop-b', name: 'propose_architecture_revision', args: {
        baseCatalogPin: pin2, ops: [{ op: 'set_responsibility', moduleId: S7D2_MODULE_IDS.region,
          text: 'owns source' }], responsibilityMoves: [], reason: 'own src' } }],
    }, { kind: 'text', text: 'RL-24: prop-b' }] });
    await cold.waitFor('the rl24-b proposal call', async () =>
      (await cold.host.scripted.requests(ls)).some(request =>
        request.messages.some(message => message.role === 'tool' && message.callId === 'rl24-prop-b')));
    const propB = jsonOf(await cold.host.scripted.requests(ls), 'rl24-prop-b') as {
      status: string; proposalRef: ArchitectureProposalRef };
    expect(propB.status).toBe('pending_batch');
    await cold.waitFor('the second batch', async () => (await cold.proposal(propB.proposalRef)).batchRef !== null);
    const readB = await cold.proposal(propB.proposalRef);
    const batch2 = { aggregateType: 'ArchitectureProposalBatch' as const, projectId: P,
      batchId: batchIdOf(pin2, [propB.proposalRef]) };
    expect(readB.batchRef).toEqual(batch2);
    const withSecond = await cold.coldStart();
    expect(withSecond.phase).toBe('running');
    expect(withSecond.batchRefs).toEqual([batch1, batch2]);
    const cards = await cold.proposalCards();
    expect(cards).toHaveLength(2);
    const card2 = proposalCardOf(cards, batch2.batchId);
    expect(card2.state).toBe('waiting_answer');

    // Step 4: approving card1 applies exactly batch1's members: one catalog revision, `source`, not `owns source`.
    const approveBody = graphWrite(S6A_SCOPE, { source: card1.source,
      selection: { kind: 'option', optionId: 'approve' }, text: '', annotations: [] },
    'rl24-approve-card1', card1.source.pins);
    const approved = (await cold.host.post('decisions/answer', approveBody)).body as Record<string, unknown>;
    expect(approved['status']).toBe('ready');
    const pin3 = await cold.pin();
    expect(pin3.catalogRef.revision).toBe(pin2.catalogRef.revision + 1);
    const catalog = valueOf<{ catalog: { catalog: { modules: { ref: { moduleId: string }; name: string;
      responsibility: string }[] } } }>((await cold.host.post('architecture/read', plain(S6A_SCOPE, { selection: { kind: 'current' } }))).body, 'ready', 'the revised catalog');
    const srcModule = catalog.catalog.catalog.modules.find(module => module.ref.moduleId === S7D2_MODULE_IDS.region)!;
    expect(srcModule.name).toBe('source');
    expect(srcModule.responsibility).not.toBe('owns source');
    const afterA = await cold.proposal(propB.proposalRef);
    expect(afterA.proposal.state).toBe('pending');
    expect(afterA.batchRef).toEqual(batch2);
    expect(proposalCardOf(await cold.proposalCards(), batch2.batchId).state).toBe('waiting_answer');
    expect((await cold.coldStart()).phase).toBe('running');

    // Step 5 (memory): the same request id replays the answer. On SQLite the replay crosses the Host restart
    // after step 8, so the restart cannot leave step 7's autonomous Run half-started.
    const resultWithoutReplay = (body: Record<string, unknown>): unknown => JSON.parse(JSON.stringify(body),
      (key, value) => key === 'replayed' ? undefined : value) as unknown;
    if (backend === 'memory') {
      const replayed = (await cold.host.post('decisions/answer', approveBody)).body as Record<string, unknown>;
      expect(resultWithoutReplay(replayed)).toEqual(resultWithoutReplay(approved));
      expect((await cold.pin()).catalogRef.revision).toBe(pin3.catalogRef.revision);
    }

    // Step 6: card2's batch is based on pin2; approving it now is `source_stale`, no revision, and completes the
    // run. The queue re-reads the card's source pins at the current pointers, so the answer carries the batch pin
    // at its own revision and the moved active pointer; the batch's base pin is what 8C finds stale.
    const card2Now = proposalCardOf(await cold.proposalCards(), batch2.batchId);
    expect(card2Now.state).toBe('waiting_answer');
    const staleBody = graphWrite(S6A_SCOPE, { source: card2Now.source,
      selection: { kind: 'option', optionId: 'approve' }, text: '', annotations: [] },
    'rl24-approve-card2', card2Now.source.pins);
    expect((await cold.host.post('decisions/answer', staleBody)).body).toMatchObject({ status: 'ready' });
    const afterB = await cold.proposal(propB.proposalRef);
    expect(afterB.proposal.state).toBe('stale');
    expect((await cold.pin()).catalogRef.revision).toBe(pin3.catalogRef.revision);
    const final = await cold.waitForPhase('completed');
    expect(final.phase).toBe('completed');
    expect(final.actionPhase).toBe('proposals');
    expect(final.lastCompleted).toBe('proposals');
    expect(final.batchRefs).toEqual([batch1, batch2]);

    // Step 7: on pin3 the same way, a new task's proposal is its own new batch (8C's normal immediate freeze),
    // and the finished cold start's batchRefs do not change. Ls is free before the new task is adopted.
    await cold.waitFor('the Ls line free', async () =>
      (await cold.host.readSession(ls.ref)).record.occupancy === null);
    // The sibling node's Run has ended but the node is still `verifying` until its TaskReduction lands; the Goal's
    // `every_step` gate claims nothing while it is (`nodeInFlight`). Read the published node rows (nr adds no
    // route; the `goals/delivery` page read is acc's, NR-16) and continue once that node no longer blocks a claim.
    await cold.waitFor('the rl24-b node reduction', async () => {
      const read = await cold.host.platform.nodeCommits.readNodeRows(cold.host.humanContext(), { goalRef: goal });
      const sibling = readReady(read, 'the node rows').rows
        .find(row => row.task.taskId === 'rl24-prop-b-work');
      return sibling !== undefined && sibling.reduction !== null && !sibling.pending;
    });
    const pinNow = await cold.pin();
    await cold.adoptWorkPlan({ goal, label: 'rl24-c', taskId: 'rl24-prop-c-work', line: ls, replies: [{
      kind: 'calls', calls: [{ callId: 'rl24-prop-c', name: 'propose_architecture_revision', args: {
        baseCatalogPin: pinNow, ops: [{ op: 'set_module_name', moduleId: S7D2_MODULE_IDS.region, name: 'source3' }],
        responsibilityMoves: [], reason: 'rename again' } }],
    }, { kind: 'text', text: 'RL-24: prop-c' }] });
    await cold.waitFor('the rl24-c proposal call', async () =>
      (await cold.host.scripted.requests(ls)).some(request =>
        request.messages.some(message => message.role === 'tool' && message.callId === 'rl24-prop-c')));
    const propC = jsonOf(await cold.host.scripted.requests(ls), 'rl24-prop-c') as {
      status: string; proposalRef: ArchitectureProposalRef };
    // The cold start has completed: 8C freezes this one immediately, so the call already names its batch.
    expect(propC.status).toBe('needs_decision');
    await cold.waitFor('the third batch', async () => (await cold.proposal(propC.proposalRef)).batchRef !== null);
    const batch3 = { aggregateType: 'ArchitectureProposalBatch' as const, projectId: P,
      batchId: batchIdOf(pinNow, [propC.proposalRef]) };
    expect((await cold.proposal(propC.proposalRef)).batchRef).toEqual(batch3);
    // The approved and stale cards left the queue; only the new immediate batch's card waits.
    expect(await cold.proposalCards()).toHaveLength(1);
    expect((await cold.coldStart()).batchRefs).toEqual([batch1, batch2]);

    // Step 8: neither region round's model request offers `create_member`.
    for (const line of [ls, ld]) {
      const requests = await cold.host.scripted.requests(line);
      expect(requests.length).toBeGreaterThan(0);
      expect(requests[0]!.tools.map(tool => tool.name)).not.toContain('create_member');
    }

    // Step 5 (SQLite): the replay crosses a Host restart and still returns the original applied result.
    if (backend === 'sqlite') {
      await cold.host.crash();
      const replayed = (await cold.host.post('decisions/answer', approveBody)).body as Record<string, unknown>;
      expect(resultWithoutReplay(replayed)).toEqual(resultWithoutReplay(approved));
      expect((await cold.pin()).catalogRef.revision).toBe(pin3.catalogRef.revision);
    }
  }, 300_000);

  // -------------------------------------------------------------------------
  // C1 rulings 5 items 1–4 (11-06): the four acceptance cells. Each names one hand-computed identity and one
  // mutation of `src/` that changes exactly the rule it claims. (1)(2) are memory; (3)(4) crash/reopen on SQLite.
  // -------------------------------------------------------------------------

  it('RL-24 (1) (memory): a new-pin proposal while the run waits at proposals freezes alone', async () => {
    const cold = await openS7D2ColdStartWorld({ backend: 'memory' });
    worlds.push(cold);
    const { goal } = await cold.initialize();
    await cold.advanceTo('regions');
    const holders = await cold.adviserHolders();
    const proposals = holdColdStartPhase('proposals', 'RL-24 (1): after the proposals phase commit');
    await cold.setAdviserOpen(holders + 2, 'rl24-1-limits');
    const row = await cold.waitForExplorations(3);
    await proposals.reached;
    const srcEntry = (row.explorations ?? []).find(entry => entry.segment === 'region'
      && entry.queryRunRef.runId.endsWith(':src'))!;
    const docsEntry = (row.explorations ?? []).find(entry => entry.segment === 'region'
      && entry.queryRunRef.runId.endsWith(':docs'))!;
    const ls = await cold.lineOf(srcEntry.sessionRef, 'rl24-1-src');
    const ld = await cold.lineOf(docsEntry.sessionRef, 'rl24-1-docs');
    const pin2 = await cold.pin();
    await cold.host.scripted.script(ls, proposalReplies('rl24-1-prop-a', pin2,
      [{ op: 'set_module_name', moduleId: S7D2_MODULE_IDS.region, name: 'source' }], 'rl24-1 batch one'));
    await cold.host.scripted.script(ld, [{ kind: 'text', text: 'RL-24 (1): docs explored' }]);
    proposals.release();
    await cold.waitFor('the rl24-1 prop-a call', async () =>
      (await cold.host.scripted.requests(ls)).some(request =>
        request.messages.some(message => message.role === 'tool' && message.callId === 'rl24-1-prop-a')));
    const propA = jsonOf(await cold.host.scripted.requests(ls), 'rl24-1-prop-a') as {
      status: string; proposalRef: ArchitectureProposalRef };
    await cold.waitFor('the rl24-1 first batch', async () =>
      (await cold.proposal(propA.proposalRef)).batchRef !== null);
    const batch1 = { aggregateType: 'ArchitectureProposalBatch' as const, projectId: P,
      batchId: batchIdOf(pin2, [propA.proposalRef]) };
    expect((await cold.proposal(propA.proposalRef)).batchRef).toEqual(batch1);
    const card1 = proposalCardOf(await cold.proposalCards(), batch1.batchId);
    // The approval moves the catalog to pin3; the lifecycle's completion is held so the pin3 proposal is submitted
    // while the run is still at `proposals`. Hand-computed batch: batchId = sha256({ baseCatalogPin: pin3,
    // members: [new ref] }); one card on that batch.
    const completed = commitBarrier.hold(coldStartCompletionCommit, 'RL-24 (1): before the cold-start completion');
    try {
      await cold.approve(card1, 'rl24-1-approve');
      const pin3 = await cold.pin();
      expect(pin3.catalogRef.revision).toBe(pin2.catalogRef.revision + 1);
      await cold.adoptWorkPlan({ goal, label: 'rl24-1-late', taskId: 'rl24-1-late-work', line: ls,
        replies: proposalReplies('rl24-1-prop-new', pin3,
          [{ op: 'set_module_name', moduleId: S7D2_MODULE_IDS.region, name: 'source-late' }], 'rl24-1 new pin') });
      await cold.waitFor('the rl24-1 new-pin call', async () =>
        (await cold.host.scripted.requests(ls)).some(request =>
          request.messages.some(message => message.role === 'tool' && message.callId === 'rl24-1-prop-new')));
      const propNew = jsonOf(await cold.host.scripted.requests(ls), 'rl24-1-prop-new') as {
        status: string; proposalRef: ArchitectureProposalRef };
      // Named mutation (ruling 1): `createColdStartProposalWindow` keeps only `action.phase === 'proposals'` and
      // drops the proposal-vs-run `baseCatalogPin` comparison, so this call writes `pending_batch`; red here.
      expect(propNew.status).toBe('needs_decision');
      const batchNew = { aggregateType: 'ArchitectureProposalBatch' as const, projectId: P,
        batchId: batchIdOf(pin3, [propNew.proposalRef]) };
      expect((await cold.proposal(propNew.proposalRef)).batchRef).toEqual(batchNew);
      expect(proposalCardOf(await cold.proposalCards(), batchNew.batchId).state).toBe('waiting_answer');
      completed.release();
      await cold.waitForPhase('completed');
      // The finished run keeps batch1; the new-pin batch is 8C's normal immediate freeze, not a `batchRef:null` pending.
      expect((await cold.coldStart()).batchRefs).toEqual([batch1]);
      expect((await cold.proposal(propNew.proposalRef)).batchRef).toEqual(batchNew);
    } finally {
      completed.release();
    }
  }, 300_000);

  it('RL-24 (2) (memory): a late proposal that read the open window before completion freezes alone', async () => {
    const cold = await openS7D2ColdStartWorld({ backend: 'memory' });
    worlds.push(cold);
    const { goal } = await cold.initialize();
    await cold.advanceTo('regions');
    const holders = await cold.adviserHolders();
    // Hold the completion commit: the proposal below reads the window while the run is still at `proposals`.
    const completed = commitBarrier.hold(coldStartCompletionCommit, 'RL-24 (2): before the cold-start completion');
    const proposals = holdColdStartPhase('proposals', 'RL-24 (2): after the proposals phase commit');
    await cold.setAdviserOpen(holders + 2, 'rl24-2-limits');
    const row = await cold.waitForExplorations(3);
    await proposals.reached;
    const srcEntry = (row.explorations ?? []).find(entry => entry.segment === 'region'
      && entry.queryRunRef.runId.endsWith(':src'))!;
    const docsEntry = (row.explorations ?? []).find(entry => entry.segment === 'region'
      && entry.queryRunRef.runId.endsWith(':docs'))!;
    const ls = await cold.lineOf(srcEntry.sessionRef, 'rl24-2-src');
    const ld = await cold.lineOf(docsEntry.sessionRef, 'rl24-2-docs');
    const pin2 = await cold.pin();
    await cold.host.scripted.script(ls, [{ kind: 'text', text: 'RL-24 (2): src explored' }]);
    await cold.host.scripted.script(ld, [{ kind: 'text', text: 'RL-24 (2): docs explored' }]);
    proposals.release();
    await cold.waitForPhase('proposals');
    // Both region rounds answer without proposing, so the only thing left is the completion; it is held now.
    await completed.reached;
    // Hold the proposal commit itself: the propose read the window open and now waits before its store call.
    const proposalCommit = commitBarrier.hold(byIdentityPrefix('architecture-proposal-propose:'),
      'RL-24 (2): before the late proposal commit');
    try {
      await cold.adoptWorkPlan({ goal, label: 'rl24-2-late', taskId: 'rl24-2-late-work', line: ls,
        replies: proposalReplies('rl24-2-prop', pin2,
          [{ op: 'set_responsibility', moduleId: S7D2_MODULE_IDS.region, text: 'owns source' }], 'rl24-2 late') });
      await proposalCommit.reached;
      // The lifecycle finishes the run while the proposal commit waits; the fix re-reads the now-closed window.
      completed.release();
      await cold.waitForPhase('completed');
      proposalCommit.release();
      await cold.waitFor('the rl24-2 proposal result', async () =>
        (await cold.host.scripted.requests(ls)).some(request =>
          request.messages.some(message => message.role === 'tool' && message.callId === 'rl24-2-prop')));
      const prop = jsonOf(await cold.host.scripted.requests(ls), 'rl24-2-prop') as {
        status: string; proposalRef: ArchitectureProposalRef };
      // Named mutation (ruling 2): drop the cold-start revision guard from the proposal commit (the window is only a
      // boolean read), so the commit lands after the completion as `pending_batch`; red here.
      expect(prop.status).toBe('needs_decision');
      const batch = { aggregateType: 'ArchitectureProposalBatch' as const, projectId: P,
        batchId: batchIdOf(pin2, [prop.proposalRef]) };
      expect((await cold.proposal(prop.proposalRef)).batchRef).toEqual(batch);
      expect(proposalCardOf(await cold.proposalCards(), batch.batchId).state).toBe('waiting_answer');
      expect(await cold.coldStart()).toMatchObject({ phase: 'completed' });
    } finally {
      completed.release();
      proposalCommit.release();
    }
  }, 300_000);

  it('RL-24 (3) (SQLite only): a frozen first batch restores as it was; late proposals each get a batch', async () => {
    const cold = await openS7D2ColdStartWorld({ backend: 'sqlite' });
    worlds.push(cold);
    const { goal } = await cold.initialize();
    await cold.advanceTo('regions');
    const holders = await cold.adviserHolders();
    // The freeze commit lands, but the `cold_start` write that saves `batchRefs` is held: the crash leaves the
    // frozen batch in the store and an empty `batchRefs` in the operation (ruling 3's window).
    const save = commitBarrier.hold(coldStartBatchSaveCommit, 'RL-24 (3): before the batchRefs save');
    const proposals = holdColdStartPhase('proposals', 'RL-24 (3): after the proposals phase commit');
    // Two free seats: `holders` may still count only the opening adviser line while `src` registers, so a
    // `holders + 1` cap would leave one region pending at the cap with nothing to wake it.
    await cold.setAdviserOpen(holders + 2, 'rl24-3-limits');
    const row = await cold.waitForExplorations(3);
    await proposals.reached;
    const srcEntry = (row.explorations ?? []).find(entry => entry.segment === 'region'
      && entry.queryRunRef.runId.endsWith(':src'))!;
    const docsEntry = (row.explorations ?? []).find(entry => entry.segment === 'region'
      && entry.queryRunRef.runId.endsWith(':docs'))!;
    const ls = await cold.lineOf(srcEntry.sessionRef, 'rl24-3-src');
    const ld = await cold.lineOf(docsEntry.sessionRef, 'rl24-3-docs');
    const pin2 = await cold.pin();
    await cold.host.scripted.script(ls, proposalReplies('rl24-3-prop-a', pin2,
      [{ op: 'set_module_name', moduleId: S7D2_MODULE_IDS.region, name: 'source' }], 'rl24-3 batch one'));
    await cold.host.scripted.script(ld, [{ kind: 'text', text: 'RL-24 (3): docs explored' }]);
    proposals.release();
    await cold.waitFor('the rl24-3 prop-a call', async () =>
      (await cold.host.scripted.requests(ls)).some(request =>
        request.messages.some(message => message.role === 'tool' && message.callId === 'rl24-3-prop-a')));
    const propA = jsonOf(await cold.host.scripted.requests(ls), 'rl24-3-prop-a') as {
      status: string; proposalRef: ArchitectureProposalRef };
    await cold.waitFor('the rl24-3 first batch', async () =>
      (await cold.proposal(propA.proposalRef)).batchRef !== null);
    const batch1 = { aggregateType: 'ArchitectureProposalBatch' as const, projectId: P,
      batchId: batchIdOf(pin2, [propA.proposalRef]) };
    await save.reached;
    expect((await cold.coldStart()).batchRefs ?? []).toEqual([]);
    try {
      // First late, compatible proposal: the window is still open (the save is waiting), so it is `pending_batch`.
      await cold.adoptWorkPlan({ goal, label: 'rl24-3-late1', taskId: 'rl24-3-late1-work', line: ls,
        replies: proposalReplies('rl24-3-late1', pin2,
          [{ op: 'set_module_name', moduleId: S7D2_MODULE_IDS.region, name: 'source-late1' }], 'rl24-3 late 1') });
      await cold.waitFor('the rl24-3 late1 call', async () =>
        (await cold.host.scripted.requests(ls)).some(request =>
          request.messages.some(message => message.role === 'tool' && message.callId === 'rl24-3-late1')));
      const late1 = jsonOf(await cold.host.scripted.requests(ls), 'rl24-3-late1') as {
        status: string; proposalRef: ArchitectureProposalRef };
      expect(late1.status).toBe('pending_batch');
      // Let that Work Run end before the break: the crash must leave the pending proposal, not a half-open turn.
      await cold.waitFor('the Ls line free before the crash', async () =>
        (await cold.host.readSession(ls.ref)).record.occupancy === null);
      await cold.host.crash();
      // Second late, compatible proposal: it lands while the reopened run recovers, so both late proposals are
      // pending together if the restore is still below the pending read (the bug).
      await cold.waitFor('the Ls line free after the crash', async () =>
        (await cold.host.readSession(ls.ref)).record.occupancy === null);
      const late2Task = await cold.adoptWorkPlan({ goal, label: 'rl24-3-late2', taskId: 'rl24-3-late2-work',
        line: ls, replies: proposalReplies('rl24-3-late2', pin2,
          [{ op: 'set_module_name', moduleId: S7D2_MODULE_IDS.region, name: 'source-late2' }], 'rl24-3 late 2') });
      // The first late task interrupted by the crash is still pending, so the Goal's own start may pick it; drive
      // the new task directly through the same public `workflow/advance` step (`runWork`), consuming the queued script.
      await cold.runWork({ line: ls, task: late2Task, label: 'rl24-3-late2-run', replies: [] });
      await cold.waitFor('the rl24-3 late2 call', async () =>
        (await cold.host.scripted.requests(ls)).some(request =>
          request.messages.some(message => message.role === 'tool' && message.callId === 'rl24-3-late2')));
      const late2 = jsonOf(await cold.host.scripted.requests(ls), 'rl24-3-late2') as {
        status: string; proposalRef: ArchitectureProposalRef };
      await cold.waitFor('the rl24-3 late1 batch', async () =>
        (await cold.proposal(late1.proposalRef)).batchRef !== null);
      await cold.waitFor('the rl24-3 late2 batch', async () =>
        (await cold.proposal(late2.proposalRef)).batchRef !== null);
      const resumed = await cold.coldStart();
      // Hand-computed: batch1 = sha256({ baseCatalogPin: pin2, members: [prop-a] }) and it is the restored first
      // entry; each late proposal is its own single-member batch on pin2.
      expect(resumed.batchRefs?.[0]).toEqual(batch1);
      expect((await cold.proposal(late1.proposalRef)).batchRef).toEqual(
        { aggregateType: 'ArchitectureProposalBatch', projectId: P,
          batchId: batchIdOf(pin2, [late1.proposalRef]) });
      expect((await cold.proposal(late2.proposalRef)).batchRef).toEqual(
        { aggregateType: 'ArchitectureProposalBatch', projectId: P,
          batchId: batchIdOf(pin2, [late2.proposalRef]) });
      // Named mutation (ruling 3): move the `readFrozenArchitectureBatches` restore block back below the pending
      // read/freeze in `proposalsPhase`, so `batchRefs` still starts empty after the crash and the frozen batch1 is
      // never restored (and the two late proposals can merge); red here, on `batchRefs[0]`.
      expect(resumed.batchRefs).toContainEqual(batch1);
    } finally {
      save.release();
    }
  }, 300_000);

  it('RL-24 (4) (SQLite only): a submitted exploration Query resumes from its stored run after a budget change', async () => {
    const cold = await openS7D2ColdStartWorld({ backend: 'sqlite' });
    worlds.push(cold);
    const { goal } = await cold.initialize({ coarseProposal: false });
    await cold.waitForPhase('route');
    await cold.host.scripted.script(cold.lines.adviser, [{ kind: 'text', text: 'RL-24 (4): coarse explored' }]);
    // The Query commit lands, then the cold-start write that saves its exploration entry is held: the crash sits
    // exactly between the two commits (ruling 4).
    const entrySave = commitBarrier.hold(coldStartEntryCommit('coarse_split'),
      'RL-24 (4): before the coarse exploration entry save');
    await cold.submitContinuation('split', 'rl24-4-route-split');
    await cold.waitForPhase('coarse_split');
    const refs = coarseSplitQueryRefs(P);
    await entrySave.reached;
    expect((await cold.coldStart()).explorations ?? []).toEqual([]);
    // The next Host start reads a different adviser Query budget; the retry must not resubmit the same identity.
    cold.setAdviserProfileBudget({ maxTokens: 123_456, deadline: null });
    await cold.host.crash();
    try {
      await expect.poll(async () => ((await cold.coldStart()).explorations ?? []).length,
        { timeout: 15_000, interval: 100 }).toBe(1);
      const resumed = await cold.coldStart();
      // The restored entry is the stored Query's own run, not a new submission.
      expect(resumed.explorations?.[0]?.queryRunRef).toEqual(refs.queryRunRef);
      expect((await cold.query(refs.queryJobRef)).run.ref).toEqual(refs.queryRunRef);
      // The provider records the request before its text and finish events: wait for the answer itself.
      await cold.waitFor('the resumed coarse round answered', async () =>
        (await cold.query(refs.queryJobRef)).job.job.status === 'answered');
      // Named mutation (ruling 4): drop `readQueryJob` from the narrow port / skip the pre-read and always submit
      // the intent built from the CURRENT profile; the changed budget makes the same queryJob identity a different
      // fingerprint, the cold start gets `idempotency_conflict`, and this poll never sees an entry.
    } finally {
      entrySave.release();
    }
    void goal;
  }, 300_000);
});
