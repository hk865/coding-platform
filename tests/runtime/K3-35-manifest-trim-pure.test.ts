/**
 * K3-35 (一) PURE renderer/codec extreme (rework 6 item 7): the 32-item size and
 * L13 trim row as input -> output only. A real Run can hold at most one process
 * call that needs review, so this combination is not reachable by a scenario;
 * it is constructed here and handed to the production pure functions
 * `buildUnknownCallReviewInputV1` and `fitUnknownCallReviewForManifest`.
 *
 * Every literal comes from the spec or hand arithmetic:
 *   - 32 process items, aliases 1..32, real sha256 argument digests and
 *     512-character summaries (the L7 caps);
 *   - 32 Kernel callIds of 512 ASCII bytes each (the L7 upper limit);
 *   - a 200-path capture of 512-byte changed paths and 32 x 512-byte
 *     `notVisible` entries;
 *   - 32 Kernel-declared commands over 4 KiB made of quotes, backslashes and
 *     control characters (JSON encoding grows them further);
 *   - 65,536 rendered-instruction bytes and 262,144 whole-manifest bytes.
 *
 * This is a pure input -> output test: nothing here is written or committed.
 * The measure is the production one (`execution-preparation.ts` ~555): a
 * COMPLETE legal `PreparedTaskManifestV1` is assembled from the review and the
 * nonempty base input prefix, with a real section list whose
 * `unknown_call_review` section ends where the rendered text ends, and
 * `Buffer.byteLength(JSON.stringify(manifest), 'utf8')` is taken. The skeleton
 * is constructed here rather than through `prepare` (which needs a store).
 *
 * The expected order is L13's: the changed sample from the back, then
 * `notVisible` from the back, then items from the last one; each is a prefix or
 * a tail of the input. No Kernel callId reaches the built input (D8).
 */
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import { artifactBodyDigest } from '../../src/contracts/artifact.js';
import type { ContinuationBriefV1 } from '../../src/contracts/continuation-brief.js';
import type {
  ContextAssemblyBindingV1, ContextSectionNameV1,
} from '../../src/contracts/graph-context.js';
import type { PreparedTaskManifestV1, UnknownCallReviewInputV1 } from '../../src/contracts/core/prepared-execution.js';
import { renderUnknownCallReviewZh } from '../../src/contracts/core/prepared-execution.js';
import type { RunRef, TaskAttemptRef, TaskBudgetV1, TaskTriple } from '../../src/contracts/dispatch.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { PromptSetV1 } from '../../src/contracts/prompts/prompt-set.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type {
  CapturedPathV1, UnknownCallReviewItemV1, UnknownCallReviewV1,
} from '../../src/contracts/unknown-call-review.js';
import { buildUnknownCallReviewInputV1 } from '../../src/core/agent-runtime/context-assembler.js';
import { fitUnknownCallReviewForManifest } from '../../src/core/agent-runtime/execution-preparation.js';

const PROJECT = 'P';
const GOAL = 'g1';
const RUN_ID = 'k335-pure-run';
const WORKSPACE = 'W';
const AT = '2026-10-17T00:00:00.000Z';
/** The literal capacities from L13, never the production constants. */
const INSTRUCTION_MAX_BYTES = 65_536;
const MANIFEST_MAX_BYTES = 262_144;
const ITEM_COUNT = 32;
const PATH_BYTES = 512;

const RUN_REF: RunRef = { aggregateType: 'Run', projectId: PROJECT, goalId: GOAL, runId: RUN_ID };
const pad = (value: number): string => String(value).padStart(2, '0');

/** 32 Kernel callIds, each exactly 512 ASCII bytes (the L7 upper limit). */
const CALL_IDS: readonly string[] = Array.from({ length: ITEM_COUNT },
  (_, index) => `k335-callid-${pad(index + 1)}-`.padEnd(512, 'q'));

/** One changed path of exactly 512 ASCII bytes. */
function pathOf(index: number): CapturedPathV1 {
  return { path: `k335-path-${String(index).padStart(3, '0')}-`.padEnd(PATH_BYTES, 'f'), change: 'modified' };
}

