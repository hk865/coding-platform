/**
 * The Query contexts the Runtime hands to its tool factories while a real round runs (rule sheet A3): the real
 * factory is called with the real input and its tools are returned unchanged; the wrapper only keeps the context, so
 * a test can act as that running Query (for a request round, the Runtime's own `query_run` principal). Nothing is
 * built here: every context is one the Runtime itself made.
 * - `captureQueryContexts` wraps the graph and note tool factories and keeps a copy of each context.
 * - `captureAnswerContexts` wraps the answer tools, which every planning or consultation round opens (B20) whatever
 *   its grants, and keeps each context as given (with the Runtime's signal), found by its QueryRun.
 */
import { vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import * as answerTools from '../../src/core/agent-runtime/answer-tools.js';
import * as noteTools from '../../src/core/agent-runtime/note-tool.js';
import * as toolGroupAssembly from '../../src/core/agent-runtime/tool-group-assembly.js';

export function captureQueryContexts(): { latest(): CoreCallContext; restore(): void } {
  const contexts: CoreCallContext[] = [];
  const original = toolGroupAssembly.createQueryGraphToolGroup;
  const spy = vi.spyOn(toolGroupAssembly, 'createQueryGraphToolGroup').mockImplementation(input => {
    contexts.push(structuredClone(input.context));
    return original(input);
  });
  // A round granted no graph tool (the planning adviser) opens only the note group.
  const originalNotes = noteTools.createNoteTools;
  const noteSpy = vi.spyOn(noteTools, 'createNoteTools').mockImplementation(input => {
    contexts.push(structuredClone(input.context));
    return originalNotes(input);
  });
  return {
    latest() {
      const last = contexts.at(-1);
      if (last === undefined) throw new Error('S6B: the round opened no Query context');
      return last;
    },
    restore: () => { spy.mockRestore(); noteSpy.mockRestore(); },
  };
}

/** Several rounds held at once (P1): `ofRun` is the context of the round whose `query_run` principal is that run. */
export function captureAnswerContexts(): { ofRun(runId: string): CoreCallContext | undefined; restore(): void } {
  const contexts: CoreCallContext[] = [];
  const original = answerTools.createAnswerTools;
  const spy = vi.spyOn(answerTools, 'createAnswerTools').mockImplementation(config => {
    contexts.push(config.context);
    return original(config);
  });
  return {
    ofRun: runId => contexts.find(context => context.principal.kind === 'query_run'
      && context.principal.queryRunRef.runId === runId),
    restore: () => { spy.mockRestore(); },
  };
}
