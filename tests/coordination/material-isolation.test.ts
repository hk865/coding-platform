/** A02: real Control/SQLite/Vault routing and exact-principal shared-body isolation. */
import { expect, it } from 'vitest';
import { createPersistentPlatform } from '../../src/composition/persistent-platform.js';
import { setupP107Scenario } from '../../tests/coordination/runtime-concurrency-fixture.js';
import { P107_PROJECT as P, P107_WORKSPACE as W, P107_SCHEMA as AT } from '../../tests/contract-support/fixtures/workspace-fixtures.js';
import { P107_GOAL as G, P107_TASK_READER_A, P107_TASK_READER_B, P107_TASK_WRITER_B, P107_ROLE_BINDING_READER_V1 as ROLE, p107PlanRef } from '../../tests/contract-suite/p1-07-harness.js';
import { buildDispatchClaimCommand } from '../../src/fixtures/dispatch-fixtures.js';
import { workContextRefFor } from '../../src/contracts/context-continuity.js';
import { workParticipationRefFor, directedRequestRefFor } from '../../src/contracts/coordination.js';
import { CoordinationDrive } from '../../src/control/dispatch-engine/coordination-drive.js';
import { buildGrantMaterialAccessCommand, buildMaterialAccessGrantV1 } from '../../src/contracts/commands/material-access.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';

