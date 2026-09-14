import type { DatabaseSync } from 'node:sqlite';
import type { AggregateRef, AggregateSnapshot, GoalSnapshot } from '../../contracts/ledger.js';
import {executionNoteRefFor,workMemoryNoteId,type ExecutionNoteSnapshot} from '../../contracts/context-continuity.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import { DEFAULT_MEMORY_LIMITS, type MemoryLedgerPort, type MemoryLimits, type MemoryScope, type MemorySnapshot,
  type MemoryReadResult, type LocalProfileResult, type MemoryCommit, type MemoryReceipt } from '../../contracts/memory.js';
import { emptyMemory, foldMemory, memoryKey, memoryIdentity, memoryFingerprint, validMemoryCommand, validMemoryScope, validMemorySnapshot,validMemoryGovernanceWitness,memoryGovernanceWitness } from '../../contracts/memory-values.js';

type Deps = { get(ref: AggregateRef): AggregateSnapshot | undefined; beforeWrite?: () => void; limits?: MemoryLimits };
type StoredReceipt = { fingerprint: string;requestDigest:string|null; receipt: Extract<MemoryReceipt, {status:'committed'}> };
function storedReceipt(json:string):Extract<MemoryReceipt,{status:'committed'}>{
  const r=JSON.parse(json) as Extract<MemoryReceipt,{status:'committed'}>;
  if(!r||Object.keys(r).sort().join(',')!=='changed,entryIds,replayed,revision,status'||r.status!=='committed'||r.replayed!==false||
    !Number.isSafeInteger(r.revision)||r.revision<0||typeof r.changed!=='boolean'||!Array.isArray(r.entryIds)||r.entryIds.length<1||r.entryIds.length>32||
    !r.entryIds.every(id=>typeof id==='string'&&id.trim().length>0&&id.length<=256))throw Error('Invalid stored memory receipt');
  return r;
}
function validScope(scope: MemoryScope, profileId: string | null, get: Deps['get']): boolean {
  return validMemoryScope(scope) && (scope.kind === 'profile' ? scope.profileId === profileId : get({ aggregateType:'Project', projectId:scope.projectId })?.ref.aggregateType === 'Project');
}
function validate(batch: MemoryCommit, current: MemorySnapshot, deps: Deps, limits: MemoryLimits): MemoryReceipt | null {
  if(batch.command.actor.kind!=='human')return {status:'rejected',code:'forbidden',reason:'Explicit human maintenance is required'};
  const folded = foldMemory(current, batch.command, limits);
  if (folded.status === 'rejected') return folded;
  if (canonicalJson(folded.snapshot) !== canonicalJson(batch.snapshot) || canonicalJson(folded.audit) !== canonicalJson(batch.audit) ||
    canonicalJson(folded.entryIds) !== canonicalJson(batch.entryIds) || folded.changed !== batch.changed || !Array.isArray(batch.guards))
    return {status:'rejected',code:'invalid',reason:'Memory commit does not match canonical transition'};
  const required:AggregateRef[]=batch.command.scope.kind==='project'?[{aggregateType:'Project',projectId:batch.command.scope.projectId}]:[];
  for(const edit of batch.command.edits){
    if(edit.operation==='remove'||edit.source.kind==='human')continue;
    const source=edit.source,scope=batch.command.scope;
    if(scope.kind!=='project')return forbidden();
    if(source.kind==='copy'){
      if(source.scope.kind!=='project'||source.scope.projectId===scope.projectId)return forbidden();
      continue;
    }
    if(source.ref.projectId!==scope.projectId)return forbidden();
    const snapshot=deps.get(source.ref);
    if(snapshot?.ref.aggregateType!=='ExecutionNote')return forbidden();
    const note=(snapshot as ExecutionNoteSnapshot).note;
    if(!validMemoryGovernanceWitness(note.memoryGovernance)||note.memoryGovernance.digest!==memoryGovernanceWitness(source.governance).digest)return forbidden();
    const workspaceRef={aggregateType:'Workspace' as const,projectId:scope.projectId,workspaceId:source.ref.workspaceId};
    const goalRef={aggregateType:'Goal' as const,projectId:scope.projectId,goalId:note.runRef.goalId};
    const goal=deps.get(goalRef) as GoalSnapshot|undefined;
    if(note.bodyRef.digest!==source.noteDigest||(note.memory?.revision??null)!==source.memoryRevision||
      note.applicableVersions.workspaceRevision!==source.workspaceRevision||note.applicableVersions.planRevision!==source.planRevision||
      deps.get(workspaceRef)?.revision!==source.workspaceRevision||!goal||canonicalJson(goal.activePlanRevision)!==canonicalJson(note.applicableVersions.planRef)||
      note.verification.status==='contradicted'||note.memory?.state==='retired')return forbidden();
    required.push(source.ref,workspaceRef,goalRef);
    for(const pin of source.governance){const ref={aggregateType:pin.kind,projectId:scope.projectId};
      if((deps.get(ref)?.revision??0)!==pin.revision)return forbidden();required.push(ref);}
    if(note.memory){const next=executionNoteRefFor(note.projectId,note.workspaceId,note.workId,workMemoryNoteId(note.memory.key,note.memory.revision+1));
      if(deps.get(next))return forbidden();required.push(next);}
  }
  if(required.some(ref=>!batch.guards.some(guard=>canonicalJson(guard.ref)===canonicalJson(ref))))
    return {status:'rejected',code:'invalid',reason:'Memory commit omitted a required source guard'};
  for(const guard of batch.guards) if ((deps.get(guard.ref)?.revision ?? 0) !== guard.revision)
    return {status:'rejected',code:'revision_conflict',reason:'Memory source version changed'};
  return null;
}
function receipt(batch: MemoryCommit): Extract<MemoryReceipt,{status:'committed'}> {
  return {status:'committed',replayed:false,revision:batch.snapshot.revision,entryIds:batch.entryIds,changed:batch.changed};
}
const unavailable = (): Extract<MemoryReceipt,{status:'rejected'}> => ({status:'rejected',code:'unavailable',reason:'Memory storage unavailable; save was not confirmed'});
const forbidden = (): Extract<MemoryReceipt,{status:'rejected'}> => ({status:'rejected',code:'forbidden',reason:'Unknown profile or project memory scope'});

