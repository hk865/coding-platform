/**
 * Slice PS: one person's adoption first stops the affected Runs, then the next
 * call adopts.
 *
 * The wrapper sits on the published `plans` port only: the honest call order is
 * `route → trackedCall → this wrapper → RAW apply`. It never calls the wrapped
 * port (no recursion) and the automatic Workflow adoption keeps its raw
 * `planService` binding, so an automatic adoption never stops work and never
 * enters this slice (PS §3.12, U1).
 *
 * On a human's `busy` refusal, the affected disposition-only Tasks and their
 * Runs come from the Plan owner (`readAdoptionStopTargets`), never from the
 * model-written `reason.affectedTaskIds`. Every Run still `starting`/`running`
 * gets one durable `cancel` control with the fixed request identity and reason,
 * then is delivered to the live handle; a Run that never entered ends by RUN-09
 * inside the same submission. If at least one Run was stopped this call returns
 * `busy`/`stopping_affected_work` and writes no plan; if none was stopped the
 * raw refusal is returned unchanged. The caller calls `plans/apply` again after
 * the Runs end, and that call's real apply commits (PS §3.5-§3.7).
 *
 * Before stopping live Runs, the wrapper finishes the yielded wait on the
 * candidate's own source chain through the same judgment the automatic adoption
 * uses (`sameChainYieldedWaitOf`, injected as `finishYieldedWait`). The judgment
 * names the one fixed `cancel_yielded_wait` step; this wrapper submits it under
 * the platform automation identity and never delivers it (a yielded Run has no
 * live handle). A submit that committed makes the same request judge the adoption
 * again in this one call; a non-`busy` answer is returned as-is (normally
 * `committed`). Only a still-`busy` answer continues into the live-Run stop
 * below. No cancel step (`none`, a person's stop, an already queued/applied
 * intent) and a read refusal keep the existing path.
 *
 * A refused control write is classified against the deterministic intent of the
 * same identity (PS §3.4.1): an existing queued intent is delivered, an ended
 * Run or a non-queued intent is left to the next call, and a `busy` refusal of
 * a still-live Run is returned as-is without resubmitting. Only a
 * `revision_conflict`/`idempotency_conflict` on a still-live Run with no
 * existing intent is resubmitted with the same requestId and the fresh pin, at
 * most three submissions including the first. Every other refusal is returned
 * as-is; a delivery refusal is returned as-is and the already-written control
 * stays for the next idempotent replay.
 *
 * Known limit (lead 11-24, c3qc): the clicked version is checked only where the judgment reads the candidate, and
 * the yielded-wait cancel guards only the Run revision, the synchronous record store keeping that read and the commit
 * from interleaving; a candidate replaced after the read still leaves the cancel, and adopting again returns the
 * adopter's own ruling, the same "control written, adoption not" state as PS-SPEC §8 item 3.
 */
import { rejected } from '../contracts/core/rejections.js';
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { ControlIntentRef } from '../contracts/control-intent.js';
import type { RunSnapshot } from '../contracts/dispatch.js';
import type { CoreRejection, WriteResult } from '../contracts/core/results.js';
import { reworkActorClassOf, WORKFLOW_AUTOMATION_ACTOR } from '../contracts/task-requeue.js';
import type { SubmittedControl } from '../contracts/control-intent.js';
import type { RuntimeExecutionPort } from '../core/agent-runtime/ports.js';
import { hostSystemContext } from '../core/work-graph/model/platform-check-context.js';
import type { ExecutionReadPort } from '../core/work-graph/model/execution-read-contracts.js';
import type { PlanServicePort, PlanProposalRef, PlanTaskPort } from '../core/work-graph/model/plan-contracts.js';
import { controlIntentRefFor } from '../core/work-graph/tasks/control-service.js';
import type { RunControlPort } from '../core/work-graph/tasks/control-contracts.js';
import { asWriteRejection } from '../core/work-graph/tasks/plan-result-helpers.js';
import type { SameChainYieldedWaitV1 } from '../business/workflow/workflow.js';

