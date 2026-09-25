import type { SessionRef } from './identity.js';

/** A locator owned by the existing Run, not a second transcript or permission.
 * Positions are inclusive and local to the bound Kernel Session. Absence on an
 * old Run means unindexed, not unexecuted. The immutable start is observed from
 * turn.started; the end is only set from complete terminal evidence. */
export type RunExecutionHistoryV1 = {
  schemaVersion: 1;
  sessionRef: SessionRef;
  kernel: { adapterId: string; kernelSessionId: string; runId: string; turnId: string };
  startPosition: number;
  /** Continuously inspected original-history watermark, not a completion flag. */
  observedThroughPosition: number;
  endPosition: number | null;
};
