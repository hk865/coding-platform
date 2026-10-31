/**
 * CS-consult (book-7b.md §5 row 1227, SR7 §7.4): consulting an archived or
 * retired line. Q2's damaged world supplies the source; `consultRetiredLine`
 * asks the source its own inquiry, posts the real `workflow/consultation` and
 * reads the copy, its create operation and the asked message back. Five cases: the corrupt history's
 * `platform_facts` payload and its two lists, a retired line's empty `kernel`,
 * `missing`/`transient`, the SQLite replay, and the frozen bodies a prepared
 * copy reads. No store read; every expected value is the ruling's literal or
 * hand-computed from the frozen fixture.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { consultationQueryRefs } from '../../src/contracts/query-job.js';
import type { SessionFactsV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import type {
  ConsultationCreateV1, ConsultationFactRefV1, ConsultationFactsV1, SessionOperationRecord,
} from '../../src/core/work-graph/model/session-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { readS7BMessage } from '../helpers/S7B-fixture.js';
import { holdS7ACommitter, ready } from '../helpers/S7A-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import type { S7BDamagedWorld, S7B3Defect } from '../helpers/S7B3-damaged-world.js';
import { openS7BDamagedWorld } from '../helpers/S7B3-damaged-world.js';
import { openS7BPlanningWorld } from '../helpers/S7B3-planning-world.js';
import { consultRetiredLine } from '../helpers/S7B3-consultation-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const DISCLAIMER = 'These facts were frozen from the consulted line when the copy was created; they may already be out of date.';
const CORRUPT_REASON = "the source line's Kernel history is corrupt";
const PLAN_ID = 's6b-plan-s7b3-planning';
const WORK_TASK = 'ag2b-work';
const GATE_TASK = 'ag2b-gate';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  // The replay's derivation commit stays held through the crash and every assertion; the reset releases it
  // before the worlds close (S7A fixture header, the crash/reset pattern).
  commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close();
});

async function openDamaged(defect: S7B3Defect): Promise<S7BDamagedWorld> {
  const input = await openS7BDamagedWorld({ defect });
  worlds.push(input.world);
  return input;
}

/** The create arm's frozen consultation payload; a non-consultation create has none. */
function createOf(consultation: { operation: SessionOperationRecord | null }): ConsultationCreateV1 {
  const operation = consultation.operation;
  if (operation === null || operation.action.kind !== 'create') {
    throw new Error(`the consultation recorded no create operation: ${JSON.stringify(operation)}`);
  }
  if (operation.action.consultation === null) throw new Error('the create operation has no consultation payload');
  return operation.action.consultation;
}

function factsOf(payload: ConsultationCreateV1): ConsultationFactsV1 {
  if (payload.facts === null) throw new Error('platform_facts must carry a facts object');
  return payload.facts;
}

function recordsOf(facts: ConsultationFactsV1): Extract<ConsultationFactRefV1, { kind: 'record' }>[] {
  return facts.facts.filter((fact): fact is Extract<ConsultationFactRefV1, { kind: 'record' }> =>
    fact.kind === 'record');
}

function taskFactsOf(facts: ConsultationFactsV1): Extract<ConsultationFactRefV1, { kind: 'task' }>[] {
  return facts.facts.filter((fact): fact is Extract<ConsultationFactRefV1, { kind: 'task' }> =>
    fact.kind === 'task');
}

/** The manifest the consultation's own Query prepared; its bundle is read through the public material route. */
async function preparedManifest(world: S6AHostWorld,
  messageRef: S7BDamagedWorld['messageRef']): Promise<PreparedQueryManifestV1> {
  const { queryJobRef } = consultationQueryRefs(messageRef);
  const { run } = await readQuery(world.ag2b, queryJobRef);
  const prepared = run.run.executionState?.prepared;
  if (prepared === null || prepared === undefined) throw new Error('the consultation Query was not prepared');
  const opened = ready<{ body: string }>(await world.post('materials/open', plain(S6A_SCOPE, {
    ref: prepared.bundleRef, usage: 'historical_explanation',
  })), 'the prepared Query bundle');
  return JSON.parse(opened.body) as PreparedQueryManifestV1;
}

/** The frozen body artifact, opened through the same public material read preparation uses. */
async function messageBody(world: S6AHostWorld, messageRef: S7BDamagedWorld['messageRef']): Promise<string> {
  const message = await readS7BMessage(world, messageRef);
  return ready<{ body: string }>(await world.post('materials/open', plain(S6A_SCOPE, {
    ref: message.bodyRef, usage: 'historical_explanation',
  })), 'the source message body artifact').body;
}

