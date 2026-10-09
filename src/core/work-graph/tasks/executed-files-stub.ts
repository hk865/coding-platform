/**
 * Slice 5 §2.6 executed-files seam (F25).
 *
 * This slice reads a Goal's executed files as explicitly NOT AVAILABLE. The
 * literal value below is the frozen data: `availability:'not_available'`, no
 * files, `possiblyIncomplete:true`, no guards and no source cursor. It must
 * never be read as "no files and complete". Slice 2 replaces only the
 * implementation and keeps this DTO/algorithm.
 */
import type { GoalExecutedFilesPort } from '../model/decision-contracts.js';

/**
 * The one executed-files stub factory. It creates no record, opens no Run and
 * reads nothing; it returns the spec-mandated literal projection.
 */
export function createExecutedFilesStub(): GoalExecutedFilesPort {
  return {
    async readGoalExecutedFiles() {
      return { status: 'ready', value: {
        availability: 'not_available',
        files: [],
        possiblyIncomplete: true,
        guards: [],
        sourceCursor: null,
      } };
    },
  };
}
