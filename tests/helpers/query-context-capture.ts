/**
 * The Query contexts the Runtime hands to `createQueryGraphToolGroup` while a real round runs (rule sheet A3): the
 * real factory is called with the real input and its group is returned unchanged; the wrapper only keeps a copy of
 * each context, so a test can act as that running Query (for a request round, the Runtime's own `query_run`
 * principal). Nothing is built here: every context is one the Runtime itself made.
 */
import { vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import * as toolGroupAssembly from '../../src/core/agent-runtime/tool-group-assembly.js';

export function captureQueryContexts(): { latest(): CoreCallContext; restore(): void } {
  const contexts: CoreCallContext[] = [];
  const original = toolGroupAssembly.createQueryGraphToolGroup;
  const spy = vi.spyOn(toolGroupAssembly, 'createQueryGraphToolGroup').mockImplementation(input => {
    contexts.push(structuredClone(input.context));
    return original(input);
  });
  return {
    latest() {
      const last = contexts.at(-1);
      if (last === undefined) throw new Error('S6B: the round opened no Query context');
      return last;
    },
    restore: () => spy.mockRestore(),
  };
}
