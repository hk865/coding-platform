/**
 * B2 shared Prepared contract (skeleton).
 *
 * The bounded JSON manifest is stored as one content-addressed Artifact body;
 * `envelope.bundleRef` is its ONLY reference. The manifest does not embed its own
 * ArtifactRef/digest (that would be a circular summary). `input` is the exact
 * string handed to the Kernel; `inputDigest = sha256(UTF8(input))`, matching the
 * existing `contextInputDigest`. `manifestDigest` is the body digest of the
 * SAVED bytes, never a re-serialization of the parsed object.
 *
 * A declaration inside the manifest is never automatically trusted: WorkGraph
 * re-reads the current formal facts and the trusted Host configuration.
 */
import type { ArtifactRef } from '../artifact.js';
import type {
  RoleBindingRefV1, RuntimeInputBindingV1, SourceRefV1, TaskBudgetV1,
  ModelRequestMaterialPinV1,
} from '../dispatch.js';
import type { MaterialAccessGrantRef, MaterialBasisV1 } from '../material-access.js';
import type { RoleSpecResolutionV1 } from '../role-spec-materials.js';
import type { TaskEnvelopeV1 } from '../task-envelope.js';
import type { RoleConfigurationRef, SessionRef } from './identity.js';
import type { QueryRunRef } from '../query-job.js';
import type { GoalSnapshot, WorkspaceSnapshot } from '../ledger.js';
import type { PlanRevisionSnapshot } from '../plan.js';
import type { RuntimeBudget } from '../runtime-budget.js';
import type { TaskClaim } from './task-claim.js';
import type { ContinuationBriefV1 } from '../continuation-brief.js';
import type { ContextAssemblyBindingV1 } from '../graph-context.js';
import type {
  CapturedPathV1, UnknownCallObservationV1, UnknownCallReviewRef, WorkspaceCaptureV1,
} from '../unknown-call-review.js';
import type { BoundedTextV1 } from '../continuation-brief.js';

/**
 * K3: the review-round input handed to the Kernel (spec §2). Only the review /
 * proposal round manifests carry it. The structured items never carry a Kernel
 * callId (D8); `display` is `truncated`/`unexpanded` for commands without their
 * full text, and settlement re-judges those (D6, L16).
 */
export type UnknownCallReviewInputV1 = {
  reviewRef: UnknownCallReviewRef;
  revision: number;
  phase: 'review' | 'proposal';
  round: number;
  items: Array<{
    alias: number;
    toolName: string;
    display: 'full' | 'truncated' | 'unexpanded';
    /** command and cwd together <=4 KiB (UTF-8); null when unexpanded. */
    command: BoundedTextV1 | null;
    cwd: string | null;
    startedAt: string | null;
    sameBatch: number[];
    current: UnknownCallObservationV1 | null;
    /**
     * L20/lead answer 3: the record's own `summary.command`, carried only in
     * the proposal phase so trimming can keep it when the item becomes
     * `unexpanded` (the review phase is byte-identical, so it has no such field).
     */
    summaryCommand?: string | null;
  }>;
  /** proposal phase: the aliases of `proposalTargets` (D7). */
  targets: number[] | null;
  personText: string | null;
  /**
   * L18/lead answer 3: the disposition answer's annotations, in the answer's
   * own order. Filled only in the proposal phase; `path: null` names the record
   * object.
   */
  annotations: Array<{ path: string | null; text: string }>;
  /**
   * L20/D7: the aliases of the mixed card's undetermined platform items (in
   * `dispositionTargets`, not in `proposalTargets`), ascending. Proposal phase
   * only; empty in the review phase.
   */
  platformTargets: number[];
  workspace: {
    status: WorkspaceCaptureV1['status'];
    runBaselineKnown: boolean;
    notVisible: string[];
    notVisibleOmitted: number;
    changedSample: CapturedPathV1[] /* <=200 */;
    changedOmitted: number;
  };
};

/**
 * K3 L13/R1: render the structured review instruction as the trailing
 * `unknown_call_review` section of a review-purpose Work Run's input.
 *
 * It lives beside `UnknownCallReviewInputV1` (as `renderContinuationBriefZh`
 * sits beside the continuation brief) so WorkGraph can re-render the stored
 * structured copy when it validates the section interval and digests. Pure:
 * it reads only the input and returns one string.
 */
