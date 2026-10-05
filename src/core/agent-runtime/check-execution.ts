/**
 * R3e.1 trusted Host registered-check runner (implementation).
 *
 * This is the ONE thin Runtime consumer of `EvidencePort`: it reads the formal
 * round, asks the port to begin a fresh check, checks the frozen ticket's real
 * root/permission revision, executes the registered command through the real
 * Kernel `WorkspaceSandbox`/`ProcessSandbox` public API and records the real
 * bounded observation. It owns NO record store, NO second result database and
 * NO completion reduction; the atomic cursor/receipt stays in `EvidencePort`.
 *
 * Only a `pending` check runs. An already executing/finished/interrupted window
 * is returned as the persisted view without a fresh probe or execute. Only a
 * proven non-start (`sandbox_unavailable`/`launch_failed`) is recorded as
 * `not_started`; any other failure after launch leaves the executing window
 * unreconciled instead of fabricating an observation.
 *
 * Spec §9 (A.2 step 5.3): a permission revision that is not the frozen binding
 * carries the VD-8 marker before begin (`frozen_permission_changed:`). After
 * begin, a window the runner proves never ran a process returns to `pending`
 * (VR-05, VD-6: root/constraint mismatch, root or permission changed, the
 * re-read failed, the caller cancelled) and an incomplete frozen ticket is
 * `interrupted` (VR-13); the runner still returns the original refusal. A
 * result whose record fails on a stale pin or an unavailable report store is
 * retried a bounded number of times with the same request id (VD-10).
 */
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../contracts/core/results.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { CheckProcessObservation, RoundSnapshot, VerificationRoundRef } from '../../contracts/verification.js';
import type { WorkspaceHostBindings } from '../workspace/access.js';
import type { AbandonCheckInput, EvidencePort } from '../work-graph/evidence/contracts.js';
import type { GraphWrite } from '../work-graph/tasks/contracts.js';
import { checkExecutionTicketProblem } from '../work-graph/evidence/evidence-record-codecs.js';
import { FROZEN_PERMISSION_CHANGED, frozenBindingReason } from '../work-graph/state/verification-machine.js';

/** The real frozen Kernel public API surface the runner is allowed to call.
 * Production composition passes the actual `public-api.js` namespace. */
export type RegisteredCheckKernel = Pick<
    typeof import('../../../vendor/coding-agent/dist/public-api.js'),
    'WorkspaceSandbox' | 'ProcessSandbox' | 'ProcessSandboxError'
>;

export interface RegisteredCheckRunner {
    runRegisteredCheck(
        ctx: CoreCallContext,
        request: GraphWrite<{ roundRef: VerificationRoundRef; checkId: string }>,
    ): Promise<ReadResult<RoundSnapshot>>;
}

export type RegisteredCheckRunnerDependencies = {
    evidence: EvidencePort;
    workspaceHost: WorkspaceHostBindings;
    kernel: RegisteredCheckKernel;
    now(): string;
};

/** stdout/stderr each retain at most 32 KiB; real totalBytes/truncated survive. */
const OUTPUT_LIMIT_BYTES = 32 * 1024;
/** VD-10: the first record of a result plus at most two retries under a refreshed pin. */
const RECORD_RESULT_ATTEMPTS = 3;

function reject(code: CoreError, reason: string): CoreRejection {
    return { status: 'rejected', code, reason };
}
/** Workspace reads can report failures outside the core error vocabulary; every
 * non-ready result still fails closed, cancelled/forbidden keep their meaning. */
