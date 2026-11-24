/**
 * The Decide board-check scene (7D2 batch 10): `Decide.scene.json` carries the
 * queue rows the page draws — a waiting structural proposal card, the reverted
 * notice and the conflict notice — plus the two knowledge reads' answers. This
 * file adds only what one static answer cannot: the two notices read different
 * recovery items, so `knowledge/recovery-items` answers by the `noticeId` the
 * page sent (the same `project_notice:` suffix `boot.ts` slices).
 *
 *   --scene tests/ui/scenes/Decide.scene.mjs
 *
 * The conflict notice's `bad_file` place is recoverable from its snapshot only
 * while the same `itemNo` is still an `unreadable` recovery item
 * (`knowledgeNoticeFactsOf`); the reverted notice lists the two reverted files
 * from the JSON. The structural card's `architecture/proposal-batch-files`
 * answer is the JSON's.
 *
 * 重新提、恢复、标为已读 answer success and move the queue and the recovery
 * items, so the reread after the click shows the next card (with its 详情
 * closed) or the recovered place.
 */
import { readFileSync } from 'node:fs';

const HAVE = JSON.parse(readFileSync(new URL('./Decide.scene.json', import.meta.url), 'utf8'));
const CONFLICT_NOTICE = 'scene-notice-conflict';

/** The conflict notice's one recoverable place: the bad module file, item 1. */
const CONFLICT_RECOVERY = { status: 'ready', value: { items: [
  { itemNo: 1, kind: 'unreadable', path: '.workbench/modules/core.json' },
] } };
const NOTICE_KEYS = ['project_notice:scene-notice-reverted', 'project_notice:scene-notice-conflict'];

/** What the writes move: the answered card leaves the queue, the seen notices leave it,
 * and a recovered item leaves its own notice's list. */
const S = { answered: new Set(), seen: false,
  recovered: { [CONFLICT_NOTICE]: new Set(), 'scene-notice-reverted': new Set() } };
const committedAnswer = (value) => ({ status: 'committed', value: value ?? {} });
const recoveryOf = (noticeId) => (noticeId === CONFLICT_NOTICE
  ? structuredClone(CONFLICT_RECOVERY)
  : structuredClone(HAVE.routes['knowledge/recovery-items']));

export const scene = {
  now: HAVE.now,
  routes: HAVE.routes,
  reply(route, input, body) {
    const winput = body && body.request ? body.request.input : (input ?? null);
    if (route === 'decisions/queue') {
      const queue = structuredClone(HAVE.routes['decisions/queue']);
      if (S.answered.size > 0) {
        queue.value.waitingAnswer = queue.value.waitingAnswer.filter((card) => !S.answered.has(card.cardKey));
      }
      if (S.seen) queue.value.notices = queue.value.notices.filter((notice) => !NOTICE_KEYS.includes(notice.itemKey));
      return queue;
    }
    if (route === 'knowledge/recovery-items') {
      const noticeId = input?.noticeId;
      const answer = recoveryOf(noticeId);
      const gone = S.recovered[noticeId] || new Set();
      answer.value.items = answer.value.items.filter((item) => !gone.has(item.itemNo));
      if (answer.value.items.length === 0) return { status: 'rejected', code: 'not_found', reason: 'no recovery items' };
      return answer;
    }
    if (route === 'decisions/answer') {
      const key = winput && winput.source ? winput.source.key : '';
      S.answered.add(key);
      return { status: 'committed', value: { answer: { status: 'committed' } } };
    }
    if (route === 'knowledge/recover') {
      const noticeId = winput && winput.noticeId;
      if (S.recovered[noticeId]) S.recovered[noticeId].add(winput.itemNo);
      return committedAnswer({ path: '.workbench/modules/core.json' });
    }
    if (route === 'decisions/notices/seen') {
      S.seen = true;
      return committedAnswer();
    }
    return HAVE.routes[route];
  },
};
