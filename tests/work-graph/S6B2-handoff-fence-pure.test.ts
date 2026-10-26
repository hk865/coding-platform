/** A5: the fence claim key and empty-slot guard; the key and guard are literal expectations, not program output. */
import { describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import { handoffFenceGuard, secretaryHandoffClaimKey } from '../../src/core/work-graph/sessions/session-handoff-fence.js';

describe('the fence claim key and empty-slot guard (pure)', () => {
  it('is the prefix plus the canonical Session aggregate JSON, asserted null → null', () => {
    const session: SessionRef = { projectId: 'p1', sessionId: 's-old' };
    const key = 'secretary-handoff:{"aggregateType":"Session","projectId":"p1","sessionId":"s-old"}';
    expect(secretaryHandoffClaimKey(session)).toBe(key);
    expect(handoffFenceGuard(session)).toEqual({ claimKey: key, expectedOwner: null, nextOwner: null });
  });
});
