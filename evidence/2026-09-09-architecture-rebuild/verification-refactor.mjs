// One-time, bounded AR-03 migration of the pre-existing verification implementation.
import { readFileSync, writeFileSync } from 'node:fs';
const read = p => readFileSync(p, 'utf8').replaceAll('\r\n', '\n');
const write = (p, s) => writeFileSync(p, s);
const between = (s, start, end) => {
  const a = s.indexOf(start), b = s.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw Error('Missing migration marker: ' + start);
  return s.slice(a, b);
};
const original = read('src/app/verification-imports.ts');
const engine = read('src/verification/verification-engine.ts');
const verifyContract = read('src/contracts/verification.ts');
const typesEnd = '\n// ------------------------------------------------------------------------ //\n// Verification request + result';
const algorithm = between(verifyContract, 'function isNonEmptyPin', typesEnd).replaceAll('\u0000', '\\0');
write('src/verification/verification-plan-compiler.ts', `/** Deterministic, content-addressed verification planning. No state writes or defaults. */
import { canonicalJson, sha256Hex } from '../contracts/fingerprint.js';
import type { CompletionPolicyPin, ArchitectureBaselinePin } from '../contracts/governance.js';
import type { VerificationPlanCompileInput, VerificationPlanCompileResult, VerificationIssue, VerificationCheckPlan, VerificationPlanV1 } from '../contracts/verification.js';
import { NO_CHANGE_FAST_PATH_CHECK_ID, REVIEWER_SEMANTIC_CHECK_ID } from '../contracts/verification.js';

${algorithm}`);
write('src/contracts/verification.ts', verifyContract.replace(between(verifyContract, 'function isNonEmptyPin', typesEnd), '').replace('import { canonicalJson, sha256Hex } from "./fingerprint.js";\n', ''));

// Shared bounded parsing and identities are Verification implementation details.
const parse = between(original, 'function ensure(', '/** Hash actual contents');
write('src/verification/verification-input.ts', `import { createHash } from 'node:crypto';
import type { VerificationScope as Scope, Benchmark } from '../contracts/verification-import.js';
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
${parse.replaceAll('\nfunction ', '\nexport function ').replace(/^function /, 'export function ')}
export function vScope(value: Scope): Scope { return { projectId: value.projectId, workspaceId: value.workspaceId, goalId: value.goalId, runId: value.runId }; }
`);
const workspaceDigest = between(original, '/** Hash actual contents', 'export function evaluateBenchmark');
write('src/context/verification-workspace.ts', `import { createHash } from 'node:crypto';
import { readdir, readFile, lstat, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from '../contracts/fingerprint.js';
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function ensure(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
${workspaceDigest}`);

const materialBody = between(engine, '    // -- 1. Resolve the goal', '    // -- 4. Gather');
const snapshotGuards = between(engine, 'function isGoalSnapshot', 'export class VerificationEngineImpl');
const runBody = between(original, '  private async context(scope: Scope)', '  async runChecks')
  .replace('private async context(scope: Scope)', 'async run(scope: Scope)')
  .replace('    const record =', "    ensure(this.deps.runtime && this.deps.rootFor, '运行核验 Context 未配置');\n    const record =")
  .replaceAll('this.runtime', 'this.deps.runtime').replaceAll('this.h.ledger', 'this.deps.ledger').replaceAll('this.rootFor', 'this.deps.rootFor');
