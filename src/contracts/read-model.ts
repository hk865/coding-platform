import type { RunSnapshot } from './dispatch.js';
import type { ReviewWorkRef, ReviewWorkSnapshot, ReviewResultSnapshot, TaskReviewProtocolSnapshot } from './reviewer-work.js';
export type ReviewProjectionSnapshot = ReviewWorkSnapshot | ReviewResultSnapshot | TaskReviewProtocolSnapshot | RunSnapshot;
export type ReviewProjectionFacts = { protocols: TaskReviewProtocolSnapshot[]; works: ReviewWorkSnapshot[]; results: ReviewResultSnapshot[]; runs: RunSnapshot[] };
export interface ReviewReadModelPort {
  reviewWork(ref: ReviewWorkRef): Promise<{ work: ReviewWorkSnapshot; result: ReviewResultSnapshot | null; run: RunSnapshot | null } | null>;
}
