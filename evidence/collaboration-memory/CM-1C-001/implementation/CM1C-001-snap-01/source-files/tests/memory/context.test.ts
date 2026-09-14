import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInMemoryHarness} from '../../src/harness/in-memory-harness.js';
import {buildBootstrapCommand} from '../../src/contracts/bootstrap.js';
import {createProfileMemory,projectMemory} from '../../src/app/memory.js';
import {memoryInput} from '../../src/data/context-compiler/memory-context.js';
const cleanup:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
it('refreshes applicable revisions and recursively invalidates copied sources without using stale cache',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cm1b-context-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));
  let at='2026-09-13T10:00:00Z';const now=()=>at;
  const h=createInMemoryHarness();
  expect(await h.bootstrap(buildBootstrapCommand({schemaVersion:1,entries:['a','b','c'].map(projectId=>({projectId,workspaceId:'ws'}))},
    {commandId:'boot',correlationId:'boot',submittedAt:now()}))).toMatchObject({status:'committed'});
  let project:ReturnType<typeof projectMemory>;
  const profile=await createProfileMemory(dir,projectId=>h.ledger.memory!.read({kind:'project',projectId}),now,
    (projectId,entry,chain)=>project.sourceCurrent(projectId,entry,chain));cleanup.push(()=>profile.close());
  project=projectMemory(h.ledger,profile,now);
  const save=async(id:string,content:string,purposes:string[],revision:number)=>profile.action('/api/real/memory/profile/maintain',{
    requestId:id,expectedRevision:revision,edits:[{operation:'remember',entryId:id,content,conditions:{purposes,expiresAt:null}}]});
  expect(await save('reply','Use short replies.',['reply'],0)).toMatchObject({status:'committed'});
  expect(await save('architecture','Explain architecture with detail.',['architecture'],1)).toMatchObject({status:'committed'});
  const select=(projectId:string,purpose:'reply'|'architecture'|'progress'='reply')=>project.context.select({projectId,workspaceId:'ws',purpose,now:now()});
  expect(await select('a')).toMatchObject({status:'ready',profileRevision:2,entries:[{entry:{entryId:'reply'}}]});
  expect(await select('b','architecture')).toMatchObject({status:'ready',entries:[{entry:{entryId:'architecture'}}]});
  expect(await profile.action('/api/real/memory/profile/maintain',{requestId:'correct',expectedRevision:2,
    edits:[{operation:'correct',entryId:'reply',expectedEntryRevision:1,content:'Reply using bullets.',conditions:{purposes:['reply'],expiresAt:null}}]})).toMatchObject({status:'committed'});
  const updated=await select('a');expect(updated).toMatchObject({status:'ready',profileRevision:3,entries:[{entry:{revision:2,content:'Reply using bullets.'}}]});
  if(updated.status!=='ready')throw Error('selection');expect(memoryInput(updated)).not.toContain('Use short replies.');
  expect(await project.action('/api/real/memory/project/maintain',{requestId:'experience',expectedRevision:0,
    edits:[{operation:'remember',entryId:'experience',content:'Use the current temporary environment.',conditions:{purposes:['progress'],expiresAt:'2026-09-13T11:00:00Z'}}]},'a')).toMatchObject({status:'committed'});
  const copy=(to:string,from:string,id:string,requestId:string)=>project.action('/api/real/memory/project/copy',{
    projectId:to,workspaceId:'ws',requestId,expectedRevision:0,sourceProjectId:from,sourceEntryId:id,sourceRevision:1,allowCopy:true},to);
  expect(await copy('b','a','experience','ab')).toMatchObject({status:'committed'});
  expect(await copy('c','b','copy-ab','bc')).toMatchObject({status:'committed'});
  expect(await select('c','progress')).toMatchObject({status:'ready',entries:[{entry:{entryId:'copy-bc'}}]});
  expect(await project.action('/api/real/memory/project/maintain',{requestId:'remove-source',expectedRevision:1,
    edits:[{operation:'remove',entryId:'experience',expectedEntryRevision:1}]},'a')).toMatchObject({status:'committed'});
  expect(await select('c','progress')).toMatchObject({status:'ready',entries:[],excluded:expect.arrayContaining([{entryId:'copy-bc',reason:'source_changed_or_retired'}])});
  expect(await copy('a','b','copy-ab','stale-copy')).toMatchObject({status:'rejected',code:'forbidden'});
  at='2026-09-13T12:00:00Z';
  expect(await select('b','progress')).toMatchObject({status:'ready',entries:[],excluded:expect.arrayContaining([{entryId:'copy-ab',reason:'expired'}])});
  expect(await project.action('/api/real/memory/project/maintain',{requestId:'candidate',expectedRevision:1,edits:[{
    operation:'remember',entryId:'candidate',origin:'inferred',content:'UNCONFIRMED_STYLE_GUESS',conditions:{purposes:['reply'],expiresAt:null}}]},'b')).toMatchObject({status:'committed'});
  const inferred=await select('b');expect(inferred).toMatchObject({status:'ready',excluded:expect.arrayContaining([{entryId:'candidate',reason:'candidate'}])});
  if(inferred.status!=='ready')throw Error('candidate read');expect(memoryInput(inferred)).not.toContain('UNCONFIRMED_STYLE_GUESS');
  await profile.close();expect(await select('a')).toMatchObject({status:'unavailable'});
},30_000);