write('src/context/verification-context.ts', `import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ArtifactPort, ArtifactRef } from '../contracts/artifact.js';
import type { StateLedger, AggregateSnapshot, GoalSnapshot, WorkspaceSnapshot } from '../contracts/ledger.js';
import type { RunRef, RunSnapshot } from '../contracts/dispatch.js';
import type { PlanRevisionSnapshot } from '../contracts/plan.js';
import type { PatchRecordSnapshot } from '../contracts/patch.js';
import type { WorkspaceWriteLeaseSnapshot } from '../contracts/workspace-lease.js';
import type { VerificationScope as Scope } from '../contracts/verification-import.js';
import type { VerificationContextPort, VerificationMaterialResult, VerificationRuntimeFacts } from '../contracts/verification-context.js';
import type { VerificationRequestV1, VerificationIssue } from '../contracts/verification.js';
import { resolveArchitectureBaselineRevision, resolveCompletionPolicyRevision } from '../contracts/governance.js';
import { canonicalJson } from '../contracts/fingerprint.js';
import { verificationWorkspaceDigest } from './verification-workspace.js';
const execute = promisify(execFile);
function ensure(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
function vScope(value: Scope): Scope { return { projectId: value.projectId, workspaceId: value.workspaceId, goalId: value.goalId, runId: value.runId }; }
${snapshotGuards}
export type VerificationContextDeps = {
  ledger: StateLedger;
  vault: Pick<ArtifactPort, 'open'>;
  runtime?: VerificationRuntimeFacts;
  rootFor?: (projectId: string, workspaceId: string) => string;
};
/** Select canonical verification facts and exact-source materials; never authorize state changes. */
export class VerificationContextCompiler implements VerificationContextPort {
  constructor(private readonly deps: VerificationContextDeps) {}
  async resolveVerification(request: VerificationRequestV1): Promise<VerificationMaterialResult> {
    const issue = (path: string, message: string): VerificationIssue => ({ path, message });
${materialBody}
    return { status: 'ready', planSnapshot, workspaceRevision, policyContent };
  }
${runBody}
  policy(plan: PlanRevisionSnapshot) {
    return resolveCompletionPolicyRevision(this.deps.ledger, plan.effectiveCompletionPolicy.ref, plan.effectiveCompletionPolicy.digest);
  }
  baseline(plan: PlanRevisionSnapshot) {
    return resolveArchitectureBaselineRevision(this.deps.ledger, plan.effectiveArchitectureBaseline.ref, plan.effectiveArchitectureBaseline.digest);
  }
  async taskReductionRevision(scope: { projectId: string; goalId: string; taskId: string }) {
    const result = await this.deps.ledger.load({ aggregateType: 'TaskReduction', ...scope });
    return result.status === 'found' ? result.snapshot.revision : 0;
  }
  async goalPhaseRevision(scope: { projectId: string; goalId: string }) {
    const result = await this.deps.ledger.load({ aggregateType: 'GoalPhase', ...scope });
    return result.status === 'found' ? result.snapshot.revision : 0;
  }
  async writeLease(projectId: string, leaseId: string) {
    const result = await this.deps.ledger.load({ aggregateType: 'WorkspaceWriteLease', projectId, leaseId });
    return result.status === 'found' ? result.snapshot as WorkspaceWriteLeaseSnapshot : null;
  }
  async patchRecord(projectId: string, patchId: string) {
    const result = await this.deps.ledger.load({ aggregateType: 'PatchRecord', projectId, patchId });
    return result.status === 'found' ? result.snapshot as PatchRecordSnapshot : null;
  }
  openReport(ref: ArtifactRef, owner: RunRef) { return this.deps.vault.open(ref, { requesterRunRef: owner }); }
  workspaceDigest(scope: Scope) {
    ensure(this.deps.rootFor, '工作区核验 Context 未配置');
    return verificationWorkspaceDigest(this.deps.rootFor(scope.projectId, scope.workspaceId));
  }
  async validateCandidatePatch(scope: Scope, patchFile: string) {
    ensure(this.deps.rootFor, '工作区核验 Context 未配置');
    try { await execute('git', ['apply', '--reverse', '--check', '--', patchFile], { cwd: this.deps.rootFor(scope.projectId, scope.workspaceId), maxBuffer: 4096 }); }
    catch { throw Error('候选补丁与当前工作区不匹配（反向检查失败）'); }
  }
}
`);
let newEngine = engine.replace(materialBody, `    const material = await this.deps.context.resolveVerification(request);
    if (material.status !== 'ready') return material;
    const { planSnapshot, workspaceRevision, policyContent } = material;

`)
  .replace('import type { StateLedger } from "../contracts/ledger.js";', 'import type { VerificationContextPort } from "../contracts/verification-context.js";')
  .replace('  ledger: StateLedger;', "  context: Pick<VerificationContextPort, 'resolveVerification'>;")
  .replace('import type { AggregateSnapshot, GoalSnapshot, WorkspaceSnapshot } from "../contracts/ledger.js";\n', '')
  .replace('import type { PlanRevisionSnapshot } from "../contracts/plan.js";\n', '')
  .replace('import {\n  resolveArchitectureBaselineRevision,\n  resolveCompletionPolicyRevision,\n} from "../contracts/governance.js";\n', '')
  .replace('import { canonicalJson } from "../contracts/fingerprint.js";\n', '')
  .replace('import { compileVerificationPlan } from "../contracts/verification.js";', 'import { compileVerificationPlan } from "./verification-plan-compiler.js";')
  .replace(snapshotGuards, '')
  .replace('src/contracts/verification.ts — the engine resolves canonical facts', 'verification-plan-compiler.ts — Context resolves canonical facts');
