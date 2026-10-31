/**
 * R-request/R-history/R-closed-answer, the real service and card rows. Their only legal producer is the real
 * `request_rework`/`request_recheck` tool call on an entered Work Run (FX-02), whose names L1 registers; a
 * constructed record or ctx would be tests/RULES.md F1/F3. The row table keeps them in the uniform deferred form
 * (`7c1-r-rework-table.md:10`, R-04), and the pure closedReason row is not proved here.
 */
import { describe, it } from 'vitest';

describe('R-request: the real tool/service arm (deferred to 7C-1 L1)', () => {
  it('R-REQUEST-02: the request_rework/request_recheck tool writes a pending request and its card', () => {
    const toolRun = (globalThis as { S7C1_REWORK_TOOL_RUN?: unknown }).S7C1_REWORK_TOOL_RUN;
    if (toolRun === undefined) {
      throw new Error('S7C1-DEFERRED: the rework tool names are not registered (7C-1 L1)');
    }
  });
});

describe('R-history: a closed real source card is still enumerated (deferred to 7C-1 L1)', () => {
  it('R-HISTORY-01: a rejected/stale request stays in the all-state card source', () => {
    const toolRun = (globalThis as { S7C1_REWORK_TOOL_RUN?: unknown }).S7C1_REWORK_TOOL_RUN;
    if (toolRun === undefined) {
      throw new Error('S7C1-DEFERRED: the rework tool names are not registered (7C-1 L1)');
    }
  });
});

describe('R-closed-answer: the applied card stays open in the queue (deferred to 7C-1 L1)', () => {
  it('R-CLOSED-ANSWER-01: the real saved answer leaves the applied card closedReason null', () => {
    // The real row saves the person's answer, applies it, and reads `decisions/queue`; its only legal record 3
    // producer is the request tool arm above. R-04 removes the pure projection substitute; the closedReason
    // behaviour is left to this row at L1 and is reported "未证明" until then.
    const toolRun = (globalThis as { S7C1_REWORK_TOOL_RUN?: unknown }).S7C1_REWORK_TOOL_RUN;
    if (toolRun === undefined) {
      throw new Error('S7C1-DEFERRED: the rework tool names are not registered (7C-1 L1)');
    }
  });
});
