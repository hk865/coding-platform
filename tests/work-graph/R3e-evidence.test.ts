/**
 * R3e.1 formal round/Evidence domain behaviour tests (stage-1 skeleton).
 *
 * Every fact here comes from the real R3e fixture: an independently created
 * Goal/Plan/Session/claim (static requirement) whose subject Run was ended by
 * the formal B2 claim/prepare/start/terminal path, the real RecordStore, the
 * real material body/read-facts chain and the real VerificationWorkspaceReader.
 * These are FINAL behaviour assertions: until stage 2 lands the production
 * `EvidencePort` returns `unsupported`, so each test stops at its first
 * evidence assertion. Later replay/CAS/close tails are NOT reached.
 *
 * Specification: docs/refactor/tasks/R3e-completion-skeleton.md §4–5, §8 and the
 * R3e.1 mid-review repair §5.
 */
import { afterEach, expect, it } from 'vitest';
import type { CheckProcessObservation, RoundSnapshot } from '../../src/contracts/verification.js';
import { B2_AT } from '../helpers/B2-execution-fixture.js';
import { createR3eEvidenceFixture, R3E_HOST, R3E_WORK_TASK_ID, type R3eEvidenceFixture } from '../helpers/R3e-evidence-fixture.js';

const fixtures: R3eEvidenceFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

async function openFixture(kind: 'memory' | 'sqlite' = 'memory'): Promise<R3eEvidenceFixture> {
  const fixture = await createR3eEvidenceFixture(kind);
  fixtures.push(fixture);
  return fixture;
}

function executedObservation(text: string): CheckProcessObservation {
  return {
    kind: 'executed', startedAt: B2_AT, finishedAt: B2_AT, exitCode: 0, signal: null,
    timedOut: false, cancelled: false,
    stdout: { text, totalBytes: Buffer.byteLength(text), truncated: false },
    stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { workspaceRevision: 'r3e-workspace-revision-1', changedPaths: [] },
    sandboxProfileVersion: 'bwrap-m3-v4',
  };
}

async function latestRound(fixture: R3eEvidenceFixture, ref: RoundSnapshot['ref']): Promise<RoundSnapshot> {
  const read = await fixture.evidence.readVerification(fixture.ctx, ref);
  expect(read, 'directed round read').toMatchObject({ status: 'ready' });
  if (read.status !== 'ready') throw Error('round read did not succeed');
  return read.value;
}

type BeginRequest = ReturnType<R3eEvidenceFixture['beginRequest']>;
type BeginResult = Awaited<ReturnType<R3eEvidenceFixture['evidence']['beginCheck']>>;

/** Begin + record one fixed check, retaining the exact committed begin request
 * and ticket so a later replay uses the ORIGINAL object (same requestId/expected). */
async function completeCheck(fixture: R3eEvidenceFixture, ref: RoundSnapshot['ref'], checkId: string, text: string):
Promise<{ round: RoundSnapshot; beginRequest: BeginRequest; begin: BeginResult }> {
  const beforeBegin = await latestRound(fixture, ref);
  const beginRequest = fixture.beginRequest(beforeBegin, checkId);
  const begin = await fixture.evidence.beginCheck(fixture.ctx, beginRequest);
  expect(begin, `begin ${checkId}`).toMatchObject({ status: 'committed' });
  if (begin.status !== 'committed') throw Error(`begin ${checkId} did not commit`);
  const afterBegin = await latestRound(fixture, ref);
  const recorded = await fixture.evidence.recordCheckResult(fixture.ctx,
    fixture.recordRequest(afterBegin, checkId, begin.value.invocationId, executedObservation(text)));
  expect(recorded, `record ${checkId}`).toMatchObject({ status: 'committed' });
  if (recorded.status !== 'committed') throw Error(`record ${checkId} did not commit`);
  return { round: recorded.value, beginRequest, begin };
}