write('src/verification/verification-engine.ts', newEngine);

// Journal is local durable protocol storage; only Control writes canonical state.
let init = between(original, '  async init()', '  forRun(scope: Scope)');
init = init.replace('    // Rehydrate body-first artifacts; the baseline harness vault is in-memory.\n    for (const c of this.candidates) await this.artifact(c.patch, c, c.registeredAt);\n    for (const a of this.attempts) await this.reportArtifacts(a);\n', '');
const view = between(original, '  forRun(scope: Scope)', '  private async save(');
const save = between(original, '  private async save(', '  private async context').replace('private async save', 'async save');
write('src/verification/verification-journal.ts', `import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeAtomicFile } from '../storage/atomic-file.js';
import { canonicalJson } from '../contracts/fingerprint.js';
import type { VerificationScope as Scope, VerificationCandidate, VerificationAttempt } from '../contracts/verification-import.js';
import type { CommandCheckRecord, VerificationRunView } from '../contracts/verification-service.js';
import { vScope } from './verification-input.js';
/** File names and serialized identities are the existing durable import/check protocol. */
export class VerificationJournal {
  readonly checks: CommandCheckRecord[] = [];
  readonly candidates: VerificationCandidate[] = [];
  readonly attempts: VerificationAttempt[] = [];
  readonly pending = new Map<string, VerificationCandidate>();
  constructor(readonly directory: string) {}
${init}${view.replace('forRun(scope: Scope)', 'forRun(scope: Scope): VerificationRunView')}${save}}
`);

// Keep all report bytes and original source identities, including legacy rehydration.
const reportMethods = between(original, '  private async artifact(', '  async register(')
  .replaceAll('private async ', 'async ').replaceAll('this.h.vault', 'this.vault');
write('src/verification/verification-reports.ts', `import type { ArtifactPort, ArtifactRef } from '../contracts/artifact.js';
import type { VerificationScope as Scope, VerificationAttempt } from '../contracts/verification-import.js';
import { canonicalJson } from '../contracts/fingerprint.js';
import { digest, ensure, vScope } from './verification-input.js';
export class VerificationReports {
  constructor(private readonly vault: Pick<ArtifactPort, 'put'>) {}
${reportMethods}}
`);

const common = `import type { VerificationScope as Scope, VerificationCandidate, VerificationAttempt, Benchmark } from '../contracts/verification-import.js';
import type { VerificationServiceDeps, CommandCheckRecord } from '../contracts/verification-service.js';
import { canonicalJson } from '../contracts/fingerprint.js';
import { digest, ensure, object, text, sha, benchmark, time, changedPaths, vScope } from './verification-input.js';
import { VerificationJournal } from './verification-journal.js';
`;
const deps = s => s.replaceAll('this.h.workspaceLease', 'this.deps.workspaceLease').replaceAll('this.h.submitEvidence', 'this.deps.control.submitEvidence').replaceAll('this.h.recordPatch', 'this.deps.control.recordPatch').replaceAll('this.context(', 'this.deps.context.run(').replaceAll('this.save(', 'this.journal.save(').replaceAll('this.forRun(', 'this.journal.forRun(').replaceAll('this.checks', 'this.journal.checks').replaceAll('this.candidates', 'this.journal.candidates').replaceAll('this.attempts', 'this.journal.attempts').replaceAll('this.pending', 'this.journal.pending').replaceAll('this.directory', 'this.journal.directory');
let commands = deps(between(original, '  async runChecks', '  private async artifact('))
  .replaceAll('verificationWorkspaceDigest(target.root)', 'this.deps.context.workspaceDigest(scope)')
  .replaceAll('verificationWorkspaceDigest(ctx.root)', 'this.deps.context.workspaceDigest(scope)')
  .replaceAll('this.h.vault', 'this.deps.vault')
  .replace('{ ledger: this.h.ledger, now:', '{ context: this.deps.context, now:')
  .replace("this.deps.vault.open(ref, { requesterRunRef: { aggregateType: 'Run', projectId: scope.projectId, goalId: scope.goalId, runId: scope.runId } })", "this.deps.context.openReport(ref, { aggregateType: 'Run', projectId: scope.projectId, goalId: scope.goalId, runId: scope.runId })")
  .replace('this.deps.vault.open(observation.artifactRef!,{requesterRunRef:ctx.run.ref})', 'this.deps.context.openReport(observation.artifactRef!,ctx.run.ref)')
  .replace('this.deps.vault.open(progress.artifactRef,{requesterRunRef:runRef})', 'this.deps.context.openReport(progress.artifactRef,runRef)')
  .replace("const lease=await this.h.ledger.load({aggregateType:'WorkspaceWriteLease',projectId:scope.projectId,leaseId:check.leaseId});", 'const lease=await this.deps.context.writeLease(scope.projectId,check.leaseId);')
  .replace("ensure(lease.status==='found','检查租约缺失；不能推断已释放');", "ensure(lease,'检查租约缺失；不能推断已释放');")
  .replace("const storedLease=(lease.snapshot as import('../contracts/workspace-lease.js').WorkspaceWriteLeaseSnapshot).lease;", 'const storedLease=lease.lease;')
  .replace('resolveCompletionPolicyRevision(this.h.ledger,ctx.plan.effectiveCompletionPolicy.ref,ctx.plan.effectiveCompletionPolicy.digest)', 'this.deps.context.policy(ctx.plan)');
