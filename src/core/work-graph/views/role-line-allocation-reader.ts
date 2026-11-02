/**
 * `role-lines/allocation`: the one read of the four allocation records and the project limits record, and the
 * read-time derivation of each holder's name and contact (`creatorOf`).
 *
 * Five keys are read in one `readMany`; a missing key is absence (zero holders / the default limit) and every other
 * outcome is `unavailable` at this read's own boundary. Each involved workspace's completed operations are enumerated
 * once through the registered lookup, building the source→handoff table that `creatorOf` walks; no relation record is
 * written and no second read port is added.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ProjectScope, SessionRef } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import {
  ROLE_LINE_DEFAULT_LIMITS, ROLE_LINE_DUTIES, creatorOf, type CreatorContactV1, type ProjectRoleLimitsV1,
  type RoleLineAllocationReportV1, type RoleLineAllocationV1, type RoleLineDutyV1, type RoleLineLifecycleFactsV1,
  type SessionRoleFactsV1,
} from '../../../contracts/role-lines.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { EncodedRecord, GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { lookupAll } from '../persistence/lookup-all.js';
import { unavailableReadOf } from '../sessions/role-line-facts-writer.js';
import type { RoleLineAllocationReadPort } from '../model/session-contracts.js';
import {
  CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP, decodeSessionOperationRecord, decodeSessionRecord,
  plainSessionRef, plainSessionRefKey,
} from '../sessions/session-record-codecs.js';
import {
  projectRoleLimitsCodec, roleLineAllocationCodec, sessionRoleFactsCodec,
} from '../sessions/role-line-record-codecs.js';

export type RoleLineAllocationReaderDependenciesV1 = {
  records: Pick<GoalRecordTransactionPort, 'readMany'>;
  lookups: Pick<RecordLookupPort, 'lookup'>;
};

export function createRoleLineAllocationReader(
  deps: RoleLineAllocationReaderDependenciesV1,
): RoleLineAllocationReadPort {
  return {
    async readRoleLineAllocation(ctx: CoreCallContext, _input: Record<string, never>) {
      return readReport(deps, ctx);
    },
  };
}

/** One holder's read-time contact facts. */
export type RoleLineContactFactsV1 = {
  facts: SessionRoleFactsV1;
  line: RoleLineLifecycleFactsV1;
  contact: RoleLineLifecycleFactsV1 | null;
  completedHandoff: ReadonlyMap<string, { successor: RoleLineLifecycleFactsV1; borrowed: boolean }>;
};

type HandoffHopV1 = { successor: RoleLineLifecycleFactsV1; borrowed: boolean };
/** One completed handoff of a source, with the operation time the current archive is matched against. */
type HandoffCandidateV1 = HandoffHopV1 & { updatedAt: string };
type RecordsRead = { ok: true; value: Map<string, EncodedRecord> } | { ok: false; rejection: CoreRejection };
type SessionsRead = { ok: true; value: Map<string, SessionRecord> } | { ok: false; rejection: CoreRejection };
type FactsRead = { ok: true; value: Map<string, SessionRoleFactsV1> } | { ok: false; rejection: CoreRejection };

