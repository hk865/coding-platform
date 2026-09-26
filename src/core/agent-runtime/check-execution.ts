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
 */
import type { CoreError, CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { CheckProcessObservation, RoundSnapshot, VerificationRoundRef } from '../../contracts/verification.js';
import type { WorkspaceHostBindings } from '../workspace/access.js';
import type { EvidencePort } from '../work-graph/evidence/contracts.js';
import type { GraphWrite } from '../work-graph/tasks/contracts.js';
import { checkExecutionTicketProblem } from '../work-graph/evidence/evidence-record-codecs.js';

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
                return reject('forbidden', 'the current Host permission revision is not the trusted configuration binding');
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
            const ticketProblem = checkExecutionTicketProblem(ticket);
            if (ticketProblem !== null) return reject('unavailable', `the frozen ticket is incomplete: ${ticketProblem}`);

            // The pre-begin WorkspaceSandbox/probe is only reusable when its real
            // root (and denied-prefix process constraint) is exactly the fresh
            // ticket binding. A mismatch keeps the begun window unreconciled
            // instead of executing against a stale root.
            const sameDenied = ticket.deniedPrefixes.length === configuration.deniedPrefixes.length
                && ticket.deniedPrefixes.every((prefix, index) => prefix === configuration.deniedPrefixes[index]);
            if (root !== ticket.workspaceRoot || !sameDenied) {
                return reject('unavailable',
                    'the prepared sandbox root/constraints differ from the fresh ticket; the executing window stays unreconciled');
            }
            const rootVerify = await deps.workspaceHost.resolveRoot(ticket.workspace);
            if (rootVerify.status !== 'ready' || rootVerify.value.root !== ticket.workspaceRoot) {
                return reject('unavailable', 'the workspace root changed after begin; the executing window stays unreconciled');
            }
            const permissionVerify = await deps.workspaceHost.authorize(ctx, ticket.workspace);
            if (permissionVerify.status !== 'ready' || permissionVerify.value.permissionRevision !== ticket.permissionRevision) {
                return reject('forbidden', 'the Host permission changed after begin; the executing window stays unreconciled');
            }
            const afterBegin = await deps.evidence.readVerification(ctx, round.ref);
            if (afterBegin.status !== 'ready') return afterBegin;

            // Never start a new process once the original caller signal was
            // already cancelled before execute; the begun window stays unknown.
            if (ctx.signal.aborted) {
                return reject('cancelled',
                    'the registered check was cancelled before the process started; the executing window stays unreconciled');
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
            const finishingCtx: CoreCallContext = { ...ctx, signal: new AbortController().signal };
            const recorded = await deps.evidence.recordCheckResult(finishingCtx, {
                input: { roundRef: round.ref, checkId: check.checkId, invocationId: ticket.invocationId, observation },
                meta: { requestId: `r3e-check-result-${ticket.invocationId}`,
                    expected: [{ ref: afterBegin.value.ref, revision: afterBegin.value.revision }] },
            });
            if (recorded.status !== 'committed') return recorded;
            return { status: 'ready', value: recorded.value };
        },
    };
}