write('src/verification/command-check-lifecycle.ts', `${common}
import { buildP107AcquireWriteLeaseCommand, buildP107ReleaseLeaseCommand } from '../contracts/fixtures/workspace-fixtures.js';
import { buildEvidenceV1, buildSubmitEvidenceCommand } from '../contracts/fixtures/evidence-fixtures.js';
import type { CheckContextV1 } from '../contracts/verification.js';
import { buildCurrentEffectivityAnchor } from '../control/task-reducer.js';
import { compileVerificationPlan } from './verification-plan-compiler.js';
import { CommandCheckProvider } from './command-check-provider.js';
import { VerificationEngineImpl } from './verification-engine.js';
const actor = { kind: 'human' as const, id: 'local-benchmark-import' };
/** Explicit command execution, durable observations, evidence intake and effects reconciliation. */
export class CommandCheckLifecycle {
  private checkBusy = false;
  constructor(private readonly deps: VerificationServiceDeps, private readonly journal: VerificationJournal) {}
${commands}}
`);

const evaluate = between(original, 'export function evaluateBenchmark', '/**\n * One explicit command check.');
let benchMethods = deps(between(original, '  async register(', '\n}\nfunction vScope'))
  .replace('this.artifact(', 'this.reports.artifact(').replaceAll('this.reportArtifacts(', 'this.reports.reportArtifacts(')
  .replace("try { await execute('git', ['apply', '--reverse', '--check', '--', patchFile], { cwd: ctx.root, maxBuffer: 4096 }); } catch { throw Error('候选补丁与当前工作区不匹配（反向检查失败）'); }", 'await this.deps.context.validateCandidatePatch(scope, patchFile);')
  .replaceAll('verificationWorkspaceDigest(ctx.root)', 'this.deps.context.workspaceDigest(scope)')
  .replace('this.deps.context.workspaceDigest(scope) === c.workspaceDigest', 'this.deps.context.workspaceDigest(a) === c.workspaceDigest')
  .replace("const recorded = await this.h.ledger.load({ aggregateType: 'PatchRecord', projectId: scope.projectId, patchId: id });", 'const recorded = await this.deps.context.patchRecord(scope.projectId, id);')
  .replace("if (recorded.status === 'found')", 'if (recorded)')
  .replace("const saved = recorded.snapshot as import('../contracts/patch.js').PatchRecordSnapshot;", 'const saved = recorded;')
  .replace('new RecordedVerification(this.h)', 'this.recorded');
write('src/verification/benchmark-verification.ts', `${common}
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { buildP107AcquireWriteLeaseCommand, buildP107RecordPatchCommand } from '../contracts/fixtures/workspace-fixtures.js';
import type { RecordedVerificationPort } from '../contracts/verification-service.js';
import { VerificationReports } from './verification-reports.js';
const actor = { kind: 'human' as const, id: 'local-benchmark-import' };
${evaluate}
/** Frozen candidate and original/diagnostic/repair scores retain separate durable identities. */
export class BenchmarkVerification {
  constructor(private readonly deps: VerificationServiceDeps, private readonly journal: VerificationJournal,
    private readonly reports: VerificationReports, private readonly recorded: RecordedVerificationPort) {}
  async restoreArtifacts() {
    for (const c of this.journal.candidates) await this.reports.artifact(c.patch, c, c.registeredAt);
    for (const a of this.journal.attempts) await this.reports.reportArtifacts(a);
  }
${benchMethods}
}
`);

