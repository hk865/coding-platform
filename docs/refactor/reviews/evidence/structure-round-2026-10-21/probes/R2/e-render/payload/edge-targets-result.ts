/**
 * Copy-only edge adapter, RESULT variant: the wrapped functions live in
 * `src/core/agent-runtime/context-rendering.ts`, `context-fact-text.ts`, and the
 * nested `generalWarningLabel` still in `note-read-model.ts`. The installer
 * writes this file as `tests/probes/edge-targets.ts` and asserts every import
 * anchor exists before writing. The record shape and case list are the base
 * variant's.
 */
import {
  probeRenderAttentionChanges, probeRenderContext, probeRenderQueryContext,
} from '../../src/core/agent-runtime/context-rendering.js';
import {
  probeAnnotations, probeDeclarationsForTask, probeEffectiveDuty, probeGoalPayload,
  probeMissingInputReminder, probeNoteSourcesOf, probeNotImplementedExtensions,
  probeOptionalRowsFromExtensions, probeQueryFocusLines, probeQueryPlanSummary,
  probeRolePayload, probeTaskPayload, probeTopLevelModuleCards,
} from '../../src/core/agent-runtime/context-fact-text.js';
import { createNoteReadModel, probeGeneralWarningLabel } from '../../src/core/work-graph/notes/note-read-model.js';
import { serializeProbe } from '../../src/probe-hook.js';

let noteModelReady = false;
function ensureNoteModel(): void {
  if (noteModelReady) return;
  createNoteReadModel({ records: {} } as never);
  noteModelReady = true;
}

export { serializeProbe };

const QUERY_PRELUDE = '# Verified read-only Query input\n\nThis is the current bounded Query context assembled from formal platform facts; it is not a transcript.';

/** Base recorded one renderer; the result's Query path is renderQueryContext. */
function asQueryInput(input: {
  prelude: string; required: unknown; optional?: Record<string, unknown>; residentBudgetBytes: number;
}): unknown {
  const hasFootprint = input.optional !== undefined
    && Object.prototype.hasOwnProperty.call(input.optional, 'footprint');
  return {
    templateId: hasFootprint ? 'query-planning-input' : 'query-copy-input',
    prelude: input.prelude,
    required: input.required,
    optional: hasFootprint ? { footprint: input.optional!['footprint'] } : {},
    residentBudgetBytes: input.residentBudgetBytes,
  };
}

export function runProbe(probe: string, args: unknown[]): unknown {
  switch (probe) {
    case 'renderContext': {
      const input = args[0] as { prelude?: string } | undefined;
      if (input !== undefined && input.prelude === QUERY_PRELUDE) {
        return probeRenderQueryContext(asQueryInput(input as never) as never);
      }
      return probeRenderContext(input as never);
    }
    case 'renderQueryContext': return probeRenderQueryContext(args[0] as never);
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