describe('CS-consult: an archived or retired source line', () => {
  it('admits an archived source with a corrupt middle record and freezes platform_facts', async () => {
    const input = await openDamaged('corrupt');
    const consulted = await consultRetiredLine(input);
    const payload = createOf(consulted.first);
    const card = await input.world.readSession(input.source);
    const manifest = await preparedManifest(input.world, consulted.first.message.ref);
    const refs = consultationQueryRefs(consulted.first.message.ref);

    // CS asks its own goal-less inquiry; Q2's accepted `action_request` is not the consulted message.
    expect(consulted.first.message).toMatchObject({ intent: 'inquiry', needsReply: true, goalRef: null });
    expect(payload).toMatchObject({
      messageRef: consulted.first.message.ref,
      mode: 'platform_facts',
      reason: CORRUPT_REASON,
      sourceRef: input.source.ref,
      // The source's seven frozen Kernel records; the boundary read still passed.
      boundary: { cursor: card.record.historyCursor, position: 7 },
    });
    // The Query is the copy's own, bound to CS's inquiry rather than Q2's accepted message.
    expect(consulted.first.result.query?.job.ref).toEqual(refs.queryJobRef);
    expect(consulted.first.result.query?.run.ref).toEqual(refs.queryRunRef);
    expect(payload.facts).not.toBeNull();
    expect(factsOf(payload).omitted).toEqual([]);
    expect(factsOf(payload).unreadable).toEqual([{ fact: null, reason: 'unreadable' }]);
    // The copy prepares from the frozen payload with the pack's own disclaimer.
    expect(manifest.input).toContain(DISCLAIMER);
    expect(card.record).toMatchObject({ lifecycle: 'archived', health: 'available' });
  });

  it('admits a retired source with truly empty history as kernel and keeps it unavailable', async () => {
    const input = await openDamaged('retired');
    const consulted = await consultRetiredLine(input);
    const payload = createOf(consulted.first);
    const card = await input.world.readSession(input.source);

    expect(payload).toMatchObject({
      messageRef: consulted.first.message.ref,
      mode: 'kernel',
      facts: null,
      reason: null,
      sourceRef: input.source.ref,
      boundary: { cursor: null, position: 0 },
    });
    expect(card.record).toMatchObject({ lifecycle: 'active', health: 'unavailable' });
    // The copy is the frozen read-only derivation, not a restored source line.
    expect(consulted.first.copy?.session.provenance).toMatchObject({ schemaVersion: 1, kind: 'readonly_copy' });
  });

  const MODES = [
    { defect: 'missing', mode: 'platform_facts', unreadable: [{ fact: null, reason: 'missing' }] },
    { defect: 'transient', mode: 'waiting', unreadable: null },
  ] as const;

  it.each(MODES)('a $defect source read follows the mode rule', async ({ defect, mode, unreadable }) => {
    const input = await openDamaged(defect);
    const consulted = await consultRetiredLine(input);
    if (mode === 'waiting') {
      // A transient read keeps today's wait: no copy, no create operation, no mode frozen.
      expect(consulted.first.result.state).toBe('waiting');
      expect(consulted.first.operation).toBeNull();
      expect(consulted.first.copy).toBeNull();
      expect(consulted.first.message.consultationDerivation).toBeUndefined();
      return;
    }
    const payload = createOf(consulted.first);
    expect(payload).toMatchObject({ mode: 'platform_facts', boundary: null });
    expect(factsOf(payload).unreadable).toEqual(unreadable);
  });

  it('a replay reads the operation and collects nothing (SQLite only)', async () => {
    const planning = await openS7BPlanningWorld({ backend: 'sqlite' });
    worlds.push(planning.world);
    // The crash leaves the first attempt's create operation persisted and its derivation unlanded; the retry on the
    // new Host posts the same body and reads that operation first instead of collecting again.
    const consulted = await consultRetiredLine({ world: planning.world, source: planning.sessionRef,
      messageRef: planning.messageRef, defect: 'retired' }, { replay: true });
    const first = consulted.first.operation;
    const second = consulted.second.operation;
    expect(second).not.toBeNull();
    if (second === null) throw new Error('the replay recorded no create operation');
    // The operation before the crash (read on the old Host) and after it are one record, unchanged.
    expect(second.ref).toEqual(first.ref);
    expect(second.revision).toBe(first.revision);
    expect(second.action).toEqual(first.action);
    // The retry reuses the frozen payload: the collected facts are the same and nothing was collected again.
    expect(createOf(consulted.second).facts).toEqual(createOf(consulted.first).facts);
  });

  it('freezes the collected bodies and prepares the copy from them only', async () => {
    const input = await openDamaged('corrupt');
    // Hold the consultation Query's first execution commit: the create payload is collected and the copy has not
    // prepared. One more person message reaches the source inbox in that window.
    const hold = holdS7ACommitter(input.world, byIdentityPrefix('r5b-query-execution:'));
    const pending = consultRetiredLine(input);
    await hold.reached;
    const later = await sendS7A2PersonMessage(input.world, { label: 'cs-after-freeze', recipient: input.source.ref });
    hold.release();
    const consulted = await pending;
    const laterBody = await messageBody(input.world, later.ref);
    const payload = createOf(consulted.first);
    expect(payload.mode).toBe('platform_facts');
    const facts = factsOf(payload);
    const records = recordsOf(facts);
    const goal = records.find(record => record.sourceRef.ref.aggregateType === 'Goal');
    const plan = records.find(record => record.sourceRef.ref.aggregateType === 'PlanRevision');
    const run = records.find(record => record.sourceRef.ref.aggregateType === 'Run');
    const sourceFacts = ready<SessionFactsV1>(await input.world.post('sessions/facts',
      plain(S6A_SCOPE, input.source.ref)), 'the source facts');
    const latestRun = sourceFacts.latestWork?.runRef ?? null;

    // The Goal and its active PlanRevision are record facts with their frozen text; the
    // latest Run of the source's Work task is the third; the damaged source records are the
    // history read's one unreadable entry, never invented record facts.
    expect(goal?.sourceRef).toEqual({ ref: input.world.goals.first, revision: 2 });
    expect(goal?.body).toContain('"goalId":"ag2b-goal"');
    expect(plan?.sourceRef).toEqual({ ref: { aggregateType: 'PlanRevision',
      projectId: S6A_SCOPE.projectId, planId: PLAN_ID }, revision: 1 });
    expect(plan?.body).toContain(`"planId":"${PLAN_ID}"`);
    expect(run?.sourceRef.ref).toEqual(latestRun);
    expect(facts.unreadable).toEqual([{ fact: null, reason: 'unreadable' }]);

    // One task fact per graph task, pinned by PlanRevision + taskId; no event arm is produced.
    expect(taskFactsOf(facts)).toEqual(expect.arrayContaining([
      { kind: 'task', planRevision: { aggregateType: 'PlanRevision', projectId: S6A_SCOPE.projectId,
        planId: PLAN_ID }, taskId: WORK_TASK },
      { kind: 'task', planRevision: { aggregateType: 'PlanRevision', projectId: S6A_SCOPE.projectId,
        planId: PLAN_ID }, taskId: GATE_TASK },
    ]));
    expect(facts.facts.some(fact => fact.kind === 'event')).toBe(false);

    // The last inbox messages are body facts: Q2's person message and CS's own inquiry.
    const bodies = facts.facts.filter((fact): fact is Extract<ConsultationFactRefV1, { kind: 'body' }> =>
      fact.kind === 'body');
    const original = await readS7BMessage(input.world, input.messageRef);
    const originalBody = bodies.find(fact => fact.sourceRef.ref.aggregateType === 'SessionMessage'
      && fact.sourceRef.ref.messageId === input.messageRef.messageId);
    expect(bodies).toHaveLength(2);
    expect(originalBody).toMatchObject({ ref: original.bodyRef,
      sourceRef: { ref: input.messageRef, revision: 2 } });

    // Preparation reads only the frozen bodies: record texts from the payload, the body
    // artifact once through the material port, and the task definition from the frozen plan.
    // No Session history is taken and no source Goal/plan/Run/inbox is read again.
    const manifest = await preparedManifest(input.world, consulted.first.message.ref);
    expect(manifest.takesSessionHistory).toBe(false);
    expect(manifest.sessionBasis).toBeUndefined();
    expect(manifest.input).toContain(DISCLAIMER);
    for (const record of records) expect(manifest.input).toContain(`- ${record.body}`);
    expect(manifest.input).toContain(`- ${await messageBody(input.world, input.messageRef)}`);
    // The source inbox holds the later message now, but the prepared input keeps the collected bodies only.
    expect(manifest.input).not.toContain(laterBody);
    expect(manifest.input).toContain('- unreadable: unknown (unreadable)');
    const planBody = JSON.parse(plan?.body ?? '{}') as { tasks?: Array<{ taskId: string }> };
    for (const task of taskFactsOf(facts)) {
      const definition = planBody.tasks?.find(candidate => candidate.taskId === task.taskId);
      expect(definition).toBeDefined();
      expect(manifest.input).toContain(`- ${canonicalJson(definition as unknown as JsonValue)}`);
    }
  });
});