it('admits every fixed check body-first and replays the original open receipt without a second source capture', async () => {
  const fixture = await openFixture();
  expect(fixture.subject).toMatchObject({ taskId: R3E_WORK_TASK_ID });
  const openRequest = fixture.openRequest();
  const opened = await fixture.evidence.openVerification(fixture.ctx, openRequest);
  expect(opened, 'formal open must commit').toMatchObject({ status: 'committed', replayed: false, value: { status: 'open' } });
  if (opened.status !== 'committed') throw Error('open did not commit');
  const round = opened.value;
  expect(round.subject).toEqual(fixture.subject);
  expect(round.subjectRunRef).toEqual(fixture.subjectRunRef);
  expect(round.adoptedPlanRef).toEqual(fixture.planRef);
  expect(round.checks.map(check => check.checkId).sort()).toEqual([fixture.interruptCheck.checkId, fixture.passCheck.checkId].sort());

  let latest = round;
  for (const check of round.checks) {
    latest = (await completeCheck(fixture, round.ref, check.checkId, `R3E_OK_${check.checkId}\n`)).round;
  }
  for (const check of latest.checks) {
    expect(check, `check ${check.checkId} resolved`).toMatchObject({ phase: 'finished', outcome: 'PASS', sourceStatus: 'matched' });
    expect(check.reportRef, `check ${check.checkId} has a report`).toBeTruthy();
  }
  const reportRef = latest.checks.find(check => check.checkId === fixture.passCheck.checkId)?.reportRef ?? null;
  if (reportRef === null) throw Error('the pass check must carry a report ref');

  // The report body is read back through the real body-first material seam.
  const facts = await fixture.materialFacts.openArtifactFacts(fixture.ctx, { ref: reportRef, usage: 'historical_explanation' });
  expect(facts.result, 'report body must be readable as historical fact').toMatchObject({ status: 'ready' });
  if (facts.result.status !== 'ready') throw Error('report body read did not succeed');
  expect(facts.result.value.body).toContain('R3E_OK_r3e-pass');

  const read = await fixture.evidence.readVerification(fixture.ctx, round.ref);
  expect(read, 'directed round read returns the persisted view').toEqual({ status: 'ready', value: latest });

  const finalized = await fixture.evidence.finalizeChecks(fixture.ctx, fixture.finalizeRequest(latest));
  expect(finalized, 'finalize must commit the mechanical Evidence').toMatchObject({
    status: 'committed', replayed: false, value: { applicable: true, outcome: 'PASS' },
  });
  if (finalized.status !== 'committed') throw Error('finalize did not commit');
  expect(finalized.value.snapshot.status).toBe('finalized');
  expect(finalized.value.evidence).toHaveLength(1);

  const capturesBeforeReplay = fixture.sourceCaptures();
  const replay = await fixture.evidence.openVerification(fixture.ctx, openRequest);
  expect(replay, 'the original request replays its receipt').toMatchObject({ status: 'committed', replayed: true });
  expect(replay.status === 'committed' ? replay.value : null).toEqual(round);
  expect(fixture.sourceCaptures(), 'receipt replay must not re-capture source').toBe(capturesBeforeReplay);
});