it('three real Works share one formally routed body: two authorized readers, third denied even after identical-body put and SQLite reopen', async () => {
  const source = { async capture(q: any) { return {status:'sourced' as const,pin:{schemaVersion:1 as const,projectId:q.projectId,workspaceId:q.workspaceId,sourceSet:q.sourceSet,identity:{workspace:'cm1a-a02-isolated',commit:null},manifestDigest:sha256Hex('source-a02')}}; } };
  let h = await createPersistentPlatform({deps:{clock:()=>AT},sourceApplicability:source});
  try {
    await setupP107Scenario(h);
    const actors:any[]=[];
    for(const [i,taskId] of [P107_TASK_READER_A,P107_TASK_READER_B,P107_TASK_WRITER_B].entries()){
      const name=['a','b','u'][i];
      const claim=await h.claimTask(buildDispatchClaimCommand({projectId:P,goalId:G,taskId,runId:'run-isolation-'+name,attemptId:'attempt-isolation-'+name,commandId:'claim-isolation-'+name,correlationId:'a02',idempotencyKey:'claim-isolation-'+name,submittedAt:AT,roleBinding:ROLE,declaredPermissions:{tools:['read'],writeScope:[]},budget:{tokenBudget:1000000,deadline:null}}));
      expect(claim.status,JSON.stringify(claim)).toBe('committed');if(claim.status!=='committed')throw Error('claim');
      const runRef=claim.runRef, workRef=workContextRefFor(P,W,'work-isolation-'+name),partRef=workParticipationRefFor(P,W,workRef.workId,'part-isolation-'+name),agentId='agent-isolation-'+name;
      const actor={kind:'agent',id:agentId,runRef};
      const principal={schemaVersion:1,agentInstanceId:agentId,workContextRef:workRef,participationRef:partRef,roleBinding:ROLE,runRef};
      const identity=(id:string,withPrincipal=true)=>({projectId:P,actor,idempotencyKey:id,...(withPrincipal?{agentPrincipal:principal}:{})});
      const command=(type:string,id:string,aggregateId:string,payload:any,expectedRevision=0)=>({commandId:id,commandType:type,schemaVersion:1,aggregateId,expectedRevision,correlationId:'a02',submittedAt:AT,identity:identity(id),payload});
      const bound=await h.control.bindWorkContext({commandId:'bind-'+name,commandType:'BindWorkContext',schemaVersion:1,aggregateId:workRef.workId,expectedRevision:0,correlationId:'a02',submittedAt:AT,identity:{projectId:P,actor:{kind:'system',id:'evidence-host'},idempotencyKey:'bind-'+name},payload:{workspaceId:W,workKind:'task',goalId:G,taskId,planRef:p107PlanRef(P),planRevision:1,roleBindingRef:ROLE,initialRunRef:runRef}});
      expect(bound.status,JSON.stringify(bound)).toBe('committed');
      const registered=await h.control.registerAgentInstance({...command('RegisterAgentInstance','register-'+name,agentId,{workspaceId:W,templateId:'a02-test-template',templateRevision:'1'}),identity:identity('register-'+name,false)} as any);
      expect(registered.status,JSON.stringify(registered)).toBe('committed');
      const participated=await h.control.startWorkParticipation(command('StartWorkParticipation','part-'+name,partRef.participationId,{workspaceId:W,workContextRef:workRef,agentInstanceId:agentId,roleBinding:ROLE,runRef}) as any);
      expect(participated.status,JSON.stringify(participated)).toBe('committed');actors.push({name,runRef,workRef,partRef,command});
    }
    const [a,b,u]=actors;
    const body='CM1A-A02-shared-body-v1-unique-nonce';
    const stored=await h.vault.put({contentType:'text/plain',body,sourceRefs:[{kind:'workspace',refId:W,revision:'1'}],ownerRef:a.runRef,requestedAt:AT});
    expect(stored.status).toBe('stored');if(stored.status!=='stored')throw Error('put');
    const sub=await h.control.createSubscription(b.command('CreateSubscription','subscribe-b','sub-isolation-b',{workspaceId:W,ownerWorkContextRef:b.workRef,ownerParticipationRef:b.partRef,topics:['DirectedRequestSent'],startCursor:null}));
    expect(sub.status,JSON.stringify(sub)).toBe('committed');
    const request=a.command('SendDirectedRequest','send-a-b','request-isolation',{workspaceId:W,fromParticipationRef:a.partRef,fromRunRef:a.runRef,toWorkContextRef:b.workRef,expectedParticipationRef:b.partRef,statement:'Read the exact shared body',statementBodyRef:stored.ref,roleBinding:ROLE});
    const sent=await h.control.sendDirectedRequest(request);expect(sent.status,JSON.stringify(sent)).toBe('committed');
    expect(await h.control.sendDirectedRequest(request)).toMatchObject({status:'committed',replayed:true});
    expect(await h.control.sendDirectedRequest({...request,payload:{...request.payload,statement:'different'}})).toMatchObject({status:'rejected',code:'idempotency_conflict'});
    const drive=await new CoordinationDrive({ledger:h.ledger,control:h.control,now:()=>AT}).drive(8);
    expect(drive.failures,JSON.stringify(drive)).toEqual([]);
    const page=await h.ledger.events({afterCursor:null,limit:1000});
    const delivered=page.events.filter(x=>x.event.eventType==='DeliveryRecorded').map(x=>(x.event.payload as any).delivery);
    expect(delivered.some(d=>d.targetWorkContextRef.workId===b.workRef.workId&&d.bodyRef.digest===stored.ref.digest)).toBe(true);
    expect(delivered.some(d=>d.targetWorkContextRef.workId===u.workRef.workId)).toBe(false);
    const ws=await h.ledger.load({aggregateType:'Workspace',projectId:P,workspaceId:W});if(ws.status!=='found')throw Error('workspace');
    const captured=await source.capture({projectId:P,workspaceId:W,sourceSet:{kind:'workspace_paths',paths:['.']}});
    const basis={planRef:p107PlanRef(P),workspaceRevision:ws.snapshot.revision,sourceDigest:captured.pin.manifestDigest,sourcePin:captured.pin};
    for(const reader of [a,b]){
      const id='grant-isolation-'+reader.name;
      const grant=buildMaterialAccessGrantV1({grantId:id,scope:{projectId:P,workspaceId:W,goalId:G},materials:[stored.ref],reader:reader.runRef,issuedBy:{aggregateType:'Control',projectId:P,goalId:G},purpose:'A02 exact shared body',basis,grantedAt:AT});
      const receipt=await h.control.grantMaterialAccess(buildGrantMaterialAccessCommand(grant,{commandId:id,projectId:P,actorKind:'system',actorId:'evidence-host',idempotencyKey:id,correlationId:'a02',submittedAt:AT}));
      expect(receipt.status,JSON.stringify(receipt)).toBe('committed');
    }
    await h.advanceProjection();
    const assertReads=async()=>{
      for(const reader of [a,b]) expect(await h.vault.open(stored.ref,{requesterRunRef:reader.runRef,currentBasis:basis,usage:'current'})).toMatchObject({status:'ready',record:{body}});
      expect(await h.vault.open(stored.ref,{requesterRunRef:u.runRef,currentBasis:basis,usage:'current'})).toMatchObject({status:'rejected',code:'forbidden'});
    };
    await assertReads();
    const replay=await h.vault.put({contentType:'text/plain',body,sourceRefs:[{kind:'workspace',refId:W,revision:'1'}],ownerRef:u.runRef,requestedAt:AT});
    expect(replay).toMatchObject({status:'stored',replayed:true,ref:{digest:stored.ref.digest}});await assertReads();
    // A stored orphan body is not an accepted request when its target version is wrong.
    const orphan=await h.vault.put({contentType:'text/plain',body:'orphan-body-a02',sourceRefs:[{kind:'workspace',refId:W,revision:'1'}],ownerRef:a.runRef,requestedAt:AT});if(orphan.status!=='stored')throw Error('orphan');
    const rejected=a.command('SendDirectedRequest','send-rejected','request-rejected',{...request.payload,statementBodyRef:orphan.ref,expectedParticipationRef:a.partRef});
    expect((await h.control.sendDirectedRequest(rejected)).status).toBe('rejected');
    expect((await h.ledger.load(directedRequestRefFor(P,W,'request-rejected'))).status).toBe('not_found');
    await h.close();h=await h.reopen();await h.advanceProjection();await assertReads();
  } finally { await h.cleanup(); }
});