/** The full capture the artifact would carry: 200 changed paths of 512 bytes. */
const FULL_CHANGES: readonly CapturedPathV1[] = Array.from({ length: 200 }, (_, index) => pathOf(index));
/** 32 `notVisible` entries of 512 ASCII bytes each. */
const NOT_VISIBLE: readonly string[] = Array.from({ length: 32 },
  (_, index) => `k335-hidden-${pad(index)}-`.padEnd(512, 'n'));

const CAPTURE_BODY = JSON.stringify({ schemaVersion: 1, changed: FULL_CHANGES });
const CAPTURE_REF: ArtifactRef = {
  kind: 'artifact', contentType: 'application/vnd.platform.workspace-change-capture+json',
  digest: artifactBodyDigest(CAPTURE_BODY), sizeBytes: Buffer.byteLength(CAPTURE_BODY, 'utf8'),
  source: { kind: 'artifact', refId: 'k335-capture', revision: '1' },
};

/** The Kernel-declared command: over 4 KiB of quotes, backslashes and control characters. */
function commandOf(alias: number): string {
  return `echo #${String(alias)} ` + '"\\\u0001'.repeat(1400) + '\u0000tail';
}

/** One codec-legal `process` item with a real sha256 digest and a 512-character summary. */
function itemOf(alias: number): UnknownCallReviewItemV1 {
  const callId = CALL_IDS[alias - 1];
  if (callId === undefined) throw new Error(`no callId for alias ${String(alias)}`);
  return {
    alias, callId, toolName: 'shell', kind: 'process', contained: false,
    kernel: { adapterId: 'k335-adapter', kernelSessionId: 'k335-kernel-session',
      kernelRunId: 'k335-kernel-run', turnId: 'k335-turn', callId, declaredPosition: 2, startedPosition: 3 },
    argumentsDigest: sha256Hex(`k335-arguments-${String(alias)}`),
    summary: { command: `echo #${String(alias)} `.padEnd(512, 'x'), cwd: '/w', mode: null, paths: [],
      pathsOmitted: 0, truncated: true },
    startedAt: AT,
    observed: { verdict: 'pending', by: null },
  };
}

const ITEMS: readonly UnknownCallReviewItemV1[] = Array.from({ length: ITEM_COUNT },
  (_, index) => itemOf(index + 1));

/** The constructed review record (pure input; nothing here is written or committed). */
const REVIEW: UnknownCallReviewV1 = {
  ref: { aggregateType: 'UnknownCallReview', projectId: PROJECT, goalId: GOAL, runId: RUN_ID },
  schemaVersion: 1, revision: 1, workspaceId: WORKSPACE,
  task: { projectId: PROJECT, goalId: GOAL, taskId: 'k335-pure-task' },
  runRef: RUN_REF, sessionRef: { projectId: PROJECT, sessionId: 'k335-pure-session' },
  origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'operator' },
    reason: 'the K3-35 (一) pure capacity input' },
  inventory: 'complete', inventoryProblem: null,
  items: [...ITEMS], itemsOmitted: 0,
  workspace: { status: 'captured', runBaselineKnown: true, baseCommit: 'k335-base', headNow: 'k335-head',
    captureRef: CAPTURE_REF, changedCount: FULL_CHANGES.length, sample: FULL_CHANGES.slice(0, 50),
    notVisible: [...NOT_VISIBLE], notVisibleOmitted: 0 },
  streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
  status: 'pending_review', open: 'yes', decisionReasons: [],
  dispositionTargets: null, proposalTargets: null, stateEntry: 1,
  activeRound: null, rounds: [], proposals: [], blockedCommands: [], disposition: null,
  createdAt: AT, updatedAt: AT,
};

/** The 32 real Kernel commands, by alias. */
const COMMAND_FACTS: ReadonlyMap<number, { command: string; cwd: string | null }> = new Map(
  ITEMS.map(item => [item.alias, { command: commandOf(item.alias), cwd: '/w' }] as const));