export function renderUnknownCallReviewZh(input: UnknownCallReviewInputV1): string {
  const lines: string[] = [];
  lines.push('## Unknown-call review');
  lines.push('这一轮只核对，不做任务，不改工作区；不许重跑下面的命令。');
  lines.push('');
  lines.push('### 工作区采集');
  const workspace = input.workspace;
  lines.push(`状态：${workspace.status}；基准已知：${workspace.runBaselineKnown ? '是' : '否'}`);
  const omitted = (count: number): string => count > 0 ? `（另有 ${String(count)} 条）` : '';
  lines.push(`看不见的部分：${workspace.notVisible.length === 0 ? '（无）'
    : workspace.notVisible.join('、') + omitted(workspace.notVisibleOmitted)}`);
  lines.push(`变了的前 200 条：${workspace.changedSample.length === 0 ? '（无）'
    : workspace.changedSample.map(path => `${path.path}（${path.change}）`).join('、') + omitted(workspace.changedOmitted)}`);
  lines.push('不在清单里不证明没做。');
  lines.push('');
  lines.push('### 已经写过的结论');
  const written = input.items.filter(item => item.current !== null
    && (item.current.by === 'review_round' || item.current.by === 'settlement'));
  if (written.length === 0) {
    lines.push('（无）');
  } else {
    for (const item of written) {
      const current = item.current;
      if (current === null || (current.by !== 'review_round' && current.by !== 'settlement')) continue;
      lines.push(`- #${String(item.alias)}：做没做完=${current.verdict}；依据=${current.evidence}`);
    }
  }
  lines.push('');
  // L20: the proposal phase lists the proposal targets and the person's note and
  // annotations. The review-only item list and its two questions would ask the
  // model to review instead of propose, so they are not rendered here.
  if (input.phase === 'proposal') {
    lines.push('### 提方案');
    lines.push('- 这一轮只给下面的条目提方案：每条调用一次 propose_safer_method，命令要能原样执行；不要跑原命令。');
    const indent = (text: string): string => text.replace(/\r\n|\n/g, '\n  ');
    const targets = [...(input.targets ?? [])].sort((left, right) => left - right);
    for (const alias of targets) {
      const item = input.items.find(entry => entry.alias === alias);
      if (item === undefined) continue;
      // L20/lead answer 3: trimming makes an item `unexpanded` only to fit the
      // prepared manifest. The proposal must still show the record's own cut,
      // marked as a cut, never "（无）". Truncated items keep their 4 KiB cut.
      const original = item.display === 'unexpanded'
        ? indent(item.summaryCommand ?? '') + '（只是摘要：全文太长，没有放进这一轮的说明）'
        : indent(item.command?.text ?? '（无）');
      lines.push(`- #${String(alias)}（${item.toolName}）原命令：${original}`);
    }
    if (input.personText !== null && input.personText !== '') lines.push(`- 附言：${input.personText}`);
    for (const annotation of input.annotations) {
      lines.push(`- 批注（${annotation.path ?? '记录'}）：${annotation.text}`);
    }
    if (input.platformTargets.length !== 0) {
      const aliases = [...input.platformTargets].sort((left, right) => left - right)
        .map(alias => `#${String(alias)}`).join('、');
      lines.push(`- 平台条目 ${aliases}：结果查不清，不提方案；接续说明里写“结果查不清，重做前先核实”。`);
    }
    return lines.join('\n');
  }
  lines.push('### 要核对的调用');
  for (const item of input.items) {
    if (item.display === 'unexpanded') {
      lines.push(`- #${String(item.alias)} ${item.toolName}：没展开，按判断不了处理。`);
    } else {
      const batch = item.sameBatch.length === 0 ? '（无）' : `#${item.sameBatch.join('、#')}`;
      lines.push(`- #${String(item.alias)} ${item.toolName}：命令 ${item.command?.text ?? '（无）'}；cwd ${item.cwd ?? '（无）'}`
        + `；开始时间 ${item.startedAt ?? '（未知）'}；同批调用：${batch}`);
    }
    if (item.display === 'truncated' || item.display === 'unexpanded') {
      lines.push('  这条命令没有全文，两个结论（做没做完、会不会是崩溃的原因）一律按判断不了处理；你看到的痕迹照样写进依据。');
    }
  }
  lines.push('');
  lines.push('### 每条要回答两件事');
  lines.push('1. 做没做完：已做 / 没做 / 做了一半 / 判断不了，附依据；');
  lines.push('2. 会不会就是 Host 崩溃的原因：不太可能 / 可能 / 判断不了，附依据（命令本身、留下的痕迹）。');
  return lines.join('\n');
}