function mapWorkspaceCode(code: string): CoreError {
    if (code === 'cancelled' || code === 'forbidden' || code === 'invalid'
        || code === 'unavailable' || code === 'not_found' || code === 'capacity') {
        return code;
    }
    return 'unavailable';
}
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function createRegisteredCheckRunner(deps: RegisteredCheckRunnerDependencies): RegisteredCheckRunner {
    /** A finishing signal under the same Host identity/scope (B2 cleanup pattern): a proven fact survives a late cancel. */
    const finishing = (ctx: CoreCallContext): CoreCallContext => ({ ...ctx, signal: new AbortController().signal });

    /**
     * VR-05 (VD-6): no process started after begin, so the window returns to
     * `pending` under the pin of a fresh re-read (none when the re-read fails),
     * and the caller still receives the original refusal.
     */
    async function abandon(
        ctx: CoreCallContext, roundRef: VerificationRoundRef, checkId: string, invocationId: string,
        cause: AbandonCheckInput['cause'], refusal: CoreRejection,
    ): Promise<CoreRejection> {
        if (deps.evidence.abandonCheck === undefined) return refusal;
        const settleCtx = finishing(ctx);
        const current = await deps.evidence.readVerification(settleCtx, roundRef);
        if (current.status !== 'ready') return refusal;
        await deps.evidence.abandonCheck(settleCtx, { input: { roundRef, checkId, invocationId, cause },
            meta: { requestId: `r3e-check-abandon-${invocationId}`, expected: [{ ref: current.value.ref, revision: current.value.revision }] } });
        return refusal;
    }

    /**
     * VD-10: record the occurred result; a stale pin or an unavailable report
     * store is retried under a refreshed pin with the same request id. A retry
     * that meets `idempotency_conflict` means an earlier attempt committed: the
     * round is read again instead. When the attempts run out the window stays
     * executing until the start-up reconcile (VR-04/VR-06).
     */
    async function recordResult(
        ctx: CoreCallContext, roundRef: VerificationRoundRef, checkId: string, invocationId: string,
        observation: CheckProcessObservation, pinned: RoundSnapshot,
    ): Promise<ReadResult<RoundSnapshot>> {
        let pin = { ref: pinned.ref, revision: pinned.revision };
        let last: WriteResult<RoundSnapshot> | null = null;
        for (let attempt = 0; attempt < RECORD_RESULT_ATTEMPTS; attempt += 1) {
            last = await deps.evidence.recordCheckResult(ctx, {
                input: { roundRef, checkId, invocationId, observation },
                meta: { requestId: `r3e-check-result-${invocationId}`, expected: [pin] },
            });
            if (last.status === 'committed') return { status: 'ready', value: last.value };
            if (attempt > 0 && last.code === 'idempotency_conflict') return await deps.evidence.readVerification(ctx, roundRef);
            if (last.code !== 'revision_conflict' && last.code !== 'unavailable') return last;
            const reread = await deps.evidence.readVerification(ctx, roundRef);
            if (reread.status !== 'ready') return last;
            const check = reread.value.checks.find(candidate => candidate.checkId === checkId);
            // Another writer settled the window (or the round): the persisted view is the answer.
            if (check === undefined || check.phase !== 'executing' || check.invocationId !== invocationId) return reread;
            pin = { ref: reread.value.ref, revision: reread.value.revision };
        }
        // Every attempt ended in a retryable refusal: the last one is the answer.
        return last as CoreRejection;
    }

    return {
        async runRegisteredCheck(
            ctx: CoreCallContext,
            request: GraphWrite<{ roundRef: VerificationRoundRef; checkId: string }>,
        ): Promise<ReadResult<RoundSnapshot>> {
            const read = await deps.evidence.readVerification(ctx, request.input.roundRef);
            if (read.status !== 'ready') return read;
            const round = read.value;
            const check = round.checks.find(candidate => candidate.checkId === request.input.checkId);
            if (check === undefined) return reject('invalid', `the round has no registered check ${request.input.checkId}`);
            if (check.phase !== 'pending') return { status: 'ready', value: round };

            const configuration = round.configuration;
            const resolved = await deps.workspaceHost.resolveRoot(configuration.workspace);
            if (resolved.status !== 'ready') return reject(mapWorkspaceCode(resolved.code), resolved.reason);
            const authorized = await deps.workspaceHost.authorize(ctx, configuration.workspace);
            if (authorized.status !== 'ready') return reject(mapWorkspaceCode(authorized.code), authorized.reason);
            if (authorized.value.permissionRevision !== configuration.permissionRevision) {
                // VD-8 (L-9): the same frozen-binding comparison as `beginCheck`, with its marker.
                return reject('forbidden', frozenBindingReason(FROZEN_PERMISSION_CHANGED,
                    'the current Host permission revision is not the trusted configuration binding'));
            }
            const root = resolved.value.root;
            let workspace;
            try {
                workspace = await deps.kernel.WorkspaceSandbox.create(root, { deniedPrefixes: [...configuration.deniedPrefixes] });
            } catch (error) {
                return reject('unsupported', `the verification workspace is unavailable: ${messageOf(error)}`);
            }
            let profile;
            try {
                profile = await deps.kernel.ProcessSandbox.probe(root, workspace);
            } catch (error) {
                return reject('unsupported', `the process sandbox probe failed: ${messageOf(error)}`);
            }
            if (!profile.available) {
                return reject('unsupported', profile.reason ?? 'the process sandbox is unavailable; no registered command was run');
            }

            const begin = await deps.evidence.beginCheck(ctx, request);
            if (begin.status !== 'committed') return begin;
            if (begin.replayed) {
                // A replayed ticket is NOT a re-execution permit.
                return await deps.evidence.readVerification(ctx, round.ref);
            }
            const ticket = begin.value;
            const invocationId = ticket.invocationId;
            const ticketProblem = checkExecutionTicketProblem(ticket);
            if (ticketProblem !== null) {
                const refusal = reject('unavailable', `the frozen ticket is incomplete: ${ticketProblem}`);
                // VR-13: the ticket comes from the frozen values, so a new begin would fail the same way.
                if (deps.evidence.interruptCheck !== undefined && nonEmptyText(invocationId)) {
                    const settleCtx = finishing(ctx);
                    const current = await deps.evidence.readVerification(settleCtx, round.ref);
                    if (current.status === 'ready') {
                        await deps.evidence.interruptCheck(settleCtx, { input: { roundRef: round.ref, checkId: check.checkId,
                            invocationId, cause: 'ticket_invalid', ticketProblem },
                        meta: { requestId: `r3e-check-interrupt-${invocationId}`,
                            expected: [{ ref: current.value.ref, revision: current.value.revision }] } });
                    }
                }
                return refusal;
            }

            // The pre-begin WorkspaceSandbox/probe is only reusable when its real
            // root (and denied-prefix process constraint) is exactly the fresh
            // ticket binding. A mismatch never executes against a stale root; no
            // process started, so the window returns to pending (VR-05).
            const sameDenied = ticket.deniedPrefixes.length === configuration.deniedPrefixes.length
                && ticket.deniedPrefixes.every((prefix, index) => prefix === configuration.deniedPrefixes[index]);
            if (root !== ticket.workspaceRoot || !sameDenied) {
                return await abandon(ctx, round.ref, check.checkId, invocationId, 'root_changed', reject('unavailable',
                    'the prepared sandbox root/constraints differ from the fresh ticket; no process was started'));
            }
            const rootVerify = await deps.workspaceHost.resolveRoot(ticket.workspace);
            if (rootVerify.status !== 'ready' || rootVerify.value.root !== ticket.workspaceRoot) {
                return await abandon(ctx, round.ref, check.checkId, invocationId, 'root_changed',
                    reject('unavailable', 'the workspace root changed after begin; no process was started'));
            }
            const permissionVerify = await deps.workspaceHost.authorize(ctx, ticket.workspace);
            if (permissionVerify.status !== 'ready' || permissionVerify.value.permissionRevision !== ticket.permissionRevision) {
                return await abandon(ctx, round.ref, check.checkId, invocationId, 'permission_changed',
                    reject('forbidden', 'the Host permission changed after begin; no process was started'));
            }
            const afterBegin = await deps.evidence.readVerification(ctx, round.ref);
            if (afterBegin.status !== 'ready') {
                return await abandon(ctx, round.ref, check.checkId, invocationId, 'read_failed', afterBegin.status === 'rejected'
                    ? afterBegin : reject('unavailable', 'the begun round could not be read again; no process was started'));
            }

            // Never start a new process once the original caller signal was
            // already cancelled before execute.
            if (ctx.signal.aborted) {
                return await abandon(ctx, round.ref, check.checkId, invocationId, 'caller_cancelled',
                    reject('cancelled', 'the registered check was cancelled before the process started'));
            }
            const startedAt = deps.now();
            let observation: CheckProcessObservation;
            try {
                const sandbox = new deps.kernel.ProcessSandbox(profile, root, workspace);
                const result = await sandbox.execute({
                    command: ticket.definition.command, cwd: ticket.definition.cwd,
                    timeoutMs: ticket.definition.timeoutMs, outputLimitBytes: OUTPUT_LIMIT_BYTES,
                    signal: ctx.signal,
                });
                observation = {
                    kind: 'executed', startedAt, finishedAt: deps.now(),
                    exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, cancelled: result.cancelled,
                    stdout: { text: result.stdout.text, totalBytes: result.stdout.totalBytes, truncated: result.stdout.truncated },
                    stderr: { text: result.stderr.text, totalBytes: result.stderr.totalBytes, truncated: result.stderr.truncated },
                    effects: { workspaceRevision: result.effects.workspaceRevision, changedPaths: [...result.effects.changedPaths] },
                    sandboxProfileVersion: result.sandboxProfileVersion,
                };
            } catch (error) {
                if (error instanceof deps.kernel.ProcessSandboxError
                    && (error.code === 'sandbox_unavailable' || error.code === 'launch_failed')) {
                    observation = { kind: 'not_started', reason: error.code, startedAt, finishedAt: deps.now() };
                } else {
                    return reject('unavailable', `the registered check execution window is unknown: ${messageOf(error)}`);
                }
            }
            // The process result is an occurred fact. The same Host identity/scope
            // and the original ticket/invocation/observation are committed under a
            // trusted finishing signal (B2 cleanup pattern) so a late cancel cannot
            // lose or reclassify the real result. The process itself still used the
            // original `ctx.signal` above.
            return await recordResult(finishing(ctx), round.ref, check.checkId, invocationId, observation, afterBegin.value);
        },
    };
}

function nonEmptyText(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}