/** PS §3.4: the fixed control reason of a stop caused by an adoption. */
const STOPPING_AFFECTED_WORK = 'stopping_affected_work';
/** PS §3.4 / SM:778: the fixed request identity (`plan-change:<proposalId>:<taskId>:<runId>`). */
const PLAN_CHANGE_REQUEST_PREFIX = 'plan-change';
/** PS §3.4.1 / L6: at most three control submissions for one Run, the first included. */
const MAX_CONTROL_SUBMISSIONS = 3;
/** The refusals classified by the deterministic intent of the same identity. */
const RETRIABLE_CONTROL_REFUSALS: ReadonlySet<string> = new Set(['busy', 'revision_conflict', 'idempotency_conflict']);

export type PlanAdoptionStopDependencies = {
  /** The RAW Plan owner; never the wrapped public port. */
  apply: PlanTaskPort['applyPlanChange'];
  readTargets: PlanServicePort['readAdoptionStopTargets'];
  controls: RunControlPort;
  runtime: Pick<RuntimeExecutionPort, 'deliverControl'>;
  /** The exact Run read the expected control pin comes from. */
  readRun: ExecutionReadPort['readExecution'];
  /**
   * The shared same-chain yielded-wait judgment, wired by the composition root
   * with `sameChainYieldedWaitOf` (`business/workflow/workflow.ts`): it reads the
   * candidate and the adopted Plan and answers `none`, the one fixed cancel step,
   * a candidate wait, or a read refusal. This wrapper submits that step under the
   * platform automation identity and never delivers it. `stale`: the candidate is
   * no longer `candidate` at the clicked revision.
   */
  finishYieldedWait: (ctx: CoreCallContext, proposalRef: PlanProposalRef, expectedProposalRevision: number) =>
    Promise<SameChainYieldedWaitV1 | { kind: 'stale' }>;
};

type StopOutcome =
  | { kind: 'stopped' }
  | { kind: 'skipped' }
  | { kind: 'refused'; rejection: CoreRejection };

