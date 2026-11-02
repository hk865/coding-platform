// tests/helpers/session-duty-double.ts — ONE copy; 90-8
import type { SessionDutyReadPort } from '../../src/core/work-graph/model/work-line-contracts.js';
/** A line whose duty is not what the test builds: no reservation, no claim, no role facts (§3.4 item 2). */
export const unknownSessionDuty: SessionDutyReadPort =
  async () => ({ status: 'ready', value: 'unknown' });
