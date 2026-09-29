/**
 * R5b.2 original Query history observation.
 *
 * The observer NEVER treats a model "completed" text, a Kernel return value or a
 * best-effort callback as terminal evidence. It reads the genuine original
 * history along the persisted locator, reduces the complete Turn with the public
 * Kernel reducer, re-checks the transcript exchange pairing and only then
 * submits the ONE terminal Job/Run/Answer/Session fact. It keeps no second
 * transcript and no per-run cache: every observation is reconstructed from the
 * persisted QueryRun + the original Kernel records.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { RunExecutionHistoryV1 } from '../../contracts/core/execution-history.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { SourceRefV1 } from '../../contracts/dispatch.js';
import type { QueryJobAnswerV1, QueryJobRef, QueryRunRef } from '../../contracts/query-job.js';
import type { PreparedQueryManifestV1 } from '../../contracts/core/prepared-execution.js';
import type { ArtifactRef } from '../../contracts/artifact.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../contracts/fingerprint.js';
import {
  assertTranscriptExchangeIntegrity, createInitialRunState, projectTerminalTranscript, reduceRunState,
  sessionRecordSchema, validateRunStateInvariants,
} from '../../../vendor/coding-agent/dist/public-api.js';
import type { RunState, SessionRecord as KernelSessionRecord } from '../../../vendor/coding-agent/dist/public-api.js';
import { createSessionHistoryCursorOwner, type SessionHistoryEntry } from './session-operations.js';
import { confirmMailboxInputs } from './execution-inputs.js';
import type { RuntimeExecutionDependencies } from './execution-contracts.js';
import type {
  QueryEntryIdentity, QueryExecutionRecord, QueryPreparationFacts,
} from '../work-graph/queries/contracts.js';

export type QueryObservationPort = {
  observe(ctx: CoreCallContext, request: { queryRunRef: QueryRunRef }): Promise<ReadResult<QueryExecutionRecord>>;
  /** Awaited before_model step: persist the real entered fact once. */
  onEntered(ctx: CoreCallContext, request: { entry: QueryEntryIdentity; occurredAt: string }): Promise<ReadResult<QueryExecutionRecord>>;
};

/** Bounded per-call pagination: a Turn is reconstructed page by page, never by an unbounded scan. */
const MAX_OBSERVATION_PAGES = 64;
const MAX_ANSWER_BYTES = 16 * 1024;
const MAX_SOURCES = 64;

type DecodedRecord = { position: number; record: KernelSessionRecord };

