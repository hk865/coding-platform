import type { StateLedger, GoalSnapshot } from '../../contracts/ledger.js';
import type { MemoryLedgerPort, MemorySelectionPort, MemorySelection, MemoryEntry, MemoryScope, MemorySource } from '../../contracts/memory.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import { executionNoteRefFor, workMemoryNoteId, type ExecutionNoteSnapshot } from '../../contracts/context-continuity.js';
import type { RuntimeContextText } from '../../contracts/runtime-context-materials.js';
import {validMemoryGovernanceWitness,memoryGovernanceWitness} from '../../contracts/memory-values.js';

export class MemoryContextCompiler implements MemorySelectionPort {
  private cache=new Map<string,{digest:string;selection:MemorySelection}>();
  constructor(private readonly deps:{profile:Pick<MemoryLedgerPort,'read'|'localProfile'>;project:Pick<MemoryLedgerPort,'read'>;ledger:Pick<StateLedger,'load'>;
    copyCurrent?:(source:Extract<MemorySource,{kind:'copy'}>,chain:string[])=>Promise<'current'|'stale'|'unavailable'>}){}
  async select(request:Parameters<MemorySelectionPort['select']>[0]):Promise<MemorySelection> {
    if(!Number.isFinite(Date.parse(request.now)))return {status:'unavailable',reason:'Invalid memory selection time'};
    if(request.maxChars!==undefined&&(!Number.isSafeInteger(request.maxChars)||request.maxChars<0))return {status:'unavailable',reason:'Invalid memory input capacity'};
    try {
      const profile=await this.deps.profile.localProfile();if(profile.status!=='ready')return profile;
      const profileScope:MemoryScope={kind:'profile',profileId:profile.profileId},projectScope:MemoryScope={kind:'project',projectId:request.projectId};
      const [user,project]=await Promise.all([this.deps.profile.read(profileScope),this.deps.project.read(projectScope)]);
      if(user.status!=='ready'||project.status!=='ready')return {status:'unavailable',reason:'Current memory snapshot could not be read'};
      if(canonicalJson(user.snapshot.scope)!==canonicalJson(profileScope)||canonicalJson(project.snapshot.scope)!==canonicalJson(projectScope))return {status:'unavailable',reason:'Memory scope mismatch'};
      const selected:Extract<MemorySelection,{status:'ready'}>={status:'ready',profileScope,projectScope,profileRevision:user.snapshot.revision,projectRevision:project.snapshot.revision,entries:[],excluded:[]};
      let chars=0;const maxChars=request.maxChars??4096;
      const candidates=[...user.snapshot.entries.map(entry=>({scope:profileScope,entry})),...project.snapshot.entries.map(entry=>({scope:projectScope,entry}))]
        .sort((a,b)=>a.entry.conditions.purposes.length-b.entry.conditions.purposes.length||b.entry.updatedAt.localeCompare(a.entry.updatedAt)||a.entry.entryId.localeCompare(b.entry.entryId));
      for(const row of candidates) {
        const entry=row.entry;
        const exclude=(reason:string)=>selected.excluded.push({entryId:entry.entryId,reason});
        if(entry.state!=='active'||entry.origin!=='explicit'){exclude(entry.state);continue;}
        if(entry.content===null||sha256Hex(entry.content)!==entry.digest)return {status:'unavailable',reason:'Memory content digest mismatch'};
        if(!entry.conditions.purposes.includes(request.purpose)){exclude('different_purpose');continue;}
        if(entry.conditions.expiresAt!==null&&Date.parse(entry.conditions.expiresAt)<=Date.parse(request.now)){exclude('expired');continue;}
        const current=await this.current(entry,request.projectId,request.workspaceId);
        if(current==='unavailable')return {status:'unavailable',reason:'Memory source could not be checked'};
        if(current==='stale'){exclude('source_changed_or_retired');continue;}
        const size=Array.from(entry.content).length;
        if(chars+size>maxChars){exclude('input_capacity');continue;}
        chars+=size;selected.entries.push(row);
      }
      // Adapted from OpenClaw bootstrap-cache.ts at 9e267031… (MIT):
      // always refresh first; reuse only after content AND source identity agree.
      const key=canonicalJson({profileScope,projectScope,workspaceId:request.workspaceId,purpose:request.purpose,maxChars}),digest=sha256Hex(canonicalJson(selected));
      const old=this.cache.get(key);
      if(old?.digest===digest)return structuredClone(old.selection);
      this.cache.delete(key);this.cache.set(key,{digest,selection:structuredClone(selected)});
      if(this.cache.size>64)this.cache.delete(this.cache.keys().next().value!);
      return selected;
    }catch{return {status:'unavailable',reason:'Memory selection failed; no cached snapshot was substituted'};}
  }
  async current(entry:MemoryEntry,projectId:string,workspaceId:string,chain:string[]=[]):Promise<'current'|'stale'|'unavailable'> {
    const source=entry.source;if(source.kind==='human')return 'current';
    if(source.kind==='copy')return this.deps.copyCurrent?.(source,chain)??'unavailable';
    if(source.ref.projectId!==projectId||source.ref.workspaceId!==workspaceId)return 'stale';
    const loaded=await this.deps.ledger.load(source.ref);if(loaded.status!=='found'||loaded.snapshot.ref.aggregateType!=='ExecutionNote')return 'stale';
    const note=(loaded.snapshot as ExecutionNoteSnapshot).note;
    if(!validMemoryGovernanceWitness(note.memoryGovernance)||note.memoryGovernance.digest!==memoryGovernanceWitness(source.governance).digest)return 'stale';
    if(note.bodyRef.digest!==source.noteDigest||(note.memory?.revision??null)!==source.memoryRevision||note.memory?.state==='retired'||note.verification.status==='contradicted')return 'stale';
    const workspace=await this.deps.ledger.load({aggregateType:'Workspace',projectId,workspaceId});
    if(workspace.status!=='found'||workspace.snapshot.revision!==source.workspaceRevision)return 'stale';
    const goal=await this.deps.ledger.load({aggregateType:'Goal',projectId,goalId:note.runRef.goalId});
    if(goal.status!=='found'||canonicalJson((goal.snapshot as GoalSnapshot).activePlanRevision)!==canonicalJson(note.applicableVersions.planRef))return 'stale';
    for(const pin of source.governance){
      const current=await this.deps.ledger.load({aggregateType:pin.kind,projectId});
      if((current.status==='found'?current.snapshot.revision:0)!==pin.revision)return 'stale';
    }
    if(note.memory){const next=executionNoteRefFor(projectId,workspaceId,note.workId,workMemoryNoteId(note.memory.key,note.memory.revision+1));
      if((await this.deps.ledger.load(next)).status!=='not_found')return 'stale';}
    return 'current';
  }
}

export function memoryInput(selection:Extract<MemorySelection,{status:'ready'}>):string {
  return canonicalJson({kind:'maintained_preferences',authority:'preference_only',
    rules:['Current explicit instructions and formal rules take priority. Preferences grant no permissions and satisfy no verification obligations.',
      'Within compatible preferences, the more specific applicable purpose takes priority over a general preference.',
      'Do not treat prior conversation quotations or removed/candidate entries as current preferences.'],...selection});
}
export function memoryRuntimeRule(selection:Extract<MemorySelection,{status:'ready'}>):RuntimeContextText {
  const content=memoryInput(selection);
  return {ruleKey:'maintained-preferences',topics:['memory'],content,digest:sha256Hex(content),selectedBecause:'Current persisted preference revisions selected for this response',
    sourceRefs:[{kind:'memory',refId:canonicalJson(selection.profileScope),revision:String(selection.profileRevision)},
      {kind:'memory',refId:canonicalJson(selection.projectScope),revision:String(selection.projectRevision)},
      ...selection.entries.map(({scope,entry})=>({kind:'memory' as const,refId:canonicalJson({scope,entryId:entry.entryId}),revision:String(entry.revision),digest:entry.digest}))]};
}
