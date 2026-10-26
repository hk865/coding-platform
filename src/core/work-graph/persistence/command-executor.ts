/**
 * The ONE write executor: identity → fingerprint → receipt lookup → facts →
 * decision → fragment → guard merge → pre-commit checks → one commit →
 * conflict mapping and retries → strict result projection.
 *
 * A command keeps only its own material: the facts it reads, its decision, the
 * write fragment it builds and the way it projects a decoded event. The order,
 * the receipt checks and the failure table live here so no owner can drift.
 * The executor starts no transaction other than the single `records.commit`
 * and never migrates an existing owner.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import { rejected, rejectedWithNonEmptyCurrent } from '../../../contracts/core/rejections.js';
import type { CoreError, CoreRejection } from '../../../contracts/core/results.js';
import { canonicalJson, sha256Hex } from '../../../contracts/fingerprint.js';
import type { JsonValue } from '../../../contracts/fingerprint.js';
import { messageOf } from '../../../contracts/error-message.js';
import type {
  DecodeResult, EncodedDomainEvent, GoalRecordTransactionPort, PreparedCommit, StoreCommitReceipt, StoreFailure,
} from '../../record-store/ports.js';
import { lookupCommittedReceipt } from './receipt-lookup.js';
import type { CommittedReceipt } from './receipt-lookup.js';
import { mergeGuards } from './record-guards.js';
import { pinsFromStoreCurrent } from './read-result-failures.js';

/** The two hashes a command's identity consists of; they are fixed before any read. */
export type Keys = Readonly<{ identityKey: string; fingerprint: string }>;

/** The R2 identity of one command; a replay rebuilds it from the commandId and needs no fingerprint. */
export function commandIdentity(input: {
  operation: string;
  scope: { projectId: string; workspaceId: string | null };
  principal: JsonValue;
  commandId: string;
}): string {
  return `${input.operation}:${sha256Hex(canonicalJson({ schemaVersion: 1, operation: input.operation,
    projectId: input.scope.projectId, workspaceId: input.scope.workspaceId, principal: input.principal,
    commandId: input.commandId }))}`;
}

/** The identity and the fingerprint of one write; `executeWriteCommand` and the advance's builder both call this. */
export function commandKeys(input: {
  operation: string;
  scope: { projectId: string; workspaceId: string | null };
  principal: JsonValue;
  commandId: string;
  fingerprintInput: JsonValue;
}): { identityKey: string; fingerprint: string } {
  return {
    identityKey: commandIdentity(input),
    fingerprint: sha256Hex(canonicalJson({ schemaVersion: 1, operation: input.operation,
      input: input.fingerprintInput })),
  };
}

/** The committed row of the exact identity/fingerprint pair. */
export type { CommittedReceipt };

/** Everything a command builds, except the four fields the executor owns. */
export type CommitFragment = Omit<PreparedCommit, 'identityKey' | 'fingerprint' | 'indexGuards' | 'indexChanges'>;

/**
 * A rejection of the whole write. `cause` keeps a store failure whole so the
 * owner can read its own conflict list, and marks an outcome that may already
 * have committed. Optional fields are omitted, never set to `undefined`.
 */
export type CommandRejection = {
  status: 'rejected';
  code: CoreError;
  reason: string;
  current?: VersionPin[];
  cause?: { store: StoreFailure } | { unknownCommit: true };
};

export type CommandResult<Result, Refusal> =
  | { status: 'committed'; value: Result; replayed: boolean; cursor: CommitCursor }
  | { status: 'refused'; refusal: Refusal }
  | CommandRejection;

/**
 * One atomic write as the executor sees it. `build` may prepare immutable
 * content-addressed material but writes no domain fact; `decide` and `build`
 * are the owner's only business slots. The executor passes `keys` read-only.
 */
export type WriteCommand<Facts, Decision, Refusal, Decoded, Result> = {
  operation: string;
  scope: { projectId: string; workspaceId: string | null };
  principal: JsonValue;
  commandId: string;
  fingerprintInput: JsonValue;
  read(): Promise<{ status: 'ready'; facts: Facts } | CoreRejection>;
  decide(facts: Facts): { refuse: Refusal } | { decision: Decision };
  build(decision: Decision, keys: Keys): CommitFragment | CommandRejection | Promise<CommitFragment | CommandRejection>;
  result: {
    eventType: string;
    schemaVersion: number;
    decode(event: EncodedDomainEvent): DecodeResult<Decoded>;
    validate(decoded: Decoded, receipt: CommittedReceipt, keys: Keys): string | null;
    project(decoded: Decoded, cursor: CommitCursor): Result;
  };
  retryable?: {
    claim?(claimKey: string): boolean;
    guard?(refKey: string): boolean;
    horizon?: boolean;
  };
};