let recorded = read('src/verification/recorded-verification.ts')
  .replace("import type { StateLedger } from '../contracts/ledger.js';\n", '')
  .replace("import type { ControlEngine } from '../contracts/modules.js';\n", "import type { RecordedVerificationDeps, RecordedVerificationPort } from '../contracts/verification-service.js';\n")
  .replace("import { compileVerificationPlan } from '../contracts/verification.js';", "import { compileVerificationPlan } from './verification-plan-compiler.js';")
  .replace("import { resolveCompletionPolicyRevision, resolveArchitectureBaselineRevision } from '../contracts/governance.js';\n", '')
  .replace('export class RecordedVerification {', 'export class RecordedVerification implements RecordedVerificationPort {')
  .replace("constructor(private readonly h: Pick<ControlEngine, 'submitEvidence' | 'reduceTask' | 'reduceGoal'> & {\n        ledger: StateLedger;\n    }) { }", 'constructor(private readonly deps: RecordedVerificationDeps) { }')
  .replaceAll('resolveCompletionPolicyRevision(this.h.ledger, plan.effectiveCompletionPolicy.ref, plan.effectiveCompletionPolicy.digest)', 'this.deps.context.policy(plan)')
  .replaceAll('resolveArchitectureBaselineRevision(this.h.ledger, plan.effectiveArchitectureBaseline.ref, plan.effectiveArchitectureBaseline.digest)', 'this.deps.context.baseline(plan)')
  .replaceAll('new EvidenceAdmission(this.h)', 'new EvidenceAdmission(this.deps)');
write('src/verification/recorded-verification.ts', recorded);
let admission = read('src/verification/evidence-admission.ts')
  .replace("import type { StateLedger } from '../contracts/ledger.js';\n", '')
  .replace("import type { ControlEngine } from '../contracts/modules.js';", "import type { RecordedVerificationDeps } from '../contracts/verification-service.js';")
  .replace("constructor(private readonly deps: Pick<ControlEngine, 'submitEvidence' | 'reduceTask' | 'reduceGoal'> & {\n        ledger: StateLedger;\n    }) { }", 'constructor(private readonly deps: RecordedVerificationDeps) { }')
  .replaceAll('this.deps.submitEvidence', 'this.deps.control.submitEvidence').replaceAll('this.deps.reduceTask', 'this.deps.control.reduceTask').replaceAll('this.deps.reduceGoal', 'this.deps.control.reduceGoal')
  .replace("const old = await this.deps.ledger.load({\n            aggregateType: 'TaskReduction', projectId, goalId, taskId\n        });\n        const revision = old.status === 'found' ? old.snapshot.revision : 0;", 'const revision = await this.deps.context.taskReductionRevision({ projectId, goalId, taskId });')
  .replace("const old = await this.deps.ledger.load({\n            aggregateType: 'GoalPhase', ...scope\n        });\n        const revision = old.status === 'found' ? old.snapshot.revision : 0;", 'const revision = await this.deps.context.goalPhaseRevision(scope);');
write('src/verification/evidence-admission.ts', admission);
let provider = read('src/verification/command-check-provider.ts');
provider = provider.replace(between(provider, 'export type CommandCheckProgress =', 'export class CommandCheckProvider'), "export type { CommandCheckProgress } from '../contracts/verification-service.js';\nimport type { CommandCheckProgress } from '../contracts/verification-service.js';\n")
  .replace('private readonly vault: ArtifactPort', "private readonly vault: Pick<ArtifactPort, 'put'>");
write('src/verification/command-check-provider.ts', provider);