export type PreparedTaskManifestV1 = {
  schemaVersion: 1;
  kind: 'task_execution';
  claim: TaskClaim;
  /** resolved / absent / inadmissible are preserved as real results. */
  role: RoleSpecResolutionV1;
  /** absent compatibility may only come from a trusted Host versioned template. */
  hostTemplate: { templateId: string; revision: string; digest: string } | null;
  roleBinding: RoleBindingRefV1;
  hostConfigurationRevision: string;
  sessionRole: RoleConfigurationRef;
  workspaceSnapshot: { workspaceId: string; revision: number };
  permissions: TaskEnvelopeV1['permissions'];
  budget: TaskBudgetV1;
  selectedTaskInputs: Array<{ requirementId: string; ref: ArtifactRef }>;
  /** Source pin verified by the trusted Host; never model-supplied or guessed. */
  materialBasis: MaterialBasisV1 | null;
  materialAccessRefs: MaterialAccessGrantRef[];
  additionalMaterialRefs: ArtifactRef[];
  deliveryRefs: ModelRequestMaterialPinV1[];
  sourceRefs: SourceRefV1[];
  /**
   * C3: present exactly on a Run claimed with a `requeueRef`; pinned by
   * `inputBinding.continuationBriefDigest`, rendered as the last section of `input`.
   */
  continuationBrief?: ContinuationBriefV1;
  /**
   * Slice 3: the assembled context binding fixed at prepare. Absent means a
   * `legacy_unversioned` input; it is never synthesized for an old manifest.
   */
  contextAssembly?: ContextAssemblyBindingV1;
  /**
   * LA-1: model history seed filled by AgentRuntime `prepare` (never Workflow)
   * from `TaskRequeue.historySource` when the claim Session is a fresh Session
   * on the same Kernel adapter and the source is readable. `throughPosition:
   * null` is the explicit empty baseline.
   */
  sessionBasis?: { sourceKernelSessionId: string; throughPosition: number | null };
  /**
   * L5: the run-start baseline artifact reference (the artifact body is a
   * `WorkspaceBaselineV1`; the manifest carries only the reference).
   */
  workspaceBaseline?: { status: 'captured'; ref: ArtifactRef; digest: string }
    | { status: 'unavailable'; reason: 'not_git' | 'too_many_changes' | 'read_failed'; detail: string /* <=500 */ };
  /** K3: present exactly on a review round / proposal round (L10). */
  unknownCallReview?: UnknownCallReviewInputV1;
  /**
   * L19a: the blocked-command summary carried with the binding. Only these
   * three fields per entry; the hook re-reads the records for actions,
   * expansions and declared forms at call time.
   */
  blockedCommands?: Array<{ reviewRunId: string; alias: number; commandSha256: string }>;
  input: string;
  inputDigest: string;
};

export type PreparedTaskExecution = {
  kind: 'task';
  claim: TaskClaim;
  envelope: TaskEnvelopeV1;
  inputBinding: RuntimeInputBindingV1;
};

/**
 * R5b.2 bounded Query execution manifest. Its ONLY reference is the saved body's
 * ArtifactRef; it never embeds its own ref/digest. `input` is the exact string
 * handed to the Kernel and `inputDigest = sha256(UTF8(input))`; the saved-body
 * digest is the ArtifactRef.digest. Every declaration below is re-checked by
 * WorkGraph against the current formal facts and the trusted Host configuration.
 */
export type PreparedQueryManifestV1 = {
  schemaVersion: 1;
  kind: 'query_execution';
  queryRunRef: QueryRunRef;
  sessionRef: SessionRef;
  sessionGeneration: number;
  roleBinding: RoleBindingRefV1;
  sessionRole: RoleConfigurationRef;
  role: Exclude<RoleSpecResolutionV1, { status: 'inadmissible' }>;
  hostTemplate: { templateId: string; revision: string; digest: string } | null;
  hostConfigurationRevision: string;
  goal: { ref: GoalSnapshot['ref']; revision: number };
  workspace: { ref: WorkspaceSnapshot['ref']; revision: number };
  focusPlan: { ref: PlanRevisionSnapshot['ref']; revision: number } | null;
  permissions: { tools: string[]; writeScope: [] };
  runtimeBudget: RuntimeBudget;
  budget: { tokenBudget: number | null; deadline: string | null };
  sourceRefs: SourceRefV1[];
  /**
   * The formal isolated derivation of this Query: the source Kernel Session and
   * its fixed completed boundary. `throughPosition: null` is the explicit empty
   * baseline (the source had no completed turn). Absent keeps the legacy target
   * Session history behavior.
   */
  sessionBasis?: { sourceKernelSessionId: string; throughPosition: number | null };
  /** Slice 3: the assembled Query context binding fixed at prepare. */
  contextAssembly?: ContextAssemblyBindingV1;
  input: string;
  inputDigest: string;
};

/** The three verifiable references a prepared Query carries back to Runtime. */
export type PreparedQueryExecution = {
  queryRunRef: QueryRunRef;
  bundleRef: ArtifactRef;
  inputDigest: string;
};
