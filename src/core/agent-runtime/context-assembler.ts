/**
 * The context assembler entry point (slice 3 §4.2–§4.5): the frozen public
 * surface plus the dependency wiring of `createContextAssembler`. The assembly
 * recipes live in the neighbouring `context-*` modules.
 */
import { rejected } from '../../contracts/core/rejections.js';
import type { ContextAssembler, ContextAssemblerDependencies, ContextClock } from './context-types.js';
import { assembleQueryContext } from './context-query-recipe.js';
import { assembleWorkContext } from './context-work-recipe.js';

export type { AttentionGraphReadRequestV1 } from '../../contracts/graph-context.js';
export type {
  ArchitectureReminderReadPort, AssembledContextV1, ContextAssembler, ContextAssemblerDependencies,
} from './context-types.js';
export {
  ATTENTION_HEADER, ATTENTION_MAX_BYTES, CONTEXT_FORMAT_VERSION,
  CONTEXT_SECTION_ORDER, renderAttentionChanges, renderContext,
} from './context-rendering.js';
export {
  REVIEW_COMMAND_MAX_BYTES, buildUnknownCallReviewInputV1, trimUnknownCallReviewInput,
  type ReviewCommandFactV1,
} from './context-review-input.js';
export { briefWorkspaceFactsFor, type BriefWorkspaceFactsOutcome } from './context-workspace-facts.js';
export { archiveOriginSkipsHistorySeed, readKernelCommandFacts, runEnteredKernel } from './context-history-facts.js';
export { readTaskBlockedCommands } from './context-continuation-recipe.js';

export function createContextAssembler(deps: ContextAssemblerDependencies): ContextAssembler {
  const clock = (deps as ContextAssemblerDependencies & ContextClock).now;
  return {
    assembleTask(ctx, input) { return assembleWorkContext(deps, clock, ctx, input); },
    assembleQuery(ctx, input) { return assembleQueryContext(deps, ctx, input); },
    async readAttentionGraph(ctx, request) {
      if (deps.graphContext === undefined) {
        return rejected('unsupported', 'the graph context reader is not configured');
      }
      return deps.graphContext.readAttentionFacts(ctx, request);
    },
  };
}
