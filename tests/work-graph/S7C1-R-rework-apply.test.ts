/**
 * R-apply (`book-7c.md:1360`): the person's approved application and its replay, through
 * `applyApprovedReworkRequest` and L1's ② adapter. The row is frozen deferred until the rework tool
 * names are registered (FX-02/L1); a constructed record or ctx would be tests/RULES.md F1/F3.
 */
import { describe, it } from 'vitest';

describe('R-apply: the approved application and its replay (deferred to 7C-1 L1)', () => {
  it('R-APPLY-ROW-01: the person-approved pending request applies once; the same commandId replays', () => {
    const toolRun = (globalThis as { S7C1_REWORK_TOOL_RUN?: unknown }).S7C1_REWORK_TOOL_RUN;
    if (toolRun === undefined) {
      throw new Error('S7C1-DEFERRED: the rework tool names are not registered (7C-1 L1)');
    }
  });
});