function rejected(code: CoreRejection['code'], reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function ownContext(ctx: CoreCallContext): CoreCallContext | null {
  try {
    return {
      projectId: ctx.projectId,
      principal: structuredClone(ctx.principal),
      materialReader: structuredClone(ctx.materialReader),
      signal: ctx.signal,
      ...(typeof ctx.workspaceId === 'string' ? { workspaceId: ctx.workspaceId } : {}),
    };
  } catch { return null; }
}
function mapRead(result: ReadResult<unknown>): CoreRejection {
  if (result.status === 'ready') return rejected('unavailable', 'a must-fail read unexpectedly returned a value');
  if (result.status === 'not_found') return rejected('not_found', 'the required Query fact was not found');
  if (result.status === 'not_ready') return rejected('incomplete', 'the required Query fact is not readable at the required watermark');
  return { status: 'rejected', code: result.code, reason: result.reason, ...(result.current === undefined ? {} : { current: result.current }) };
}
function settledStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
function decodeEntry(entry: SessionHistoryEntry): DecodedRecord | null {
  const body: unknown = entry.body;
  if (!isRecord(body) || body['encoding'] !== 'kernel_session_record_json' || typeof body['text'] !== 'string') return null;
  let parsed: unknown;
  try { parsed = JSON.parse(body['text']); } catch { return null; }
  const result = sessionRecordSchema.safeParse(parsed);
  if (!result.success) return null;
  if (result.data.position !== entry.source.position || result.data.recordId !== entry.recordId
    || result.data.sessionId !== entry.source.kernelSessionId) return null;
  return { position: result.data.position, record: result.data };
}
function findTurnStart(records: readonly DecodedRecord[], kernel: QueryEntryIdentity['kernel']): { run: Parameters<typeof createInitialRunState>[0]; position: number } | null {
  for (const item of records) {
    if (item.record.recordType !== 'turn.started') continue;
    const payload = item.record.payload as unknown as { run?: Parameters<typeof createInitialRunState>[0] };
    const run = payload.run;
    if (run === undefined || run.runId !== kernel.runId || run.turn.turnId !== kernel.turnId) continue;
    return { run, position: item.position };
  }
  return null;
}
function applyEvents(state: RunState, records: readonly DecodedRecord[], kernel: QueryEntryIdentity['kernel'], afterPosition: number): RunState {
  let next = state;
  for (const item of records) {
    if (item.position <= afterPosition) continue;
    if (item.record.recordType !== 'agent.event') continue;
    const event = item.record.payload.event;
    if (event.meta.runId !== kernel.runId || event.meta.turnId !== kernel.turnId) continue;
    next = reduceRunState(next, event);
  }
  return next;
}
function turnIsComplete(state: RunState): boolean {
  if (state.activeModelRequest !== null) return false;
  const batch = state.toolBatch;
  if (batch !== null && batch.calls.some(call => !settledStatus(call.status))) return false;
  return true;
}
/** The formal Kernel transcript outcome_unknown check. A reduced tool batch that
 * no longer lists the call is NOT a known result: the transcript's official
 * `outcome_unknown` tool result is still the evidence. Mirrors the Work
 * observer's single reader; no second error interpreter is added. */
function transcriptHasOutcomeUnknown(transcript: RunState['transcript']): boolean {
  return transcript.some(entry => entry.kind === 'tool_result'
    && entry.result.status === 'error' && entry.result.error.code === 'outcome_unknown');
}
function mapOutcome(status: string): 'answered' | 'failed' | 'cancelled' | 'timeout' | null {
  switch (status) {
    case 'completed': return 'answered';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    case 'limit_exceeded': return 'timeout';
    default: return null;
  }
}
function entryIdentity(state: NonNullable<QueryExecutionRecord['run']['run']['executionState']>, queryRunRef: QueryRunRef): QueryEntryIdentity | null {
  if (state.entry === null) return null;
  return {
    queryRunRef,
    sessionRef: state.sessionRef,
    sessionGeneration: state.sessionGeneration,
    entryGeneration: state.entry.generation,
    consumerId: state.entry.consumerId,
    kernel: { ...state.entry.kernel },
  };
}

/** The last non-empty assistant text, capped at the formal 16 KiB answer bound. */
function extractAnswer(state: RunState): string | null {
  let final: string | null = null;
  for (const entry of state.transcript) {
    if (entry.kind !== 'assistant_message') continue;
    if (entry.message.content.trim().length === 0) continue;
    final = entry.message.content;
  }
  if (final === null) return null;
  if (Buffer.byteLength(final, 'utf8') > MAX_ANSWER_BYTES) return null;
  return final;
}

/** Real successful `project_source` tool results only; model-reported sources never count. */
function projectSourceWitnesses(state: RunState): QueryJobAnswerV1['sources'] {
  const names = new Map<string, string>();
  const witnesses: QueryJobAnswerV1['sources'] = [];
  for (const entry of state.transcript) {
    if (entry.kind === 'assistant_message') {
      for (const call of entry.toolCalls) names.set(call.callId, call.name);
      continue;
    }
    if (entry.kind !== 'tool_result') continue;
    if (names.get(entry.callId) !== 'project_source') continue;
    if (entry.result.status !== 'success') continue;
    for (const part of entry.result.output) {
      if (part.kind !== 'json' || !isRecord(part.value)) continue;
      const value = part.value;
      if (value['status'] !== 'ready' || !isRecord(value['value'])) continue;
      const file = value['value'];
      const path = file['path'];
      const content = file['content'];
      const version = file['version'];
      if (typeof path !== 'string' || typeof content !== 'string' || !isRecord(version)) continue;
      witnesses.push({
        kind: 'project_source',
        refKey: canonicalJson({ path, version } as unknown as JsonValue),
        version: sha256Hex(JSON.stringify(content)),
        label: path,
      });
    }
  }
  return witnesses;
}

function answerSources(pins: PreparedQueryManifestV1, state: RunState): QueryJobAnswerV1['sources'] {
  const combined: QueryJobAnswerV1['sources'] = [
    ...projectSourceWitnesses(state),
    { kind: 'goal', refKey: pins.goal.ref.goalId, version: String(pins.goal.revision), label: null },
    { kind: 'workspace', refKey: pins.workspace.ref.workspaceId, version: String(pins.workspace.revision), label: null },
  ];
  if (pins.focusPlan !== null) {
    combined.push({ kind: 'plan-revision', refKey: pins.focusPlan.ref.planId, version: String(pins.focusPlan.revision), label: null });
  }
  const seen = new Set<string>();
  const deduped: QueryJobAnswerV1['sources'] = [];
  for (const source of combined) {
    const key = source.kind + '|' + source.refKey;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(source);
    if (deduped.length >= MAX_SOURCES) break;
  }
  return deduped;
}

type CollectedTurn = {
  state: RunState;
  decoded: readonly DecodedRecord[];
  startPosition: number;
  lastPosition: number;
  lastCursor: string;
};

/** Re-read the EXACT manifest body that was bound at preparation; the terminal
 * answer sources are the original pins, never a later current-state read. */
async function loadPersistedManifest(
  bodies: RuntimeExecutionDependencies['bodies'],
  ref: ArtifactRef | undefined,
): Promise<PreparedQueryManifestV1 | null> {
  if (ref === undefined) return null;
  let stored;
  try { stored = await bodies.read(ref); } catch { return null; }
  if (stored.status !== 'ready') return null;
  const record = stored.value;
  if (record.ref.contentType !== ref.contentType || record.ref.digest !== ref.digest || record.ref.sizeBytes !== ref.sizeBytes) return null;
  if (sha256Hex(record.body) !== ref.digest) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(record.body); } catch { return null; }
  if (!isRecord(parsed) || parsed['schemaVersion'] !== 1 || parsed['kind'] !== 'query_execution') return null;
  return parsed as unknown as PreparedQueryManifestV1;
}