export function createPlanAdoptionStop(deps: PlanAdoptionStopDependencies): PlanTaskPort['applyPlanChange'] {
  return async (ctx, request) => {
    // The honest adoption runs first: a candidate that is not TASK-19-busy is
    // returned untouched (committed, invalid, or any other refusal).
    const applied = await deps.apply(ctx, request);
    if (applied.status !== 'rejected' || applied.code !== 'busy') return applied;
    // Only a person's adoption stops work. The class comes from the one
    // `reworkActorClassOf` rule, never from `ActorRef.kind`; a non-human caller
    // is returned the raw refusal and the automation path stays out of PS.
    const principal = ctx.principal;
    if (principal.kind !== 'host') return applied;
    if (reworkActorClassOf(principal, principal.actor) !== 'human') return applied;
    const actor = principal.actor;

    const proposalRef = request.input.proposalRef;
    // PL §7.3.1 (C22): finish the yielded wait of this candidate's own source
    // chain before stopping live Runs. The shared judgment names the one fixed
    // `cancel_yielded_wait` step; this wrapper submits it as the platform
    // automation actor in the candidate's workspace and never delivers it (a
    // yielded Run has no live handle). A committed cancel lets the same request
    // judge the adoption again in this one call; only a still-busy answer falls
    // through to the existing live-Run path. No cancel step (`none`, a person's
    // stop, an already queued/applied intent) and a read refusal keep that path
    // too; the control owner's own refusal is returned as-is. The click names one
    // candidate version: once it is gone, the adopter's own latest ruling ends this
    // call. The latest `busy` is the one returned when nothing is stopped.
    let busy = applied;
    const finished = await deps.finishYieldedWait(ctx, proposalRef, request.input.expectedProposalRevision);
    if ('kind' in finished && finished.kind === 'stale') return await deps.apply(ctx, request);
    if ('kind' in finished && finished.kind === 'cancel') {
      const submitted = await deps.controls.submitControl(
        hostSystemContext({ ...ctx, workspaceId: proposalRef.workspaceId }, WORKFLOW_AUTOMATION_ACTOR),
        finished.operation.request);
      if (submitted.status !== 'committed') return submitted;
      const retried = await deps.apply(ctx, request);
      if (retried.status !== 'rejected' || retried.code !== 'busy') return retried;
      busy = retried;
    }
    const targets = await deps.readTargets(ctx, proposalRef);
    if (targets.status !== 'ready') return busy;

    // `runtime.port` always supplies control delivery; the port type keeps it
    // optional for older Runtime implementations, so this required dependency is
    // asserted here rather than branching on it.
    const deliverControl = deps.runtime.deliverControl!;
    const deliverExisting = async (intentRef: ControlIntentRef): Promise<StopOutcome> => {
      const delivered = await deliverControl(ctx, { intentRef });
      if (delivered.status === 'ready') return { kind: 'stopped' };
      return { kind: 'refused', rejection: asWriteRejection(delivered, 'the cancel control could not be delivered') };
    };
    const scope = { projectId: ctx.projectId, workspaceId: ctx.workspaceId! };
    const submitCancel = async (run: RunSnapshot, requestId: string): Promise<WriteResult<SubmittedControl>> =>
      await deps.controls.submitControl(ctx, {
        input: { runRef: run.ref, kind: 'cancel', reason: STOPPING_AFFECTED_WORK },
        meta: { requestId, expected: [{ ref: run.ref, revision: run.revision }] },
      });

    /**
     * PS §3.4.1: every round starts from the deterministic intent of the same
     * actor/scope/requestId. A queued intent is delivered as-is; another intent
     * status means this Run is already being stopped and the next Run continues.
     * `not_found` re-reads the Run: an ended Run continues, an already-cancelled
     * pointer is delivered, and only a still-live Run is resubmitted with the
     * fresh pin. `busy` is a real refusal (not a retry) once those exits miss.
     */
    const stopRun = async (taskId: string, run: RunSnapshot): Promise<StopOutcome> => {
      if (run.controlState?.desiredState === 'cancelled') {
        return await deliverExisting(run.controlState.intentRef);
      }
      const requestId = `${PLAN_CHANGE_REQUEST_PREFIX}:${proposalRef.proposalId}:${taskId}:${run.ref.runId}`;
      const existingRef = controlIntentRefFor(actor, scope, requestId);
      let current = run;
      for (let submission = 1; submission <= MAX_CONTROL_SUBMISSIONS; submission += 1) {
        const submitted = await submitCancel(current, requestId);
        if (submitted.status === 'committed') return await deliverExisting(submitted.value.intent.ref);
        if (!RETRIABLE_CONTROL_REFUSALS.has(submitted.code)) return { kind: 'refused', rejection: submitted };

        const existing = await deps.controls.readControl(ctx, existingRef);
        if (existing.status === 'ready') {
          if (existing.value.status === 'queued') return await deliverExisting(existing.value.ref);
          return { kind: 'skipped' };
        }
        if (existing.status !== 'not_found') {
          return { kind: 'refused', rejection: asWriteRejection(existing, 'the deterministic cancel intent could not be read') };
        }

        const read = await deps.readRun(ctx, current.ref);
        if (read.status !== 'ready') {
          return { kind: 'refused', rejection: asWriteRejection(read, 'the affected Run could not be re-read') };
        }
        const fresh = read.value.run;
        if (fresh.status === 'ended') return { kind: 'skipped' };
        if (fresh.controlState?.desiredState === 'cancelled') {
          return await deliverExisting(fresh.controlState.intentRef);
        }
        if (submitted.code === 'busy') return { kind: 'refused', rejection: submitted };
        if (submission === MAX_CONTROL_SUBMISSIONS) return { kind: 'refused', rejection: submitted };
        current = fresh;
      }
      return { kind: 'skipped' };
    };

    let stopped = false;
    for (const task of targets.value.tasks) {
      for (const run of task.runs) {
        if (run.status !== 'starting' && run.status !== 'running') continue;
        const outcome = await stopRun(task.taskId, run);
        if (outcome.kind === 'refused') return outcome.rejection;
        if (outcome.kind === 'stopped') stopped = true;
      }
    }
    // A read failure or a candidate with no in-flight Run keeps the latest raw
    // refusal: this call stopped nothing, so the caller sees the exact TASK-19 reason.
    return stopped ? rejected('busy', STOPPING_AFFECTED_WORK) : busy;
  };
}
