/**
 * Record 4's codec: both frozen gate records round-trip unchanged, the record keys by its canonical full ref, and
 * the one arm rule refuses a half-filled `noteRequest`. Pure A5: values are the helper's literals; no store,
 * platform, Host, Workflow or Runtime is imported.
 */
import { describe, expect, it } from 'vitest';
import type { ModuleOverlapGateV1 } from '../../src/core/work-graph/persistence/module-overlap-gate-codecs.js';
import { moduleOverlapGateCodec } from '../../src/core/work-graph/persistence/module-overlap-gate-codecs.js';
import { S7C_GATE_SENT, S7C_GATE_UNSENT } from '../helpers/S7C-n-overlap-fixture.js';

describe('ModuleOverlapGate codec', () => {
  it.each<[string, ModuleOverlapGateV1]>([
    ['the unsent gate', S7C_GATE_UNSENT],
    ['the sent gate', S7C_GATE_SENT],
  ])('%s round-trips through encode and decode', (_label, gate) => {
    const decoded = moduleOverlapGateCodec.decode(moduleOverlapGateCodec.encode(gate));
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') throw new Error('the encoded gate did not decode');
    expect(decoded.value).toEqual(gate);
  });

  it('keys the gate by its canonical full ref', () => {
    expect(moduleOverlapGateCodec.encode(S7C_GATE_UNSENT).refKey)
      .toBe('{"aggregateType":"ModuleOverlapGate","goalId":"g1","moduleId":"m1","projectId":"p1","taskId":"t1"}');
  });
});

describe('rejects: noteRequest', () => {
  it('refuses a recipient with a duty but no messageRef', () => {
    const halfSent = {
      ...S7C_GATE_UNSENT,
      noteRequest: { recipient: { projectId: 'p1', sessionId: 's1' }, duty: 'adviser' },
    } as unknown as ModuleOverlapGateV1;
    expect(moduleOverlapGateCodec.check(halfSent))
      .toBe('ModuleOverlapGate.noteRequest must be one of its two arms');
  });
});