// ------------------------------------------------------------------------ //
// The complete manifest skeleton (pure values, no store and no `prepare`).   //
// ------------------------------------------------------------------------ //
const TASK_ID = 'k335-pure-task';
const TASK: TaskTriple = { projectId: PROJECT, goalId: GOAL, taskId: TASK_ID };
const PLAN_REF: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: PROJECT, planId: 'k335-pure-plan' };
const PRIOR_RUN_REF: RunRef = { aggregateType: 'Run', projectId: PROJECT, goalId: GOAL, runId: 'k335-pure-prior-run' };
/** The review Run itself; `RUN_REF` stays the Run whose calls it reviews (a distinct Run). */
const MANIFEST_RUN_REF: RunRef = { aggregateType: 'Run', projectId: PROJECT, goalId: GOAL,
  runId: 'k335-pure-manifest-run' };
const ATTEMPT_REF: TaskAttemptRef = {
  aggregateType: 'TaskAttempt', projectId: PROJECT, goalId: GOAL, taskId: TASK_ID, attemptId: 'k335-pure-attempt',
};
const SESSION_REF = { projectId: PROJECT, sessionId: 'k335-pure-session' };
const ROLE_BINDING = { schemaVersion: 1 as const, bindingId: 'k335-pure-binding', templateId: 'k335-pure-role',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'k335-pure-policy' };
const SESSION_ROLE = { kind: 'role_spec' as const, pin: {
  ref: { aggregateType: 'RoleSpecRevision' as const, projectId: PROJECT, roleId: 'k335-pure-role', revision: 1 },
  digest: sha256Hex('k335-pure-role-spec'),
} };
const CLAIM: TaskClaim = {
  task: TASK, planRef: PLAN_REF, workspaceId: WORKSPACE,
  sessionRef: SESSION_REF, sessionRevision: 1, generation: 1,
  runRef: MANIFEST_RUN_REF, previousRun: null, attemptRef: ATTEMPT_REF,
  outboxRef: { aggregateType: 'DispatchOutboxEntry', projectId: PROJECT, goalId: GOAL,
    taskId: TASK_ID, attemptId: ATTEMPT_REF.attemptId },
  claimedAt: AT,
};
const PERMISSIONS: PreparedTaskManifestV1['permissions'] = {
  policyRevision: 'k335-pure-policy', tools: ['read', 'shell'], writeScope: ['src/'],
};
const BUDGET: TaskBudgetV1 = { tokenBudget: 120_000, deadline: null };
const SOURCE_REFS: PreparedTaskManifestV1['sourceRefs'] = [
  { kind: 'workspace', refId: WORKSPACE, revision: '3' },
  { kind: 'plan-revision', refId: PLAN_REF.planId, revision: '3' },
];
const BASELINE_REF: ArtifactRef = {
  kind: 'artifact', contentType: 'application/vnd.platform.workspace-baseline+json',
  digest: sha256Hex('k335-pure-workspace-baseline'), sizeBytes: 512,
  source: { kind: 'artifact', refId: 'k335-pure-baseline', revision: '1' },
};
/** A complete `ContinuationBriefV1`: this review Run carries a rework brief. */
const CONTINUATION_BRIEF: ContinuationBriefV1 = {
  schemaVersion: 1, runRef: MANIFEST_RUN_REF, task: TASK,
  requeueRef: { aggregateType: 'TaskRequeue', projectId: PROJECT, goalId: GOAL, taskId: TASK_ID,
    afterRunId: PRIOR_RUN_REF.runId },
  mode: 'rework', failureClass: 'interrupted',
  trigger: { actorClass: 'human', goalResume: false, requeueNumber: 1, autoRework: null,
    earlierRequeues: [{ afterRunId: PRIOR_RUN_REF.runId, failureClass: 'interrupted' }] },
  previous: {
    runRef: PRIOR_RUN_REF,
    attemptRef: { aggregateType: 'TaskAttempt', projectId: PROJECT, goalId: GOAL, taskId: TASK_ID,
      attemptId: 'k335-pure-prior-attempt' },
    sessionRef: SESSION_REF, outcome: 'crashed', origin: 'observed',
    interruption: null, cancelledBy: null,
    error: { text: 'the Host crashed during the prior Run', truncated: false },
    limit: null, budget: null, wait: null, unacceptedSteers: [], endedAt: AT,
  },
  factsFrom: { runRef: PRIOR_RUN_REF, hops: 0, truncated: false },
  stoppedAt: { kernel: 'not_entered', reason: null, turnStatus: null, lastPosition: null,
    lastToolGroup: null, lastAssistant: null, window: null },
  toolCalls: { confirmed: [], notExecuted: [], unknown: [],
    confirmedOmitted: 0, notExecutedOmitted: 0, unknownOmitted: 0 },
  acceptedInputs: { steers: [], steersOmitted: 0, messages: [], messagesOmitted: 0 },
  checks: null,
  requeue: { reason: { text: 'continue after the crash', truncated: false },
    reasonAuthor: 'human', newInputs: [] },
  workspace: {
    selfChanged: { status: 'not_entered', confirmed: [], possible: [], omitted: 0 },
    checkpoints: [], segments: [],
    unobserved: { from: 'previous_run_end', to: null, previousEndedAt: AT },
    uncommitted: { status: 'not_git', baseCommit: null, paths: [], omitted: 0,
      reason: 'the pure manifest skeleton reads no workspace' },
  },
  session: { continuity: 'same_session_history', sessionRef: SESSION_REF,
    seededFrom: null, boundaryPosition: null },
  standingInstructionVersion: 1,
};

