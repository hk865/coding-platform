import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SqliteStateLedger} from '../data/state-ledger/sqlite-ledger.js';
import {MemoryControlEngine} from '../control/control-engine/memory.js';
import {HumanMemory} from '../interaction/human-collaboration/memory.js';
import {MemoryViewIndex} from '../data/read-model-index/memory-view.js';
import {MemoryContextCompiler} from '../data/context-compiler/memory-context.js';
import {MEMORY_PURPOSES,MEMORY_GOVERNANCE_KINDS,type MemoryReadResult,type MemoryEdit,type MemoryScope,type MemorySource,type MemoryEntry} from '../contracts/memory.js';
import {canonicalJson,sha256Hex} from '../contracts/fingerprint.js';
import type {StateLedger} from '../contracts/ledger.js';
import {executionNoteRefFor,workMemoryNoteId,type ExecutionNoteSnapshot,type ExecutionNoteV1} from '../contracts/context-continuity.js';
import {memoryGovernanceWitness,validMemoryGovernanceWitness,memoryNoteBody} from '../contracts/memory-values.js';
import type {ArtifactPort} from '../contracts/artifact.js';
import type {ControlEngine} from '../contracts/modules.js';
import type {RunSnapshot} from '../contracts/dispatch.js';

type NoteHost={vault:ArtifactPort;control:Pick<ControlEngine,'recordExecutionNote'|'resolveTaskWorkIdentity'>};
async function recordExperience(ledger:StateLedger,host:NoteHost,input:Record<string,unknown>,projectId:string,now:()=>string):Promise<ExecutionNoteV1>{
  const field=(key:string)=>{const value=input[key];if(typeof value!=='string'||!value.trim())throw Error('Missing '+key);return value;};
  const requestId=field('requestId'),workspaceId=field('workspaceId'),goalId=field('goalId'),runId=field('runId'),summary=field('summary'),reason=field('reason');
  const runRef={aggregateType:'Run' as const,projectId,goalId,runId},loaded=await ledger.load(runRef);
  if(loaded.status!=='found'||loaded.snapshot.ref.aggregateType!=='Run')throw Error('Source run is unavailable');
  const run=loaded.snapshot as RunSnapshot;
  if(run.workspaceSnapshot.workspaceId!==workspaceId||!run.startedAt||!['running','ended'].includes(run.status))throw Error('Select an actual started run in this workspace');
  const work=await host.control.resolveTaskWorkIdentity({projectId,workspaceId,goalId,taskId:run.task.taskId});
  if(work.status!=='resolved')throw Error('Canonical task work is unavailable');
  const workId=work.workContextRef.workId,noteId=workMemoryNoteId('human-experience:'+requestId,1),ref=executionNoteRefFor(projectId,workspaceId,workId,noteId);
  const existing=await ledger.load(ref);
  if(existing.status==='found'){
    const note=(existing.snapshot as ExecutionNoteSnapshot).note;
    if(note.summary!==summary||note.reason!==reason||canonicalJson(note.runRef)!==canonicalJson(runRef))throw Error('Experience request identity has different content');
    return note;
  }
  const workspace=await ledger.load({aggregateType:'Workspace',projectId,workspaceId});
  if(workspace.status!=='found'||workspace.snapshot.revision!==run.workspaceSnapshot.revision)throw Error('Source run workspace is no longer current');
  const goal=await ledger.load({aggregateType:'Goal',projectId,goalId});
  if(workspace.status!=='found'||goal.status!=='found'||canonicalJson((goal.snapshot as import('../contracts/ledger.js').GoalSnapshot).activePlanRevision)!==canonicalJson(run.planRef))throw Error('Source run plan is no longer current');
  const plan=await ledger.load(run.planRef);if(plan.status!=='found'||plan.snapshot.ref.aggregateType!=='PlanRevision')throw Error('Source plan unavailable');
  const versions=await Promise.all(MEMORY_GOVERNANCE_KINDS.map(async kind=>{const current=await ledger.load({aggregateType:kind,projectId});return {kind,revision:current.status==='found'?current.snapshot.revision:0};}));
  const note:Omit<ExecutionNoteV1,'bodyRef'>={schemaVersion:1,noteId,workId,projectId,workspaceId,runRef,attemptRef:null,roleBindingRef:run.roleBinding,
    kind:'key_choice',summary,reason,alternatives:[],sourceRefs:[{kind:'run',refKey:canonicalJson(runRef),version:run.revision,label:'Human-maintained experience from this public run'}],
    applicableVersions:{planRef:run.planRef,planRevision:(plan.snapshot as import('../contracts/plan.js').PlanRevisionSnapshot).planRevision,workspaceRevision:workspace.snapshot.revision,governanceRevision:run.roleBinding.policyRevision},
    memoryGovernance:memoryGovernanceWitness(versions),memory:{key:'human-experience:'+requestId,revision:1,state:'active',topics:['planning','progress','handoff','execution']},
    verification:{status:'unverified',evidenceRefs:[]},noFullTranscript:true,createdAt:now()};
  const stored=await host.vault.put({contentType:'application/json',body:memoryNoteBody(note),ownerRef:runRef,
    sourceRefs:[{kind:'artifact',refId:canonicalJson(runRef),revision:String(run.revision)}],requestedAt:note.createdAt});
  if(stored.status!=='stored')throw Error('Public experience body could not be saved');
  const complete={...note,bodyRef:stored.ref};
  const receipt=await host.control.recordExecutionNote({schemaVersion:1,commandType:'RecordExecutionNote',commandId:'note-'+requestId,aggregateId:noteId,
    expectedRevision:0,correlationId:requestId,submittedAt:note.createdAt,identity:{projectId,actor:{kind:'human',id:'local-gui'},idempotencyKey:'note-'+requestId},payload:{note:complete}});
  if(receipt.status!=='committed')throw Error('Public experience was not recorded: '+receipt.code);
  return complete;
}