export class InMemoryMemoryLedger implements MemoryLedgerPort {
  readonly limits: MemoryLimits;
  private profile: string | null = null;
  private collections = new Map<string,MemorySnapshot>();
  private identities = new Map<string,StoredReceipt>();
  private audit: unknown[] = [];
  constructor(private readonly deps: Deps) { this.limits = {...DEFAULT_MEMORY_LIMITS,...deps.limits}; }
  async localProfile(): Promise<LocalProfileResult> { return this.profile ? {status:'ready',profileId:this.profile} : {status:'unavailable',reason:'Local profile is not initialized'}; }
  async initializeProfile(id: string): Promise<LocalProfileResult> {
    if(this.profile) return {status:'ready',profileId:this.profile};
    if(typeof id !== 'string' || !id.trim() || id.length>256) return {status:'unavailable',reason:'Invalid profile identity'};
    try { this.deps.beforeWrite?.(); this.profile=id; return {status:'ready',profileId:id}; }
    catch { return {status:'unavailable',reason:'Profile initialization failed'}; }
  }
  async read(scope: MemoryScope): Promise<MemoryReadResult> {
    if(!validScope(scope,this.profile,this.deps.get)) return {status:'unavailable',reason:'Unknown memory scope'};
    return {status:'ready',snapshot:structuredClone(this.collections.get(memoryKey(scope)) ?? emptyMemory(scope))};
  }
  async lookup(command: import('../../contracts/memory.js').MemoryCommand): Promise<MemoryReceipt | null> {
    const prior=this.identities.get(memoryIdentity(command));
    return !prior ? null : prior.fingerprint===memoryFingerprint(command) ? {...structuredClone(prior.receipt),replayed:true}
      : {status:'rejected',code:'idempotency_conflict',reason:'Request identity has different content'};
  }
  async lookupRequest(request:import('../../contracts/memory.js').MemoryReceiptQuery):Promise<MemoryReceipt|null>{
    const prior=this.identities.get(memoryIdentity(request));
    return !prior?null:prior.requestDigest===request.requestDigest?{...structuredClone(prior.receipt),replayed:true}:
      {status:'rejected',code:'idempotency_conflict',reason:'Request identity has different content'};
  }
  async commit(batch: MemoryCommit): Promise<MemoryReceipt> {
    if(!validMemoryCommand(batch?.command)) return {status:'rejected',code:'invalid',reason:'Invalid memory command'};
    if(!validScope(batch.command.scope,this.profile,this.deps.get)) return forbidden();
    const key=memoryIdentity(batch.command), fingerprint=memoryFingerprint(batch.command), prior=this.identities.get(key);
    if(prior) return prior.fingerprint===fingerprint ? {...structuredClone(prior.receipt),replayed:true} : {status:'rejected',code:'idempotency_conflict',reason:'Request identity has different content'};
    const current=this.collections.get(memoryKey(batch.command.scope)) ?? emptyMemory(batch.command.scope);
    const invalid=validate(batch,current,this.deps,this.limits); if(invalid) return invalid;
    try {
      this.deps.beforeWrite?.();
      const result=receipt(batch);
      this.collections.set(memoryKey(batch.command.scope),structuredClone(batch.snapshot));
      this.audit.push({scope:batch.command.scope,actor:batch.command.actor,at:batch.command.submittedAt,audit:structuredClone(batch.audit)});
      this.identities.set(key,{fingerprint,requestDigest:batch.command.requestDigest??null,receipt:structuredClone(result)});
      return structuredClone(result);
    } catch { return unavailable(); }
  }
}