/** The nonempty base input prefix, ending at the `\n\n` before the review header. */
const BASE_PIECES: ReadonlyArray<{ name: ContextSectionNameV1; text: string }> = [
  { name: 'role', text: '## 角色\nK3-35 pure manifest role' },
  { name: 'goal', text: '## 目标\nK3-35 pure manifest goal' },
  { name: 'task', text: '## 任务\nK3-35 pure manifest task' },
  { name: 'inputs', text: '## 输入\nK3-35 pure manifest selected input' },
];
const BASE_INPUT = BASE_PIECES.reduce((text, piece) => `${text}\n\n${piece.text}`, 'K3-35 pure manifest prelude') + '\n\n';
const BASE_SECTIONS: ContextAssemblyBindingV1['sections'] = (() => {
  let text = 'K3-35 pure manifest prelude';
  return BASE_PIECES.map((piece) => {
    text += '\n\n';
    const startByte = Buffer.byteLength(text, 'utf8');
    text += piece.text;
    return { name: piece.name, startByte, endByte: Buffer.byteLength(text, 'utf8'), omitted: 0 };
  });
})();
const REVIEW_SECTION_START = Buffer.byteLength(BASE_INPUT, 'utf8');
const CONTEXT_ASSEMBLY: ContextAssemblyBindingV1 = {
  schemaVersion: 1, formatVersion: 's3-context-v1', callKind: 'review', duty: 'executor',
  sectionOrder: ['role', 'goal', 'task', 'inputs', 'unknown_call_review'],
  residentBudgetBytes: 16_384,
  // `totalBytes`/the review end are replaced on every measure, as production does.
  residentBytes: 0, totalBytes: REVIEW_SECTION_START,
  sections: [...BASE_SECTIONS, { name: 'unknown_call_review',
    startByte: REVIEW_SECTION_START, endByte: REVIEW_SECTION_START, omitted: 0 }],
  sources: [], inputSelections: [],
  extensions: { notes: 'available', anomalies: 'available', footprint: 'not_implemented',
    goalSettings: 'not_implemented', decisions: 'available' },
};

/**
 * PC-1b (ruling 14): the preparation now freezes a prompt set inside the
 * manifest, so the measured bytes include it. These literals add it; the
 * manifest-size boundary stays the same, so only the number of item trims can
 * move (the assertions check the order and that the last boundary is over).
 */
const PROMPT_TEXT_CONTENT_TYPE = 'application/vnd.coding-platform.prompt-text;version=1';
const promptTextRef = (body: string): ArtifactRef => ({
  kind: 'artifact', contentType: PROMPT_TEXT_CONTENT_TYPE,
  digest: sha256Hex(body), sizeBytes: Buffer.byteLength(body, 'utf8'),
  source: { kind: 'workspace', refId: WORKSPACE, revision: '1' },
});
const PROMPT_SET: PromptSetV1 = {
  schemaVersion: 1, modelId: 'k335-pure-model', provider: 'deepseek', model: 'k335-pure-scripted',
  packId: 'platform', reasoningReplay: 'current_run',
  sectionOrder: { work: ['role', 'goal', 'task', 'footprint', 'notes', 'reminders', 'inputs', 'unknown_call_review'] },
  templates: [],
  strings: { digest: sha256Hex('{}'), ref: promptTextRef('{}') },
  base: { templateId: 'base', version: 1, digest: sha256Hex(''), ref: promptTextRef('') },
  skills: [],
  toolNames: [],
  tools: [],
};

