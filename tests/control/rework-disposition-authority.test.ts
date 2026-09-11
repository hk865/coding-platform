import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ControlReworkDisposition } from '../../src/control/control-engine/rework-disposition.js';
import { InMemoryLedger } from '../../src/data/state-ledger/in-memory-ledger.js';
import type { ReviewWorkSnapshot } from '../../src/contracts/reviewer-work.js';
import { admitConclusion, buildIssue, engineFor, memoryLedger, prepareScope,
  RW04_PROJECT, RW04_WORKSPACE, RW04_GOAL, RW04_VERIFY_TASK, RW04_OBLIGATION, RW04_REQUIREMENT } from './autonomous-rework-fixture.js';
import { appendFailRound, openJournalPort } from './rework-drive-fixture.js';
import { reviewFixture, scope as reviewScope, load, ref, identity, sha } from './reviewer-work-fixture.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const request = { schemaVersion: 1 as const, projectId: RW04_PROJECT, workspaceId: RW04_WORKSPACE, goalId: RW04_GOAL, taskIds: [] };

it('does not dispose a journal failure when a later journal PASS has no admitted Evidence', async () => {
  const ledger = memoryLedger();
  const { sourcePlan: plan } = await prepareScope(ledger);
  const directory = await mkdtemp(join(tmpdir(), 'disposition-authority-')); directories.push(directory);
  const { journal, port } = await openJournalPort({ directory, current: () => ledger });
  for (const result of ['FAIL', 'PASS'] as const) await appendFailRound({
    journal, scope: { projectId: RW04_PROJECT, workspaceId: RW04_WORKSPACE, goalId: RW04_GOAL, taskId: RW04_VERIFY_TASK, runId: 'run-' + result },
    plan, sourceDigest: 'source', requestId: 'request-' + result, evidenceId: 'never-admitted-' + result,
    check: { checkId: 'check-' + result, command: 'test', obligationId: RW04_OBLIGATION, requirementId: RW04_REQUIREMENT, kind: 'dynamic', result },
  });
  const before = await ledger.events({ afterCursor: null, limit: 1000 });
  const view = await port(request);
  expect(view.status).toBe('ready');
  if (view.status !== 'ready') throw Error('Expected preserved failure');
  expect(view.issues).toHaveLength(1);
  expect(view.issues[0]!.disposition!.status).toBe('unaddressed');
  expect(await ledger.events({ afterCursor: null, limit: 1000 })).toEqual(before);
});

it('rejects stale canonical PASS for disposition and accepts only a current admitted PASS', async () => {
  const ledger = memoryLedger(), engine = engineFor(ledger);
  const { sourcePlan: plan } = await prepareScope(ledger);
  const issue = buildIssue({ taskId: RW04_VERIFY_TASK, plan,
    failedRequirements: [{ obligationId: RW04_OBLIGATION, requirementId: RW04_REQUIREMENT }] });
  const reader = new ControlReworkDisposition(ledger);
  const conclusion = { plan, taskId: RW04_VERIFY_TASK, obligationId: RW04_OBLIGATION, requirementId: RW04_REQUIREMENT, outcome: 'PASS' as const };
  await admitConclusion(engine, ledger, { ...conclusion, evidenceId: 'stale-pass', workspaceRevision: 999 });
  expect((await reader.projectIssues(request, [issue]))[0]!.disposition!.status).toBe('unaddressed');
  await admitConclusion(engine, ledger, { ...conclusion, evidenceId: 'current-pass', workspaceRevision: 1 });
  const before = await ledger.events({ afterCursor: null, limit: 1000 });
  expect((await reader.projectIssues(request, [issue]))[0]!.disposition!.status).toBe('disposed_by_reverification');
  expect(await ledger.events({ afterCursor: null, limit: 1000 })).toEqual(before);
});

it('requires canonical independent review admission before reviewer PASS can dispose the requirement', async () => {
  const ledger = new InMemoryLedger(), h = await reviewFixture(ledger, { protocol: true, reviewers: 1 });
  const issue = buildIssue({ ...reviewScope, plan: h.plan,
    failedRequirements: h.coverage.map(coverage => ({ ...coverage, kind: 'reviewer' as const })) });
  const query = { schemaVersion: 1 as const, ...reviewScope, taskIds: [] };
  const reader = new ControlReworkDisposition(ledger);
  // A caller-supplied verdict is refused by the real Control entry point.
  expect(await h.control.submitEvidence(h.submit({ ...h.toolEvidence, evidenceId: 'unqualified-review-pass', kind: 'verdict', coverage: h.coverage })))
    .toMatchObject({ status: 'rejected', code: 'review_protocol_required' });
  expect((await reader.projectIssues(query, [issue]))[0]!.disposition!.status).toBe('unaddressed');
  const created = await h.ports.lifecycle.createWork(h.create);
  if (created.status === 'rejected') throw Error(created.code);
  const started = await h.start(await load<ReviewWorkSnapshot>(ledger, created.workRef));
  // A persisted reviewer output is still not a formally admitted reviewer result.
  expect((await reader.projectIssues(query, [issue]))[0]!.disposition!.status).toBe('unaddressed');
  const assessmentRef = ref('{"assessment":"authority-review"}');
  expect(await h.ports.lifecycle.recordValidatedResult({
    identity: identity('authority-review-result'), workRef: created.workRef, expectedWorkRevision: started.work.revision,
    output: started.output, validatedMaterialIdentityDigest: sha(h.create.descriptor.materialIdentity),
    assessmentRef, assessmentDigest: assessmentRef.digest,
    decision: { status: 'accepted', requirements: h.coverage.map(coverage => ({ ...coverage, outcome: 'PASS' as const, summary: 'Independent qualification evidence' })) },
  })).toMatchObject({ status: 'accepted' });
  const before = await ledger.events({ afterCursor: null, limit: 1000 });
  expect((await reader.projectIssues(query, [issue]))[0]!.disposition!.status).toBe('disposed_by_reverification');
  expect(await ledger.events({ afterCursor: null, limit: 1000 })).toEqual(before);
});
