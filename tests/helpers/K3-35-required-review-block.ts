/**
 * K3-35: the whole required review part of the continuation brief, one literal.
 *
 * The literal and `requiredReviewBlock` now live in the pure fixture
 * (`K3-continuation-pure-fixture.ts`, F-014); this module keeps the existing
 * import path for the heavy public-path consumers and pulls in no store,
 * platform, Host, Workflow, Runtime or stub port itself.
 */
export {
  REQUIRED_REVIEW_BLOCK, requiredReviewBlock,
} from './K3-continuation-pure-fixture.js';
