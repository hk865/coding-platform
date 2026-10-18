/**
 * K3 model contracts: the `CommandRerunRequest` read/write ports (spec §2,
 * L19a). Types only in group 1; the owner service is group 4.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { WorkspaceScope } from '../../../contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { RunRef, TaskTriple } from '../../../contracts/dispatch.js';
import type {
  CommandRerunRequestRef, CommandRerunRequestStateV1, CommandRerunRequestV1,
} from '../../../contracts/command-rerun-request.js';
import type { GraphWrite } from './task-contracts.js';

/**
 * Rework 1 item 8 (lead ruling): the request owner's return contract. A branch
 * that writes nothing says `not_written` and never fabricates a commit cursor;
 * CRR-01/CRR-07 writes return the real `WriteResult` (its own commit cursor).
 *
 * Rework 2 item 3 (lead ruling): the no-write `pending`/`allowed` outcomes
 * carry the WAITING request's `command` beside `requestId`, so the tool prints
 * the form already waiting without a second point read (the committed form
 * already carries it in `request.command`).
 */
export type CommandRerunRequestReplyV1 =
  | { status: 'not_written'; outcome:
      | { status: 'not_blocked' }
      | { status: 'pending'; requestId: string; command: string }
      | { status: 'allowed'; requestId: string; command: string }
      | { status: 'refused'; reason: 'denied_final' | 'denied_in_this_run' } }
  | WriteResult<{ request: CommandRerunRequestV1; outcome:
      | { status: 'requested'; requestId: string }
      | { status: 'pending'; requestId: string }
      | { status: 'refused'; reason: 'denied_final' | 'denied_in_this_run' } }>;

/**
 * The Task closure one trusted call already read. The shell hook's
 * `listTaskRequests` read returns it, and `consumeAllowance` reuses it instead
 * of reading the closure a second time in the SAME hook call (item 2). It is a
 * separate argument, not part of `GraphWrite`: no model/client input supplies it.
 */
export type TaskClosureReadV1 = { task: TaskTriple; closed: boolean };

export interface CommandRerunRequestReadPort {
  readRequest(
    ctx: CoreCallContext,
    input: { ref: CommandRerunRequestRef },
  ): Promise<ReadResult<CommandRerunRequestV1>>;
  /**
   * The card source reads pending per goal (index k3-crr-by-goal-state); the
   * tool reads by (task, review record, alias) (index k3-crr-by-task-alias);
   * the hook pages per task (index k3-crr-by-task, filter `{ goalId, taskId }`).
   * A lookup returns records; there is no separate `readMany`.
   */
  listRequests(
    ctx: CoreCallContext,
    input: {
      workspace: WorkspaceScope;
      filter:
        | { goalRef: GoalRef; state: CommandRerunRequestStateV1 }
        | { goalId: string; taskId: string; reviewRunId: string; alias: number }
        | { goalId: string; taskId: string };
      page: { limit: number /* 1..200 */; cursor?: string };
    },
  ): Promise<ReadResult<{ items: CommandRerunRequestV1[]; nextCursor: string | null; readThrough: CommitCursor | null }>>;
  /**
   * L19a item 2: the shell hook's whole-task read under ONE closure read. It
   * pages `{ goalId, taskId }` through `k3-crr-by-task` to the end (still ONE
   * physical page per page, limit 200) while reading the Task closure exactly
   * once for the call, and returns that closure for the delivery step. This is
   * an internal hook seam, not a model/client input.
   */
  listTaskRequests(
    ctx: CoreCallContext,
    input: { workspace: WorkspaceScope; filter: { goalId: string; taskId: string } },
  ): Promise<ReadResult<{ items: CommandRerunRequestV1[]; closure: TaskClosureReadV1 }>>;
}

export interface CommandRerunRequestPort {
  /** `request_command_rerun`'s owner: by (task, review record, alias) it reads pending/allowed/denied records and writes (L19a). */
  requestRerun(
    ctx: CoreCallContext,
    request: GraphWrite<{
      task: TaskTriple;
      runRef: RunRef;
      command: string;
      reason: string;
      rewriteOf?: { review: string; alias: number };
    }>,
  ): Promise<CommandRerunRequestReplyV1>;
  /** Card-answer application: identity from the answer message; the request@revision must still be pending (L19a). */
  applyAnswer(
    ctx: CoreCallContext,
    request: GraphWrite<{
      requestRef: CommandRerunRequestRef;
      selection: 'allow_rerun' | 'deny' | 'deny_final';
      decisionMessageRef: SessionMessageRef;
    }>,
  ): Promise<WriteResult<CommandRerunRequestV1>>;
  /**
   * One-time allowance: mark the allowance used (recording the callId) first;
   * run only after the commit succeeds (L19a). `closure` is the trusted internal
   * pass-through: the hook supplies the closure its `listTaskRequests` read
   * already made, so the call reads it ONCE. Without it the owner reads the
   * closure itself (a real read, never a default) for direct callers.
   */
  consumeAllowance(
    ctx: CoreCallContext,
    request: GraphWrite<{
      requestRef: CommandRerunRequestRef;
      usedBy: { runId: string; callId: string };
    }>,
    closure?: TaskClosureReadV1,
  ): Promise<WriteResult<CommandRerunRequestV1>>;
}
