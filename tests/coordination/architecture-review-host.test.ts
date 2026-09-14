import { it } from 'vitest';
import { architectureReviewScenario } from './architecture-review-scenario.js';
for (const outcome of ['accept', 'reject', 'defer', 'modify'] as const)
    it('real architecture report, ' + outcome + ', complete distribution and restart', () => architectureReviewScenario(outcome), 120000);
for (const fault of ['after_delivery', 'before_bind', 'after_bind'] as const)
    it('architecture decision interruption ' + fault + ' does not duplicate another Work', () => architectureReviewScenario('accept', { fault }), 120000);
it('ordinary first dispatch establishes exact participation and exposes the real report tool', () => architectureReviewScenario('accept', { initialAssignments: true }), 120000);
