import { canonicalJson, sha256Hex } from './fingerprint.js';
import { MEMORY_PURPOSES, MEMORY_GOVERNANCE_KINDS, type MemoryCommand, type MemoryScope, type MemorySnapshot, type MemoryEntry,
  type MemoryEdit, type MemorySource, type MemoryLimits, type MemoryReceipt, type MemoryAudit } from './memory.js';

const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
const revision = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function memoryNoteBody(note:import('./context-continuity.js').ExecutionNoteV1|Omit<import('./context-continuity.js').ExecutionNoteV1,'bodyRef'>):string {
  const {bodyRef:_,...body}=note as import('./context-continuity.js').ExecutionNoteV1;
  return canonicalJson(body);
}
export function memoryNoteBodyDigest(note:import('./context-continuity.js').ExecutionNoteV1):string{return sha256Hex(memoryNoteBody(note));}
export function memoryGovernanceWitness(versions:import('./memory.js').MemoryGovernanceVersion[]):import('./memory.js').MemoryGovernanceWitness {
  const sorted=structuredClone(versions).sort((a,b)=>a.kind.localeCompare(b.kind));
  return {versions:sorted,digest:sha256Hex(canonicalJson(sorted))};
}
export function validMemoryGovernanceVersions(value:unknown):value is import('./memory.js').MemoryGovernanceVersion[]{
  return Array.isArray(value)&&value.length===MEMORY_GOVERNANCE_KINDS.length&&new Set(value.map(pin=>pin?.kind)).size===value.length&&
    value.every(pin=>!!pin&&Object.keys(pin).length===2&&MEMORY_GOVERNANCE_KINDS.includes(pin.kind)&&revision(pin.revision));
}
export function validMemoryGovernanceWitness(value:unknown):value is import('./memory.js').MemoryGovernanceWitness {
  if(!value||typeof value!=='object')return false;
  const v=value as import('./memory.js').MemoryGovernanceWitness;
  return Object.keys(v).length===2&&validMemoryGovernanceVersions(v.versions)&&v.digest===memoryGovernanceWitness(v.versions).digest;
}
export function memorySourceIdentity(source:MemorySource):string {
  if(source.kind==='work_note')return canonicalJson({kind:source.kind,ref:source.ref,noteDigest:source.noteDigest});
  return canonicalJson(source);
}
export function validMemoryScope(value: unknown): value is MemoryScope {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 2 && (v['kind'] === 'profile' ? text(v['profileId']) : v['kind'] === 'project' && text(v['projectId']));
}
export function memoryKey(scope: MemoryScope): string { return canonicalJson(scope); }
export function memoryIdentity(command: Pick<MemoryCommand,'scope'|'actor'|'idempotencyKey'>): string {
  return canonicalJson({ scope: command.scope, actor: command.actor, key: command.idempotencyKey });
}
export function memoryFingerprint(command: MemoryCommand): string {
  return sha256Hex(canonicalJson({ schemaVersion: command.schemaVersion, scope: command.scope, actor: command.actor,
    expectedRevision: command.expectedRevision, edits: command.edits,requestDigest:command.requestDigest??null }));
}
export function emptyMemory(scope: MemoryScope): MemorySnapshot { return { schemaVersion: 1, scope, revision: 0, entries: [] }; }
export function validMemorySnapshot(value:unknown):value is MemorySnapshot {
  if(!value||typeof value!=='object')return false;
  const s=value as MemorySnapshot;
  return s.schemaVersion===1&&validMemoryScope(s.scope)&&revision(s.revision)&&Array.isArray(s.entries)&&
    new Set(s.entries.map(entry=>entry?.entryId)).size===s.entries.length&&s.entries.every(entry=>
      !!entry&&text(entry.entryId)&&revision(entry.revision)&&entry.revision>0&&['active','candidate','removed'].includes(entry.state)&&
      ['explicit','inferred'].includes(entry.origin)&&validMemorySource(entry.source)&&date(entry.createdAt)&&date(entry.updatedAt)&&
      /^[a-f0-9]{64}$/.test(entry.digest)&&!!entry.conditions&&Array.isArray(entry.conditions.purposes)&&entry.conditions.purposes.length>0&&
      entry.conditions.purposes.every(p=>MEMORY_PURPOSES.includes(p))&&new Set(entry.conditions.purposes).size===entry.conditions.purposes.length&&
      (entry.conditions.expiresAt===null||date(entry.conditions.expiresAt))&&
      (entry.state==='removed'?entry.content===null:typeof entry.content==='string'&&entry.content.trim().length>0&&sha256Hex(entry.content)===entry.digest)&&
      (entry.state!=='active'||entry.origin==='explicit')&&(entry.state!=='candidate'||entry.origin==='inferred'));
}
export function validMemorySource(value: unknown): value is MemorySource {
  if (!value || typeof value !== 'object') return false;
  const s = value as MemorySource;
  if (s.kind === 'human') return text(s.statementId);
  if (s.kind === 'copy') return validMemoryScope(s.scope) && text(s.entryId) && revision(s.revision) && s.revision > 0 && /^[a-f0-9]{64}$/.test(s.digest);
  return s.kind === 'work_note' && !!s.ref && s.ref.aggregateType === 'ExecutionNote' && text(s.ref.projectId) && text(s.ref.workspaceId) &&
    text(s.ref.workId) && text(s.ref.noteId) && /^[a-f0-9]{64}$/.test(s.noteDigest) && revision(s.workspaceRevision) &&
    (s.memoryRevision === null || revision(s.memoryRevision)) && (s.planRevision === null || revision(s.planRevision))&&
    validMemoryGovernanceVersions(s.governance);
}
export function validMemoryCommand(command: MemoryCommand): boolean {
  if (!command || command.schemaVersion !== 1 || !validMemoryScope(command.scope) || !text(command.commandId) || !text(command.idempotencyKey) ||
    !command.actor || !['human', 'system'].includes(command.actor.kind) || !text(command.actor.id) || !revision(command.expectedRevision) ||
    !date(command.submittedAt) || (command.requestDigest!==undefined&&!/^[a-f0-9]{64}$/.test(command.requestDigest)) || !Array.isArray(command.edits) || !command.edits.length || command.edits.length > 32) return false;
  return command.edits.every(edit => {
    if (!edit || !['remember', 'correct', 'remove'].includes(edit.operation)) return false;
    if (edit.operation === 'remember') { if (!text(edit.entryId) || !['explicit','inferred'].includes(edit.origin)) return false; }
    else if ((!text(edit.entryId) && !text(edit.oldText)) || (!!edit.entryId === !!edit.oldText) || !revision(edit.expectedEntryRevision) || edit.expectedEntryRevision < 1) return false;
    if (edit.operation === 'remove') return true;
    return typeof edit.content === 'string' && edit.content.trim().length > 0 && edit.content.length <= 65_536 && validMemorySource(edit.source) &&
      !!edit.conditions && Array.isArray(edit.conditions.purposes) && edit.conditions.purposes.length > 0 &&
      edit.conditions.purposes.every(p => MEMORY_PURPOSES.includes(p)) && new Set(edit.conditions.purposes).size === edit.conditions.purposes.length &&
      (edit.conditions.expiresAt === null || date(edit.conditions.expiresAt));
  });
}