/** The production manifest build (`execution-preparation.ts` ~505-548). */
function manifestFor(review: UnknownCallReviewInputV1, inputText: string): PreparedTaskManifestV1 {
  const total = Buffer.byteLength(inputText, 'utf8');
  const assembly: ContextAssemblyBindingV1 = { ...CONTEXT_ASSEMBLY, totalBytes: total,
    sections: CONTEXT_ASSEMBLY.sections.map(section => section.name === 'unknown_call_review'
      && section.startByte === REVIEW_SECTION_START ? { ...section, endByte: total } : section) };
  return {
    schemaVersion: 1, kind: 'task_execution', claim: CLAIM,
    role: { status: 'absent', roleId: 'k335-pure-role',
      reason: 'the pure manifest skeleton installs no role spec' },
    hostTemplate: null, roleBinding: ROLE_BINDING,
    hostConfigurationRevision: 'k335-pure-host@1', sessionRole: SESSION_ROLE,
    workspaceSnapshot: { workspaceId: WORKSPACE, revision: 3 },
    permissions: PERMISSIONS, budget: BUDGET,
    selectedTaskInputs: [{ requirementId: 'k335-pure-requirement', ref: CAPTURE_REF }],
    materialBasis: { planRef: PLAN_REF, workspaceRevision: 3, sourceDigest: sha256Hex('k335-pure-source') },
    materialAccessRefs: [], additionalMaterialRefs: [], deliveryRefs: [], sourceRefs: SOURCE_REFS,
    contextAssembly: assembly, takesSessionHistory: false, promptSet: PROMPT_SET,
    continuationBrief: CONTINUATION_BRIEF,
    sessionBasis: { sourceKernelSessionId: 'k335-pure-source-kernel', throughPosition: 4 },
    workspaceBaseline: { status: 'captured', ref: BASELINE_REF, digest: BASELINE_REF.digest },
    unknownCallReview: review,
    blockedCommands: [{ reviewRunId: RUN_REF.runId, alias: 1, commandSha256: sha256Hex('k335-pure-command') }],
    input: inputText, inputDigest: sha256Hex(inputText),
  };
}

/** Exactly production: the whole manifest, with the nonempty base prefix + rendered review. */
const measure = (review: UnknownCallReviewInputV1, rendered: string): number =>
  Buffer.byteLength(JSON.stringify(manifestFor(review, BASE_INPUT + rendered)), 'utf8');