export type ProfileMemoryHost=Awaited<ReturnType<typeof createProfileMemory>>;
export async function createProfileMemory(dir:string,readProject:(projectId:string)=>Promise<MemoryReadResult>,now:()=>string,
  sourceCurrent:(projectId:string,entry:MemoryEntry,chain:string[])=>Promise<'current'|'stale'|'unavailable'>){
  await mkdir(join(dir,'profile'),{recursive:true});
  const ledger=new SqliteStateLedger({path:join(dir,'profile','ledger.sqlite')});
  const control=new MemoryControlEngine({memory:ledger.memory,ledger});
  const profile=await control.initializeProfile(randomUUID());
  if(profile.status!=='ready'){await ledger.close();throw Error(profile.reason);}
  const scope:MemoryScope={kind:'profile',profileId:profile.profileId};
  const human=new HumanMemory({control,now,actorId:'local-gui'}),view=new MemoryViewIndex(ledger.memory);
  const copied=async(source:Extract<MemorySource,{kind:'copy'}>,chain:string[]=[])=>{
    if(source.scope.kind!=='project')return {status:'stale' as const};
    const key=canonicalJson(source);
    if(chain.length>=32||chain.includes(key))return {status:'stale' as const};
    const read=await readProject(source.scope.projectId);
    if(read.status!=='ready')return {status:'unavailable' as const};
    const entry=read.snapshot.entries.find(entry=>entry.entryId===source.entryId&&entry.revision===source.revision&&entry.digest===source.digest&&entry.state==='active');
    if(!entry)return {status:'stale' as const};
    const status=await sourceCurrent(source.scope.projectId,entry,[...chain,key]);
    return status==='current'?{status,entry}:{status};
  };
  return {ledger,scope,readProject,copied,close:()=>ledger.close(),
    action:async(path:string,input:Record<string,unknown>)=>{
      if(path==='/api/real/memory/profile/view')return view.view(scope);
      if(path==='/api/real/memory/profile/maintain')return human.maintain({scope,requestId:String(input['requestId']??''),expectedRevision:input['expectedRevision'] as number,
        edits:humanEdits(input,String(input['requestId']??''))});
      throw Error('Unknown profile memory operation');
    }};
}
function humanEdits(input:Record<string,unknown>,requestId:string):MemoryEdit[]{
  if('actor' in input||'proof' in input)throw Error('Memory actor and authority are supplied by the host');
  if(!Array.isArray(input['edits']))throw Error('Memory edits must be an array');
  return input['edits'].map((raw,index)=>{
    if(!raw||typeof raw!=='object'||'source' in raw)throw Error('Use the explicit public-source import operation');
    const edit={...raw};
    if(edit.operation!=='remove'){
      edit.source={kind:'human',statementId:requestId+':'+index};
      edit.conditions??={purposes:[...MEMORY_PURPOSES],expiresAt:null};
      if(edit.operation==='remember')edit.origin??='explicit';
    }
    return edit as MemoryEdit;
  });
}
export function projectMemory(ledger:StateLedger,profile:ProfileMemoryHost,now:()=>string,notes?:NoteHost){
  if(!ledger.memory)throw Error('Persistent memory capability is unavailable');
  const control=new MemoryControlEngine({memory:ledger.memory,ledger,copySource:async(source,content)=>{
    const result=await profile.copied(source);return result.status==='current'&&result.entry.content===content;
  }}),human=new HumanMemory({control,now,actorId:'local-gui'}),view=new MemoryViewIndex(ledger.memory);
  const context=new MemoryContextCompiler({profile:profile.ledger.memory,project:ledger.memory,ledger,
    copyCurrent:async(source,chain)=>(await profile.copied(source,chain)).status});
  const sourceCurrent=async(projectId:string,entry:MemoryEntry,chain:string[])=>{
    if(entry.state!=='active'||entry.origin!=='explicit'||entry.conditions.expiresAt!==null&&Date.parse(entry.conditions.expiresAt)<=Date.parse(now()))return 'stale' as const;
    return context.current(entry,projectId,entry.source.kind==='work_note'?entry.source.ref.workspaceId:'',chain);
  };
  return {context,sourceCurrent,read:(scope:MemoryScope)=>view.view(scope),action:async(path:string,input:Record<string,unknown>,projectId:string)=>{
    const scope:MemoryScope={kind:'project',projectId},requestId=String(input['requestId']??''),expectedRevision=input['expectedRevision'] as number;
    if(path==='/api/real/memory/project/view')return view.view(scope);
    if(path==='/api/real/memory/project/maintain')return human.maintain({scope,requestId,expectedRevision,edits:humanEdits(input,requestId)});
    if('actor' in input||'proof' in input||'source' in input||'requestDigest' in input)throw Error('Memory authority is supplied by the host');
    const requestDigest=sha256Hex(canonicalJson(JSON.parse(JSON.stringify({path,input,scope}))));
    if(path==='/api/real/memory/project/import-note'||path==='/api/real/memory/project/copy'||path==='/api/real/memory/project/record-experience'){
      const replay=await ledger.memory!.lookupRequest({scope,actor:{kind:'human',id:'local-gui'},idempotencyKey:requestId,requestDigest});
      if(replay)return replay;
    }
    if(path==='/api/real/memory/project/import-note'||path==='/api/real/memory/project/record-experience'){
      if(!notes)throw Error('Public note host is unavailable');
      let note:ExecutionNoteV1;
      if(path.endsWith('/record-experience'))note=await recordExperience(ledger,notes,input,projectId,now);
      else{
        if(typeof input['workspaceId']!=='string'||typeof input['workId']!=='string'||typeof input['noteId']!=='string')throw Error('Select a public work note');
        const selected=executionNoteRefFor(projectId,input['workspaceId'],input['workId'],input['noteId']),loaded=await ledger.load(selected);
        if(loaded.status!=='found'||loaded.snapshot.ref.aggregateType!=='ExecutionNote')throw Error('Public work note is unavailable');
        note=(loaded.snapshot as ExecutionNoteSnapshot).note;
        if(input['sourceDigest']!==note.bodyRef.digest)throw Error('Selected public note changed');
      }
      if(!validMemoryGovernanceWitness(note.memoryGovernance))throw Error('Original note governance is unknown; retain it as history');
      const opened=await notes.vault.open(note.bodyRef,{requesterRunRef:note.runRef});
      if(opened.status!=='ready'||opened.record.body!==memoryNoteBody(note))throw Error('Exact original public note body is unavailable');
      const ref=executionNoteRefFor(projectId,note.workspaceId,note.workId,note.noteId),governance=note.memoryGovernance.versions;
      return human.maintain({scope,requestId,expectedRevision,requestDigest,edits:[{operation:'remember',entryId:'note-'+requestId,
        content:note.summary,origin:'explicit',conditions:{purposes:['planning','progress','handoff','execution'],expiresAt:null},
        source:{kind:'work_note',ref,noteDigest:note.bodyRef.digest,memoryRevision:note.memory?.revision??null,
          workspaceRevision:note.applicableVersions.workspaceRevision,planRevision:note.applicableVersions.planRevision,governance}}]});
    }
    if(path==='/api/real/memory/project/copy'){
      if(input['allowCopy']!==true||typeof input['sourceProjectId']!=='string'||input['sourceProjectId']===projectId)throw Error('Explicit selected-version cross-project permission is required');
      const read=await profile.readProject(input['sourceProjectId']);
      const entry=read.status==='ready'?read.snapshot.entries.find(row=>row.entryId===input['sourceEntryId']&&row.revision===input['sourceRevision']&&row.state==='active'):null;
      if(!entry?.content)throw Error('Selected source revision is unavailable');
      return human.maintain({scope,requestId,expectedRevision,requestDigest,edits:[{operation:'remember',entryId:'copy-'+requestId,content:entry.content,origin:'explicit',conditions:entry.conditions,
        source:{kind:'copy',scope:{kind:'project',projectId:input['sourceProjectId']},entryId:entry.entryId,revision:entry.revision,digest:entry.digest}}]});
    }
    throw Error('Unknown project memory operation');
  }};
}