/** Adapted from Hermes MemoryStore._find_unique_match at 53c57871… (MIT).
 * Identity-bearing entries intentionally reject any multi-entry match, including
 * duplicate text: selecting one would leave another independently versioned fact. */
export function uniqueMemoryMatch(entries: readonly MemoryEntry[], oldText: string): { status: 'found'; entry: MemoryEntry } | { status: 'not_found' | 'ambiguous' } {
  const matches = entries.filter(entry => entry.state !== 'removed' && entry.content?.includes(oldText));
  return matches.length === 1 ? { status: 'found', entry: matches[0]! } : { status: matches.length ? 'ambiguous' : 'not_found' };
}
type FoldResult = { status: 'ready'; snapshot: MemorySnapshot; audit: MemoryAudit[]; entryIds: string[]; changed: boolean } | Extract<MemoryReceipt, { status: 'rejected' }>;
export function foldMemory(current: MemorySnapshot, command: MemoryCommand, limits: MemoryLimits): FoldResult {
  const reject = (code: Extract<MemoryReceipt,{status:'rejected'}>['code'], reason: string): FoldResult => ({ status: 'rejected', code, currentRevision: current.revision, reason });
  if (!validMemoryCommand(command) || !validMemorySnapshot(current) || memoryKey(current.scope) !== memoryKey(command.scope) ||
    ![limits.maxEntries,limits.maxChars,limits.maxEntryChars].every(n=>Number.isSafeInteger(n)&&n>0)) return reject('invalid','Invalid memory command, scope or capacity');
  if (command.expectedRevision !== current.revision) return reject('revision_conflict','Memory changed; read the current revision before editing');
  // Hermes batch's working-copy/final-capacity rule, adapted to canonical CAS.
  const snapshot = structuredClone(current), audit: MemoryAudit[] = [], entryIds: string[] = [];
  let changed = false;
  for (const edit of command.edits) {
    let entry: MemoryEntry | undefined;
    if (edit.operation === 'remember') {
      const existing = snapshot.entries.find(row => row.entryId === edit.entryId);
      if (existing) return reject(existing.state === 'removed' ? 'removed' : 'invalid','Entry identity already exists; use a versioned correction');
      if (edit.source.kind !== 'human' && snapshot.entries.some(row => row.state === 'removed' && memorySourceIdentity(row.source) === memorySourceIdentity(edit.source)))
        return reject('removed','This source was removed; historical import cannot reactivate it');
      const content = edit.content.trim();
      entry = snapshot.entries.find(row => row.state !== 'removed' && row.content === content && row.origin === edit.origin &&
        canonicalJson(row.conditions) === canonicalJson(edit.conditions));
      if (entry) {
        if((entry.source.kind==='human'&&edit.source.kind==='human')||canonicalJson(entry.source)===canonicalJson(edit.source)){
          entryIds.push(entry.entryId); continue;
        }
        return reject('invalid','The same text has a different source; correct the existing version to replace its basis');
      }
      entry = { entryId: edit.entryId, revision: 1, state: edit.origin === 'explicit' ? 'active' : 'candidate', content,
        origin: edit.origin, conditions: structuredClone(edit.conditions), source: structuredClone(edit.source), digest: sha256Hex(content),
        createdAt: command.submittedAt, updatedAt: command.submittedAt };
      snapshot.entries.push(entry);
    } else {
      if (edit.entryId) entry = snapshot.entries.find(row => row.entryId === edit.entryId);
      else { const match = uniqueMemoryMatch(snapshot.entries, edit.oldText!); if (match.status !== 'found') return reject(match.status,'The old text must match exactly one current entry'); entry = match.entry; }
      if (!entry) return reject('not_found','Memory entry does not exist');
      if (entry.state === 'removed') return reject('removed','Removed memory cannot be resurrected from a previous record');
      if (entry.revision !== edit.expectedEntryRevision) return reject('revision_conflict','Entry version changed');
      entry.revision++; entry.updatedAt = command.submittedAt;
      if (edit.operation === 'remove') { entry.state = 'removed'; entry.content = null; }
      else { entry.content = edit.content.trim(); entry.digest = sha256Hex(entry.content); entry.source = structuredClone(edit.source);
        entry.conditions = structuredClone(edit.conditions); entry.origin = 'explicit'; entry.state = 'active'; }
    }
    changed = true; entryIds.push(entry.entryId);
    audit.push({ entryId: entry.entryId, revision: entry.revision, operation: edit.operation, digest: entry.digest });
  }
  const active = snapshot.entries.filter(entry => entry.content !== null);
  if (snapshot.entries.length > limits.maxEntries || active.some(entry => Array.from(entry.content!).length > limits.maxEntryChars) ||
    active.reduce((sum, entry) => sum + Array.from(entry.content!).length, 0) > limits.maxChars) return reject('capacity','Memory capacity exceeded; nothing was saved');
  if (changed) snapshot.revision++;
  return { status:'ready', snapshot, audit, entryIds, changed };
}
