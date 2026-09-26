/** Real composition consumers over the same durable ledger, bodies and Kernel Session.
 * Initial domain facts are produced by real Goal/Plan/Session/claim services in
 * the shared fixture. No Run/envelope/terminal is manually seeded. */
import {afterEach,expect,it} from 'vitest';
import {join} from 'node:path';
import {createTargetPlatform} from '../../src/composition/create-platform.js';
import {B2_AT,createB2RuntimeFixture,type B2RuntimeFixture} from '../helpers/B2-runtime-fixture.js';

const fixtures:B2RuntimeFixture[]=[];
afterEach(async()=>{for(const fixture of fixtures.splice(0))await fixture.close();});
async function open(options:Parameters<typeof createB2RuntimeFixture>[0]={}){
  const fixture=await createB2RuntimeFixture({...options,kind:'sqlite'});fixtures.push(fixture);
  await fixture.claimFixture.closeBackend();
  const platformOptions={storage:{kind:'sqlite' as const,directory:fixture.directory},workspace:fixture.deps.workspaceHost,now:()=>B2_AT,
    kernelStores:{entries:[{adapterId:'r4c-claim-kernel',storeKey:'r4c-claim-kernel-store',workspace:fixture.scope,databasePath:join(fixture.directory,'kernel.sqlite')}]},runtime:fixture.host};
  return {fixture,platformOptions,platform:await createTargetPlatform(platformOptions)};
}

it('prepares and executes the real claimed Run through the composition root, then cold-observes without another provider',async()=>{
  const {fixture:f,platformOptions,platform}=await open({scriptedReplies:[{kind:'text',text:'B2 composed answer'}]});
  try{
    const capabilities=await platform.runtime.capabilities(f.ctx,f.scope);
    expect(capabilities).toMatchObject({status:'ready',value:{createSession:{supported:true},readHistory:{supported:true},scopedWorkspaceWrites:{supported:false}}});
    const prepared=await platform.runtime.prepareExecution(f.ctx,{runRef:f.claim.runRef,requestId:'composed-prepare'});
    expect(prepared.status).toBe('ready');if(prepared.status!=='ready')return;
    expect(await platform.runtime.startRun(f.ctx,{prepared:prepared.value,consumerId:'composed-driver',requestId:'composed-start'})).toMatchObject({status:'ready',value:{run:{status:'ended'},session:{occupancy:null}}});
    expect(f.scripted.calls()).toBe(1);
    const original=await platform.executions.readExecution(f.ctx,f.claim.runRef);
    expect(original.status).toBe('ready');if(original.status!=='ready')return;
    expect(original.value.run.executionHistory?.endPosition).not.toBeNull();
    await platform.close();
    const reopened=await createTargetPlatform(platformOptions);
    try{
      const observed=await reopened.runtime.observeRun(f.ctx,{runRef:f.claim.runRef});
      expect(observed).toMatchObject({status:'ready',value:{run:{status:'ended'},session:{occupancy:null}}});
      if(observed.status==='ready')expect(observed.value.run.executionHistory).toEqual(original.value.run.executionHistory);
      expect(f.scripted.calls()).toBe(1);
    }finally{await reopened.close();}
  }finally{await platform.close();}
});

it('close waits for an active provider and its formal result before shutting the real stores',async()=>{
  let entered!:()=>void;const providerEntered=new Promise<void>(resolve=>{entered=resolve;});
  let release!:()=>void;const providerRelease=new Promise<void>(resolve=>{release=resolve;});
  const {fixture:f,platform,platformOptions}=await open({scriptedReplies:[{kind:'text',text:'drained'}],beforeReply:async()=>{entered();await providerRelease;}});
  let closing:Promise<void>|undefined;
  try{
    const prepared=await platform.runtime.prepareExecution(f.ctx,{runRef:f.claim.runRef,requestId:'close-prepare'});
    expect(prepared.status).toBe('ready');if(prepared.status!=='ready')return;
    const running=platform.runtime.startRun(f.ctx,{prepared:prepared.value,consumerId:'close-driver',requestId:'close-start'});
    // If start rejects before the provider, surface that rejection instead of hanging a barrier.
    const first=await Promise.race([providerEntered.then(()=>({kind:'provider' as const})),running.then(result=>({kind:'finished' as const,result}))]);
    expect(first.kind).toBe('provider');if(first.kind!=='provider')return;
    let closed=false;closing=platform.close().then(()=>{closed=true;});
    await Promise.resolve();await Promise.resolve();expect(closed).toBe(false);
    release();const result=await running;await closing;
    expect(result.status).toBe('ready');
    const reopened=await createTargetPlatform(platformOptions);
    try{expect(await reopened.executions.readExecution(f.ctx,f.claim.runRef)).toMatchObject({status:'ready'});expect(f.scripted.calls()).toBe(1);}
    finally{await reopened.close();}
  }finally{release();await closing;await platform.close();}
});