it('refuses mismatched subject/ticket identities but keeps an original executed fact after Host revocation', async () => {
  const fixture = await openFixture();
  const opened = await fixture.evidence.openVerification(fixture.ctx, fixture.openRequest());
  expect(opened, 'formal open must commit').toMatchObject({ status: 'committed' });
  if (opened.status !== 'committed') throw Error('open did not commit');
  const round = opened.value;
  const begin = await fixture.evidence.beginCheck(fixture.ctx, fixture.beginRequest(round, fixture.passCheck.checkId));
  expect(begin, 'formal begin must commit').toMatchObject({ status: 'committed' });
  if (begin.status !== 'committed') throw Error('begin did not commit');
  const afterBegin = await latestRound(fixture, round.ref);
  const recordRequest = fixture.recordRequest(afterBegin, fixture.passCheck.checkId, begin.value.invocationId, executedObservation('R3E_OK_original\n'));

  const wrongSubject = await fixture.evidence.openVerification(fixture.ctx,
    fixture.openRequest({ subject: { ...fixture.subject, taskId: 'not-the-subject-task' } }));
  expect(wrongSubject, 'a subject that is not the Run task is refused').toMatchObject({ status: 'rejected' });
  const wrongInvocation = await fixture.evidence.recordCheckResult(fixture.ctx,
    fixture.recordRequest(afterBegin, fixture.passCheck.checkId, 'not-the-invocation', executedObservation('R3E_OK_wrong\n')));
  expect(wrongInvocation, 'a ticket that is not the begun invocation is refused').toMatchObject({ status: 'rejected' });
  const wrongCheck = await fixture.evidence.recordCheckResult(fixture.ctx,
    fixture.recordRequest(afterBegin, 'not-the-check', begin.value.invocationId, executedObservation('R3E_OK_other\n')));
  expect(wrongCheck, 'a ticket that is not the begun check is refused').toMatchObject({ status: 'rejected' });
  const wrongHostCtx = { ...fixture.ctx,
    principal: { kind: 'host' as const, actor: { kind: 'human' as const, id: 'not-the-check-host' } } };
  const wrongExecutor = await fixture.evidence.recordCheckResult(wrongHostCtx, recordRequest);
  expect(wrongExecutor, 'an executor that is not the ticket executor is refused').toMatchObject({ status: 'rejected' });

  // The Host later withdraws the source grant. The already-begun ticket is a
  // real fact: its observation is saved, the round records the changed source
  // status and the result stays INCONCLUSIVE (a PASS is never fabricated).
  fixture.hostState.permissionRevision = 'r3e-permission-2';
  fixture.hostState.allowSource = false;
  const recorded = await fixture.evidence.recordCheckResult(fixture.ctx, recordRequest);
  expect(recorded, 'the original executed fact survives a later revocation').toMatchObject({ status: 'committed' });
  if (recorded.status !== 'committed') throw Error('record of the original ticket did not commit');
  const check = recorded.value.checks.find(candidate => candidate.checkId === fixture.passCheck.checkId);
  expect(check, 'the executed check is finished but not a PASS').toMatchObject({
    phase: 'finished', outcome: 'INCONCLUSIVE', sourceStatus: 'permission_changed',
  });
  const reportRef = check?.reportRef ?? null;
  if (reportRef === null || reportRef === undefined) throw Error('the retained fact must carry a report ref');

  // The real report body is read back through the existing historical material
  // reader; its observation is the ORIGINAL domain output, not a re-derived one.
  const capturesBeforeBody = fixture.sourceCaptures();
  const facts = await fixture.materialFacts.openArtifactFacts(fixture.ctx, { ref: reportRef, usage: 'historical_explanation' });
  expect(facts.result, 'the retained report is readable as a historical fact').toMatchObject({ status: 'ready' });
  if (facts.result.status !== 'ready') throw Error('retained report body read did not succeed');
  const body = JSON.parse(facts.result.value.body) as {
    source?: { actor?: unknown; runRef?: unknown }; subjectRunRef?: unknown; observation?: unknown;
  };
  expect(body.observation, 'the persisted observation is the original recorded observation')
    .toEqual(recordRequest.input.observation);
  expect(body.source, 'the report source is the real Host, not the ended subject Run').toMatchObject({
    actor: { kind: R3E_HOST.kind, id: R3E_HOST.id }, runRef: null,
  });
  expect(body.subjectRunRef, 'the report names the real subject Run').toEqual(fixture.subjectRunRef);
  expect(fixture.sourceCaptures(), 'reading the retained report captures no new source').toBe(capturesBeforeBody);

  // The original request replays byte-for-byte; only the replay marker changes.
  const capturesBeforeReplay = fixture.sourceCaptures();
  const replay = await fixture.evidence.recordCheckResult(fixture.ctx, recordRequest);
  expect(replay, 'the original record receipt replays under the later failure').toEqual({ ...recorded, replayed: true });
  expect(fixture.sourceCaptures(), 'record replay must not re-read the source').toBe(capturesBeforeReplay);
});