describe('K3-35 (一) pure 32-item renderer/codec extreme', () => {
  it('K3-35 (一): the 32-item input trims sample, then notVisible, then items from the back; all aliases stay', () => {
    const built = buildUnknownCallReviewInputV1({
      review: REVIEW, reviewRef: REVIEW.ref, phase: 'review', round: 1,
      commandFacts: COMMAND_FACTS, fullChanges: [...FULL_CHANGES],
    });
    // Two independent preconditions: the un-trimmed render is over the 65,536
    // instruction budget AND the un-trimmed whole manifest is over 262,144.
    const rawRendered = renderUnknownCallReviewZh(built);
    const rawManifest = JSON.stringify(manifestFor(built, BASE_INPUT + rawRendered));
    expect(Buffer.byteLength(rawRendered, 'utf8')).toBeGreaterThan(INSTRUCTION_MAX_BYTES);
    expect(Buffer.byteLength(rawManifest, 'utf8')).toBeGreaterThan(MANIFEST_MAX_BYTES);
    // The input starts at the full extreme: 32 items, 200 paths, 32 notVisible.
    expect(built.items).toHaveLength(ITEM_COUNT);
    expect(built.items.map(item => item.alias)).toEqual(ITEMS.map(item => item.alias));
    expect(built.workspace.changedSample).toHaveLength(200);
    expect(built.workspace.changedOmitted).toBe(0);
    expect(built.workspace.notVisible).toHaveLength(32);
    expect(built.workspace.notVisibleOmitted).toBe(0);
    // Every expanded item is truncated to the 4 KiB command budget.
    for (const item of built.items) {
      expect(item.display).toBe('truncated');
      expect(item.toolName).toBe('shell');
      expect(Buffer.byteLength(item.command?.text ?? '', 'utf8')).toBeLessThanOrEqual(4096);
    }
    // D8: no Kernel callId in the structured input or its render.
    const builtJson = JSON.stringify(built);
    for (const callId of CALL_IDS) expect(builtJson).not.toContain(callId);
    expect(builtJson).not.toContain('callId');
    expect(renderUnknownCallReviewZh(built)).not.toContain('k335-callid-');

    // Capture every production state the render/measure loop visits, in order.
    const states: UnknownCallReviewInputV1[] = [];
    const seen = new Set<UnknownCallReviewInputV1>();
    const note = (review: UnknownCallReviewInputV1): void => {
      if (!seen.has(review)) { seen.add(review); states.push(review); }
    };
    const result = fitUnknownCallReviewForManifest({
      review: built,
      render: review => { note(review); return renderUnknownCallReviewZh(review); },
      measure: (review, rendered) => { note(review); return measure(review, rendered); },
      instructionMaxBytes: INSTRUCTION_MAX_BYTES,
      manifestMaxBytes: MANIFEST_MAX_BYTES,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`the 32-item input must fit: ${result.reason}`);
    const fitted = result.review;
    const rendered = result.rendered;
    expect(states[0]).toBe(built);

    // L13 order, state by state: changed sample from the back (200 steps), then
    // notVisible from the back (32 steps), then the last expanded item (>=1).
    // Each list stays a prefix of its input; nothing else changes.
    let sampleTrims = 0;
    let notVisibleTrims = 0;
    let itemTrims = 0;
    for (let index = 1; index < states.length; index += 1) {
      const previous = states[index - 1];
      const next = states[index];
      if (previous === undefined || next === undefined) throw new Error('a trim state is missing');
      expect(next.workspace.changedSample)
        .toEqual(FULL_CHANGES.slice(0, next.workspace.changedSample.length));
      expect(next.workspace.notVisible)
        .toEqual(NOT_VISIBLE.slice(0, next.workspace.notVisible.length));
      if (previous.workspace.changedSample.length > 0) {
        expect(next.workspace.changedSample).toEqual(previous.workspace.changedSample.slice(0, -1));
        expect(next.workspace.changedOmitted).toBe(previous.workspace.changedOmitted + 1);
        expect(next.workspace.notVisible).toEqual(previous.workspace.notVisible);
        expect(next.items).toEqual(previous.items);
        sampleTrims += 1;
        continue;
      }
      if (previous.workspace.notVisible.length > 0) {
        expect(next.workspace.changedSample).toEqual([]);
        expect(next.workspace.notVisible).toEqual(previous.workspace.notVisible.slice(0, -1));
        expect(next.workspace.notVisibleOmitted).toBe(previous.workspace.notVisibleOmitted + 1);
        expect(next.items).toEqual(previous.items);
        notVisibleTrims += 1;
        continue;
      }
      const lastExpanded = [...previous.items].reverse().find(item => item.display !== 'unexpanded');
      if (lastExpanded === undefined) throw new Error('no expanded item is left to trim');
      const at = previous.items.indexOf(lastExpanded);
      expect(next.workspace).toEqual(previous.workspace);
      expect(next.items.map(item => item.alias)).toEqual(previous.items.map(item => item.alias));
      next.items.forEach((item, itemIndex) => {
        if (itemIndex === at) {
          expect(item).toMatchObject({ alias: lastExpanded.alias, display: 'unexpanded',
            command: null, cwd: null, current: null });
        } else {
          expect(item).toEqual(previous.items[itemIndex]);
        }
      });
      itemTrims += 1;
    }
    expect(sampleTrims).toBe(200);
    expect(notVisibleTrims).toBe(32);
    expect(itemTrims).toBeGreaterThan(0);

    // The fitted state is under both literal budgets and one step earlier was
    // over one of them: no extra trim was taken.
    expect(Buffer.byteLength(rendered, 'utf8')).toBeLessThanOrEqual(INSTRUCTION_MAX_BYTES);
    expect(measure(fitted, rendered)).toBeLessThanOrEqual(MANIFEST_MAX_BYTES);
    const beforeLast = states[states.length - 2];
    if (beforeLast === undefined) throw new Error('the fit must have trimmed at least once');
    const beforeRendered = renderUnknownCallReviewZh(beforeLast);
    expect(measure(beforeLast, beforeRendered) > MANIFEST_MAX_BYTES
      || Buffer.byteLength(beforeRendered, 'utf8') > INSTRUCTION_MAX_BYTES).toBe(true);

    // The measure really covers the WHOLE manifest: every top-level field is
    // present, and the measured bytes are the rendered review after a nonempty
    // base prefix whose `unknown_call_review` section ends at the input's end.
    const measured = manifestFor(fitted, BASE_INPUT + rendered);
    expect(Object.keys(measured).sort()).toEqual([
      'additionalMaterialRefs', 'blockedCommands', 'budget', 'claim', 'contextAssembly',
      'continuationBrief', 'deliveryRefs', 'hostConfigurationRevision', 'hostTemplate', 'input',
      'inputDigest', 'kind', 'materialAccessRefs', 'materialBasis', 'permissions', 'promptSet', 'role',
      'roleBinding', 'schemaVersion', 'selectedTaskInputs', 'sessionBasis', 'sessionRole',
      'sourceRefs', 'takesSessionHistory', 'unknownCallReview', 'workspaceBaseline', 'workspaceSnapshot',
    ].sort());
    expect(measured.input).toBe(BASE_INPUT + rendered);
    expect(measured.inputDigest).toBe(sha256Hex(measured.input));
    const measuredAssembly = measured.contextAssembly;
    if (measuredAssembly === undefined) throw new Error('the measured manifest must carry the context assembly');
    expect(measuredAssembly.totalBytes).toBe(Buffer.byteLength(measured.input, 'utf8'));
    expect(measuredAssembly.sections.find(section => section.name === 'unknown_call_review'))
      .toMatchObject({ startByte: REVIEW_SECTION_START,
        endByte: Buffer.byteLength(measured.input, 'utf8'), omitted: 0 });

    // All 32 aliases survive, in Kernel order; expanded items are a prefix and
    // every later item is `unexpanded` (alias + tool name only).
    expect(fitted.items).toHaveLength(ITEM_COUNT);
    expect(fitted.items.map(item => item.alias)).toEqual(ITEMS.map(item => item.alias));
    const displays = fitted.items.map(item => item.display);
    expect(displays[0]).toBe('truncated');
    expect(displays[displays.length - 1]).toBe('unexpanded');
    const firstUnexpanded = displays.indexOf('unexpanded');
    expect(displays.slice(0, firstUnexpanded).every(display => display === 'truncated')).toBe(true);
    expect(displays.slice(firstUnexpanded).every(display => display === 'unexpanded')).toBe(true);
    // The whole sample and notVisible were what had to go first.
    expect(fitted.workspace.changedSample).toEqual([]);
    expect(fitted.workspace.changedOmitted).toBe(200);
    expect(fitted.workspace.notVisible).toEqual([]);
    expect(fitted.workspace.notVisibleOmitted).toBe(32);

    // D8 again on the fitted structured input and its render.
    const fittedJson = JSON.stringify(fitted);
    for (const callId of CALL_IDS) expect(fittedJson).not.toContain(callId);
    expect(fittedJson).not.toContain('callId');
    expect(rendered).not.toContain('k335-callid-');
    expect(fitted.items.every(item => !('callId' in item))).toBe(true);

    // The fitted render keeps every alias and tool name; an unexpanded item is
    // the fixed sentence, an expanded one keeps the truncated command.
    for (const item of fitted.items) {
      expect(item.toolName).toBe('shell');
      expect(rendered).toContain(`- #${String(item.alias)} shell`);
      if (item.display === 'unexpanded') {
        expect(rendered).toContain(`- #${String(item.alias)} shell：没展开，按判断不了处理。`);
      } else {
        expect(item.command).not.toBeNull();
        expect(item.command!.truncated).toBe(true);
      }
    }
    // The WHOLE measured manifest excludes the Kernel callIds, not just the
    // rendered/fitted review sub-object.
    const measuredJson = JSON.stringify(measured);
    for (const callId of CALL_IDS) expect(measuredJson).not.toContain(callId);
  });
});
