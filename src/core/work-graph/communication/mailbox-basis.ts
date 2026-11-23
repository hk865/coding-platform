import type { CoreRejection } from '../../../contracts/core/results.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import { dispatchCurrentOf, sameBasis } from '../tasks/dispatch-basis.js';

// 三值比较和“当前三值”住在 `tasks/dispatch-basis.ts`（派活请求的受理也用，`tasks` 不能依赖 `communication`）；
// 邮箱照旧从这里取，入口按原路径转出，视图与旧调用方的导入不变。
export { dispatchCurrentOf, sameBasis };

/**
 * The companions of one send: only the deadline is frozen here, from the send's
 * `at`; the dispatch counter is bumped by the served-request claim alone and the
 * recipient's activity advances when a round actually starts, never on receipt.
 */
export function sentMessageCompanions(
  at: string,
  deadlineMs: number | null,
): { ok: true; value: { records: []; guards: []; deadline: string | null } } | { ok: false; rejection: CoreRejection } {
  let deadline: string | null = null;
  if (deadlineMs !== null) {
    // The instant is representable iff the Date is; a fractional duration is
    // legal, an out-of-range one is refused before anything is written.
    const frozen = new Date(Date.parse(at) + deadlineMs);
    if (!Number.isFinite(frozen.getTime())) {
      return { ok: false, rejection: reject('invalid', 'the inquiry deadline overflows the representable instant') };
    }
    deadline = frozen.toISOString();
  }
  return { ok: true, value: { records: [], guards: [], deadline } };
}
