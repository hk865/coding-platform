import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { SqliteStateLedger } from '../../src/data/state-ledger/sqlite-ledger.js';
import { SqliteReadModelIndex } from '../../src/data/read-model-index/sqlite-read-model-index.js';
import { ControlPolicyExplanation } from '../../src/control/control-engine/policy-explanation.js';
import { createReviewControlPorts } from '../../src/control/control-engine/reviewer-work.js';
import type { ReviewResultSnapshot, ReviewWorkSnapshot } from '../../src/contracts/reviewer-work.js';
import { reviewFixture, load, identity, ref, sha, at } from './reviewer-work-fixture.js';

it('reopens SQLite Work/output/Result/evidence and read projections with the same accepted command identity',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'vr02-control-persistence-'));
  let ledger=new SqliteStateLedger({path:path.join(directory,'ledger.sqlite')});
  let read=new SqliteReadModelIndex({path:path.join(directory,'read.sqlite'),policyExplanation:new ControlPolicyExplanation()});
  try {
    const h=await reviewFixture(ledger,{reviewers:30}),created=await h.ports.lifecycle.createWork(h.create);
    if(created.status==='rejected')throw Error(created.code);
    const started=await h.start(await load<ReviewWorkSnapshot>(ledger,created.workRef)),assessmentRef=ref('{"assessment":"persistent"}');
    const command={identity:identity('persistent-result'),workRef:created.workRef,expectedWorkRevision:started.work.revision,output:started.output,validatedMaterialIdentityDigest:sha(h.create.descriptor.materialIdentity),assessmentRef,assessmentDigest:assessmentRef.digest,decision:{status:'accepted' as const,requirements:h.coverage.map((c,i)=>({...c,outcome:(['PASS','FAIL','INCONCLUSIVE'] as const)[i%3]!,summary:'Persistent per requirement rationale'}))}};
    expect(await h.ports.lifecycle.recordValidatedResult(command)).toMatchObject({status:'accepted'});
    const work=await load<ReviewWorkSnapshot>(ledger,created.workRef),result=await load<ReviewResultSnapshot>(ledger,work.resultRef!);
    expect(result.decision.evidenceRefs).toHaveLength(3);
    for(const evidenceRef of result.decision.evidenceRefs){const stored=await ledger.load(evidenceRef);expect(stored.status==='found'&&stored.snapshot.ref.aggregateType==='Evidence'&&(stored.snapshot as import('../../src/contracts/evidence.js').EvidenceSnapshot).evidence.coverage).toHaveLength(10);}
    let cursor:import('../../src/contracts/command-event.js').CommitCursor|null=null;
    for(;;){const page=await ledger.events({afterCursor:cursor,limit:64});await read.advance(page);cursor=page.throughCursor;if(!page.hasMore)break;}
    const projection=await read.reviewWork(work.ref);
    await ledger.close();await read.close();
    ledger=new SqliteStateLedger({path:path.join(directory,'ledger.sqlite')});
    read=new SqliteReadModelIndex({path:path.join(directory,'read.sqlite'),policyExplanation:new ControlPolicyExplanation()});
    expect(await load<ReviewWorkSnapshot>(ledger,work.ref)).toEqual(work);
    expect(await load<ReviewResultSnapshot>(ledger,result.ref)).toEqual(result);
    expect(await read.reviewWork(work.ref)).toEqual(projection);
    const ports=createReviewControlPorts({ledger,now:()=>at,eventId:()=>{throw Error('replay must not produce events');}});
    expect(await ports.lifecycle.createWork(h.create)).toMatchObject({status:'replayed',workRef:work.ref});
    expect(await ports.lifecycle.recordValidatedResult(command)).toMatchObject({status:'replayed',resultRef:result.ref});
    expect(await ports.lifecycle.recordValidatedResult({...command,identity:identity('different-persistent-result')})).toMatchObject({status:'rejected',code:'idempotency_conflict'});
  }finally{await ledger.close();await read.close();await rm(directory,{recursive:true,force:true});}
});
