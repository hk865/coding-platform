/**
 * RL-23 (`book-7d2-frozen.md` §3.13 :749–:836, RL :1326; the frozen test brief of 11-06; C1-15/C1-16 of the drill
 * draft `:210–:211`): the six cold-start phases, the restart at each phase, and the `role_exploration` round.
 *
 * The world is `tests/helpers/S7D2-coldstart-world.ts`: the SE2 host world with `defaultGoals:false`, the empty
 * catalog adopted through 8A's public step, a two-`plan_only`-task first Plan, the opening lines, and the public
 * steps of `candidates → adopted → route → coarse_split → regions → proposals`. Every state and every expectation
 * comes from a public route or the scripted model (rule sheet A8); no record, context or store is read or written.
 *
 * Named mutation for the phase rows (`book-7d2-frozen.md:1326`): the driver rebuilds the phase from a fresh read
 * instead of the stored pointer (e.g. "an adopted catalog means `route`"): the crash rows then skip the stored phase
 * (9a reads a different `actionPhase`), and RL-23a's step 3 reads `route` instead of `adopted`, red.
 * Named mutation for 9b: a `not_entered` round is treated as ended → the second coarse entry never appears, the
 * phase stays `coarse_split`, red.
 * Named mutation for 23b: the exploration flag is passed only to the start side, not the preparation side → the
 * round's model request never arrives, step 1 red.
 * Named mutation for 23c: the region open takes a new line instead of trying `reuseStandby` → the `docs` entry's
 * `sessionRef` is a new line and the adviser line count grows by one more, red.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommitMatch } from '../helpers/S6A-commit-barrier.js';
import { commitBarrier, byIdentityPrefix } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { queryJobRefOfRun } from '../helpers/S7D2-coldstart-world.js';
import { readBody } from '../helpers/IV-host-fixture.js';
import { jsonOf } from '../helpers/S7C-member-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { startLinesOf, changeS7D2Scope, openS7D2Line } from '../helpers/S7D2-role-line-world.js';
import { PL_ADVISER_ROLE } from '../helpers/PL-consumption-fixture.js';
import {
  COLDSTART_COARSE_QUESTION, COLDSTART_ROUTE_QUESTION, COLDSTART_SOURCE_FILES,
  coldStartCoarseProposal, coldStartRegionQuestion, coarseSplitQueryRefs, holdColdStartPhase,
  openS7D2ColdStartWorld, regionQueryRefs, startLinesOperationRef,
  type S7D2ColdStartWorld, type S7D2Exploration,
} from '../helpers/S7D2-coldstart-world.js';
import { holdGate, type KLS2CHoldPoint } from '../helpers/KLS2C-knowledge-host.js';
import { coldStartOperationRef } from '../../src/core/work-graph/state/cold-start.js';
import type { RoleScopeV1 } from '../../src/contracts/role-lines.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';

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

async function opened(backend: 'memory' | 'sqlite'): Promise<S7D2ColdStartWorld> {
  const world = await openS7D2ColdStartWorld({ backend });
  worlds.push(world);
  return world;
}

/** A commit that creates the region line of `moduleId` under the cold-start operation. */
function regionOpenCommit(moduleId: string): CommitMatch {
  const parent = coldStartOperationRef(P);
  return commit => commit.identityKey.includes(`cold-start-region:${parent.operationId}:${moduleId}`)
    || commit.records.some(record => {
      let value: unknown;
      try { value = JSON.parse(record.json) as unknown; } catch { return false; }
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
      const row = value as Record<string, unknown>;
      const ref = row['ref'];
      const action = row['action'];
      if (typeof ref !== 'object' || ref === null
        || (ref as Record<string, unknown>)['aggregateType'] !== 'CoreOperation') return false;
      if (typeof action !== 'object' || action === null) return false;
      const actionRow = action as Record<string, unknown>;
      if (actionRow['kind'] !== 'create') return false;
      const operation = actionRow['parentOperation'];
      if (typeof operation !== 'object' || operation === null
        || (operation as Record<string, unknown>)['operationId'] !== parent.operationId) return false;
      // The create action stores the line's scopes as `initialLinks` (the role scope is not a field of its own).
      const links = Array.isArray(actionRow['initialLinks']) ? actionRow['initialLinks'] as unknown[] : [];
      return links.some(link => {
        if (typeof link !== 'object' || link === null) return false;
        const target = (link as Record<string, unknown>)['target'];
        if (typeof target !== 'object' || target === null) return false;
        const targetRow = target as Record<string, unknown>;
        const ref = targetRow['ref'];
        return targetRow['kind'] === 'module' && typeof ref === 'object' && ref !== null
          && (ref as Record<string, unknown>)['moduleId'] === moduleId;
      });
    });
}

const expectColdStartRow = (rows: readonly { action: string; operation: { operationId: string } }[]): void => {
  expect(rows.filter(row => row.action === 'role_line'
    && row.operation.operationId === coldStartOperationRef(P).operationId)).toHaveLength(1);
};

