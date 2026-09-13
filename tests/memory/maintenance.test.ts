import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {InMemoryLedger} from '../../src/data/state-ledger/in-memory-ledger.js';
import {SqliteStateLedger} from '../../src/data/state-ledger/sqlite-ledger.js';
import {MemoryControlEngine} from '../../src/control/control-engine/memory.js';
import {HumanMemory} from '../../src/interaction/human-collaboration/memory.js';
import {MEMORY_PURPOSES,MEMORY_GOVERNANCE_KINDS,DEFAULT_MEMORY_LIMITS as MEMORY_LIMITS,type MemoryScope,type MemoryEdit,type MemoryCommand} from '../../src/contracts/memory.js';
import {emptyMemory,foldMemory} from '../../src/contracts/memory-values.js';

const at='2026-09-13T10:00:00Z';
const cleanup:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
const remember=(entryId:string,content:string):Extract<MemoryEdit,{operation:'remember'}>=>({operation:'remember',entryId,content,origin:'explicit',
  conditions:{purposes:[...MEMORY_PURPOSES],expiresAt:null},source:{kind:'human',statementId:entryId}});

it('changing applicability metadata cannot resurrect the same deleted public note',()=>{
  const scope:MemoryScope={kind:'project',projectId:'project'};
  const source={kind:'work_note' as const,ref:{aggregateType:'ExecutionNote' as const,projectId:'project',workspaceId:'workspace',workId:'work',noteId:'note'},
    noteDigest:'a'.repeat(64),memoryRevision:1,workspaceRevision:1,planRevision:1,governance:MEMORY_GOVERNANCE_KINDS.map(kind=>({kind,revision:1}))};
  const command:MemoryCommand={schemaVersion:1,commandId:'import',scope,actor:{kind:'human',id:'user'},idempotencyKey:'import',submittedAt:at,expectedRevision:0,
    edits:[{...remember('original','Original experience'),source}]};
  const first=foldMemory(emptyMemory(scope),command,MEMORY_LIMITS);if(first.status!=='ready')throw Error('initial import');
  const removed=foldMemory(first.snapshot,{...command,expectedRevision:1,edits:[{operation:'remove',entryId:'original',expectedEntryRevision:1}]},MEMORY_LIMITS);
  if(removed.status!=='ready')throw Error('delete');
  expect(foldMemory(removed.snapshot,{...command,idempotencyKey:'reimport',expectedRevision:2,
    edits:[{...remember('different-id','Changed wording'),source:{...source,governance:source.governance.map(pin=>({...pin,revision:2}))}}]},MEMORY_LIMITS))
    .toMatchObject({status:'rejected',code:'removed'});
});
describe.each(['memory','sqlite'] as const)('%s explicit memory authority', storage=>{
  const create=async()=>{
    let fail=false;
    const ledger=storage==='memory'?new InMemoryLedger({beforeWrite:()=>{if(fail)throw Error('injected storage failure');}}):
      new SqliteStateLedger({path:':memory:',beforeWrite:()=>{if(fail)throw Error('injected storage failure');}});
    if(ledger instanceof SqliteStateLedger)cleanup.push(async()=>ledger.close());
    const control=new MemoryControlEngine({memory:ledger.memory,ledger});
    expect(await control.initializeProfile('actual-local-user')).toEqual({status:'ready',profileId:'actual-local-user'});
    const human=new HumanMemory({control,now:()=>at,actorId:'local-ui'});
    const scope:MemoryScope={kind:'profile',profileId:'actual-local-user'};
    return {ledger,control,human,scope,fail:()=>{fail=true;}};
  };
  it('maintains without Project/Task/Run, replays old requests, corrects uniquely and removes current text',async()=>{
    const h=await create();
    const request={scope:h.scope,requestId:'remember',expectedRevision:0,edits:[remember('brevity','Prefer concise replies.')]};
    expect(await h.human.maintain(request)).toMatchObject({status:'committed',revision:1,changed:true,replayed:false});
    expect(await h.human.maintain(request)).toMatchObject({status:'committed',revision:1,replayed:true});
    expect(await h.human.maintain({...request,edits:[remember('brevity','Changed payload')]})).toMatchObject({status:'rejected',code:'idempotency_conflict'});
    expect(await h.human.maintain({scope:h.scope,requestId:'duplicate',expectedRevision:1,edits:[remember('duplicate-id','Prefer concise replies.')]})).toMatchObject({status:'committed',revision:1,changed:false,entryIds:['brevity']});
    expect(await h.human.maintain({scope:h.scope,requestId:'correct',expectedRevision:1,edits:[{operation:'correct',oldText:'concise replies',expectedEntryRevision:1,
      content:'Explain architecture thoroughly.',conditions:{purposes:['architecture'],expiresAt:null},source:{kind:'human',statementId:'correction'}}]})).toMatchObject({status:'committed',revision:2});
    expect(await h.human.maintain({scope:h.scope,requestId:'remove',expectedRevision:2,edits:[{operation:'remove',entryId:'brevity',expectedEntryRevision:2}]})).toMatchObject({status:'committed',revision:3});
    expect(await h.ledger.memory.read(h.scope)).toMatchObject({status:'ready',snapshot:{revision:3,entries:[{entryId:'brevity',state:'removed',content:null,revision:3}]}});
    expect(await h.human.maintain({...request,requestId:'resurrect',expectedRevision:3})).toMatchObject({status:'rejected',code:'removed'});
    expect(await h.ledger.memory.read({kind:'profile',profileId:'another-profile'})).toMatchObject({status:'unavailable'});
    expect((await h.ledger.events({afterCursor:null,limit:10})).events).toEqual([]);
  });
  it('ambiguous correction and a failed batch never save partially',async()=>{
    const h=await create();
    expect(await h.human.maintain({scope:h.scope,requestId:'seed',expectedRevision:0,edits:[remember('one','Concise progress.'),remember('two','Concise reports.')]})).toMatchObject({status:'committed'});
    const before=await h.ledger.memory.read(h.scope);
    expect(await h.human.maintain({scope:h.scope,requestId:'ambiguous',expectedRevision:1,edits:[{operation:'remove',oldText:'Concise',expectedEntryRevision:1}]})).toMatchObject({status:'rejected',code:'ambiguous'});
    expect(await h.human.maintain({scope:h.scope,requestId:'overflow',expectedRevision:1,edits:[remember('three','Small addition'),remember('four','x'.repeat(3000))]})).toMatchObject({status:'rejected',code:'capacity'});
    expect(await h.ledger.memory.read(h.scope)).toEqual(before);
    h.fail();
    expect(await h.human.maintain({scope:h.scope,requestId:'storage',expectedRevision:1,edits:[remember('three','Small addition')]})).toMatchObject({status:'rejected',code:'unavailable'});
    expect(await h.ledger.memory.read(h.scope)).toEqual(before);
  });
});
it('valid JSON with corrupt snapshot or receipt shape is unavailable and never silently replaced',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cm1b-corrupt-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'ledger.sqlite'),ledger=new SqliteStateLedger({path});cleanup.push(()=>ledger.close());
  const control=new MemoryControlEngine({memory:ledger.memory,ledger});await control.initializeProfile('user');
  const human=new HumanMemory({control,now:()=>at,actorId:'human'}),scope:MemoryScope={kind:'profile',profileId:'user'};
  const request={scope,requestId:'save',expectedRevision:0,edits:[remember('saved','Original content')]};
  expect(await human.maintain(request)).toMatchObject({status:'committed'});
  const raw=new DatabaseSync(path);cleanup.push(async()=>raw.close());
  const original=raw.prepare('SELECT snapshot_json FROM memory_collections').get() as {snapshot_json:string};
  const corrupt=JSON.parse(original.snapshot_json);corrupt.entries[0].conditions.purposes=['made-up'];
  raw.prepare('UPDATE memory_collections SET snapshot_json=?').run(JSON.stringify(corrupt));
  expect(await ledger.memory.read(scope)).toMatchObject({status:'unavailable'});
  expect(await human.maintain({...request,requestId:'new'})).toMatchObject({status:'rejected',code:'unavailable'});
  expect(raw.prepare('SELECT snapshot_json FROM memory_collections').get()).toEqual({snapshot_json:JSON.stringify(corrupt)});
  raw.prepare('UPDATE memory_collections SET snapshot_json=?').run(original.snapshot_json);
  raw.prepare('UPDATE memory_idempotency SET receipt_json=?').run(JSON.stringify({status:'committed',revision:999,entryIds:['wrong'],changed:true}));
  expect(await human.maintain(request)).toMatchObject({status:'rejected',code:'unavailable'});
});
it('two SQLite connections preserve one profile and reject stale concurrent edits across reopen',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cm1b-memory-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));
  const a=new SqliteStateLedger({path:join(dir,'ledger.sqlite')}),b=new SqliteStateLedger({path:join(dir,'ledger.sqlite')});
  cleanup.push(async()=>{await a.close();await b.close();});
  expect(await a.memory.initializeProfile('winner')).toEqual({status:'ready',profileId:'winner'});
  expect(await b.memory.initializeProfile('loser')).toEqual({status:'ready',profileId:'winner'});
  const scope:MemoryScope={kind:'profile',profileId:'winner'};
  const human=(ledger:typeof a)=>new HumanMemory({control:new MemoryControlEngine({memory:ledger.memory,ledger}),now:()=>at,actorId:'human'});
  const results=await Promise.all([human(a).maintain({scope,requestId:'a',expectedRevision:0,edits:[remember('a','First memory')]}),
    human(b).maintain({scope,requestId:'b',expectedRevision:0,edits:[remember('b','Second memory')]})]);
  expect(results.filter(row=>row.status==='committed')).toHaveLength(1);
  expect(results.filter(row=>row.status==='rejected'&&row.code==='revision_conflict')).toHaveLength(1);
  const current=await b.memory.read(scope);expect(current.status).toBe('ready');if(current.status!=='ready')throw Error('read');
  expect(current.snapshot.entries).toHaveLength(1);
  const id=current.snapshot.entries[0]!.entryId==='a'?'b':'a';
  expect(await human(b).maintain({scope,requestId:'retry-after-read',expectedRevision:1,edits:[remember(id,'Preserved concurrent memory')]})).toMatchObject({status:'committed',revision:2});
  const reopened=new SqliteStateLedger({path:join(dir,'ledger.sqlite')});cleanup.push(async()=>reopened.close());
  expect(await reopened.memory.localProfile()).toEqual({status:'ready',profileId:'winner'});
  expect(await reopened.memory.read(scope)).toMatchObject({status:'ready',snapshot:{revision:2,entries:expect.any(Array)}});
  expect((await reopened.memory.read(scope)).status==='ready'&&(await reopened.memory.read(scope) as {snapshot:{entries:unknown[]}}).snapshot.entries).toHaveLength(2);
});
