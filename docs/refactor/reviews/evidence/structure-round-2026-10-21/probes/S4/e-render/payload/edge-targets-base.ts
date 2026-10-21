/**
 * Copy-only edge adapter, BASE variant: all wrapped functions still live in
 * `src/core/agent-runtime/context-assembler.ts`; `generalWarningLabel` is nested
 * in `createNoteReadModel` in `note-read-model.ts`. The installer writes this
 * file as `tests/probes/edge-targets.ts`.
 */
import {
  probeAnnotations, probeDeclarationsForTask, probeEffectiveDuty, probeGoalPayload,
  probeMissingInputReminder, probeNoteSourcesOf, probeNotImplementedExtensions,
  probeOptionalRowsFromExtensions, probeQueryFocusLines, probeQueryPlanSummary,
  probeRenderAttentionChanges, probeRenderContext, probeRolePayload, probeTaskPayload,
  probeTopLevelModuleCards,
} from '../../src/core/agent-runtime/context-assembler.js';
import { createNoteReadModel, probeGeneralWarningLabel } from '../../src/core/work-graph/notes/note-read-model.js';
import { serializeProbe } from '../../src/probe-hook.js';

let noteModelReady = false;
function ensureNoteModel(): void {
  if (noteModelReady) return;
  // Edge-only instance: the factory only closes over `deps`; `generalWarningLabel`
  // touches no dependency. The suite registers the same nested implementation
  // through the real assembler's read model.
  createNoteReadModel({ records: {} } as never);
  noteModelReady = true;
}

export { serializeProbe };

/** base has one renderer; the result's Query renderer maps onto it. */
function baseQueryInput(input: {
  templateId?: string; prelude: string; required: unknown; optional?: unknown; residentBudgetBytes: number;
}): unknown {
  return {
    prelude: input.prelude,
    required: input.required,
    // base Query assembly passes footprint ONLY on the planning template; the
    // copy template has no footprint slot at all.
    optional: input.templateId === 'query-planning-input' ? (input.optional ?? {}) : {},
    continuationSuffix: null,
    reviewSuffix: null,
    residentBudgetBytes: input.residentBudgetBytes,
  };
}

export function runProbe(probe: string, args: unknown[]): unknown {
  switch (probe) {
    case 'renderContext': return probeRenderContext(args[0] as never);
    case 'renderQueryContext': return probeRenderContext(baseQueryInput(args[0] as never) as never);
    case 'renderAttentionChanges': return probeRenderAttentionChanges(args[0] as never);
    case 'fact.effectiveDuty': return probeEffectiveDuty(args[0] as never, args[1] as never, args[2] as never);
    case 'fact.rolePayload': return probeRolePayload(args[0] as never, args[1] as never, args[2] as never, args[3] as number);
    case 'fact.goalPayload': return probeGoalPayload(args[0] as never, args[1] as number, args[2] as never);
    case 'fact.taskPayload': return probeTaskPayload(args[0] as never, args[1] as never, args[2] as never);
    case 'fact.queryFocusLines': return probeQueryFocusLines(args[0] as never, args[1] as never);
    case 'fact.queryPlanSummary': return probeQueryPlanSummary(args[0] as never);
    case 'fact.notImplementedExtensions': return probeNotImplementedExtensions();
    case 'fact.noteSourcesOf': return probeNoteSourcesOf(args[0] as never, args[1] as never);
    case 'fact.declarationsForTask': return probeDeclarationsForTask(args[0] as never, args[1] as string);
    case 'fact.missingInputReminder': return probeMissingInputReminder(args[0] as never, args[1] as never);
    case 'fact.optionalRowsFromExtensions': return probeOptionalRowsFromExtensions(args[0] as never);
    case 'fact.annotations': return probeAnnotations(args[0] as never);
    case 'fact.topLevelModuleCards': return probeTopLevelModuleCards(args[0] as never);
    case 'note.generalWarningLabel':
      ensureNoteModel();
      return probeGeneralWarningLabel(args[0] as never, args[1] as never);
    default: throw new Error('unknown probe: ' + probe);
  }
}
