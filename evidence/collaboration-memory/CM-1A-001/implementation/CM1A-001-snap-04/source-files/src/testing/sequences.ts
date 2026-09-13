/** Deterministic test-sequence dependencies (clock + id generators). */
import { randomUUID } from "node:crypto";

export const FIXED_ISO_2026_09_05 = "2026-09-05T12:00:00.000Z";

export type Clock = () => string;

export function fixedClock(iso: string = FIXED_ISO_2026_09_05): Clock {
  return () => iso;
}

export function sequenceIdGen(prefix: string, start = 1): () => string {
  let n = start;
  return () => `${prefix}-${String(n++).padStart(4, "0")}`;
}

export function randomIdGen(prefix = "id"): () => string {
  return () => `${prefix}-${randomUUID()}`;
}

export interface InjectableDeps {
  clock: Clock;
  commandId: () => string;
  correlationId: () => string;
  eventId: () => string;
}

/**
 * Fully deterministic deps: fixed clock + sequential id generators
 * (commandId: cmd-0001.., correlationId: corr-0001.., eventId: evt-0001..)
 * — the same inputs always produce the same artifacts, which is what
 * contract evidence relies on.
 */
export function createDeterministicDeps(): InjectableDeps & { reset: () => void } {
  const clock = fixedClock();
  let cmdSeq = 1;
  let corrSeq = 1;
  let evtSeq = 1;
  const reset = () => {
    cmdSeq = 1;
    corrSeq = 1;
    evtSeq = 1;
  };
  return {
    clock,
    commandId: () => `cmd-${String(cmdSeq++).padStart(4, "0")}`,
    correlationId: () => `corr-${String(corrSeq++).padStart(4, "0")}`,
    eventId: () => `evt-${String(evtSeq++).padStart(4, "0")}`,
    reset,
  };
}
