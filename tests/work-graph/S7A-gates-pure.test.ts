/** SR8's consumption rule (spec §3.9) as one pure table (A5); the service rows stay in `S7A-gates.test.ts`. */
import { describe, expect, it } from 'vitest';
import { messageConsumptionProblem, messageFactsOfRecord,
  type MessageConsumptionFactsV1 } from '../../src/core/work-graph/state/message-machine.js';

const facts = (over: Partial<MessageConsumptionFactsV1>): MessageConsumptionFactsV1 =>
  ({ status: 'pending', withdrawnAt: null, ...over });
describe('SR8 consumption gate', () => {
  it.each<[string, Partial<MessageConsumptionFactsV1>, 'invalid' | 'busy' | null]>([
    ['pending', {}, null],
    ['read', { status: 'read' }, null],
    ['responded', { status: 'responded' }, null],
    ['withdrawn', { withdrawnAt: '2026-10-25T00:00:00.000Z' }, 'invalid'],
    ['a person intervention that is not withdrawn', { entry: 'person_intervention' }, null],
  ])('%s', (_name, over, code) => {
    const problem = messageConsumptionProblem(facts(over));
    if (code === null) expect(problem).toBeNull();
    else expect(problem?.code).toBe(code);
  });
  it('messageFactsOfRecord maps the three fields', () => {
    expect(messageFactsOfRecord({ status: 'read', entry: 'person_intervention', answeredBy: 'line',
      withdrawnAt: '2026-10-25T00:00:00.000Z' }))
      .toEqual({ status: 'read', entry: 'person_intervention', withdrawnAt: '2026-10-25T00:00:00.000Z' });
    expect(messageFactsOfRecord({ status: 'pending', answeredBy: 'copy', withdrawnAt: null }))
      .toEqual({ status: 'pending', withdrawnAt: null, copyQuestion: true });
  });
});
