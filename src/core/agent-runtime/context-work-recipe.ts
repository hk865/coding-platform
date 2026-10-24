import { messageOf } from '../../contracts/error-message.js';
import { rejected } from '../../contracts/core/rejections.js';
import { packString } from '../../contracts/prompts/pack-string.js';
import type { ArtifactRef } from '../../contracts/artifact.js';
import {
  ContinuationBriefCapacityError, continuationBriefDigest, renderContinuationBriefZh,
  type ContinuationBriefV1,
} from '../../contracts/continuation-brief.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { ArchitectureReminderFactsV1 } from '../../contracts/architecture-observation.js';
import type { PreparedTaskManifestV1, UnknownCallReviewInputV1 } from '../../contracts/core/prepared-execution.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { TaskTriple } from '../../contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../contracts/fingerprint.js';
import type {
  ContextAssemblyBindingV1, ContextSourceV1, InputSelectionV1, TaskInputPageV1,
} from '../../contracts/graph-context.js';
import { goalContextDigestV1 } from '../../contracts/graph-context.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';
import type { PromptTextsV1 } from '../../contracts/prompts/prompt-set.js';
import type { RoleSpecResolutionV1 } from '../../contracts/role-spec-materials.js';
import type { TaskEnvelopeV1 } from '../../contracts/task-envelope.js';
import type { SessionAnomalyAnchorRef } from '../../contracts/session-anomaly.js';
import type { UnknownCallReviewV1 } from '../../contracts/unknown-call-review.js';
import type { TaskExecutionRecord } from '../work-graph/model/execution-read-contracts.js';
import type { GraphContextFactsV1 } from '../work-graph/model/graph-context-contracts.js';
import {
  ARCHITECTURE_REMINDER_UNAVAILABLE_KEY, architectureReminderRowEntries,
} from './architecture-reminders.js';
import { assembleBriefForContext } from './context-continuation-recipe.js';
import {
  annotations, effectiveDuty, goalPayload, missingInputReminder, noteSourcesOf,
  notImplementedExtensions, optionalRowsFromExtensions, rolePayload, taskPayload,
} from './context-fact-text.js';
import {
  CONTEXT_FORMAT_VERSION, renderContext, sectionOrderFor, workContextPrelude,
} from './context-rendering.js';
import { takesSessionHistoryOf } from './context-history-facts.js';
import { assembleReviewForContext } from './context-review-recipe.js';
import { canonical, requirementIdOf, sortedSources } from './context-support.js';
import type {
  AssembledContextV1, ContextAssemblerDependencies, ContextWorkHistoryInputV1, OptionalRow,
} from './context-types.js';
import type { ResolvedRuntimeConfiguration } from './execution-contracts.js';

