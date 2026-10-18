/**
 * F-074 (K3 B3 rework 9): the ONE pure global flatten + ordering rule for
 * blocked commands, shared by the recognizer (`command-recognition.ts`), the
 * execution preparation (`RT/execution-preparation.ts`) and the continuation
 * brief (`RT/context-assembler.ts`).
 *
 * The spec order is: the OWNING record's `createdAt`, then the command's
 * `alias`, then a deterministic record-ref tie-break (UTF-8 byte order of the
 * canonical ref key). Flattening first matters: sorting each record's aliases
 * in isolation would let an earlier record's alias 2 beat a later record's
 * alias 1 when `createdAt` ties.
 *
 * Nothing here talks to a clock, a store or a workspace; it is input -> output.
 */
import { compareRefKeys } from '../../record-store/lookup-index.js';

/** One already-flattened blocked command with the owning record's order keys. */
export type BlockedCommandOrderKey = {
  /** The owning review record's `createdAt` (ISO-8601, compared as text). */
  createdAt: string;
  /** The blocked command's alias (#n). */
  alias: number;
  /** The owning record's canonical ref key; only a tie-break. */
  refKey: string;
};

/** The spec order: record createdAt, then alias, then the deterministic ref tie-break. */
export function compareBlockedCommands(left: BlockedCommandOrderKey, right: BlockedCommandOrderKey): number {
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
  if (left.alias !== right.alias) return left.alias - right.alias;
  return compareRefKeys(left.refKey, right.refKey);
}

/**
 * Flatten every blocked command of every record and sort the WHOLE set by
 * `compareBlockedCommands`. The caller supplies the value it wants back; this
 * helper owns only the flatten + order.
 */
export function orderBlockedCommands<T>(
  records: readonly {
    createdAt: string;
    refKey: string;
    commands: readonly { alias: number; value: T }[];
  }[],
): T[] {
  const flattened: { key: BlockedCommandOrderKey; value: T }[] = [];
  for (const record of records) {
    for (const command of record.commands) {
      flattened.push({
        key: { createdAt: record.createdAt, alias: command.alias, refKey: record.refKey },
        value: command.value,
      });
    }
  }
  flattened.sort((left, right) => compareBlockedCommands(left.key, right.key));
  return flattened.map(entry => entry.value);
}