async function readReport(
  deps: RoleLineAllocationReaderDependenciesV1, ctx: CoreCallContext,
): Promise<ReadResult<RoleLineAllocationReportV1>> {
  const projectRef: ProjectScope = { projectId: ctx.projectId };
  const allocationKeys = ROLE_LINE_DUTIES.map((duty) => canonicalJson({
    aggregateType: 'RoleLineAllocation', projectId: projectRef.projectId, duty,
  } as unknown as JsonValue));
  const limitsKey = canonicalJson({ aggregateType: 'ProjectRoleLimits',
    projectId: projectRef.projectId } as unknown as JsonValue);
  const five = await readRecordMap(deps.records, [...allocationKeys, limitsKey], 'the role-line allocation');
  if (!five.ok) return five.rejection;

  const allocations = new Map<RoleLineDutyV1, RoleLineAllocationV1 | null>();
  for (const [index, duty] of ROLE_LINE_DUTIES.entries()) {
    const stored = five.value.get(allocationKeys[index]!);
    if (stored === undefined) { allocations.set(duty, null); continue; }
    const decoded = roleLineAllocationCodec.decode(stored);
    if (decoded.status !== 'decoded') {
      return rejected('unavailable', `the role-line allocation of ${duty} is damaged: ${decoded.reason}`);
    }
    allocations.set(duty, decoded.value);
  }
  const storedLimits = five.value.get(limitsKey);
  let limits: ProjectRoleLimitsV1 | null = null;
  if (storedLimits !== undefined) {
    const decoded = projectRoleLimitsCodec.decode(storedLimits);
    if (decoded.status !== 'decoded') {
      return rejected('unavailable', `the project role limits are damaged: ${decoded.reason}`);
    }
    limits = decoded.value;
  }

  const holderRefs = new Map<string, SessionRef>();
  for (const allocation of allocations.values()) {
    for (const holder of allocation?.holders ?? []) holderRefs.set(plainSessionRefKey(holder.sessionRef), holder.sessionRef);
  }
  const holderSessions = await readSessionMap(deps.records, [...holderRefs.values()], 'a role-line holder');
  if (!holderSessions.ok) return holderSessions.rejection;
  const holderFacts = await readFactsMap(deps.records, [...holderRefs.values()], 'a role-line holder');
  if (!holderFacts.ok) return holderFacts.rejection;
  const creatorRefs = new Map<string, SessionRef>();
  for (const facts of holderFacts.value.values()) {
    if (facts.creator.kind === 'session') creatorRefs.set(plainSessionRefKey(facts.creator.ref), facts.creator.ref);
  }
  const creatorSessions = await readSessionMap(deps.records, [...creatorRefs.values()], 'a role-line creator');
  if (!creatorSessions.ok) return creatorSessions.rejection;

  const sessionRecords = new Map<string, SessionRecord>([...holderSessions.value, ...creatorSessions.value]);
  const handoffsByWorkspace = new Map<string, Map<string, HandoffCandidateV1[]>>();

  async function handoffsOf(workspaceId: string): Promise<{ ok: true; value: Map<string, HandoffCandidateV1[]> } | {
    ok: false; rejection: CoreRejection }> {
    const cached = handoffsByWorkspace.get(workspaceId);
    if (cached !== undefined) return { ok: true, value: cached };
    let batch;
    try {
      batch = await lookupAll(deps.lookups, CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP,
        [projectRef.projectId, workspaceId, 'completed']);
    } catch (error) {
      return { ok: false, rejection: rejected('unavailable',
        `the completed handoff operations could not be read: ${storeFailureToRejection(error).reason}`) };
    }
    const found: { source: SessionRef; successor: SessionRef; borrowed: boolean; updatedAt: string }[] = [];
    for (const encoded of batch.items) {
      const decoded = decodeSessionOperationRecord(encoded);
      if (decoded.status !== 'decoded') {
        return { ok: false, rejection: rejected('unavailable',
          `a completed operation is damaged: ${decoded.reason}`) };
      }
      const action = decoded.value.action;
      if (action.kind !== 'handoff') continue;
      const archive = action.progress.archiveRequest;
      if (archive === null || archive.receipt === null) continue;
      let chosen: { successor: SessionRef; borrowed: boolean } | null = null;
      for (const [index, assignment] of action.progress.assignments.entries()) {
        if (assignment.successor === null) continue;
        if (action.input.assignments[index]?.target.kind === 'create') {
          chosen = { successor: assignment.successor, borrowed: true };
          break;
        }
      }
      const first = action.progress.assignments[0]?.successor ?? null;
      if (chosen === null && first !== null) chosen = { successor: first, borrowed: false };
      if (chosen !== null) found.push({ source: action.input.source, ...chosen, updatedAt: decoded.value.updatedAt });
    }
    const successors = await readSessionMap(deps.records, found.map((entry) => entry.successor),
      'a handoff successor');
    if (!successors.ok) return successors;
    for (const [key, record] of successors.value) sessionRecords.set(key, record);
    const table = new Map<string, HandoffCandidateV1[]>();
    for (const entry of found) {
      const successor = successors.value.get(plainSessionRefKey(entry.successor))!;
      const source = plainSessionRefKey(entry.source);
      const hops = table.get(source) ?? [];
      hops.push({ successor: lifecycleOf(successor), borrowed: entry.borrowed, updatedAt: entry.updatedAt });
      table.set(source, hops);
    }
    for (const hops of table.values()) hops.sort((left, right) =>
      left.updatedAt < right.updatedAt ? -1 : left.updatedAt > right.updatedAt ? 1 : 0);
    handoffsByWorkspace.set(workspaceId, table);
    return { ok: true, value: table };
  }

  const duties = {} as RoleLineAllocationReportV1['duties'];
  for (const duty of ROLE_LINE_DUTIES) {
    const allocation = allocations.get(duty) ?? null;
    const holders: RoleLineAllocationReportV1['duties'][RoleLineDutyV1]['holders'] = [];
    for (const holder of allocation?.holders ?? []) {
      const key = plainSessionRefKey(holder.sessionRef);
      const line = lifecycleOf(sessionRecords.get(key)!);
      const facts = holderFacts.value.get(key)!;
      let contact: RoleLineLifecycleFactsV1 | null = null;
      let creatorRecord: SessionRecord | null = null;
      if (facts.creator.kind === 'session') {
        creatorRecord = sessionRecords.get(plainSessionRefKey(facts.creator.ref))!;
        contact = plainSessionRefKey(facts.creator.ref) === key ? line : lifecycleOf(creatorRecord);
      }
      const completedHandoff = new Map<string, HandoffHopV1>();
      let currentRecord = creatorRecord;
      let currentLifecycle = contact;
      while (currentRecord !== null && currentLifecycle !== null && currentLifecycle.archivedAt !== null) {
        const loaded = await handoffsOf(currentRecord.workspaceId);
        if (!loaded.ok) return loaded.rejection;
        const currentKey = plainSessionRefKey(currentRecord.ref);
        const archivedAt = currentLifecycle.archivedAt;
        const hop = loaded.value.get(currentKey)?.find((candidate) => candidate.updatedAt >= archivedAt);
        if (hop === undefined) break;
        completedHandoff.set(currentKey, { successor: hop.successor, borrowed: hop.borrowed });
        currentLifecycle = hop.successor;
        currentRecord = sessionRecords.get(plainSessionRefKey(hop.successor.session))!;
      }
      const creator: CreatorContactV1 = creatorOf(facts, line, contact, completedHandoff);
      holders.push({ session: holder.sessionRef, name: facts.name, creator, since: holder.since });
    }
    duties[duty] = {
      duty,
      limit: limits === null ? ROLE_LINE_DEFAULT_LIMITS.open[duty] : limits.open[duty],
      revision: allocation?.revision ?? null,
      holders,
      reservations: (allocation?.reservations ?? []).map((reservation) => ({ ...reservation })),
    };
  }
  return { status: 'ready', value: { projectRef, duties } };
}