export async function assembleWorkContext(
  deps: ContextAssemblerDependencies, clock: (() => string) | undefined, ctx: CoreCallContext,
  input: {
    execution: TaskExecutionRecord; role: Exclude<RoleSpecResolutionV1, { status: 'inadmissible' }>;
    configuration: ResolvedRuntimeConfiguration;
    permissions: TaskEnvelopeV1['permissions'];
    /** Rework 1 item 1: the ONE Task review-record read `prepare` made. */
    taskReviews?: readonly UnknownCallReviewV1[];
    /** The resolved pack (ruling 14); absent keeps the generated pack. */
    texts?: PromptTextsV1;
    /** The frozen `PromptSetV1.toolNames` (ruling 10/16). */
    toolNames: readonly string[];
    /** Ruling 14 C6: the real completed boundary Q read once at preparation. */
    history: ContextWorkHistoryInputV1;
  },
): Promise<ReadResult<AssembledContextV1>> {
  const texts = input.texts ?? PLATFORM_PROMPT_PACK_V1;
  const S = (key: string): string => packString(texts, key);
  const execution = input.execution;
  const run = execution?.run;
  const claim = execution?.outbox?.claim;
  const plan = execution?.plan;
  const session = execution?.session;
  const residentBudgetBytes = typeof input.configuration?.contextResidentBytes === 'number'
    && Number.isSafeInteger(input.configuration.contextResidentBytes) && input.configuration.contextResidentBytes >= 0
    ? input.configuration.contextResidentBytes : 4096;
  const dutyResult = effectiveDuty(input.role, input.configuration, session?.role, texts);
  if ('rejection' in dutyResult) return dutyResult.rejection;
  const duty = dutyResult.duty;
  const cancelled = (reason: string): CoreRejection => rejected('cancelled', reason);

  let facts: GraphContextFactsV1 | null = null;
  if (deps.graphContext !== undefined && claim !== undefined) {
    let read: ReadResult<GraphContextFactsV1>;
    try {
      read = await deps.graphContext.readContextFacts(ctx, {
        goalRef: { aggregateType: 'Goal', projectId: claim.task.projectId, goalId: claim.task.goalId },
        planRef: claim.planRef,
        focusTaskIds: [claim.task.taskId],
        includeInputs: true,
      });
    } catch (error) {
      return rejected('unavailable', `the graph context read failed: ${messageOf(error)}`);
    }
    if (read.status !== 'ready') return read;
    facts = read.value;
  }
  const graphContextMissing = deps.graphContext === undefined;
  const extensions = facts?.extensions ?? notImplementedExtensions();
  const workspaceRevision = run?.workspaceSnapshot?.revision ?? 0;

  const roleSection = rolePayload(input.role, input.permissions, duty, residentBudgetBytes, texts);
  const goalSection = graphContextMissing || facts === null
    ? S('context.work.goalNotLoaded')
    : goalPayload(facts.goal, workspaceRevision, extensions, texts);
  const taskSection = plan === undefined || claim === undefined ? null : taskPayload(plan, execution, facts?.graph ?? null, texts);

  const extensionRows = optionalRowsFromExtensions(extensions, texts);
  const reminders: OptionalRow[] = [];
  // §4.3/G5.3: an unassembled extension is reported as not connected whenever
  // the projection says `not_implemented`, with or without the graph port.
  if (extensions.notes.availability === 'not_implemented') {
    reminders.push({ key: 'note:not_implemented', text: S('context.work.notesNotConnected') });
  }
  if (extensions.anomalies.availability === 'not_implemented') {
    reminders.push({ key: 'anomaly:not_implemented', text: S('context.work.anomaliesNotConnected') });
  }
  reminders.push(...extensionRows.reminders);

  // L8 (book ruling 12, interface §8): the stale-architecture rows share the
  // reminder section. Only a configured reader and a claim take the read; the
  // workspace and the task module are resolved exactly as `taskPayload` does.
  // Lead ruling (a failed reminder read): any failure except cancellation shows
  // the single honest row and lets the preparation continue; a `cancelled`
  // rejection still cancels and is returned unchanged.
  if (deps.architectureReminders !== undefined && claim !== undefined) {
    if (clock === undefined) {
      return rejected('unsupported', 'the context assembler needs the Host clock to assemble architecture reminders');
    }
    const workspaceId = session?.workspaceId ?? run?.workspaceSnapshot?.workspaceId
      ?? plan?.goalRef.projectId ?? claim.task.projectId;
    const task = plan?.tasks.find((candidate) => candidate.taskId === claim.task.taskId);
    const taskModuleRef = task?.scope.kind === 'module'
      ? { projectId: plan?.ref.projectId ?? claim.task.projectId, moduleId: task.scope.moduleRef }
      : null;
    const unavailable = (): void => {
      reminders.push({ key: ARCHITECTURE_REMINDER_UNAVAILABLE_KEY, text: S('context.work.remindersUnavailable') });
    };
    const cancelledReminder = (): CoreRejection =>
      cancelled('the architecture reminder read was cancelled');
    let reminderRead: ReadResult<ArchitectureReminderFactsV1> | null = null;
    try {
      reminderRead = await deps.architectureReminders.read(ctx, {
        projectId: claim.task.projectId, workspaceId,
      });
    } catch {
      // Cancellation wins over the fallback row: never downgrade an aborted
      // preparation into one "unavailable" reminder.
      if (ctx.signal.aborted) return cancelledReminder();
      unavailable();
    }
    if (reminderRead !== null) {
      // A returned cancellation OR a signal cancelled while the read resolved
      // ends the preparation; every other failure is the one honest row.
      if (reminderRead.status === 'rejected' && reminderRead.code === 'cancelled') return reminderRead;
      if (ctx.signal.aborted) return cancelledReminder();
      if (reminderRead.status === 'ready') {
        const now = clock();
        for (const row of architectureReminderRowEntries({
          facts: reminderRead.value, taskModuleRef, now, texts,
        })) {
          reminders.push({ key: row.key, text: row.text });
        }
      } else {
        unavailable();
      }
    }
  }

  const inputSelections: InputSelectionV1[] = facts?.inputs ?? [];
  const missingSelections = inputSelections.filter((selection) => selection.state !== 'selected');
  // §4.1/G5.4: `facts.executions` holds only the focus Task's Run, so a bounded
  // second read obtains each missing declaration's upstream Task facts; it
  // never opens materials.
  let upstreamExecutions: readonly TaskExecutionRecord[] = facts?.executions ?? [];
  const upstreamTaskIds = [...new Set(missingSelections
    .map((selection) => selection.declaration.upstream)
    .filter((upstream): upstream is TaskTriple => upstream !== null)
    .map((upstream) => upstream.taskId))].sort();
  if (deps.graphContext !== undefined && claim !== undefined && upstreamTaskIds.length > 0) {
    let enriched: ReadResult<GraphContextFactsV1>;
    try {
      enriched = await deps.graphContext.readContextFacts(ctx, {
        goalRef: { aggregateType: 'Goal', projectId: claim.task.projectId, goalId: claim.task.goalId },
        planRef: claim.planRef,
        focusTaskIds: upstreamTaskIds,
        includeInputs: false,
      });
    } catch (error) {
      if (ctx.signal.aborted) return cancelled('the preparation was cancelled during the upstream graph context read');
      enriched = rejected('unavailable', `the upstream graph context read failed: ${messageOf(error)}`);
    }
    if (ctx.signal.aborted) return cancelled('the preparation was cancelled during the upstream graph context read');
    // Ruling 4 (C-1): the upstream read supports cancellation; its explicit
    // `cancelled` answer ends the preparation even when the signal is clear.
    if (enriched.status === 'rejected' && enriched.code === 'cancelled') return enriched;
    // The reminder index is optional enrichment; a bounded read that cannot
    // return the upstream Runs leaves the message at the honest
    // "no current execution record" fallback instead of blocking entry.
    if (enriched.status === 'ready') upstreamExecutions = enriched.value.executions;
  }
  for (const selection of missingSelections) {
    reminders.push(missingInputReminder(selection, upstreamExecutions, texts));
  }

  const inputRows: OptionalRow[] = [];
  if (claim !== undefined && deps.taskInputs !== undefined) {
    for (const selection of inputSelections) {
      if (selection.state !== 'selected' || selection.source === null) continue;
      const candidateKey = sha256Hex(canonicalJson(selection.source as unknown as JsonValue));
      let page: ReadResult<TaskInputPageV1>;
      try {
        page = await deps.taskInputs.readTaskInputPage(ctx, {
          consumer: claim.task, planRef: claim.planRef, declarationId: selection.declaration.declarationId,
          candidateKey, afterCursor: null, maxBytes: 4096,
        });
      } catch (error) {
        if (ctx.signal.aborted) return cancelled('the preparation was cancelled during the task input page read');
        return rejected('unavailable', `the task input page read failed: ${messageOf(error)}`);
      }
      if (ctx.signal.aborted) return cancelled('the preparation was cancelled during the task input page read');
      if (page.status !== 'ready') return page;
      const pageSelection = page.value.selection;
      if (pageSelection.state !== 'selected' || pageSelection.source === null) {
        // The owner returned an item-level missing/unavailable state as ready:
        // render that state and never a fake selected row.
        reminders.push(missingInputReminder(pageSelection, upstreamExecutions, texts));
        continue;
      }
      if (sha256Hex(canonicalJson(pageSelection.source as unknown as JsonValue)) !== candidateKey) {
        return rejected('revision_conflict', `the input ${selection.declaration.declarationId} changed while its first page was read`);
      }
      inputRows.push({
        key: selection.declaration.declarationId,
        text: canonical({
          declarationId: selection.declaration.declarationId, source: pageSelection.source,
          usage: pageSelection.usage, bodyExcerpt: page.value.body, more: page.value.nextCursor !== null,
        }, '{}'),
      });
    }
  }

  let continuationBrief: ContinuationBriefV1 | null = null;
  let sessionBasis: PreparedTaskManifestV1['sessionBasis'] | undefined;
  let continuationSuffix: string | null = null;
  let reviewSuffix: string | null = null;
  let anomalyAnchorRefs: SessionAnomalyAnchorRef[] | null = null;
  let unknownCallReview: UnknownCallReviewInputV1 | undefined;
  if (run?.requeueRef !== undefined) {
    if (clock === undefined) {
      return rejected('unsupported', 'the context assembler needs the Host clock to assemble a continuation brief');
    }
    const assembled = await assembleBriefForContext(deps, clock, ctx, execution, input.taskReviews);
    if (ctx.signal.aborted) return cancelled('the preparation was cancelled during the continuation brief assembly');
    if (!assembled.ok) return assembled.rejection;
    continuationBrief = assembled.brief;
    sessionBasis = assembled.sessionBasis === null ? undefined : assembled.sessionBasis;
    anomalyAnchorRefs = assembled.anomalyAnchorRefs;
    // Slice 1 N7 (§2.7): the anomaly section is budgeted; when even the mandatory content cannot fit the
    // 16 KiB brief the preparation is refused `capacity`, never rendered truncated or thrown out of the port.
    try {
      continuationSuffix = renderContinuationBriefZh(
        continuationBrief, continuationBriefDigest(continuationBrief), texts, input.toolNames);
    } catch (error) {
      if (error instanceof ContinuationBriefCapacityError) return rejected('capacity', error.message);
      throw error;
    }
  }

  // K3 L13: a review-purpose Run renders the review instruction as its own
  // `unknown_call_review` section in the frozen order and carries it
  // structurally; its history source is the original Run (L12), never a
  // TaskRequeue.
  const reviewPurpose = run?.purpose?.kind === 'unknown_call_review' ? run.purpose : undefined;
  if (reviewPurpose !== undefined) {
    const assembledReview = await assembleReviewForContext(
      deps, ctx, execution, reviewPurpose, texts, input.toolNames);
    if (!assembledReview.ok) return assembledReview.rejection;
    // R1: the review text is its own `unknown_call_review` section in the frozen
    // order, never the continuation section; review and continuation are
    // mutually exclusive.
    reviewSuffix = assembledReview.text;
    unknownCallReview = assembledReview.review;
    sessionBasis = assembledReview.sessionBasis;
  }

  // Ruling 14: the ONE pure mode rule decides from the seed fixed above and the
  // Session's stored cursor; the recipe never reads a Kernel boundary.
  const takesSessionHistory = takesSessionHistoryOf({
    callKind: 'work',
    sessionBasis,
    hasCompletedCursor: input.history.hasCompletedCursor,
  });
  const callKind = continuationSuffix === null ? 'work' : 'continuation';
  const sectionOrder = sectionOrderFor(callKind, 'work-input', texts);
  const rendered = renderContext({
    prelude: workContextPrelude(texts),
    required: { role: roleSection, goal: goalSection, task: taskSection },
    optional: {
      footprint: extensionRows.footprint, notes: extensionRows.notes, reminders, inputs: inputRows,
    },
    continuationSuffix,
    reviewSuffix,
    residentBudgetBytes,
    sectionOrder,
    toolNames: input.toolNames,
    takesSessionHistory,
    texts,
  });

  const selectedTaskInputs = inputSelections
    .filter((selection) => selection.state === 'selected' && selection.source?.kind === 'artifact')
    .map((selection) => ({
      requirementId: requirementIdOf(selection.declaration.declarationId),
      ref: (selection.source as Extract<InputSelectionV1['source'], { kind: 'artifact' }>).ref as ArtifactRef,
    }))
    .sort((left, right) => (left.requirementId < right.requirementId ? -1 : left.requirementId > right.requirementId ? 1 : 0));

  // §4.3/G (wiring 1 W1-CTX-01, L2): the Work binding replaces only this claim
  // Goal's `record` source digest with the Goal-record content the Goal section
  // shows. Map first, then sort, so the digest takes part in the canonical key.
  const bindingSources = (facts?.sources ?? []).map((source): ContextSourceV1 => {
    if (facts === null || claim === undefined) return source;
    if (source.kind !== 'record' || source.ref.aggregateType !== 'Goal') return source;
    if (source.ref.projectId !== claim.task.projectId || source.ref.goalId !== claim.task.goalId) return source;
    return { ...source, digest: goalContextDigestV1(facts.goal) };
  });
  // §11.4/L20: only the general rows that actually fit the notes budget are
  // rendered, so they are the only general note sources recorded.
  const generalOmitted = rendered.sections.find((section) => section.name === 'notes')?.omitted ?? 0;
  const keptGeneral = extensions.notes.general
    .slice(0, Math.max(0, extensions.notes.general.length - generalOmitted));
  const noteSources = noteSourcesOf(extensions.notes, keptGeneral, texts);

  const binding: ContextAssemblyBindingV1 = {
    schemaVersion: 1,
    formatVersion: CONTEXT_FORMAT_VERSION,
    callKind,
    sectionOrder,
    duty,
    residentBudgetBytes,
    residentBytes: rendered.residentBytes,
    totalBytes: rendered.totalBytes,
    sections: rendered.sections,
    sources: sortedSources([...bindingSources, ...noteSources]),
    inputSelections: [...inputSelections],
    extensions: annotations(extensions),
  };
  return {
    status: 'ready',
    value: { input: rendered.input, binding, continuationBrief, sessionBasis, selectedTaskInputs,
      ...(anomalyAnchorRefs === null ? {} : { anomalyAnchorRefs }),
      ...(unknownCallReview === undefined ? {} : { unknownCallReview }),
      takesSessionHistory, renderMaterial: rendered.material },
  };
}
