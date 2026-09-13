import type { VersionedRef } from './ledger.js';
import type { ExecutionNoteRef } from './context-continuity.js';

/** Installation identity is deliberately not a Project, Task or Run. */
export type MemoryScope = { kind: 'profile'; profileId: string } | { kind: 'project'; projectId: string };
export type MemoryPurpose = 'reply' | 'architecture' | 'progress' | 'planning' | 'handoff' | 'execution';
export const MEMORY_PURPOSES: readonly MemoryPurpose[] = ['reply', 'architecture', 'progress', 'planning', 'handoff', 'execution'];
export type MemorySource =
  | { kind: 'human'; statementId: string }
  | { kind: 'work_note'; ref: ExecutionNoteRef; noteDigest: string; memoryRevision: number | null; workspaceRevision: number; planRevision: number | null; governance:MemoryGovernanceVersion[] }
  | { kind: 'copy'; scope: MemoryScope; entryId: string; revision: number; digest: string };
export const MEMORY_GOVERNANCE_KINDS=['ProjectCompletionPolicyActive','ProjectArchitectureBaselineActive','ProjectArchitectureEvolutionPolicyActive','ProjectCoordinationPolicyActive'] as const;
export type MemoryGovernanceVersion={kind:typeof MEMORY_GOVERNANCE_KINDS[number];revision:number};
export type MemoryGovernanceWitness={versions:MemoryGovernanceVersion[];digest:string};
export type MemoryConditions = { purposes: MemoryPurpose[]; expiresAt: string | null };
export type MemoryEntry = {
  entryId: string; revision: number; state: 'active' | 'candidate' | 'removed'; content: string | null;
  origin: 'explicit' | 'inferred'; conditions: MemoryConditions; source: MemorySource;
  digest: string; createdAt: string; updatedAt: string;
};
export type MemorySnapshot = { schemaVersion: 1; scope: MemoryScope; revision: number; entries: MemoryEntry[] };
export type MemoryReadResult = { status: 'ready'; snapshot: MemorySnapshot } | { status: 'unavailable'; reason: string };
export type MemoryEdit =
  | { operation: 'remember'; entryId: string; content: string; origin: 'explicit' | 'inferred'; conditions: MemoryConditions; source: MemorySource }
  | { operation: 'correct'; entryId?: string; oldText?: string; expectedEntryRevision: number; content: string; conditions: MemoryConditions; source: MemorySource }
  | { operation: 'remove'; entryId?: string; oldText?: string; expectedEntryRevision: number };
export type MemoryCommand = {
  schemaVersion: 1; commandId: string; scope: MemoryScope; actor: { kind: 'human' | 'system'; id: string };
  idempotencyKey: string; expectedRevision: number; submittedAt: string; edits: MemoryEdit[];
  /** Host-computed digest of a selected-source request, without the source body. */
  requestDigest?: string;
};
export type MemoryReceiptQuery = Pick<MemoryCommand,'scope'|'actor'|'idempotencyKey'> & {requestDigest:string};
export type MemoryRejection = 'invalid' | 'forbidden' | 'not_found' | 'ambiguous' | 'removed' | 'capacity' | 'revision_conflict' | 'idempotency_conflict' | 'unavailable';
export type MemoryReceipt = { status: 'committed'; replayed: boolean; revision: number; entryIds: string[]; changed: boolean }
  | { status: 'rejected'; code: MemoryRejection; currentRevision?: number; reason: string };
/** Audit never keeps a removed entry's text or a copy of the input command. */
export type MemoryAudit = { entryId: string; revision: number; operation: MemoryEdit['operation']; digest: string };
export type MemoryCommit = { command: MemoryCommand; snapshot: MemorySnapshot; audit: MemoryAudit[]; entryIds: string[]; changed: boolean; guards: VersionedRef[] };
export type LocalProfileResult = { status: 'ready'; profileId: string } | { status: 'unavailable'; reason: string };
export type MemoryLimits = { maxEntries: number; maxChars: number; maxEntryChars: number };
export const DEFAULT_MEMORY_LIMITS: MemoryLimits = { maxEntries: 256, maxChars: 16_384, maxEntryChars: 2048 };

/** A scope-specific part of StateLedger, implemented by the same adapters. */
export interface MemoryLedgerPort {
  readonly limits: MemoryLimits;
  localProfile(): Promise<LocalProfileResult>;
  initializeProfile(proposedId: string): Promise<LocalProfileResult>;
  read(scope: MemoryScope): Promise<MemoryReadResult>;
  lookup(command: MemoryCommand): Promise<MemoryReceipt | null>;
  lookupRequest(request: MemoryReceiptQuery): Promise<MemoryReceipt | null>;
  commit(batch: MemoryCommit): Promise<MemoryReceipt>;
}
export type MemorySelection = { status: 'ready'; profileScope: MemoryScope; projectScope: MemoryScope; profileRevision: number; projectRevision: number;
  entries: { scope: MemoryScope; entry: MemoryEntry }[]; excluded: { entryId: string; reason: string }[] }
  | { status: 'unavailable'; reason: string };
export interface MemorySelectionPort {
  select(request: { projectId: string; workspaceId: string; purpose: MemoryPurpose; now: string; maxChars?: number }): Promise<MemorySelection>;
}