function lifecycleOf(record: SessionRecord): RoleLineLifecycleFactsV1 {
  return { session: plainSessionRef(record.ref), lifecycle: record.lifecycle, archivedAt: record.archivedAt,
    archiveRequest: record.archiveRequest ?? null };
}

async function readRecordMap(
  records: Pick<GoalRecordTransactionPort, 'readMany'>, keys: readonly string[], what: string,
): Promise<RecordsRead> {
  let read;
  try {
    read = await records.readMany(keys);
  } catch (error) {
    return { ok: false, rejection: rejected('unavailable', `${what} read failed: ${storeFailureToRejection(error).reason}`) };
  }
  if (read.status !== 'ready') return { ok: false, rejection: unavailableReadOf(read) };
  return { ok: true, value: new Map(read.value.records.map((record) => [record.refKey, record])) };
}

async function readSessionMap(
  records: Pick<GoalRecordTransactionPort, 'readMany'>, refs: readonly SessionRef[], what: string,
): Promise<SessionsRead> {
  const keys = [...new Set(refs.map(plainSessionRefKey))];
  if (keys.length === 0) return { ok: true, value: new Map() };
  const read = await readRecordMap(records, keys, what);
  if (!read.ok) return read;
  const sessions = new Map<string, SessionRecord>();
  for (const key of keys) {
    const stored = read.value.get(key);
    if (stored === undefined) return { ok: false, rejection: rejected('unavailable', `${what} does not exist`) };
    const decoded = decodeSessionRecord(stored);
    if (decoded.status !== 'decoded') {
      return { ok: false, rejection: rejected('unavailable', `${what} is damaged: ${decoded.reason}`) };
    }
    sessions.set(key, decoded.value);
  }
  return { ok: true, value: sessions };
}

async function readFactsMap(
  records: Pick<GoalRecordTransactionPort, 'readMany'>, refs: readonly SessionRef[], what: string,
): Promise<FactsRead> {
  const keys = [...new Set(refs.map((ref) => canonicalJson({ aggregateType: 'SessionRoleFacts',
    projectId: ref.projectId, sessionId: ref.sessionId } as unknown as JsonValue)))];
  if (keys.length === 0) return { ok: true, value: new Map() };
  const read = await readRecordMap(records, keys, what);
  if (!read.ok) return read;
  const facts = new Map<string, SessionRoleFactsV1>();
  for (const key of keys) {
    const stored = read.value.get(key);
    if (stored === undefined) return { ok: false, rejection: rejected('unavailable', `${what} has no role facts`) };
    const decoded = sessionRoleFactsCodec.decode(stored);
    if (decoded.status !== 'decoded') {
      return { ok: false, rejection: rejected('unavailable', `${what} role facts are damaged: ${decoded.reason}`) };
    }
    facts.set(plainSessionRefKey(decoded.value.sessionRef), decoded.value);
  }
  return { ok: true, value: facts };
}

