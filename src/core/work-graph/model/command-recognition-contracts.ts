import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { UnknownCallReviewV1 } from '../../../contracts/unknown-call-review.js';
import type { CommandRerunRequestV1 } from '../../../contracts/command-rerun-request.js';

/** L19a: one blocked-command hit; the first by (record createdAt, alias) wins, or the caller's `preferred` hit (F-102). */
export type BlockedCommandMatchV1 = {
  reviewRunId: string;
  alias: number;
  commandSha256: string;
  match: {
    kind: 'exact' | 'action' | 'declared';
    action?: { text: string; sha256: string };
    /** Set when an `npm run Y`-like expansion of the CURRENT package.json matched. */
    viaScript?: { scriptName: string; dir: string };
  };
};

/**
 * The ONE recognizer the request owner and the shell hook share (never a second
 * parser/expansion). `requests` is the Task's request set (declared forms).
 */
export type CommandRecognizer = (
  ctx: CoreCallContext,
  input: {
    records: readonly UnknownCallReviewV1[];
    requests: readonly CommandRerunRequestV1[];
    command: string; cwd: string; maxPackageReads: number;
    /**
     * F-102: an already resolved `rewriteOf`. In the SAME parse and expansion,
     * return this hit when the command hits it, otherwise the first hit as
     * before. The command owner passes the resolved record; the shell hook
     * passes nothing (it keeps blocking on the first hit).
     */
    preferred?: { reviewRunId: string; alias: number };
  },
) => Promise<ReadResult<BlockedCommandMatchV1 | null>>;