/** The owning SqliteStateLedger supplies its existing connection and fault seam.
 * Memory events are typed separately; old project event consumers never see them. */
export class SqliteMemoryLedger implements MemoryLedgerPort {
  readonly limits: MemoryLimits;
  constructor(private readonly db: DatabaseSync, private readonly deps: Deps) {
    this.limits={...DEFAULT_MEMORY_LIMITS,...deps.limits};
    db.exec('CREATE TABLE IF NOT EXISTS memory_profile (singleton INTEGER PRIMARY KEY CHECK(singleton=1), profile_id TEXT NOT NULL);'+
      'CREATE TABLE IF NOT EXISTS memory_collections (scope_key TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL);'+
      'CREATE TABLE IF NOT EXISTS memory_idempotency (identity_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, receipt_json TEXT NOT NULL);'+
      'CREATE TABLE IF NOT EXISTS memory_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_json TEXT NOT NULL);');
    if(!(db.prepare('PRAGMA table_info(memory_idempotency)').all() as {name:string}[]).some(row=>row.name==='request_digest'))
      db.exec('ALTER TABLE memory_idempotency ADD COLUMN request_digest TEXT');
  }
  private profileId(): string | null { return (this.db.prepare('SELECT profile_id FROM memory_profile WHERE singleton=1').get() as {profile_id:string}|undefined)?.profile_id ?? null; }
  async localProfile(): Promise<LocalProfileResult> {
    try { const id=this.profileId(); return id ? {status:'ready',profileId:id} : {status:'unavailable',reason:'Local profile is not initialized'}; }
    catch { return {status:'unavailable',reason:'Profile storage unavailable'}; }
  }
  async initializeProfile(id:string): Promise<LocalProfileResult> {
    if(typeof id!=='string'||!id.trim()||id.length>256) return {status:'unavailable',reason:'Invalid profile identity'};
    try {
      this.db.exec('BEGIN IMMEDIATE'); const prior=this.profileId();
      if(!prior) {this.deps.beforeWrite?.();this.db.prepare('INSERT INTO memory_profile(singleton,profile_id) VALUES(1,?)').run(id);}
      this.db.exec('COMMIT'); return {status:'ready',profileId:prior??id};
    } catch { try {this.db.exec('ROLLBACK');} catch {} return {status:'unavailable',reason:'Profile initialization failed'}; }
  }
  private snapshot(scope:MemoryScope):MemorySnapshot {
    const row=this.db.prepare('SELECT snapshot_json FROM memory_collections WHERE scope_key=?').get(memoryKey(scope)) as {snapshot_json:string}|undefined;
    if(!row) return emptyMemory(scope);
    const snapshot=JSON.parse(row.snapshot_json) as MemorySnapshot;
    if(!validMemorySnapshot(snapshot) || memoryKey(snapshot.scope)!==memoryKey(scope)) throw Error('Invalid memory snapshot');
    return snapshot;
  }
  async read(scope:MemoryScope):Promise<MemoryReadResult> {
    try { if(!validScope(scope,this.profileId(),this.deps.get)) return {status:'unavailable',reason:'Unknown memory scope'};
      return {status:'ready',snapshot:this.snapshot(scope)}; }
    catch {return {status:'unavailable',reason:'Memory read failed; existing data was not treated as empty'};}
  }
  async lookup(command: import('../../contracts/memory.js').MemoryCommand): Promise<MemoryReceipt | null> {
    try {
      const prior=this.db.prepare('SELECT fingerprint,receipt_json FROM memory_idempotency WHERE identity_key=?').get(memoryIdentity(command)) as {fingerprint:string;receipt_json:string}|undefined;
      return !prior ? null : prior.fingerprint===memoryFingerprint(command) ? {...storedReceipt(prior.receipt_json),replayed:true}
        : {status:'rejected',code:'idempotency_conflict',reason:'Request identity has different content'};
    } catch {return unavailable();}
  }
  async lookupRequest(request:import('../../contracts/memory.js').MemoryReceiptQuery):Promise<MemoryReceipt|null>{
    try{
      const prior=this.db.prepare('SELECT request_digest,receipt_json FROM memory_idempotency WHERE identity_key=?').get(memoryIdentity(request)) as {request_digest:string|null;receipt_json:string}|undefined;
      return !prior?null:prior.request_digest===request.requestDigest?{...storedReceipt(prior.receipt_json),replayed:true}:
        {status:'rejected',code:'idempotency_conflict',reason:'Request identity has different content'};
    }catch{return unavailable();}
  }
  async commit(batch:MemoryCommit):Promise<MemoryReceipt> {
    if(!validMemoryCommand(batch?.command)) return {status:'rejected',code:'invalid',reason:'Invalid memory command'};
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const result=this.commitOwned(batch);
      this.db.exec('COMMIT');return result;
    } catch {try{this.db.exec('ROLLBACK');}catch{} return unavailable();}
  }
  private commitOwned(batch:MemoryCommit):MemoryReceipt {
    if(!validScope(batch.command.scope,this.profileId(),this.deps.get)) return forbidden();
    const key=memoryIdentity(batch.command),fingerprint=memoryFingerprint(batch.command);
    const prior=this.db.prepare('SELECT fingerprint,receipt_json FROM memory_idempotency WHERE identity_key=?').get(key) as {fingerprint:string;receipt_json:string}|undefined;
    if(prior) return prior.fingerprint===fingerprint ? {...storedReceipt(prior.receipt_json),replayed:true} : {status:'rejected',code:'idempotency_conflict',reason:'Request identity has different content'};
    const invalid=validate(batch,this.snapshot(batch.command.scope),this.deps,this.limits);if(invalid)return invalid;
    this.deps.beforeWrite?.();const result=receipt(batch);
    this.db.prepare('INSERT INTO memory_collections(scope_key,snapshot_json) VALUES(?,?) ON CONFLICT(scope_key) DO UPDATE SET snapshot_json=excluded.snapshot_json').run(memoryKey(batch.command.scope),JSON.stringify(batch.snapshot));
    this.db.prepare('INSERT INTO memory_events(event_json) VALUES(?)').run(JSON.stringify({scope:batch.command.scope,actor:batch.command.actor,at:batch.command.submittedAt,audit:batch.audit}));
    this.db.prepare('INSERT INTO memory_idempotency(identity_key,fingerprint,receipt_json,request_digest) VALUES(?,?,?,?)').run(key,fingerprint,JSON.stringify(result),batch.command.requestDigest??null);
    return result;
  }
}
