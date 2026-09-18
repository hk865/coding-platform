import { it } from 'vitest';
import { architectureServiceScenario } from './architecture-review-service-fixture.js';
for (const outcome of ['accept', 'reject', 'defer', 'modify'] as const)
  it('production service automatically distributes architecture ' + outcome + ' without a test drive', () => architectureServiceScenario(outcome), 120000);