/**
 * A commit failure is kept whole in `cause`. `current` is the projected pins,
 * attached only when non-empty: an empty projection is not a pin set, and an
 * empty array would claim the owner observed something it did not.
 */
function commitFailureRejection(
  code: CoreError, reason: string, failure: StoreFailure, current?: VersionPin[],
): CommandRejection {
  return { ...rejectedWithNonEmptyCurrent(code, reason, current), cause: { store: failure } };
}

/**
 * An outcome that may already have committed. The owner keeps the original
 * identity and input and recovers across calls; it is never retried here.
 */
function unknownCommitRejection(code: CoreError, reason: string): CommandRejection {
  return { status: 'rejected', code, reason, cause: { unknownCommit: true } };
}

/**
 * The committed event a receipt names, proved before anything is projected: the
 * cursor, the receipt's last event id, the type and version, then the decode.
 * The executor's own replay and the owners' identity-only replay share it.
 */
export type CommittedEventRead<Decoded> =
  | { status: 'ready'; value: Decoded }
  | { status: 'failed'; reason: string };

export async function readCommittedEvent<Decoded>(
  records: Pick<GoalRecordTransactionPort, 'eventAt'>,
  receipt: CommittedReceipt,
  result: { eventType: string; schemaVersion: number; decode(event: EncodedDomainEvent): DecodeResult<Decoded> },
): Promise<CommittedEventRead<Decoded>> {
  const fail = (reason: string): CommittedEventRead<Decoded> => ({ status: 'failed', reason });
  if (receipt.eventIds.length === 0) return fail('the receipt has no event ids');
  let read: Awaited<ReturnType<GoalRecordTransactionPort['eventAt']>>;
  try {
    read = await records.eventAt(receipt.cursor);
  } catch (error) {
    return fail(`the original event could not be read: ${messageOf(error)}`);
  }
  if (read.status !== 'ready') return fail(`the original event could not be read: ${read.code}: ${read.reason}`);
  const { cursor, event } = read.value;
  // An EncodedDomainEvent has no cursor, so only this branch can compare it.
  if (cursor !== receipt.cursor) return fail('the event cursor does not match the receipt cursor');
  const lastEventId = receipt.eventIds[receipt.eventIds.length - 1]!;
  if (event.eventId !== lastEventId) return fail("the event is not the receipt's last event");
  if (event.eventType !== result.eventType) return fail(`the event type is not ${result.eventType}`);
  if (event.schemaVersion !== result.schemaVersion) {
    return fail(`the event version is not ${result.schemaVersion}`);
  }
  try {
    const decoded = result.decode(event);
    return decoded.status === 'invalid' ? fail(`the event does not decode: ${decoded.reason}`)
      : { status: 'ready', value: decoded.value };
  } catch (error) {
    return fail(`the event does not decode: ${messageOf(error)}`);
  }
}

/**
 * The replay branch: rebuild the result from the committed event itself, never
 * from a current record. Every check is strict, every failure is a plain
 * `unavailable`, and a receipt that cannot be replayed is not retried.
 */
async function strictReplay<Facts, Decision, Refusal, Decoded, Result>(
  records: GoalRecordTransactionPort,
  command: WriteCommand<Facts, Decision, Refusal, Decoded, Result>,
  keys: Keys,
  receipt: CommittedReceipt,
): Promise<CommandResult<Result, Refusal>> {
  const fail = (text: string): CommandRejection => rejected('unavailable', `strict replay: ${text}`);
  if (receipt.identityKey !== keys.identityKey) return fail('the receipt identity does not match');
  const read = await readCommittedEvent(records, receipt, command.result);
  if (read.status !== 'ready') return fail(read.reason);
  const problem = command.result.validate(read.value, receipt, keys);
  if (problem !== null) return fail(`the result does not validate: ${problem}`);
  return { status: 'committed', value: command.result.project(read.value, receipt.cursor), replayed: true,
    cursor: receipt.cursor };
}