export function createQueryObservation(deps: RuntimeExecutionDependencies): QueryObservationPort {
  const owner = createSessionHistoryCursorOwner({ kernelStores: deps.kernelStores });

  async function readWindow(
    session: QueryExecutionRecord['session'], from: number, signal: AbortSignal,
  ): Promise<ReadResult<{ decoded: DecodedRecord[]; entries: SessionHistoryEntry[]; throughPosition: number }>> {
    const decoded: DecodedRecord[] = [];
    const entries: SessionHistoryEntry[] = [];
    let expected = from + 1;
    let cursor = from;
    let frozenThrough: number | null = null;
    for (let page = 0; page < MAX_OBSERVATION_PAGES; page += 1) {
      let window;
      try {
        window = await owner.readPositionWindow({ session, afterPosition: cursor, throughPosition: frozenThrough, limit: 200, signal });
      } catch (error) {
        return rejected('unavailable', `the bounded Query history window read failed: ${messageOf(error)}`);
      }
      if (window.status !== 'ready') return mapRead(window);
      frozenThrough = window.value.throughPosition;
      for (const entry of window.value.entries) {
        const item = decodeEntry(entry);
        if (item === null) return rejected('unavailable', 'a raw Query history entry is damaged or not a Kernel Session record');
        if (item.position !== expected) return rejected('unavailable', 'the Kernel history positions are not contiguous');
        expected += 1;
        decoded.push(item);
        entries.push(entry);
      }
      cursor = window.value.nextPosition;
      if (!window.value.hasMore) break;
      if (page === MAX_OBSERVATION_PAGES - 1) return rejected('capacity', 'the Query Turn history exceeds the bounded observation page budget');
    }
    return { status: 'ready', value: { decoded, entries, throughPosition: decoded.at(-1)?.position ?? from } };
  }

  async function collectTurn(
    session: QueryExecutionRecord['session'], kernel: QueryEntryIdentity['kernel'], signal: AbortSignal,
  ): Promise<ReadResult<CollectedTurn | null>> {
    const boundary = await owner.completedBoundary({ session, signal });
    if (boundary.status === 'rejected') return boundary;
    const from = boundary.cursor === null ? 0 : boundary.position;
    const window = await readWindow(session, from, signal);
    if (window.status !== 'ready') return window;
    const start = findTurnStart(window.value.decoded, kernel);
    if (start === null) return { status: 'ready', value: null };
    let state: RunState;
    try {
      state = applyEvents(createInitialRunState(start.run), window.value.decoded, kernel, start.position);
      const invariants = validateRunStateInvariants(state);
      if (!invariants.ok) return rejected('unavailable', `the reduced Query Turn violates Kernel invariants: ${invariants.message}`);
    } catch (error) {
      return rejected('unavailable', `reducing the complete Query Turn failed: ${messageOf(error)}`);
    }
    const lastEntry = window.value.entries.at(-1);
    if (lastEntry === undefined) return rejected('unavailable', 'the Query Turn has no canonical boundary cursor');
    return {
      status: 'ready',
      value: {
        state,
        decoded: window.value.decoded,
        startPosition: start.position,
        lastPosition: window.value.throughPosition,
        lastCursor: lastEntry.cursor,
      },
    };
  }

  async function onEntered(
    ctx: CoreCallContext,
    request: { entry: QueryEntryIdentity; occurredAt: string },
  ): Promise<ReadResult<QueryExecutionRecord>> {
    if (deps.queryExecution === undefined) return rejected('unsupported', 'onEntered requires the trusted QueryExecutionPort');
    const owned = ownContext(ctx);
    if (owned === null) return rejected('invalid', 'the call context cannot be isolated from the caller');
    if (owned.principal.kind !== 'host') return rejected('forbidden', 'Query observation requires a trusted Host call context');
    const queryRunRef = request?.entry?.queryRunRef;
    if (!isRecord(queryRunRef) || queryRunRef.aggregateType !== 'QueryRun' || !nonEmpty(queryRunRef.projectId)
      || !nonEmpty(queryRunRef.workspaceId) || !nonEmpty(queryRunRef.queryJobId) || !nonEmpty(queryRunRef.runId)) {
      return rejected('invalid', 'onEntered requires a complete Query entry identity');
    }
    if (queryRunRef.projectId !== owned.projectId || queryRunRef.workspaceId !== owned.workspaceId) {
      return rejected('forbidden', 'the QueryRun is outside the Host call scope');
    }
    const record = await deps.queryExecution.readQueryExecution(owned, queryRunRef);
    if (record.status !== 'ready') return record;
    const state = record.value.run.run.executionState;
    if (state === undefined) return rejected('incomplete', 'the QueryRun has no persisted execution state');
    if (state.phase === 'entered' || state.phase === 'settled' || state.phase === 'unknown') return { status: 'ready', value: record.value };
    if (state.phase !== 'entering') return rejected('busy', `the QueryRun cannot record entered in phase ${state.phase}`);
    const collected = await collectTurn(record.value.session, request.entry.kernel, owned.signal);
    if (collected.status !== 'ready') return mapRead(collected);
    if (collected.value === null) return rejected('incomplete', 'the fixed Query turn.started was not persisted');
    const history: RunExecutionHistoryV1 = {
      schemaVersion: 1,
      sessionRef: request.entry.sessionRef,
      kernel: { ...request.entry.kernel },
      startPosition: collected.value.startPosition,
      observedThroughPosition: collected.value.lastPosition,
      endPosition: null,
    };
    const requestId = `r5b-query-entered:${queryRunRef.runId}:${String(collected.value.lastPosition)}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const latest = await deps.queryExecution.readQueryExecution(owned, queryRunRef);
      if (latest.status !== 'ready') return latest;
      const write = await deps.queryExecution.recordQueryObservation(owned, {
        input: {
          entry: structuredClone(request.entry),
          history,
          source: { position: collected.value.lastPosition, cursor: collected.value.lastCursor },
          observation: { kind: 'entered', occurredAt: request.occurredAt },
        },
        meta: { requestId, expected: [{ ref: queryRunRef, revision: latest.value.run.revision }] },
      });
      if (write.status === 'committed') return { status: 'ready', value: write.value };
      if (write.code !== 'revision_conflict') return write;
    }
    return rejected('revision_conflict', 'the entered Query observation contended with another writer');
  }

  async function observe(
    ctx: CoreCallContext,
    request: { queryRunRef: QueryRunRef },
  ): Promise<ReadResult<QueryExecutionRecord>> {
    if (deps.queryExecution === undefined) return rejected('unsupported', 'observeQuery requires the trusted QueryExecutionPort');
    const owned = ownContext(ctx);
    if (owned === null) return rejected('invalid', 'the call context cannot be isolated from the caller');
    if (owned.principal.kind !== 'host') return rejected('forbidden', 'Query observation requires a trusted Host call context');
    const rawRef = request?.queryRunRef;
    if (!isRecord(rawRef) || rawRef.aggregateType !== 'QueryRun' || !nonEmpty(rawRef.projectId)
      || !nonEmpty(rawRef.workspaceId) || !nonEmpty(rawRef.queryJobId) || !nonEmpty(rawRef.runId)) {
      return rejected('invalid', 'observeQuery requires a complete QueryRunRef');
    }
    let queryRunRef: QueryRunRef;
    try { queryRunRef = structuredClone(rawRef) as QueryRunRef; } catch { return rejected('invalid', 'the observe request cannot be isolated from the caller'); }
    if (queryRunRef.projectId !== owned.projectId || queryRunRef.workspaceId !== owned.workspaceId) {
      return rejected('forbidden', 'the QueryRun is outside the Host call scope');
    }
    const record = await deps.queryExecution.readQueryExecution(owned, queryRunRef);
    if (record.status !== 'ready') return record;
    const { job, run, session } = record.value;
    const state = run.run.executionState;
    if (state === undefined || state.entry === null) return { status: 'ready', value: record.value };
    if (state.phase === 'settled' || run.run.status === 'answered' || run.run.status === 'closed') {
      return { status: 'ready', value: record.value };
    }
    if (state.phase === 'claimed' || state.phase === 'prepared') return { status: 'ready', value: record.value };
    const entry = entryIdentity(state, queryRunRef);
    if (entry === null) return { status: 'ready', value: record.value };
    const collected = await collectTurn(session, entry.kernel, owned.signal);
    if (collected.status !== 'ready') return mapRead(collected);
    if (collected.value === null) return { status: 'ready', value: record.value };
    // An accepted input is an original Kernel fact. Confirm its source before
    // publishing an Answer or releasing the Session, so a retry cannot start a
    // successor that accepts the same source again after a lost acknowledgement.
    if (!await confirmMailboxInputs(deps.messages, owned, queryRunRef, entry.kernel, collected.value.decoded)) {
      return rejected('unavailable', 'the Query input acceptance is saved in Kernel history but its source acknowledgement is not confirmed');
    }
    const runState = collected.value.state;
    const terminalStatus = mapOutcome(runState.status);
    if (terminalStatus === null) return { status: 'ready', value: record.value };
    // A terminal status is only evidence when the complete Turn is settled and
    // no result is genuinely unknown. A reducer-proven `abandoned` call is
    // different: it is a declared-but-never-started call with no result, and the
    // shared Kernel projection consumes it. A formal outcome_unknown (batch or
    // transcript) or any genuinely unsettled action keeps the real occupancy.
    const unknownInBatch = runState.toolBatch !== null
      && runState.toolBatch.calls.some(call => call.status === 'outcome_unknown');
    const transcriptUnknown = transcriptHasOutcomeUnknown(runState.transcript);
    const abandonedInBatch = runState.toolBatch !== null
      && runState.toolBatch.calls.some(call => call.status === 'abandoned');
    if ((!turnIsComplete(runState) && !abandonedInBatch) || unknownInBatch || transcriptUnknown) {
      return { status: 'ready', value: record.value };
    }
    // The platform-facing contract is the shared Kernel projection: an abandoned
    // terminal Turn drops only the never-started declarations from a COPY and
    // every other known terminal still passes the same genuine-unknown check.
    // The original state/records stay untouched; a projection that cannot be
    // consumed keeps the real occupancy and never fabricates an answer.
    try {
      assertTranscriptExchangeIntegrity(projectTerminalTranscript(runState), `r5b-query:${queryRunRef.runId}`);
    } catch {
      return { status: 'ready', value: record.value };
    }
    const manifest = await loadPersistedManifest(deps.bodies, state.prepared?.bundleRef);
    if (manifest === null) return rejected('unavailable', 'the persisted Query manifest could not be read for the terminal answer');
    const currentFacts = await deps.queryExecution.readPreparationFacts(owned, queryRunRef);
    if (currentFacts.status !== 'ready') return currentFacts;
    const occurredAt = runState.endedAt ?? deps.now();
    let outcome: 'answered' | 'failed' | 'cancelled' | 'timeout' | 'gap' = terminalStatus;
    let answer: QueryJobAnswerV1 | null = null;
    if (outcome === 'answered') {
      const text = extractAnswer(runState);
      if (text === null) {
        outcome = 'gap';
      } else {
        const materialCtx: CoreCallContext = {
          projectId: queryRunRef.projectId,
          workspaceId: manifest.workspace.ref.workspaceId,
          principal: { kind: 'query_run', queryRunRef: structuredClone(queryRunRef), initiator: structuredClone(currentFacts.value.initiator) },
          materialReader: { kind: 'run', requester: structuredClone(queryRunRef) },
          signal: owned.signal,
        };
        const storeSources: SourceRefV1[] = [
          { kind: 'workspace', refId: manifest.workspace.ref.workspaceId, revision: String(manifest.workspace.revision) },
        ];
        if (manifest.focusPlan !== null) {
          storeSources.push({ kind: 'plan-revision', refId: manifest.focusPlan.ref.planId, revision: String(manifest.focusPlan.revision) });
        }
        let stored;
        try {
          stored = await deps.materials.storeArtifact(materialCtx, {
            contentType: 'text/plain; charset=utf-8', body: text, sources: storeSources,
            origin: { kind: 'execution', ref: structuredClone(queryRunRef) },
          });
        } catch (error) {
          return rejected('unavailable', `storing the Query answer body failed: ${messageOf(error)}`);
        }
        if (stored.status !== 'stored') return rejected(stored.code === 'size_exceeded' ? 'capacity' : 'unavailable', stored.reason);
        // The original pins decide the source list; a current move only marks the
        // recorded answer stale and never erases the already-occurred result.
        const stale = currentFacts.value.goal.revision !== manifest.goal.revision
          || currentFacts.value.workspace.revision !== manifest.workspace.revision
          || (manifest.focusPlan !== null
            && (currentFacts.value.focusPlan === null || currentFacts.value.focusPlan.planRevision !== manifest.focusPlan.revision));
        const answerId = 'r5b-query-answer-' + sha256Hex(canonicalJson({ queryRunRef, position: collected.value.lastPosition } as unknown as JsonValue));
        answer = {
          schemaVersion: 1,
          answerId,
          queryJobRef: { aggregateType: 'QueryJob', projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId, queryJobId: queryRunRef.queryJobId },
          runRef: structuredClone(queryRunRef),
          roundIndex: 0,
          answer: text,
          sources: answerSources(manifest, runState),
          followsAnswerRef: null,
          stale,
          staleReason: stale ? 'the recorded Goal/Workspace/Plan moved after this answer was observed' : null,
          answeredAt: occurredAt,
          bodyRef: stored.ref,
        };
      }
    }
    const history: RunExecutionHistoryV1 = {
      schemaVersion: 1,
      sessionRef: state.sessionRef,
      kernel: { ...entry.kernel },
      startPosition: collected.value.startPosition,
      observedThroughPosition: collected.value.lastPosition,
      endPosition: collected.value.lastPosition,
    };
    const requestId = `r5b-query-observe:${queryRunRef.runId}:${String(collected.value.lastPosition)}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const latest = await deps.queryExecution.readQueryExecution(owned, queryRunRef);
      if (latest.status !== 'ready') return latest;
      const write = await deps.queryExecution.recordQueryObservation(owned, {
        input: {
          entry,
          history,
          source: { position: collected.value.lastPosition, cursor: collected.value.lastCursor },
          observation: {
            kind: 'terminal', occurredAt, outcome, answer,
            reason: outcome === 'gap' ? 'the Query turn produced no bounded answer text' : null,
          },
        },
        meta: { requestId, expected: [{ ref: queryRunRef, revision: latest.value.run.revision }] },
      });
      if (write.status === 'committed') return { status: 'ready', value: write.value };
      if (write.code !== 'revision_conflict') return write;
    }
    return rejected('revision_conflict', 'the terminal Query observation contended with another writer');
  }

  return { observe, onEntered };
}
