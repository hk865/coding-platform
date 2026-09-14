import { describe, expect, it } from 'vitest';
import { InMemoryLedger } from '../../src/data/state-ledger/in-memory-ledger.js';
import { SqliteStateLedger } from '../../src/data/state-ledger/sqlite-ledger.js';
import { ReadModelIndexImpl } from '../../src/data/read-model-index/read-model-index.js';
import { SqliteReadModelIndex } from '../../src/data/read-model-index/sqlite-read-model-index.js';
import type { ReviewResultSnapshot, ReviewWorkSnapshot } from '../../src/contracts/reviewer-work.js';
import type { TaskEvidenceIndexSnapshot } from '../../src/contracts/evidence.js';
import type { LedgerCommit, StateLedger } from '../../src/contracts/ledger.js';
import { buildReduceTaskCommand } from '../../src/contracts/commands/evidence.js';
import { reviewFixture, load, scope, identity, ref, sha, cmd } from './reviewer-work-fixture.js';
import { taskLeaseRefFor } from '../../src/contracts/dispatch.js';
import { ControlPolicyExplanation } from '../../src/control/control-engine/policy-explanation.js';
import { loadLivePlan } from '../../src/control/control-engine/dispatch-facts.js';

for (const storage of ['memory', 'sqlite'] as const) describe('independent review Control '+storage, () => {
  const ledgerFor = () => storage === 'memory' ? new InMemoryLedger() : new SqliteStateLedger({ path: ':memory:' });
  it('creates and starts blocked-task review without changing TaskLease, groups every outcome atomically and projects the separate run', async () => {
    const ledger = ledgerFor(), h = await reviewFixture(ledger), commits: LedgerCommit[] = [];
    const originalCommit = ledger.commit.bind(ledger); ledger.commit = batch => { commits.push(batch); return originalCommit(batch); };
    const before = await ledger.load(taskLeaseRefFor(scope.projectId,scope.goalId,scope.taskId));
    const reduced = await h.control.reduceTask(buildReduceTaskCommand({ ...cmd('pre-review-reduce'), ...scope, expectedRevision: 0 }));
    expect(reduced).toMatchObject({ status: 'committed', phase: 'blocked' });
    const created = await h.ports.lifecycle.createWork(h.create); expect(created).toMatchObject({ status: 'accepted' }); if (created.status === 'rejected') return;
    expect(await h.ports.lifecycle.createWork(h.create)).toMatchObject({ status: 'replayed', workRef: created.workRef });
    const started = await h.start(await load<ReviewWorkSnapshot>(ledger, created.workRef));
    const assessmentRef = ref('{"assessment":"mixed"}');
    const command = { identity: identity('admission'), workRef: created.workRef, expectedWorkRevision: started.work.revision, output: started.output, validatedMaterialIdentityDigest: sha(h.create.descriptor.materialIdentity), assessmentRef, assessmentDigest: assessmentRef.digest, decision: { status: 'accepted' as const, requirements: h.coverage.map((c,i) => ({ ...c, outcome: (['PASS','FAIL','INCONCLUSIVE'] as const)[i]!, summary: 'Specific reviewer rationale' })) } };
    expect(await h.ports.lifecycle.recordValidatedResult(command)).toMatchObject({ status: 'accepted' });
    expect(await h.ports.lifecycle.recordValidatedResult(command)).toMatchObject({ status: 'replayed' });
    const work = await load<ReviewWorkSnapshot>(ledger,created.workRef), result = await load<ReviewResultSnapshot>(ledger,work.resultRef!);
    expect(result.decision.evidenceRefs).toHaveLength(3);
    const index = await load<TaskEvidenceIndexSnapshot>(ledger,{ aggregateType:'TaskEvidenceIndex', projectId:scope.projectId,goalId:scope.goalId,taskId:scope.taskId }); expect(index.revision).toBe(4);
    expect(await ledger.load(taskLeaseRefFor(scope.projectId,scope.goalId,scope.taskId))).toEqual(before);
    expect(commits.filter(c => c.commitKind.startsWith('review-')).map(c=>c.commitKind)).toEqual(['review-work-create','review-start','review-output-bind','review-result-admission']);
    expect(await h.control.reduceTask(buildReduceTaskCommand({ ...cmd('post-review-reduce'), ...scope, expectedRevision: 1 }))).toMatchObject({ status: 'committed', phase: 'failed' });
    for (const read of [new ReadModelIndexImpl(new ControlPolicyExplanation()), new SqliteReadModelIndex({ path: ':memory:', policyExplanation: new ControlPolicyExplanation() })]) {
      let cursor = null as import('../../src/contracts/command-event.js').CommitCursor | null;
      for (;;) { const page = await ledger.events({ afterCursor:cursor,limit:100 }); await read.advance(page); cursor=page.throughCursor; if(!page.hasMore)break; }
      expect((await read.reviewWork(work.ref))?.result).toEqual(result);
      const rows = await read.consoleActiveAgents(scope); expect(rows.status).toBe('ready'); if(rows.status==='ready') { const reviewer=rows.agents.rows.find(r=>r.runRef.runId===work.reviewerRunRef.runId); expect(reviewer).toMatchObject({ runStatus:'ended',runOutcome:'completed',lease:{holderRunId:scope.runId}, work:{kind:'review',reviewWorkRef:work.ref} }); }
      if ('close' in read) await read.close();
    }
    if ('close' in ledger) await ledger.close();
  });
  it('rejects generic reviewer verdict/observation and fake admission on a new protocol plan', async()=>{
    const h=await reviewFixture(ledgerFor(),{protocol:true});
    for(const kind of ['verdict','observation'] as const){const evidence={...h.toolEvidence,evidenceId:'fake-'+kind,kind,coverage:h.coverage}; expect(await h.control.submitEvidence(h.submit(evidence))).toMatchObject({status:'rejected',code:'review_protocol_required'});}
  });
  it('keeps legacy semantics before adoption, rejects tool FAIL and refuses review redraw', async()=>{
    const h=await reviewFixture(ledgerFor(),{toolOutcome:'FAIL'}); expect(await h.ports.lifecycle.createWork(h.create)).toMatchObject({status:'rejected',code:'rework_required'});
    const legacy=await reviewFixture(ledgerFor()); expect(await legacy.control.submitEvidence(legacy.submit({...legacy.toolEvidence,evidenceId:'old-review-pass',kind:'verdict',coverage:legacy.coverage}))).toMatchObject({status:'committed'});
    expect(await legacy.control.reduceTask(buildReduceTaskCommand({...cmd('legacy-satisfied'),...scope,expectedRevision:0}))).toMatchObject({status:'committed',phase:'satisfied'});
    expect(await legacy.ports.lifecycle.createWork(legacy.create)).toMatchObject({status:'accepted'});
    expect((await loadLivePlan(legacy.ledger,legacy.plan)).tasks.find(t=>t.taskId===scope.taskId)?.phase).toBe('blocked');
    expect(await legacy.ports.lifecycle.createWork({...legacy.create,requestId:'redraw',identity:identity('redraw')})).toMatchObject({status:'rejected',code:'review_already_exists'});
    const result=await legacy.control.reduceTask(buildReduceTaskCommand({...cmd('remove-legacy-pass'),...scope,expectedRevision:1})); expect(result).toMatchObject({status:'committed',phase:'blocked'});
  });
  it('preserves prior reviewer FAIL even when a later legacy PASS exists',async()=>{
    const h=await reviewFixture(ledgerFor());
    for(const outcome of ['FAIL','PASS'] as const)expect(await h.control.submitEvidence(h.submit({...h.toolEvidence,evidenceId:'old-'+outcome,kind:'verdict',outcome,coverage:h.coverage}))).toMatchObject({status:'committed'});
    expect(await h.ports.lifecycle.createWork(h.create)).toMatchObject({status:'rejected',code:'rework_required'});
  });
  it('survives lost create responses and rejects altered same-key commands',async()=>{
    const ledger=ledgerFor(),h=await reviewFixture(ledger), original=ledger.commit.bind(ledger);let lose=true;
    ledger.commit=async batch=>{const receipt=await original(batch);if(lose&&batch.commitKind==='review-work-create'){lose=false;throw Error('response lost after commit');}return receipt;};
    expect(await h.ports.lifecycle.createWork(h.create)).toMatchObject({status:'rejected'});
    expect(await h.ports.lifecycle.createWork(h.create)).toMatchObject({status:'replayed'});
    const changed=structuredClone(h.create);changed.reviewerConfigRef.revision++;
    expect(await h.ports.lifecycle.createWork(changed)).toMatchObject({status:'rejected',code:'idempotency_conflict'});
  });
  it('rejects a create transaction with the protocol adoption removed and writes no partial Work',async()=>{
    const ledger=ledgerFor(),h=await reviewFixture(ledger), original=ledger.commit.bind(ledger);
    ledger.commit=batch=>batch.commitKind==='review-work-create'?original({...batch,snapshots:batch.snapshots.filter(s=>s.ref.aggregateType!=='TaskReviewProtocol'),events:batch.events.filter(e=>e.eventType!=='TaskReviewProtocolAdopted')}):original(batch);
    expect(await h.ports.lifecycle.createWork(h.create)).toMatchObject({status:'rejected',code:'invalid_commit'});
    ledger.commit=original;
    expect(await h.ports.lifecycle.createWork(h.create)).toMatchObject({status:'accepted',workRevision:1});
  });
  it('rolls back result/evidence/index together and replays the unchanged command after a transaction interruption',async()=>{
    let fail=false; const beforeWrite=()=>{if(fail)throw Error('injected transaction interruption');};
    const ledger:StateLedger=storage==='memory'?new InMemoryLedger({beforeWrite}):new SqliteStateLedger({path:':memory:',beforeWrite}),h=await reviewFixture(ledger);
    const create=await h.ports.lifecycle.createWork(h.create); if(create.status==='rejected')throw Error(create.code);
    const started=await h.start(await load<ReviewWorkSnapshot>(ledger,create.workRef)), assessmentRef=ref('{"assessment":"atomic"}');
    const command={identity:identity('atomic-admission'),workRef:create.workRef,expectedWorkRevision:started.work.revision,output:started.output,validatedMaterialIdentityDigest:sha(h.create.descriptor.materialIdentity),assessmentRef,assessmentDigest:assessmentRef.digest,decision:{status:'accepted' as const,requirements:h.coverage.map((c,i)=>({...c,outcome:(['PASS','FAIL','INCONCLUSIVE'] as const)[i]!,summary:'Atomic evidence rationale'}))}};
    const indexRef={aggregateType:'TaskEvidenceIndex' as const,projectId:scope.projectId,goalId:scope.goalId,taskId:scope.taskId},before=await ledger.load(indexRef);
    fail=true;expect(await h.ports.lifecycle.recordValidatedResult(command)).toMatchObject({status:'rejected'});fail=false;
    expect(await ledger.load(indexRef)).toEqual(before);expect((await load<ReviewWorkSnapshot>(ledger,create.workRef)).resultRef).toBeNull();
    expect(await h.ports.lifecycle.recordValidatedResult(command)).toMatchObject({status:'accepted'});
    expect(await h.ports.lifecycle.recordValidatedResult(command)).toMatchObject({status:'replayed'});
  });
  it('rejects fake requirement coverage and repeat output identities',async()=>{
    const h=await reviewFixture(ledgerFor()),created=await h.ports.lifecycle.createWork(h.create);if(created.status==='rejected')throw Error(created.code);
    const started=await h.start(await load<ReviewWorkSnapshot>(h.ledger,created.workRef));
    expect(await h.ports.dispatch.bindOutput({identity:identity('another-output'),workRef:created.workRef,expectedWorkRevision:2,output:started.output})).toMatchObject({status:'rejected',code:'idempotency_conflict'});
    const assessmentRef=ref('{"assessment":"coverage"}');
    const command={identity:identity('bad-coverage'),workRef:created.workRef,expectedWorkRevision:started.work.revision,output:started.output,validatedMaterialIdentityDigest:sha(h.create.descriptor.materialIdentity),assessmentRef,assessmentDigest:assessmentRef.digest,decision:{status:'accepted' as const,requirements:[{...h.coverage[0]!,outcome:'PASS' as const,summary:'One row omits other requirements'}]}};
    expect(await h.ports.lifecycle.recordValidatedResult(command)).toMatchObject({status:'rejected',code:'coverage_mismatch'});
    expect((await load<ReviewWorkSnapshot>(h.ledger,created.workRef)).resultRef).toBeNull();
  });
  it('rejects mismatched terminal facts and a grant withdrawn before formal output binding',async()=>{
    const h=await reviewFixture(ledgerFor()),created=await h.ports.lifecycle.createWork(h.create);if(created.status==='rejected')throw Error(created.code);
    const started=await h.start(await load<ReviewWorkSnapshot>(h.ledger,created.workRef),{bindOutput:false});
    const command={identity:identity('bind-output'),workRef:created.workRef,expectedWorkRevision:started.work.revision,output:started.output};
    expect(await h.ports.dispatch.bindOutput({...command,output:{...command.output,terminalEventId:'fabricated-terminal'}})).toMatchObject({status:'rejected',code:'invalid_output'});
    const grantRef=started.work.input!.grantRefs[0]!;
    expect(await h.control.revokeMaterialAccess({...cmd('withdraw-review-grant'),schemaVersion:1,commandType:'RevokeMaterialAccess',identity:identity('withdraw-review-grant'),aggregateId:grantRef.grantId,expectedRevision:1,payload:{grantRef,reason:'Withdraw before binding'}})).toMatchObject({status:'committed'});
    expect(await h.ports.dispatch.bindOutput(command)).toMatchObject({status:'rejected',code:'stale_grant'});
    expect((await load<ReviewWorkSnapshot>(h.ledger,created.workRef)).output).toBeNull();
  });
  it('rejects a grouped report exceeding the shared 512 evidence cap without a partial Result or index update',async()=>{
    const h=await reviewFixture(ledgerFor(),{reviewers:30}),created=await h.ports.lifecycle.createWork(h.create);if(created.status==='rejected')throw Error(created.code);
    const started=await h.start(await load<ReviewWorkSnapshot>(h.ledger,created.workRef));
    for(let i=0;i<510;i++)expect(await h.control.submitEvidence(h.submit({...h.toolEvidence,evidenceId:'bounded-claim-'+i,kind:'claim',outcome:'INCONCLUSIVE'}))).toMatchObject({status:'committed'});
    const assessmentRef=ref('{"assessment":"bounded"}');
    const command={identity:identity('bounded-result'),workRef:created.workRef,expectedWorkRevision:started.work.revision,output:started.output,validatedMaterialIdentityDigest:sha(h.create.descriptor.materialIdentity),assessmentRef,assessmentDigest:assessmentRef.digest,decision:{status:'accepted' as const,requirements:h.coverage.map((c,i)=>({...c,outcome:(['PASS','FAIL','INCONCLUSIVE'] as const)[i%3]!,summary:'Per requirement bounded rationale'}))}};
    expect(await h.ports.lifecycle.recordValidatedResult(command)).toMatchObject({status:'rejected',code:'evidence_limit_exceeded'});
    expect((await load<ReviewWorkSnapshot>(h.ledger,created.workRef)).resultRef).toBeNull();
    expect((await load<TaskEvidenceIndexSnapshot>(h.ledger,{aggregateType:'TaskEvidenceIndex',projectId:scope.projectId,goalId:scope.goalId,taskId:scope.taskId})).revision).toBe(511);
  });
});