const explorationOf = async (world: S7D2ColdStartWorld, segment: 'coarse_split' | 'region', suffix: string):
Promise<S7D2Exploration> => {
  const row = await world.coldStart();
  const entry = (row.explorations ?? []).find(candidate => candidate.segment === segment
    && candidate.queryRunRef.runId.endsWith(`:${suffix}`));
  if (entry === undefined) throw new Error(`RL-23: no ${segment} exploration for ${suffix}: ${JSON.stringify(row.explorations)}`);
  return entry;
};

/**
 * Ruling 7: within one world the stored candidate must keep the original answer and the original round's run.
 * `snapshot()` keeps only the cross-world normalization; the candidate's two real refs are checked here.
 */
const expectCandidateKept = async (cold: S7D2ColdStartWorld): Promise<void> => {
  const candidate = cold.initial();
  const job = await cold.query(candidate.round);
  expect((await cold.coldStart()).candidate).toEqual({ queryRunRef: job.run.ref, answerRef: candidate.answerRef });
};

describe('RL-23: the cold start and the exploration round', () => {
  it('RL-23a (memory): candidates → adopted → route → coarse_split → regions → proposals → completed', async () => {
    const cold = await opened('memory');
    expectColdStartRow(await cold.operations());
    const projectId = P;

    // Step 1: exactly the start_lines row and the cold_start row, the cold start at `candidates`.
    const initialRows = await cold.operations();
    expect(initialRows).toHaveLength(2);
    const start = startLinesOf(initialRows);
    expect(start?.operation).toEqual(startLinesOperationRef(projectId));
    expect(start?.phase).toBe('completed');
    expect(start?.steps.map(step => step.state)).toEqual(['done', 'done', 'done']);
    const before = await cold.coldStart();
    expect(before.operation).toEqual(coldStartOperationRef(projectId));
    expect(before.phase).toBe('running');
    expect(before.actionPhase).toBe('candidates');
    expect(before.steps).toEqual([]);
    expect(before.result ?? null).toBeNull();
    expect(before.lastCompleted ?? null).toBeNull();
    expect(before.candidate ?? null).toBeNull();
    expect(before.pendingRegions ?? []).toEqual([]);
    expect(before.explorations ?? []).toEqual([]);
    expect(before.batchRefs ?? []).toEqual([]);
    expect(before.route ?? null).toBeNull();
    expect(before.baseCatalogPin ?? null).toBeNull();

    // Step 3: the initial answer is stored as the candidate, the Query still goal-less and answered.
    const candidate = await cold.submitInitialPlan();
    const job = await cold.query(candidate.round);
    expect(job.job.job.goalId).toBeNull();
    expect(job.job.job.status).toBe('answered');
    const adoptedRow = await cold.waitForPhase('adopted');
    expect(adoptedRow.lastCompleted).toBe('candidates');
    expect(adoptedRow.candidate).toEqual({ queryRunRef: job.run.ref, answerRef: candidate.answerRef });
    const storedAnswer = valueOf<{ answer: { answer: string } }>((await cold.host.post('queries/answer',
      { scope: S6A_SCOPE, input: candidate.answerRef })).body, 'ready', 'the stored answer');
    expect(storedAnswer.answer.answer).toBe(candidate.answerText);

    // Step 4: the governance adoption alone does not advance the phase; the initialization adoption does.
    const pin1 = await cold.adoptGovernance();
    expect((await cold.coldStart()).actionPhase).toBe('adopted');
    const goal = await cold.confirmDraft(candidate);
    expect((await cold.coldStart()).actionPhase).toBe('adopted');
    await cold.prepareRouteScripts({ routeAnswer: 'split' });
    await cold.adopt(candidate, goal);
    const routeRow = await cold.waitForPhase('route');
    expect(routeRow.lastCompleted).toBe('adopted');

    // Step 2: the seat read at this moment, the adviser cap exactly one above it.
    const holders = await cold.adviserHolders();
    await cold.setAdviserOpen(holders + 1, 'rl23a-limits-one');

    // Step 5: the route round is one system round on the initial request; a question keeps the phase and writes no
    // card and no second route question; the person's `split` advances and stores the pre-split pin.
    const routeRound = await cold.routeRound();
    const requestView = await cold.host.readRequest(candidate.requestRoot);
    // `goals/confirm-draft` adds one `routing` attribution round; it is not a conversation round.
    expect(requestView.rounds.filter(round => round.kind !== 'routing').map(round => round.input))
      .toEqual(['C1T: prepare the first plan', COLDSTART_ROUTE_QUESTION]);
    expect(requestView.rounds.find(round => round.ref.queryJobId === routeRound.queryJobId)?.session?.sessionId)
      .toBe(cold.lines.secretary.ref.sessionId);
    await cold.waitForRequestRoundEnded(routeRound);
    expect((await cold.coldStart()).actionPhase).toBe('route');
    expect((await cold.cards()).filter(card => card.source.kind === 'structural_proposal')).toEqual([]);
    expect((await cold.host.readRequest(candidate.requestRoot)).rounds.filter(round => round.kind !== 'routing'))
      .toHaveLength(2);
    await cold.submitContinuation('split', 'rl23a-route-split');
    const coarseRow = await cold.waitForPhase('coarse_split');
    expect(coarseRow.lastCompleted).toBe('route');
    expect(coarseRow.route).toBe('split');
    expect(coarseRow.baseCatalogPin).toEqual(pin1);

    // Step 6: one coarse-split message to the opening adviser and exactly one exploration entry.
    const coarseInbox = await cold.inbox(cold.lines.adviser);
    expect(coarseInbox).toHaveLength(1);
    expect(coarseInbox[0]).toMatchObject({ sender: { kind: 'host', actor: { kind: 'system' } },
      intent: 'action_request' });
    expect(await readBody(cold.host, coarseInbox[0]!.ref, 'message')).toBe(
      'Please act: read only the top-level directories, entry points and existing docs, then propose the coarse split.');
    const coarseEntry = await explorationOf(cold, 'coarse_split', 'root');
    expect(coarseEntry.sessionRef.sessionId).toBe(cold.lines.adviser.ref.sessionId);
    expect(coarseEntry.messageRef).toEqual(coarseInbox[0]!.ref);
    expect(coarseEntry.operationRef).toEqual(startLinesOperationRef(projectId));
    expect(coarseEntry.queryRunRef).toEqual(coarseSplitQueryRefs(projectId).queryRunRef);
    const coarseQuery = await cold.query(queryJobRefOfRun(coarseEntry.queryRunRef));
    expect(coarseQuery.job.job.goalId).toBeNull();
    expect(coarseQuery.job.job.intent.execution.kind).toBe('role_exploration');
    await cold.waitFor('the coarse-split card', async () => (await cold.proposalCards()).length === 1);
    expect((await cold.coldStart()).actionPhase).toBe('coarse_split');
    await cold.approve((await cold.proposalCards())[0]!, 'rl23a-approve-coarse');
    const regionsRow = await cold.waitForPhase('regions');
    expect(regionsRow.lastCompleted).toBe('coarse_split');
    const pin2 = await cold.pin();
    expect(pin2.catalogRef.revision).toBeGreaterThan(pin1.catalogRef.revision);

    // Step 7: the top-level modules are `src` and `docs`; only `src` opens at one free seat; `docs` is pending.
    const catalog = valueOf<{ catalog: { catalog: { modules: { ref: { moduleId: string } }[];
      containment?: { parentOf: { parent: { moduleId: string }; child: { moduleId: string } }[] } } } }>(
      (await cold.host.post('architecture/read', { scope: S6A_SCOPE,
        input: { selection: { kind: 'current' } } })).body, 'ready', 'the adopted catalog');
    const adopted = catalog.catalog.catalog;
    const childIds = new Set((adopted.containment?.parentOf ?? []).map(edge => edge.child.moduleId));
    // G1: a catalog read back from the knowledge files is in module-id order.
    expect(adopted.modules.map(module => module.ref.moduleId)).toEqual(['docs', 'src', 'src/a', 'src/b']);
    expect(adopted.modules.filter(module => !childIds.has(module.ref.moduleId)).map(module => module.ref.moduleId))
      .toEqual(['docs', 'src']);
    await cold.waitForExplorations(2);
    const afterSrc = await cold.coldStart();
    expect(afterSrc.actionPhase).toBe('regions');
    expect(afterSrc.pendingRegions).toEqual([{ projectId, moduleId: 'docs' }]);
    expect((afterSrc.explorations ?? []).map(entry => entry.segment)).toEqual(['coarse_split', 'region']);
    const srcEntry = await explorationOf(cold, 'region', 'src');
    expect(srcEntry.operationRef).toEqual(coldStartOperationRef(projectId));
    const srcLine = await cold.lineOf(srcEntry.sessionRef, 'rl23a-src');
    const srcCard = await cold.host.readSession(srcLine.ref);
    expect(srcCard.roleFacts?.openedBy).toBe('cold_start');
    expect(srcCard.roleFacts?.originOperation).toEqual(coldStartOperationRef(projectId));
    const srcInbox = await cold.inbox(srcLine);
    expect(srcInbox).toHaveLength(1);
    expect(await readBody(cold.host, srcInbox[0]!.ref, 'message')).toBe(coldStartRegionQuestion('src'));
    // One more seat: `docs` opens and the phase reaches `proposals` on the pin the coarse split was applied on.
    const proposals = holdColdStartPhase('proposals', 'RL-23a: after the proposals phase commit');
    await cold.setAdviserOpen(holders + 2, 'rl23a-limits-two');
    const three = await cold.waitForExplorations(3);
    expect((three.explorations ?? []).map(entry => entry.segment)).toEqual(['coarse_split', 'region', 'region']);
    const docsEntry = await explorationOf(cold, 'region', 'docs');
    const docsLine = await cold.lineOf(docsEntry.sessionRef, 'rl23a-docs');
    const docsInbox = await cold.inbox(docsLine);
    expect(docsInbox).toHaveLength(1);
    expect(await readBody(cold.host, docsInbox[0]!.ref, 'message')).toBe(coldStartRegionQuestion('docs'));
    await proposals.reached;
    await cold.scriptRegions(moduleId => [{ kind: 'text', text: `RL-23a: region ${moduleId} explored` }]);
    proposals.release();
    const proposalsRow = await cold.waitForPhase('proposals');
    expect(proposalsRow.pendingRegions ?? []).toEqual([]);
    expect(proposalsRow.baseCatalogPin).toEqual(pin2);

    // Step 8: both region rounds answered, no proposal: completed with an empty batch list.
    const final = await cold.waitForPhase('completed');
    expect(final.phase).toBe('completed');
    expect(final.actionPhase).toBe('proposals');
    expect(final.lastCompleted).toBe('proposals');
    expect(final.pendingRegions ?? []).toEqual([]);
    expect(final.explorations).toHaveLength(3);
    expect(final.batchRefs ?? []).toEqual([]);
    expect(final.route).toBe('split');
    expect(final.baseCatalogPin).toEqual(pin2);
    // The whole walk left exactly three opening/region lines, one coarse and one region message, one route round.
    const adviserLines = (await cold.host.listSessions()).filter(card =>
      card.record.role.kind === 'legacy_template' && card.record.role.templateId === PL_ADVISER_ROLE.templateId);
    expect(adviserLines).toHaveLength(3);
    expect((await cold.host.readRequest(candidate.requestRoot)).rounds
      .filter(round => round.input === COLDSTART_ROUTE_QUESTION)).toHaveLength(1);
  }, 300_000);

  /*
   * The coarse split's approval is a knowledge write: its commit wakes the cold start before its files land. A
   * `regions` pass that reads before they land opens no region line (both wait in `pendingRegions`) and the queue
   * parks; only the write's completion commit, after the files landed, wakes the lifecycle queue again. The Host's
   * knowledge write seam holds that one write at `committed`; the row lets it land only once the lifecycle queue has no
   * pass running, due or backing off (`lifecycleIdle`, d Astra 3), so that pass has read the held write and returned
   * whatever the speed. Named mutation: drop `'KnowledgeWrite'` from `LIFECYCLE_WAKE_AGGREGATE_TYPES`
   * (`src/app/wake-loop.ts`) -> nothing wakes the cold start after the release, `waitForExplorations(2)` times out, red.
   */
  it('RL-23a (memory): a region the cold start could not open on the old files opens once the coarse split lands', async () => {
    let gate: ReturnType<typeof holdGate> | null = null;
    const cold = await openS7D2ColdStartWorld({ backend: 'memory',
      extraHostOptions: { knowledgeWriteHold: (point: KLS2CHoldPoint) => gate?.hold(point) ?? Promise.resolve() } });
    worlds.push(cold);
    await cold.initialize();
    await cold.waitForPhase('route');
    await cold.submitContinuation('split', 'rl23w-route-split');
    await cold.waitForPhase('coarse_split');
    const holders = await cold.adviserHolders();
    await cold.setAdviserOpen(holders + 1, 'rl23w-limits-one');
    await cold.waitFor('the coarse card', async () => (await cold.proposalCards()).length === 1);
    // Armed after every earlier knowledge write returned: only the approval's write stops at `committed`.
    gate = holdGate('committed');
    const approving = cold.approve((await cold.proposalCards())[0]!, 'rl23w-approve-coarse');
    await gate.reached;
    // The approval's commit woke the lifecycle queue: once it is idle, the passes it ran moved the cold start to
    // `regions` and read the held write; no region line opened and both regions wait.
    await cold.host.lifecycleIdle(S6A_SCOPE);
    const held = await cold.coldStart();
    expect([held.actionPhase, held.pendingRegions, (held.explorations ?? []).map(entry => entry.segment)]).toEqual(
      ['regions', [{ projectId: P, moduleId: 'src' }, { projectId: P, moduleId: 'docs' }], ['coarse_split']]);
    gate.release();
    expect(await approving).toMatchObject({ status: 'ready', value: { answer: { status: 'committed' } } });
    // The files landed and nothing else is written: `src` opens at the one free seat, `docs` waits for a seat.
    const row = await cold.waitForExplorations(2);
    expect((row.explorations ?? []).map(entry => entry.segment)).toEqual(['coarse_split', 'region']);
    expect(row.pendingRegions).toEqual([{ projectId: P, moduleId: 'docs' }]);
    expect((await explorationOf(cold, 'region', 'src')).operationRef).toEqual(coldStartOperationRef(P));
  }, 300_000);

  it("RL-23b (memory): the exploration round's tool table, notes, create_member and the proposal arm", async () => {
    const cold = await opened('memory');
    expectColdStartRow(await cold.operations());
    const { goal } = await cold.initialize({ coarseProposal: false });
    // Step 5's continuation carries the round; the coarse replies are ours (the round's own tool calls).
    await cold.waitForPhase('route');
    // Ruling 8: the no-line baseline is read before the exploration script is queued; a wrong `create_member`
    // cannot have created a line by the time the tool result is read.
    const sessionsBefore = (await cold.host.listSessions()).length;
    await cold.host.scripted.script(cold.lines.adviser, [{
      kind: 'calls', calls: [
        { callId: 'rl23b-link', name: 'record_note', args: { op: 'write', kind: 'link', body: '', topic: 'RL-23b link',
          conclusion: 'module.ts feeds b.ts', anchor: { kind: 'file', path: 'src/module.ts' },
          extraAnchors: [{ kind: 'file', path: 'src/b/b.ts' }],
          link: { relation: 'data', key: { kind: 'literal', text: 'C1T_LINK' },
            evidence: [{ role: 'emit', at: { path: 'src/module.ts' } },
              { role: 'receive', at: { path: 'src/b/b.ts' } }] } } },
        { callId: 'rl23b-understanding', name: 'record_note', args: { op: 'write', kind: 'understanding',
          topic: 'RL-23b understanding', conclusion: 'not allowed here', anchor: { kind: 'file', path: 'src/module.ts' },
          sections: { status: 's', decided: 'd', open: 'o', next: 'n', risks: 'r' } } },
        { callId: 'rl23b-member', name: 'create_member', args: { duty: 'executor',
          scope: { kind: 'project', ref: { projectId: P } }, reason: 'RL-23b' } },
        { callId: 'rl23b-propose', name: 'propose_architecture_revision', args: {
          baseCatalogPin: await cold.pin(),
          ops: coldStartCoarseProposal(P).ops,
          responsibilityMoves: [], reason: 'RL-23b proposal' } },
      ],
    }, { kind: 'text', text: 'RL-23b: the exploration round is done' }]);
    await cold.submitContinuation('split', 'rl23b-route-split');
    await cold.waitForPhase('coarse_split');
    await cold.waitFor('the exploration model request', async () =>
      (await cold.host.scripted.requests(cold.lines.adviser)).length >= 2);

    const requests = await cold.host.scripted.requests(cold.lines.adviser);
    const offered = requests[0]!.tools.map(tool => tool.name);
    for (const name of ['look_graph', 'find_graph', 'record_note', 'propose_architecture_revision', 'read_requests']) {
      expect(offered).toContain(name);
    }
    for (const name of ['create_member', 'send_session_message', 'write', 'edit', 'shell']) {
      expect(offered).not.toContain(name);
    }
    // Step 2: the link note is accepted, listed, and comes from A and the coarse QueryRun.
    expect(jsonOf(requests, 'rl23b-link')).toMatchObject({ write: { status: 'accepted' } });
    const listed = valueOf<{ items: { kind: string; conclusion: string;
      source: { kind: string; sessionRef?: { sessionId: string }; queryRunRef?: { runId: string } } }[] }>(
      (await cold.host.post('notes/list', { scope: S6A_SCOPE, input: { anchor: { kind: 'file', path: 'src/module.ts' },
        state: 'accepted', limit: 100, cursor: null } })).body, 'ready', 'the notes');
    const written = listed.items.find(item => item.conclusion === 'module.ts feeds b.ts');
    expect(written?.kind).toBe('link');
    expect(written?.source).toMatchObject({ kind: 'agent', sessionRef: { sessionId: cold.lines.adviser.ref.sessionId },
      queryRunRef: { runId: coarseSplitQueryRefs(P).queryRunRef.runId } });
    // Step 3: a planning round cannot write an understanding. The exploration round's note admission
    // (`planningNoteAdmission`, `src/core/work-graph/state/secretary-note.ts:65`) offers the six general kinds plus
    // `link`/`flow` only, so `understanding` is absent from the `record_note` tool schema: the dispatcher refuses
    // the arguments on `kind` and the call never reaches `note-service.ts:182`'s planning gate.
    const understanding = requests.flatMap(request => request.messages).find(message =>
      message.role === 'tool' && message.callId === 'rl23b-understanding');
    const understandingResult = understanding?.role === 'tool' ? understanding.result : null;
    expect(understandingResult).toMatchObject({ status: 'error', error: { code: 'invalid_arguments' } });
    const refusal = (understandingResult as { error?: { code?: string; message?: string } } | null)?.error;
    expect(refusal?.code).toBe('invalid_arguments');
    expect(refusal?.message).toContain('kind');
    // No note was written: the anchor lists the link note alone, never the refused understanding.
    const afterUnderstanding = valueOf<{ items: { conclusion: string }[] }>(
      (await cold.host.post('notes/list', { scope: S6A_SCOPE, input: { anchor: { kind: 'file', path: 'src/module.ts' },
        state: 'accepted', limit: 100, cursor: null } })).body, 'ready', 'the notes after the refused call');
    expect(afterUnderstanding.items).toHaveLength(1);
    expect(afterUnderstanding.items.filter(item => item.conclusion === 'not allowed here')).toEqual([]);
    // Step 4: `create_member` is not in the list, so the call fails and no line appears.
    const memberResult = requests.flatMap(request => request.messages).find(message =>
      message.role === 'tool' && message.callId === 'rl23b-member');
    expect(memberResult?.role === 'tool' ? memberResult.result : null).toMatchObject({ status: 'error' });
    expect(await cold.host.listSessions()).toHaveLength(sessionsBefore);
    // Step 5: the proposal is the exploration's own, read through the proposal arm.
    const proposed = jsonOf(requests, 'rl23b-propose') as { status: string;
      proposalRef: { projectId: string; proposalId: string; aggregateType: 'ArchitectureProposal' } };
    expect(proposed.status).toBe('needs_decision');
    const read = await cold.proposal(proposed.proposalRef);
    expect(read.proposal.proposer.sessionId).toBe(cold.lines.adviser.ref.sessionId);
    expect(read.proposal.state).toBe('pending');
    void goal;
  }, 300_000);

  it('RL-23c (memory): a region open reuses a standby adviser line (RL-16 step 4; L-9)', async () => {
    const cold = await opened('memory');
    expectColdStartRow(await cold.operations());
    const { goal } = await cold.initialize();
    await cold.waitForPhase('route');
    await cold.submitContinuation('split', 'rl23c-route-split');
    await cold.waitForPhase('coarse_split');
    // The adviser cap has room for `src` and for the standby line the person opens.
    const holders = await cold.adviserHolders();
    await cold.setAdviserOpen(holders + 2, 'rl23c-limits');
    // Stop the `src` region open right before its commit, so the person can open a standby line meanwhile.
    const srcOpen = commitBarrier.hold(regionOpenCommit('src'), 'RL-23c: before the src region create');
    await cold.waitFor('the coarse card', async () => (await cold.proposalCards()).length === 1);
    const adviserCountBefore = (await cold.host.listSessions()).filter(card =>
      card.record.role.kind === 'legacy_template'
      && card.record.role.templateId === PL_ADVISER_ROLE.templateId).length;
    const noticesBefore = (await cold.main.readNotices({ categories: ['project_notice'] })).notices.length;
    await cold.approve((await cold.proposalCards())[0]!, 'rl23c-approve-coarse');
    await srcOpen.reached;
    // The Goal already has an adviser and no Goal waits in the queue: the standby line cannot be taken by the Goal.
    const queue = await cold.host.post('goals/adviser-queue', plain(S6A_SCOPE, { workspace: S6A_SCOPE }));
    const queueValue = valueOf<{ entries: readonly { goalRef: { goalId: string } }[] }>(queue.body,
      'ready', 'the Goal adviser queue');
    expect(queueValue.entries).toEqual([]);
    // The queue read no longer carries the assigned adviser; the Goal's adviser is the line responsible for it.
    const goalAdvisers = (await cold.host.listSessions()).filter(card =>
      card.record.role.kind === 'legacy_template' && card.record.role.templateId === PL_ADVISER_ROLE.templateId
      && card.links.some(link => link.until === null && link.ref.relation === 'responsible'
        && link.ref.target.kind === 'goal' && link.ref.target.ref.goalId === goal.goalId));
    expect(goalAdvisers).not.toHaveLength(0);
    // A standby adviser: opened on `docs`, then its scope emptied (an empty scope is legal).
    const openedLine = await openS7D2Line(cold.host, { duty: 'adviser',
      scope: [{ kind: 'region', moduleRef: { projectId: P, moduleId: 'docs' } }], requestId: 'rl23c-standby' });
    const lx = await cold.lineOf(valueOf<{ session: { projectId: string; sessionId: string } }>(
      openedLine.result, 'committed', 'the standby line').session, 'rl23c-standby');
    const emptied = await changeS7D2Scope(cold.host, { session: lx, scope: [], requestId: 'rl23c-standby-empty' });
    valueOf(emptied.result, 'committed', 'the standby scope change');
    srcOpen.release();
    // Now `docs` advances: the cold start reuses Lx instead of opening a line.
    await cold.waitForExplorations(3);
    const docsEntry = await explorationOf(cold, 'region', 'docs');
    expect(docsEntry.sessionRef.sessionId).toBe(lx.ref.sessionId);
    const adviserLines = (await cold.host.listSessions()).filter(card =>
      card.record.role.kind === 'legacy_template' && card.record.role.templateId === PL_ADVISER_ROLE.templateId);
    expect(adviserLines).toHaveLength(adviserCountBefore + 2);
    expect((await cold.cards()).filter(card => card.source.kind === 'role_line_change')).toEqual([]);
    const noticesAfter = (await cold.main.readNotices({ categories: ['project_notice'] })).notices;
    expect(noticesAfter.length).toBe(noticesBefore + 1);
    // Lx holds the open `docs` module link and its one “please act” message; the entry names Lx's own operation.
    const lxCard = await cold.host.readSession(lx.ref);
    expect(lxCard.links.filter(link => link.until === null && link.ref.relation === 'responsible'
      && link.ref.target.kind === 'module' && link.ref.target.ref.moduleId === 'docs')).toHaveLength(1);
    expect(await cold.inbox(lx)).toHaveLength(1);
    expect(docsEntry.operationRef).toEqual(lxCard.roleFacts?.originOperation);
    expect(docsEntry.operationRef).not.toEqual(coldStartOperationRef(P));
    // The held `src` create went through after its release: `src` has its line too.
    const srcEntry = await explorationOf(cold, 'region', 'src');
    expect(srcEntry.sessionRef.sessionId).not.toBe(lx.ref.sessionId);
    void goal;
  }, 300_000);

  it.each([['candidates'], ['adopted'], ['route'], ['coarse_split'], ['regions'], ['proposals']] as const)(
    'RL-23a 9a (sqlite): a crash right after the %s commit resumes at that phase', async phase => {
      const baseline = await opened('sqlite');
      expectColdStartRow(await baseline.operations());
      await baseline.walkToCompleted();
      const expectedFinal = await baseline.snapshot();
      await expectCandidateKept(baseline);

      const cold = await opened('sqlite');
      expectColdStartRow(await cold.operations());
      if (phase === 'proposals') {
        // The proposals commit leaves both region rounds to be claimed by the proposals phase. Break after they
        // entered the Kernel (9c's rule: an entered round ends, a not-entered one reopens), so this row resumes the
        // stored phase and reaches the same final state, not the 9b reopen's extra exploration entries.
        await cold.advanceTo('regions');
        await cold.waitForExplorations(2);
        const holders = await cold.adviserHolders();
        const proposals = holdColdStartPhase(phase, `RL-23a 9a: after the ${phase} commit`);
        await cold.setAdviserOpen(holders + 1, 'rl23a-9a-limits-two');
        const three = await cold.waitForExplorations(3);
        await proposals.reached;
        const regionEntries = (three.explorations ?? []).filter(candidate => candidate.segment === 'region');
        const lines = new Map<string, { line: S6ASession; gate: Awaited<ReturnType<typeof cold.host.gates.modelRequest>> }>();
        for (const entry of regionEntries) {
          const suffix = entry.queryRunRef.runId.split(':').at(-1)!;
          // The replies the regions step normally queues; without them the claimed rounds wait out the test.
          const line = await cold.lineOf(entry.sessionRef, `rl23a-9a-${suffix}`);
          await cold.host.scripted.script(line, [{ kind: 'text', text: `C1T: region ${suffix} explored` }]);
          lines.set(suffix, { line, gate: await cold.host.gates.modelRequest(line) });
        }
        proposals.release();
        await cold.waitForPhase('proposals');
        await Promise.all([...lines.values()].map(async value => await value.gate.reached));
        // `docs` answers before the break; only the entered `src` round is left held, so `crash()` drains one.
        lines.get('docs')!.gate.release();
        await cold.waitFor('the docs region round answered', async () =>
          (await cold.query(regionQueryRefs(P, 'docs').queryJobRef)).job.job.status === 'answered');
        const atStop = await cold.coldStart();
        expect(atStop.phase).toBe('running');
        expect(atStop.actionPhase).toBe('proposals');
        await cold.host.crash();
        lines.get('src')!.gate.release();
        // The last phase may finish inside the restart before the row can be read; either reading proves the same
        // stored phase: still at the phase the crash stored, or already at the baseline's final state.
        const resumed = await cold.coldStart();
        if (resumed.phase === 'completed') {
          expect(await cold.snapshot()).toEqual(expectedFinal);
        } else {
          expect(resumed.actionPhase).toBe(atStop.actionPhase);
          expect(resumed.lastCompleted).toBe(atStop.lastCompleted);
          await cold.finishFrom('proposals');
          expect(await cold.snapshot()).toEqual(expectedFinal);
        }
        await expectCandidateKept(cold);
        return;
      }
      // The regions step already holds the proposals commit itself; that stop is the branch above.
      const hold = phase === 'candidates' ? null
        : holdColdStartPhase(phase, `RL-23a 9a: after the ${phase} commit`);
      await cold.advanceTo(phase);
      if (hold !== null) await hold.reached;
      const atStop = await cold.coldStart();
      expect(atStop.phase).toBe('running');
      expect(atStop.actionPhase).toBe(phase);
      await cold.host.crash();
      hold?.release();
      const resumed = await cold.waitForPhase(phase);
      expect(resumed.actionPhase).toBe(atStop.actionPhase);
      expect(resumed.lastCompleted).toBe(atStop.lastCompleted);
      await cold.finishFrom(phase);
      expect(await cold.snapshot()).toEqual(expectedFinal);
      await expectCandidateKept(cold);
    }, 300_000);

  it('RL-23a 9b (sqlite): a round that never entered the Kernel is closed `not_entered` and reopened', async () => {
    const cold = await opened('sqlite');
    expectColdStartRow(await cold.operations());
    const { goal } = await cold.initialize();
    await cold.waitForPhase('route');
    // Gate (c): the coarse round's start commit is held, so the Kernel is never entered.
    const start = await cold.host.gates.beforeStart(cold.lines.adviser);
    await cold.submitContinuation('split', 'rl23b-route-split');
    await start.reached;
    await cold.host.crash();
    start.release();
    await cold.waitForPhase('coarse_split');
    // The first coarse Query is closed as not entered; a second entry with the same message is the reopened round.
    const first = coarseSplitQueryRefs(P);
    const firstJob = await cold.query(first.queryJobRef);
    expect(firstJob.job.job.status).toBe('closed');
    expect(firstJob.job.job.closeReason?.code).toBe('not_entered');
    const row = await cold.waitForExplorations(2);
    const coarse = (row.explorations ?? []).filter(entry => entry.segment === 'coarse_split');
    expect(coarse).toHaveLength(2);
    expect(coarse[0]!.messageRef).toEqual(coarse[1]!.messageRef);
    expect(coarse[0]!.queryRunRef.runId).not.toBe(coarse[1]!.queryRunRef.runId);
    const secondJob = await cold.query(queryJobRefOfRun(coarse[1]!.queryRunRef));
    expect(secondJob.job.job.intent.execution.kind).toBe('role_exploration');
    // The adviser's one message stays one, and the line is free and available again.
    expect(await cold.inbox(cold.lines.adviser)).toHaveLength(1);
    await cold.waitFor('the adviser line is free', async () =>
      (await cold.host.readSession(cold.lines.adviser.ref)).record.occupancy === null);
    const card = await cold.host.readSession(cold.lines.adviser.ref);
    expect(card.record.occupancy).toBeNull();
    expect(card.record.health).toBe('available');
    // The reopened round reaches `answered`, then the walk continues through the coarse proposal.
    await cold.host.scripted.script(cold.lines.adviser, [{ kind: 'text', text: 'RL-23a 9b: explored' }]);
    await cold.waitFor('the reopened round', async () => {
      const jobNow = await cold.query(queryJobRefOfRun(coarse[1]!.queryRunRef));
      return jobNow.job.job.status === 'answered';
    });
    await cold.finishFrom('coarse_split');
    expect((await cold.coldStart()).actionPhase).toBe('proposals');
    void goal;
  }, 300_000);

  it('RL-23a 9c (sqlite): a round that entered the Kernel and broke ends; its line is returned', async () => {
    const cold = await opened('sqlite');
    expectColdStartRow(await cold.operations());
    const { goal } = await cold.initialize();
    await cold.waitForPhase('route');
    await cold.submitContinuation('split', 'rl23c-route-split');
    await cold.waitForPhase('coarse_split');
    const holders = await cold.adviserHolders();
    await cold.setAdviserOpen(holders + 2, 'rl23c-limits');
    await cold.waitFor('the coarse card', async () => (await cold.proposalCards()).length === 1);
    await cold.approve((await cold.proposalCards())[0]!, 'rl23c-approve-coarse');
    await cold.waitForExplorations(2);
    // Script `docs` before its round is claimed; the `src` round is the one held and broken.
    const docsEntry = await explorationOf(cold, 'region', 'docs');
    await cold.host.scripted.script(await cold.lineOf(docsEntry.sessionRef, 'rl23c-docs'),
      [{ kind: 'text', text: 'RL-23c: docs explored' }]);
    // Hold the `src` region round at its first model request; the phase still advances to `proposals`.
    const srcEntry = await explorationOf(cold, 'region', 'src');
    const srcLine = await cold.lineOf(srcEntry.sessionRef, 'rl23c-src');
    const model = await cold.host.gates.modelRequest(srcLine);
    // Advance to the phase commit only: `finishFrom('regions')` would wait for `completed`, which the held round
    // cannot reach.
    await cold.advanceTo('proposals');
    await model.reached;
    // Only `src` is cut by the crash: its `docs` neighbour answers first, so the reopened phase has one ended
    // round and one that ended in the Kernel (C1TR: the docs round must be answered before the break).
    await cold.waitFor('the docs region round answered', async () =>
      (await cold.query(queryJobRefOfRun(docsEntry.queryRunRef))).job.job.status === 'answered');
    await cold.host.crash();
    model.release();
    // The broken round is closed (not `not_entered`), not reopened; only `docs` is answered and the walk completes.
    await cold.waitForPhase('proposals');
    const srcJob = await cold.query(queryJobRefOfRun(srcEntry.queryRunRef));
    expect(srcJob.job.job.status).toBe('closed');
    expect(srcJob.job.job.closeReason?.code).not.toBe('not_entered');
    const row = await cold.coldStart();
    expect((row.explorations ?? []).filter(entry => entry.segment === 'region'
      && entry.queryRunRef.runId.endsWith(':src'))).toHaveLength(1);
    await cold.waitFor('the src line is free', async () =>
      (await cold.host.readSession(srcLine.ref)).record.occupancy === null);
    const srcCard = await cold.host.readSession(srcLine.ref);
    expect(srcCard.record.health).toBe('available');
    expect(srcCard.record.occupancy).toBeNull();
    await cold.finishFrom('proposals');
    expect((await cold.coldStart()).phase).toBe('completed');
    void goal;
  }, 300_000);
});