write('src/verification/verification-service.ts', `import type { VerificationServiceDeps, VerificationServicePort } from '../contracts/verification-service.js';
import type { VerificationScope } from '../contracts/verification-import.js';
import { VerificationJournal } from './verification-journal.js';
import { VerificationReports } from './verification-reports.js';
import { CommandCheckLifecycle } from './command-check-lifecycle.js';
import { BenchmarkVerification } from './benchmark-verification.js';
import { RecordedVerification } from './recorded-verification.js';
/** Public lifecycle facade. The application does not orchestrate protocol storage or Control sequencing. */
export class VerificationService implements VerificationServicePort {
  readonly recorded: RecordedVerification;
  private readonly journal: VerificationJournal;
  private readonly checks: CommandCheckLifecycle;
  private readonly benchmarks: BenchmarkVerification;
  constructor(deps: VerificationServiceDeps) {
    this.journal = new VerificationJournal(deps.directory);
    this.recorded = new RecordedVerification(deps);
    this.checks = new CommandCheckLifecycle(deps, this.journal);
    this.benchmarks = new BenchmarkVerification(deps, this.journal, new VerificationReports(deps.vault), this.recorded);
  }
  async init() { await this.journal.init(); await this.benchmarks.restoreArtifacts(); }
  forRun(scope: VerificationScope) { return this.journal.forRun(scope); }
  runChecks(scope: VerificationScope, input: Record<string, unknown>) { return this.checks.runChecks(scope, input); }
  checkReceipt(scope: Omit<VerificationScope, 'runId'>, requestId: string) { return this.checks.checkReceipt(scope, requestId); }
  checkReports(scope: VerificationScope, requestId: string) { return this.checks.checkReports(scope, requestId); }
  admitCheckEvidence(scope: VerificationScope, input: Record<string, unknown>) { return this.checks.admitCheckEvidence(scope, input); }
  reconcileCheck(scope: VerificationScope, requestId: string) { return this.checks.reconcileCheck(scope, requestId); }
  register(scope: VerificationScope, input: Record<string, unknown>) { return this.benchmarks.register(scope, input); }
  import(scope: VerificationScope, input: Record<string, unknown>) { return this.benchmarks.import(scope, input); }
}
`);
// Temporary legacy path while the composition root is migrated by AR-00.
write('src/app/verification-imports.ts', `import type { StateLedger } from '../contracts/ledger.js';
import type { ArtifactPort } from '../contracts/artifact.js';
import type { VerificationControlPort, VerificationServiceDeps } from '../contracts/verification-service.js';
import type { VerificationRuntimeFacts } from '../contracts/verification-context.js';
import { VerificationContextCompiler } from '../context/verification-context.js';
import { VerificationService } from '../verification/verification-service.js';
export type { VerificationCandidate, VerificationAttempt } from '../contracts/verification-import.js';
export type { CommandCheckRecord } from '../contracts/verification-service.js';
export { verificationWorkspaceDigest } from '../context/verification-workspace.js';
export { evaluateBenchmark } from '../verification/benchmark-verification.js';
/** Temporary composition compatibility only; all lifecycle behavior belongs to Verification. */
export class VerificationImports extends VerificationService {
  constructor(directory: string, host: VerificationControlPort & { ledger: StateLedger; vault: ArtifactPort; workspaceLease: VerificationServiceDeps['workspaceLease'] },
    runtime: VerificationRuntimeFacts, rootFor: (projectId: string, workspaceId: string) => string) {
    super({ directory, control: host, vault: host.vault, workspaceLease: host.workspaceLease,
      context: new VerificationContextCompiler({ ledger: host.ledger, vault: host.vault, runtime, rootFor }) });
  }
}
`);
// Tests in this ticket use the exact same Context seam as production consumers.
let et = read('tests/verification/verification-engine.test.ts')
  .replace('  compileVerificationPlan,\n', '')
  .replace('import { VerificationEngineImpl }', 'import { VerificationContextCompiler } from "../../src/context/verification-context.js";\nimport { compileVerificationPlan } from "../../src/verification/verification-plan-compiler.js";\nimport { VerificationEngineImpl }')
  .replaceAll('{ ledger: h.ledger, now: clock }', '{ context: new VerificationContextCompiler({ ledger: h.ledger, vault: h.vault }), now: clock }');
write('tests/verification/verification-engine.test.ts', et);
write('tests/verification/command-check-provider.test.ts', read('tests/verification/command-check-provider.test.ts').replace('../../src/app/verification-imports.js', '../../src/context/verification-workspace.js'));
write('tests/app/verification-imports.test.ts', read('tests/app/verification-imports.test.ts').replace('../../src/app/verification-imports.js', '../../src/verification/benchmark-verification.js'));