export async function executeWriteCommand<Facts, Decision, Refusal, Decoded, Result>(
  records: GoalRecordTransactionPort,
  command: WriteCommand<Facts, Decision, Refusal, Decoded, Result>,
): Promise<CommandResult<Result, Refusal>> {
  // Copy the identity material and hash it synchronously, before the first
  // `await`: the keys of this call are fixed, so a caller mutating its command
  // object afterwards cannot change which idempotency row this write is.
  const operation = command.operation;
  const scope = { projectId: command.scope.projectId, workspaceId: command.scope.workspaceId };
  const principal = command.principal;
  const commandId = command.commandId;
  const fingerprintInput = command.fingerprintInput;
  const keys: Keys = commandKeys({ operation, scope, principal, commandId, fingerprintInput });
  const identityKey = keys.identityKey;
  const fingerprint = keys.fingerprint;

  // A write already committed under this identity and input is replayed, never
  // repeated. The lookup classifies every failure; only `missing` may write.
  let lookup = await lookupCommittedReceipt(records, identityKey, fingerprint);
  if (lookup.status === 'found') return strictReplay(records, command, keys, lookup.receipt);
  if (lookup.status === 'conflict') return rejected('idempotency_conflict', lookup.reason);
  if (lookup.status !== 'missing') return rejected('unavailable', lookup.reason);

  let retries = 0;
  let lastRevisionPins: VersionPin[] = [];
  for (;;) {
    // The owner's facts read speaks its own vocabulary. A returned rejection is
    // passed through with its `current`; a throw is a store problem, not a
    // business refusal and not an unknown commit.
    let facts: Facts;
    try {
      const read = await command.read();
      if (read.status !== 'ready') return read;
      facts = read.facts;
    } catch (error) {
      return rejected('unavailable', `the facts read failed: ${messageOf(error)}`);
    }

    // `decide` is synchronous owner policy; its exception is a programming error
    // and propagates. A refusal is checked against the receipt first: the commit
    // may already have landed and the owner's facts may merely be stale.
    const decided = command.decide(facts);
    if ('refuse' in decided) {
      lookup = await lookupCommittedReceipt(records, identityKey, fingerprint);
      if (lookup.status === 'found') return strictReplay(records, command, keys, lookup.receipt);
      if (lookup.status === 'conflict') return rejected('idempotency_conflict', lookup.reason);
      if (lookup.status !== 'missing') return rejected('unavailable', lookup.reason);
      return { status: 'refused', refusal: decided.refuse };
    }

    // `build` may prepare content-addressed material, but it never commits. A
    // returned rejection is the owner's own decision and keeps its cause.
    let fragment: CommitFragment;
    try {
      const built = await command.build(decided.decision, keys);
      if ('status' in built) return built;
      fragment = built;
    } catch (error) {
      return rejected('unavailable', `the commit fragment could not be prepared: ${messageOf(error)}`);
    }

    // The one shared guard rule: the same key must agree. Its rejection is a
    // real revision conflict, not a store conflict, and is never retried.
    const merged = mergeGuards(fragment.guards);
    if (!merged.ok) return merged.rejection;

    // Pre-commit checks: the fragment must describe exactly the event the command
    // projects, and that event must decode, before anything is written. A missing
    // event or a type/version mismatch is a programming error and throws.
    const events = fragment.events;
    if (events.length === 0) throw new Error('the commit fragment has no event');
    const lastEvent = events[events.length - 1]!;
    if (lastEvent.eventType !== command.result.eventType) {
      throw new Error(`the last event type is not ${command.result.eventType}`);
    }
    if (lastEvent.schemaVersion !== command.result.schemaVersion) {
      throw new Error(`the last event version is not ${command.result.schemaVersion}`);
    }
    let decoded: Decoded;
    try {
      const decodedResult = command.result.decode(lastEvent);
      if (decodedResult.status === 'invalid') {
        return rejected('unavailable', `the last event does not decode: ${decodedResult.reason}`);
      }
      decoded = decodedResult.value;
    } catch (error) {
      return rejected('unavailable', `the last event does not decode: ${messageOf(error)}`);
    }

    const prepared: PreparedCommit = {
      identityKey, fingerprint, guards: merged.guards, records: fragment.records, claims: fragment.claims,
      indexGuards: [], indexChanges: [], events: fragment.events,
      ...(fragment.ledgerHorizon === undefined ? {} : { ledgerHorizon: fragment.ledgerHorizon }),
      ...(fragment.commitCursorBindings === undefined ? {} : { commitCursorBindings: fragment.commitCursorBindings }),
    };

    // Only the commit call sits in the try that can yield an unknown outcome: a
    // read, decide, build, merge or pre-commit failure is known not to have written.
    let receipt: StoreCommitReceipt;
    try {
      receipt = await records.commit(prepared);
    } catch (error) {
      lookup = await lookupCommittedReceipt(records, identityKey, fingerprint);
      if (lookup.status === 'found') return strictReplay(records, command, keys, lookup.receipt);
      if (lookup.status === 'conflict') return rejected('idempotency_conflict', lookup.reason);
      if (lookup.status !== 'missing') return unknownCommitRejection('unavailable', lookup.reason);
      return unknownCommitRejection('unavailable', 'the commit outcome is unknown and the receipt was not found');
    }

    if (receipt.status === 'committed') {
      if (receipt.replayed) return strictReplay(records, command, keys, receipt);
      // A fresh receipt proves this commit: it names this identity and its last
      // event, and the owner accepts the event's own identity and scope proof.
      const fail = (text: string): CommandRejection => rejected('unavailable', `strict replay: ${text}`);
      if (receipt.eventIds.length === 0) return fail('the receipt has no event ids');
      if (receipt.identityKey !== identityKey) return fail('the receipt identity does not match');
      if (lastEvent.eventId !== receipt.eventIds[receipt.eventIds.length - 1]!) {
        return fail("the event is not the receipt's last event");
      }
      const problem = command.result.validate(decoded, receipt, keys);
      if (problem !== null) return fail(`the result does not validate: ${problem}`);
      return { status: 'committed', value: command.result.project(decoded, receipt.cursor), replayed: false,
        cursor: receipt.cursor };
    }

    // A returned failure is not trusted on its own: the commit may still have
    // landed. The receipt is looked up again before any retry decision.
    lookup = await lookupCommittedReceipt(records, identityKey, fingerprint);
    if (lookup.status === 'found') return strictReplay(records, command, keys, lookup.receipt);
    if (lookup.status === 'conflict') return rejected('idempotency_conflict', lookup.reason);
    if (lookup.status !== 'missing') return rejected('unavailable', lookup.reason);

    switch (receipt.code) {
      case 'revision_conflict': {
        lastRevisionPins = pinsFromStoreCurrent(receipt.current);
        // Every observed version must be declared retryable; a caller pin or a
        // stale source is not. An empty conflict retries only when the fragment
        // carried a ledger horizon and the owner opted into horizon retries.
        const everyGuard = receipt.current.length > 0
          && receipt.current.every(entry => command.retryable?.guard?.(entry.refKey) === true);
        const horizon = receipt.current.length === 0 && fragment.ledgerHorizon !== undefined
          && command.retryable?.horizon === true;
        if (!everyGuard && !horizon) {
          return commitFailureRejection('revision_conflict', receipt.reason, receipt, lastRevisionPins);
        }
        break;
      }
      case 'unique_conflict': {
        // Every holder must be declared retryable too; otherwise the slot belongs
        // to someone else and the owner should back off as busy.
        const everyClaim = receipt.current.length > 0
          && receipt.current.every(entry => command.retryable?.claim?.(entry.claimKey) === true);
        if (!everyClaim) return commitFailureRejection('busy', receipt.reason, receipt);
        break;
      }
      case 'invalid':
      case 'not_found':
      case 'idempotency_conflict':
        return commitFailureRejection(receipt.code, receipt.reason, receipt);
      case 'unsupported':
        return commitFailureRejection('unsupported', receipt.reason, receipt);
      case 'corrupt':
      case 'unavailable':
        return commitFailureRejection('unavailable', receipt.reason, receipt);
    }

    // The conflict qualifies for a retry. The first try plus three retries is the
    // maximum; the last real store conflict stays whole as the cause.
    if (retries === 3) {
      return commitFailureRejection('busy', 'the write did not settle after 3 retries', receipt, lastRevisionPins);
    }
    retries += 1;
  }
}