it('keeps the first recorded result, refuses a changed observation and preserves an interrupted window', async () => {
  const fixture = await openFixture();
  const opened = await fixture.evidence.openVerification(fixture.ctx, fixture.openRequest());
  expect(opened, 'formal open must commit').toMatchObject({ status: 'committed' });
  if (opened.status !== 'committed') throw Error('open did not commit');
  const round = opened.value;
  const firstBeginRequest = fixture.beginRequest(round, fixture.passCheck.checkId);
  const begin = await fixture.evidence.beginCheck(fixture.ctx, firstBeginRequest);
  expect(begin, 'formal begin must commit').toMatchObject({ status: 'committed' });
  if (begin.status !== 'committed') throw Error('begin did not commit');
  const invocationId = begin.value.invocationId;
  const afterBegin = await latestRound(fixture, round.ref);

  const first = await fixture.evidence.recordCheckResult(fixture.ctx,
    fixture.recordRequest(afterBegin, fixture.passCheck.checkId, invocationId, executedObservation('first-real-result\n')));
  expect(first, 'the first real result commits').toMatchObject({ status: 'committed' });
  if (first.status !== 'committed') throw Error('first record did not commit');

  const conflict = await fixture.evidence.recordCheckResult(fixture.ctx,
    fixture.recordRequest(first.value, fixture.passCheck.checkId, invocationId, executedObservation('different-result\n')));
  expect(conflict, 'the same ticket cannot be overwritten with another observation').toMatchObject({ status: 'rejected' });

  const read = await fixture.evidence.readVerification(fixture.ctx, round.ref);
  expect(read, 'the persisted result is unchanged after the conflict').toEqual({ status: 'ready', value: first.value });

  // Reuse the ORIGINAL request object (same requestId/expected/input); only the
  // replayed marker may differ from the original begin value/cursor.
  const replayBegin = await fixture.evidence.beginCheck(fixture.ctx, firstBeginRequest);
  expect(replayBegin, 'repeating begin returns the original ticket and never a new process')
    .toEqual({ ...begin, replayed: true });

  const afterReplayBegin = await latestRound(fixture, round.ref);
  const interruptBegin = await fixture.evidence.beginCheck(fixture.ctx,
    fixture.beginRequest(afterReplayBegin, fixture.interruptCheck.checkId));
  expect(interruptBegin, 'the second check begins').toMatchObject({ status: 'committed' });
  const interrupted = await latestRound(fixture, round.ref);
  expect(interrupted.checks.find(candidate => candidate.checkId === fixture.interruptCheck.checkId),
    'an abandoned execute window stays executing').toMatchObject({ phase: 'executing' });

  const incomplete = await fixture.evidence.finalizeChecks(fixture.ctx, fixture.finalizeRequest(interrupted));
  expect(incomplete, 'a round with an unknown executing window is not finalized').toMatchObject({ status: 'rejected', code: 'incomplete' });
  const stillOpen = await latestRound(fixture, round.ref);
  expect(stillOpen.status).toBe('open');
});

it('finalizes under one Round CAS, ignores an unrelated public write, then refuses a fresh begin', async () => {
  const fixture = await openFixture();
  const opened = await fixture.evidence.openVerification(fixture.ctx, fixture.openRequest());
  expect(opened, 'formal open must commit').toMatchObject({ status: 'committed' });
  if (opened.status !== 'committed') throw Error('open did not commit');
  const round = opened.value;
  const stale = round;

  // A real public Goal write appends to the same ledger but touches no Round fact.
  await fixture.createUnrelatedGoal('r3e-unrelated-goal', 'r3e-unrelated-goal-id');

  const begun = new Map<string, { request: BeginRequest; result: BeginResult }>();
  let latest = round;
  for (const check of round.checks) {
    const completed = await completeCheck(fixture, round.ref, check.checkId, `R3E_OK_${check.checkId}\n`);
    begun.set(check.checkId, { request: completed.beginRequest, result: completed.begin });
    latest = completed.round;
  }

  // The pre-change Round revision is genuinely stale after the public writers advanced it.
  const conflict = await fixture.evidence.finalizeChecks(fixture.ctx, fixture.finalizeRequest(stale));
  expect(conflict, 'a stale Round pin must conflict').toMatchObject({ status: 'rejected', code: 'revision_conflict' });

  const finalized = await fixture.evidence.finalizeChecks(fixture.ctx, fixture.finalizeRequest(latest));
  expect(finalized, 'the current Round revision finalizes').toMatchObject({ status: 'committed', value: { applicable: true, outcome: 'PASS' } });
  if (finalized.status !== 'committed') throw Error('finalize did not commit');

  const refused = await fixture.evidence.beginCheck(fixture.ctx,
    fixture.beginRequest(finalized.value.snapshot, fixture.interruptCheck.checkId));
  expect(refused, 'a finalized round refuses a fresh begin').toMatchObject({ status: 'rejected' });

  // The ORIGINAL committed begin request still returns its original ticket,
  // value and cursor; only the replayed marker changes.
  const original = begun.get(fixture.passCheck.checkId);
  if (original === undefined) throw Error('the pass check begin request must be retained');
  const replayed = await fixture.evidence.beginCheck(fixture.ctx, original.request);
  expect(replayed, 'the original begin request replays its receipt').toEqual({ ...original.result, replayed: true });
});
