// Waiting (draft §1.8; MVP-BEHAVIOR.md:279-292; slice-9-SPEC.md:667, :693). The wait is set up where the product lets
// it exist (second review #11): a member's Work Run calls the real tool `send_session_message` with `waitAfterSend`
// (a Query round is refused that combination, `communication-tools.ts:478-480`). The member's Task asks the
// secretary line a question with a short real deadline, asks once more on expiry (`followupOf`), then asks a second
// question with a long deadline. A normal close and a new Host on the same ledger keep the wait; the expiry is
// recorded once and only a real acceptance consumes it; a late reply is saved, never reopens the old wait (P2: a reply
// opens no round, MVP-BEHAVIOR.md:310); a transfer keeps question and deadline. P6 Q8: while the first wait is open the
// person interjects on the member line (a direct intervention); the wait stays. There is no clock seam
// (9-start-rulings.frozen.md:969-970): the chain is followed event by event until each event came, the chain is over
// (its Task done and every wait of it settled), or the window ends.
import { newId, ready } from '../lib/http.mjs';
import { broken, chooseModel, coldStart, createGoal, driverStart, ensurePolicy, executions, findAll, interveneLine, lines, messageBody,
  messageRefOf, openProject, orNull, pageGoalRef, proposeAndApply, runHistory, sessionTurns, sleep, testCheck, textOf, lastFinalOf, turnsOf, waitFor,
  waitGoal } from '../lib/flows.mjs';

const MINUTE = 60_000;
const DEADLINE_MS = 2 * MINUTE;
const LONG_DEADLINE_MS = 30 * MINUTE;
// 11-18（G6 第十次的教训）：连锁等待和别的等待一样要有上限。第十次时目标已完成、链上还有等待没了结，
// 这里一直等到授权窗口结束，后面的场景都没轮到。整条链最多等 60 分钟；任务做完以后再等 10 分钟，
// 链还没了结就结束。两种结束都记成“未覆盖”，不算通过。
const CHAIN_CAP_MS = 60 * MINUTE;
const TASK_DONE_GRACE_MS = 10 * MINUTE;
/** P6 Q8: how long the driver watches for the interjection's Run and the interruption notices. */
const INTERJECT_WATCH_MS = 5 * MINUTE;
const SEED = {
  'package.json': '{\n  "name": "g6-wait",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n',
  'README.md': '# g6-wait\n\nNumber helpers.\n',
  'num.js': 'export function double(n) {\n  return n * 2;\n}\n',
};
// G7 W4 (after review): the seed's registered `node --test` check is the one the waiting Goal's `static` requirements
// use, and a check applies only to the Tasks it lists, so the person says plainly it is the whole project's check (the
// secretary then lists `"all"`). A propose that still refuses is recorded by `proposeAndApply`'s `broken` with its issues.
const SEED_REQUEST = '初始化这个项目：在 README.md 末尾加一行用法示例。验收：node --test 通过。'
  + 'node --test 是整个项目的检查，这个项目以后所有任务都用它验收。只改 README.md。';
const QUESTION = 'num.js 现在有哪些导出函数？';
const SECOND_QUESTION = 'README 的标题要不要改成中文？';
/** P6 Q8: the person's interjection while the member waits; it asks for nothing new, so the chain can go on. */
const INTERJECT = '插一句：先别改代码，继续等秘书回答你刚才的问题，拿到回答再按原来的步骤做。';
const instruction = secretary => [
  '先问清楚再动手，按顺序做：',
  `1. 用 send_session_message 给 Session ${secretary} 发问题“${QUESTION}”，needsReply 和 waitAfterSend 都设为 true，deadlineMs 设为 ${DEADLINE_MS}，然后等回答。`,
  '2. 如果到期还没有回答，再用 send_session_message 问一次同样的问题，followupOf 设为第一次那条消息，needsReply、waitAfterSend、deadlineMs 同上，再等。',
  `3. 拿到回答或第二次也到期以后，给同一个 Session 发第二个问题“${SECOND_QUESTION}”，needsReply 和 waitAfterSend 为 true，deadlineMs 设为 ${LONG_DEADLINE_MS}，等回答。`,
  '4. 最后在 num.js 加 triple(n)，并加 test/triple.test.js（node:test）。',
].join('\n');

const def = {
  id: 'waiting',
  rows: ['C-170', 'C-171', 'C-187', 'C-188', 'C-190', 'C-172', 'C-184', 'C-189', 'C-192', 'C-195', 'C-196', 'C-207', 'C-224', 'C-225'],
  checks: [
    { id: 'wait-open', rows: ['C-188', 'C-225'], text: '成员 Work 经真实工具发出等待（waitAfterSend）：原问题、收信人、期限都在；发信的 Run 真的让出（yielded，continuation 指这条等待）' },
    { id: 'interject-keeps-wait', rows: ['C-188', 'C-224'], text: '等待开着时人插话（直接干预）：原等待保留（期限不变、没被消费），插话由 consumedWait 为 intervention 的 Run 接，等待两侧各收到一条中断通知' },
    { id: 'restart-kept', rows: ['C-170', 'C-207'], text: '正常关闭重启后仍核对原等待（同一 messageRef、收信人、期限），接续的 Run 消费这条等待（expiry/wait_reply，originalRun 是原 Run，在成员线上）' },
    { id: 'expiry-once', rows: ['C-171', 'C-190'], text: '到期先记下（expiredAt），不算消费；由 expiry 接受消费' },
    { id: 'second-expiry', rows: ['C-171', 'C-190', 'C-224'], text: '同一追问链第二次实际到期，后继输入写“第 2 次到期”' },
    { id: 'consumes', rows: ['C-187'], text: '真实接受才 consumesWait:true；迟到的普通回复写 false' },
    { id: 'late-reply', rows: ['C-224', 'C-189'], text: '迟回保存为下一个安全点的新输入，不重开旧等待' },
    { id: 'reply-first', rows: ['C-187', 'C-224'], text: '回复抢先：第二个问题到期前收到回复，由回复的接受消费等待（consumesWait:true），不记到期' },
    { id: 'transfer', rows: ['C-224'], text: '转交保留问题和期限，未送达不自动换人' },
    { id: 'disconnect', rows: ['C-195', 'C-196'], text: '等待的一侧归档后 decisions/queue 出这条等待的 disconnect 项，Host 给两侧各发 notify' },
    { id: 'supply-order', rows: ['C-172', 'C-192', 'C-184'], text: '供给按冻结顺序：人的消息、续作、agent 消息' },
  ],
};

export function draft(goalId, secretary) {
  return {
    schemaVersion: 2, planId: `${goalId}-plan`, planRevision: 1, goalId, stages: [],
    tasks: [
      { taskId: 't-wait', title: '先问清楚再加 triple', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
        scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: 'gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 't-wait', role: 'local-workbench', instruction: instruction(secretary) }],
    // G7 W4: the seed adoption's policy asks for up to two required requirements per obligation (CPL; the G6 run 4
    // seed chose 2 here, `empty_verification_requirements`), so the one obligation names both things the Task must
    // show. Both are `static`, the kind the seed's registered `node --test` check covers.
    obligations: [{ obligationId: 'o-tests', title: '测试通过', requirementLevel: 'required', taskIds: ['t-wait', 'gate'],
      verificationRequirements: [
        { requirementId: 'r-tests', requirementLevel: 'required', kind: 'static', description: 'node --test 全部通过' },
        { requirementId: 'r-triple', requirementLevel: 'required', kind: 'static',
          description: 'num.js 导出 triple(n)，test/triple.test.js 用 node:test 覆盖它并通过' },
      ] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

/** Same message (a SessionMessageRef has no sessionId, `session-message.ts:29-34`, so only the messageId tells). */
const same = (left, right) => left !== null && right !== null && left !== undefined && right !== undefined
  && left.sessionId === right.sessionId && left.messageId === right.messageId;
const claimSession = item => item?.outbox?.claim?.sessionRef?.sessionId ?? null;

/**
 * P6J waiting (diagnosis row `waiting`): the independent second question — a member send that waits, is not on the
 * first chain, and names README (the scenario's step 3). Read on every poll so its open window is never outside the
 * observation. The README question is locked first: before it appears a fallback second question is never returned, so
 * it is never used to archive the sending line early (quick-check row 5).
 */
export const secondQuestionOf = (sends, chainRefs) => {
  const independent = sends.filter(entry => entry.args?.waitAfterSend === true && !chainRefs.some(ref => same(ref, entry.ref)));
  return independent.find(entry => String(entry.args?.text ?? '').includes('README')) ?? null;
};

/**
 * P6L waiting (diagnosis row `waiting`; run sheet item 5): `reply-first` and the expiry outcome are one verdict on ONE
 * letter snapshot. `expiredAt`, `response.respondedAt` and `acceptedInputs` are read from the same object, so a reply
 * that came 128 ms after the expiry can never be written as "reply first" in either cell. A reply before the expiry
 * that its own response acceptance consumes is the pass; one still open or already expired is `uncovered`, never a pass.
 */
export const replyFirstVerdict = message => {
  if (message === null || message === undefined) return { status: 'uncovered', code: 'env-unavailable', note: 'messages/read 读不到' };
  const respondedAt = message.response?.respondedAt ?? null;
  if (respondedAt === null) return { status: 'uncovered', code: 'not-run', note: '还开着，没有回复抢先' };
  if (message.expiredAt != null && Date.parse(respondedAt) >= Date.parse(message.expiredAt)) {
    return { status: 'uncovered', code: 'not-run', order: 'expired-first',
      note: `先到期了（${message.expiredAt}），回复在 ${respondedAt}，不是回复抢先` };
  }
  const by = (message.acceptedInputs ?? []).find(entry => entry.consumesWait === true);
  return { status: by?.part === 'response' ? 'pass' : 'fail', order: 'reply-first',
    note: `回复 ${respondedAt}；消费它的接受 ${by === undefined ? '无' : `${by.part}@${by.acceptedAt}`}；expiredAt ${message.expiredAt ?? '无'}` };
};

/** P6J waiting `disconnect`: the one open wait with a recipient, re-read immediately before the far side is archived. */
export const openWaitForDisconnect = waits => [...waits].filter(entry => entry.state?.state === 'open'
  && entry.recipient?.sessionId !== undefined && entry.expiredAt == null).at(-1) ?? null;

/** P6J waiting: a second question's state after a re-read, and the one action it allows. */
export const secondStepOf = ({ message, readFailure = null, hasReceiver = false }) => {
  if (readFailure !== null) return { kind: 'gap', note: `messages/read 读不到：${readFailure}` };
  if (message === null || message === undefined) return { kind: 'gap', note: 'messages/read 没有回答' };
  const accepted = (message.acceptedInputs ?? []).some(input => input.consumesWait === true);
  if (message.withdrawnAt != null || message.waitCancelledAt != null) {
    return { kind: 'closed', note: `已不开放（撤回 ${message.withdrawnAt ?? '无'}，取消 ${message.waitCancelledAt ?? '无'}）` };
  }
  if (message.response?.respondedAt != null) {
    return { kind: 'reply-first', message, verdict: replyFirstVerdict(message) };
  }
  if (accepted || message.expiredAt != null) {
    return { kind: 'closed', note: `已不开放（到期 ${message.expiredAt ?? '无'}，已消费 ${accepted}）` };
  }
  if (!hasReceiver) return { kind: 'no-receiver', note: '没有可转交的另一条线' };
  return { kind: 'transfer', message };
};

/**
 * P6L waiting (diagnosis row `waiting`, run sheet item 5): the existing transfer entry is the archive request's own
 * `wait.transfer` (`session-archive.ts:15-18`), one `sessions/archive-line` call naming the original wait's Run, its
 * letter and the receiving line. There is no standalone `waits/dispose(transfer)`: a live sender line is refused it.
 * A rejected archive keeps the first refusal raw; the caller re-reads the same letter (`secondWaitRound`) and judges a
 * reply that landed since. Shared by the poll loop and the after-chain branch.
 */
export async function transferWait(project, send, value, other) {
  const gaps = [];
  const fresh = await message(project, send.ref, gaps);
  if (gaps.length > 0) return { kind: 'gap', note: gaps.join('；') };
  if (fresh === null) return { kind: 'gap', note: 'messages/read 没有回答' };
  const step = secondStepOf({ message: fresh, hasReceiver: other !== undefined });
  if (step.kind !== 'transfer') return step;
  const sender = send.line;
  const cardBody = await project.host.client.read('sessions/read', project.scope, sender);
  const card = ready(cardBody);
  if (card === null) return { kind: 'gap', note: `sessions/read ${sender.sessionId}: ${cardBody?.status ?? 'no answer'}` };
  const waitGaps = [];
  const wait = (await waitsOf(project, sender, waitGaps)).find(entry => entry.messageRef?.messageId === send.ref.messageId) ?? null;
  if (waitGaps.length > 0) return { kind: 'gap', note: waitGaps.join('；') };
  if (wait === null || wait.originalRun === null || wait.originalRun === undefined) {
    return { kind: 'gap', note: `sessions/facts ${sender.sessionId} 里读不到 ${send.ref.messageId} 的原等待 Run，归档的 wait.transfer 无从给出` };
  }
  // P6L2 B8: an open responsibility of the sending line must carry its own disposal choice in the same request, or
  // the Host refuses the archive (`archive_disposal_required`). Only a task still active and unsatisfied needs one.
  const taskGaps = [];
  const tasks = [];
  // P6L2 B8: `sessions/read.links` are `SessionWorkLink`s: relation and target live under `link.ref`, and `until`
  // marks an ended responsibility.
  for (const link of (card.links ?? []).filter(entry => entry.until == null
    && entry.ref?.relation === 'responsible' && entry.ref?.target?.kind === 'task')) {
    const taskRef = link.ref.target.ref;
    const goalRef = { aggregateType: 'Goal', projectId: taskRef.projectId, goalId: taskRef.goalId };
    const row = ready(await project.host.client.read('tasks/query', project.scope, { goalRef }))?.tasks
      ?.find(entry => entry.ref.taskId === taskRef.taskId) ?? null;
    if (row === null) { taskGaps.push(`tasks/query 里读不到责任 Task ${taskRef.taskId}`); continue; }
    if (row.disposition === 'active' && row.effectivePhase !== 'satisfied') {
      tasks.push({ target: { kind: 'task', ref: taskRef }, disposition: { kind: 'drop' } });
    }
  }
  if (taskGaps.length > 0) return { kind: 'gap', note: taskGaps.join('；') };
  const archived = await project.host.client.write('sessions/archive-line', project.scope,
    { sessionRef: sender, reason: 'G6 waiting: archive the sending line and transfer its open wait', tasks,
      wait: { kind: 'transfer', runRef: wait.originalRun, messageRef: wait.messageRef, to: other.key } },
    [{ ref: { aggregateType: 'Session', ...sender }, revision: card.record.revision }]);
  // P6LO B9: the transfer is judged on `closeSecondQuestion`'s final reads of the same letter and sending line, so no
  // re-read is taken here; `deadline` is the letter's deadline read before the archive.
  if (archived?.status !== 'ready' || !['archived', 'pending'].includes(archived.value?.state)) {
    // The first refusal is kept raw; the caller re-reads the same letter and judges a reply that landed since.
    return { kind: 'transfer-refused', message: fresh, archived, deadline: value.deadline, sender, to: other.key,
      note: `归档发信线 ${sender.sessionId}：${archived?.status ?? 'no answer'} ${archived?.value?.state ?? archived?.code ?? ''} ${archived?.reason ?? ''}`.trim() };
  }
  return { kind: 'transfer', message: fresh, archived, deadline: value.deadline, sender, to: other.key };
}

/** Slice 1 S1-MSG-01 (`mailbox-archive.ts:76-84`): a reply target is same-workspace, active, not unavailable, not being archived, not a read-only copy. */
export const replyTargetEligible = (record, workspaceId) => record !== null && record !== undefined
  && record.workspaceId === workspaceId && record.lifecycle === 'active' && record.health !== 'unavailable'
  && (record.archiveRequest ?? null) === null && record.provenance?.kind !== 'readonly_copy';

/**
 * P6J4 waiting (quick check row 5): the line the open README wait may move to, chosen on every round from the lines'
 * real state — never a member line or the secretary, and only one whose SessionCard is an eligible reply target
 * (`replyTargetEligible`), so a line being archived or retired is never chosen. P6J4b: answers `{ row, gaps }`; a line
 * list or card that cannot be read is named in `gaps`, so "no eligible line" is never told from a read that failed.
 */
export const receiverFor = (project, { memberLines, secretary }) => async () => {
  const gaps = [];
  const memberIds = new Set((await memberLines(gaps)).map(line => line.sessionId));
  for (const row of await lines(project, gaps)) {
    if (memberIds.has(row.key.sessionId) || row.key.sessionId === secretary.sessionId) continue;
    const body = await project.host.client.read('sessions/read', project.scope, row.key);
    const card = ready(body);
    if (card === null) gaps.push(`sessions/read ${row.key.sessionId}: ${body?.status ?? 'no answer'} ${body?.code ?? ''}`.trim());
    else if (replyTargetEligible(card.record, project.scope.workspaceId)) return { row, gaps };
  }
  return { row: undefined, gaps };
};

/** A receiver callback may answer a row itself or `{ row, gaps }` (`receiverFor`). */
const pickedOf = picked => (picked?.key !== undefined ? { row: picked, gaps: [] } : { row: picked?.row, gaps: picked?.gaps ?? [] });

/**
 * P6J waiting: one round on the locked README letter, shared by `followChain`'s polls and the after-chain re-read.
 * Always re-reads the letter, re-selects the qualified receiver line on this round (never a line chosen earlier), and
 * takes the one action `secondStepOf` allows. A transfer the platform refuses because the reply landed re-reads the
 * same letter and returns `reply-first`.
 */
export async function secondWaitRound(project, send, { receiverOf = async () => undefined, allowTransfer = true } = {}) {
  const gaps = [];
  const fresh = await message(project, send.ref, gaps);
  if (gaps.length > 0) return { kind: 'gap', note: gaps.join('；'), gaps };
  if (fresh === null) return { kind: 'gap', note: 'messages/read 没有回答', gaps };
  const picked = allowTransfer ? pickedOf(await receiverOf()) : { row: undefined, gaps: [] };
  const other = picked.row;
  const step = secondStepOf({ message: fresh, hasReceiver: other !== undefined });
  // P6J4b: an open letter with no receiver found while the line reads failed is a gap, not "no eligible line".
  if (step.kind === 'no-receiver' && picked.gaps.length > 0) {
    return { kind: 'gap', note: `接收线读不全：${picked.gaps.join('；')}`, message: fresh, gaps: [...gaps, ...picked.gaps] };
  }
  // The letter as this round read it travels with every outcome (a committed transfer's lost re-read is filled from it).
  if (step.kind !== 'transfer') return { ...step, message: step.message ?? fresh, gaps };
  const outcome = await transferWait(project, send, fresh, other);
  if (outcome.kind === 'transfer-refused' || outcome.kind === 'gap') {
    const again = await message(project, send.ref);
    if (again?.response?.respondedAt != null) {
      return { kind: 'reply-first', message: again, verdict: replyFirstVerdict(again), attempt: outcome,
        gaps, note: `转交没成（${outcome.note}），复读同一封信：回复先到` };
    }
  }
  return { ...outcome, gaps };
}

/**
 * P6J waiting: one poll's handling of the README question. The question is locked first (a fallback second question is
 * never touched); then `secondWaitRound` reads the letter, re-selects the receiver and transfers at most once. `prior`
 * is the last round's record, so a later poll re-reads and judges the letter but never transfers a second time.
 */
export async function secondQuestionRound(project, { sends, chainRefs, prior = null, receiverOf = async () => undefined }) {
  const send = secondQuestionOf(sends, chainRefs);
  if (send === null) return null;
  const attempted = prior?.attempted === true;
  const outcome = await secondWaitRound(project, send, { receiverOf, allowTransfer: !attempted });
  const first = prior === null || !same(prior.send.ref, send.ref);
  const transferred = outcome.kind === 'transfer' || outcome.kind === 'transfer-refused';
  const attempt = outcome.attempt ?? (transferred ? outcome : prior?.attempt ?? null);
  // Once the wait really moved, a later reply is not "first": keep the transfer as the recorded outcome while still
  // re-reading the letter every round for its facts.
  const recorded = attempt?.kind === 'transfer' && !transferred ? attempt : outcome;
  return { send,
    outcome: recorded,
    attempted: attempted || attempt !== null,
    attempt,
    firstSeenAt: first ? new Date().toISOString() : prior.firstSeenAt,
    firstValue: first ? outcome.message ?? null : prior.firstValue,
    value: outcome.message ?? prior?.value ?? null,
    gaps: outcome.gaps ?? prior?.gaps ?? [] };
}

/**
 * P6J waiting: the one result handling of the README question, shared by the poll loop's outcome and the after-chain
 * re-read. A reply is always judged by `replyFirstVerdict` on one letter snapshot, so the `reply-first` and `transfer`
 * cells never contradict each other; a completed archive keeps the transfer check. `verdict` is the one computation
 * `closeSecondQuestion` already made on the final snapshot; when absent it is made here from the same letter.
 */
export const judgeSecond = (rec, { outcome, attempt = null, secondText, secondMsg, verdict = null, acceptanceGap = null, final = null }) => {
  // P6LO B9: an archive attempt (this round's or an earlier one) is judged only on the close-out's final reads of the same
  // letter and sending line (`final`): any of them missing is uncovered; the handler is the intended receiver, the
  // wait's disposition is transfer and the sender is archived → the deadline is compared with the one read before the
  // archive (`tried.deadline`). The first receipt and its inner rejection only go into the note. A proven transfer
  // settles reply-first as well: a reply after it is not "reply first".
  const tried = [outcome, attempt].find(entry => entry?.kind === 'transfer' || entry?.kind === 'transfer-refused') ?? null;
  const rejection = tried?.archived?.value?.rejection ?? null;
  const receipt = tried === null ? '' : `；首次归档回执 ${tried.archived?.status ?? 'no answer'} ${tried.archived?.value?.state ?? tried.archived?.code ?? ''}${
    rejection === null ? '' : `（内层拒绝 ${rejection.code ?? '-'} ${rejection.reason ?? ''}）`}${tried.kind === 'transfer-refused' ? `：${tried.note ?? '无原因'}` : ''}`;
  if (tried !== null) {
    const toSession = tried.to?.sessionId ?? attempt?.to?.sessionId ?? null;
    const done = `归档发信的成员线 ${tried.sender?.sessionId ?? '-'}，wait.transfer → ${toSession ?? '-'}${receipt}`;
    const moved = final?.message ?? null;
    const senderRecord = final?.senderRecord ?? null;
    const handler = moved?.replyHandler?.sessionRef?.sessionId ?? null;
    const disposed = moved?.archiveWaitDisposition?.kind ?? null;
    const senderArchived = senderRecord?.record?.lifecycle === 'archived';
    if (moved === null || senderRecord === null) {
      const missing = [moved === null ? final?.messageGap ?? '这封信没有终读' : null,
        senderRecord === null ? final?.senderGap ?? '发信线没有终读' : null].filter(entry => entry !== null);
      rec.uncover('transfer', 'env-unavailable', `${done}；终读缺：${missing.join('；')}，handler、归档处置、发信线和期限都无从核对`);
    } else if (handler !== null && handler === toSession && disposed === 'transfer' && senderArchived) {
      rec.check('transfer', moved.deadline === tried.deadline, `${done}；终读 handler ${handler}，归档处置 ${disposed}，发信线已归档，期限 ${
        tried.deadline ?? '-'} → ${moved.deadline ?? '-'}`);
      rec.uncover('reply-first', 'not-run', `${secondText}：转交已证实，之后的回复不算回复抢先`);
      return;
    } else {
      rec.uncover('transfer', 'not-run', `${done}；终读：handler ${handler ?? '无'}，预定接收线 ${toSession ?? '无'}，归档处置 ${disposed ?? '无'}，发信线 ${
        senderArchived ? '已归档' : '未归档'}：转交没有实际发生`);
    }
  }
  if (outcome.kind === 'reply-first') {
    const first = verdict ?? replyFirstVerdict(outcome.message ?? secondMsg);
    // P6J4b: a reply whose acceptance could not be read to the end is a gap; only complete reads judge "not consumed".
    if (first.status === 'fail' && acceptanceGap !== null) {
      rec.uncover('reply-first', 'env-unavailable', `${secondText}：回复 ${outcome.message?.response?.respondedAt ?? '-'} 已读到，接受记录读不到（${acceptanceGap}），消费无从判${receipt}`);
    } else if (first.status === 'pass') rec.pass('reply-first', `${secondText}：${first.note}${receipt}`);
    else if (first.status === 'fail') rec.fail('reply-first', `${secondText}：${first.note}${receipt}`);
    else rec.uncover('reply-first', first.code, `${secondText}：${first.note}${receipt}`);
    // P6L waiting: the same verdict decides this cell too. An expiry that came first is never written as "reply first".
    if (tried === null) {
      rec.uncover('transfer', 'not-run', first.order === 'expired-first'
        ? `${secondText}：先到期了（${outcome.message?.expiredAt ?? '未知'}），回复在 ${outcome.message?.response?.respondedAt ?? '未知'}，转交没有发生`
        : `${secondText}：回复先到（${outcome.message?.response?.respondedAt ?? '未知'}），转交没有发生`);
    }
    return;
  }
  if (outcome.kind === 'gap') {
    rec.uncover('reply-first', 'env-unavailable', `${secondText}：${outcome.note}${receipt}`);
    if (tried === null) rec.uncover('transfer', 'env-unavailable', `${secondText}：${outcome.note}`);
  } else if (tried !== null) {
    rec.uncover('reply-first', 'not-run', `${secondText}：还开着（没有回复），回复抢先没有发生${receipt}`);
  } else if (outcome.kind === 'closed') {
    rec.uncover('reply-first', 'not-run', `${secondText}：${outcome.note}；没有回复抢先`);
    rec.uncover('transfer', 'not-run', `${secondText}：${outcome.note}；转交没有发生`);
  } else {
    rec.uncover('reply-first', 'not-run', `${secondText}：${outcome.note ?? '还开着，没有回复抢先'}`);
    rec.uncover('transfer', 'not-run', `${outcome.note ?? '没有可转交的另一条线'}`);
  }
};

/**
 * P6J4 waiting: the README question's last round after the chain. The same letter is always re-read through the same
 * round handler (the loop may have ended before the reply, or after a refused transfer the reply came); an earlier
 * attempt only forbids a second transfer, never the re-read. The one result handling then judges it (`judgeSecond`).
 */
export async function closeSecondQuestion(ctx, project, rec, { chain, secondSend, seenOpen, receiverOf, acceptanceMs = 10 * MINUTE }) {
  const prior = chain.second !== null && chain.second !== undefined && same(chain.second.send.ref, secondSend.ref) ? chain.second : null;
  const final = await secondQuestionRound(project, { sends: [secondSend], chainRefs: [], prior, receiverOf });
  const outcome = final?.outcome ?? { kind: 'gap', note: 'messages/read 读不到' };
  // P6L waiting: only a reply that came before the expiry and is not yet shown consumed needs the acceptance poll. The
  // one complete letter that comes back is the snapshot both cells are judged on (`replyFirstVerdict`).
  const acceptance = outcome.kind === 'reply-first' && outcome.verdict?.order === 'reply-first' && outcome.verdict.status !== 'pass'
    ? await consumingAcceptance(ctx, project, secondSend.ref, { timeoutMs: acceptanceMs }) : { consumed: null, gap: null };
  const secondMsg = acceptance.consumed ?? outcome.message ?? await message(project, secondSend.ref);
  const secondText = `第二个问题 ${secondSend.ref.messageId}（期限 ${secondMsg?.deadline ?? '-'}；${seenOpen}）`;
  const verdict = replyFirstVerdict(secondMsg);
  // P6L3 B9: the final letter and sending line are read again at close-out, after the archive, and judge the transfer
  // whatever the first receipt said. A read failure is named, never folded into "not transferred".
  let last = null;
  let finalMsg = secondMsg;
  // P6LO B9: any archive attempt, also one a reply followed, gets the final reads.
  if ([outcome, final?.attempt].some(entry => entry?.kind === 'transfer' || entry?.kind === 'transfer-refused')) {
    const messageGaps = [];
    const letter = await message(project, secondSend.ref, messageGaps);
    const senderBody = await project.host.client.read('sessions/read', project.scope, secondSend.line);
    const senderRecord = ready(senderBody);
    last = { message: letter, messageGap: messageGaps[0] ?? null, senderRecord,
      senderGap: senderRecord === null ? `sessions/read ${secondSend.line.sessionId}: ${senderBody?.status ?? 'no answer'} ${senderBody?.code ?? ''}`.trim() : null };
    if (letter !== null) finalMsg = letter;
  }
  const secondTextFor = `第二个问题 ${secondSend.ref.messageId}（期限 ${finalMsg?.deadline ?? '-'}；${seenOpen}）`;
  judgeSecond(rec, { outcome, attempt: final?.attempt ?? null, secondText: secondTextFor, secondMsg: finalMsg, verdict,
    acceptanceGap: acceptance.gap, final: last });
  return final;
}

/**
 * P6J4b: the reply's consuming acceptance, polled up to 10 minutes. The poll judges nothing (`check: null`): it returns
 * the letter that shows it consumed, or null with the last read's failure when the last read did not answer (acceptance
 * records only grow, so a later complete read supersedes an earlier failed one).
 */
export async function consumingAcceptance(ctx, project, ref, { timeoutMs = 10 * MINUTE, everyMs } = {}) {
  let gap = null;
  const consumed = await orNull(waitFor(ctx, 'the reply acceptance to consume the second wait', async () => {
    const gaps = [];
    const value = await message(project, ref, gaps);
    gap = gaps[0] ?? null;
    return value;
  }, value => (value?.acceptedInputs ?? []).some(entry => entry.consumesWait === true), { timeoutMs, everyMs, check: null }));
  return { consumed, gap: consumed === null ? gap : null };
}

/**
 * Lead ruling Q7, the last step: the member wait still open just before its far side is archived. The member lines'
 * waits are read, the newest open one with a recipient is taken, and P6J its own `messageRef` is re-read on its line
 * immediately before the archive: only a wait still open then is a real disconnect object. A read that fails is a gap.
 */
export async function disconnectTarget(project, memberLines) {
  let target = null;
  let holder = null;
  const beforeGaps = [];
  for (const line of memberLines) {
    const open = openWaitForDisconnect(await waitsOf(project, line, beforeGaps));
    if (open !== null) { target = open; holder = line; }
  }
  if (beforeGaps.length > 0) return { target: null, code: 'env-unavailable', note: `归档前读 sessions/facts 失败：${beforeGaps.join('；')}；开着的等待读不全` };
  if (target === null) return { target: null, code: 'not-run', note: '归档前重读成员线：已没有开着的等待（都已回答或处理），断开无从造出' };
  const freshGaps = [];
  const fresh = openWaitForDisconnect((await waitsOf(project, holder, freshGaps)).filter(entry => same(entry.messageRef, target.messageRef)));
  if (freshGaps.length > 0) {
    return { target: null, code: 'env-unavailable', note: `归档前重读 sessions/facts 失败：${freshGaps.join('；')}；等待 ${target.messageRef.messageId} 是否仍开着读不到` };
  }
  if (fresh === null) return { target: null, code: 'not-run', note: `归档前重读同一个 messageRef ${target.messageRef.messageId}：已不开放，断开没有发生` };
  return { target: fresh, holder };
}

async function waitsOf(project, sessionRef, gaps = null) {
  const body = await project.host.client.read('sessions/facts', project.scope, sessionRef);
  const value = ready(body);
  if (value === null && body?.status !== 'not_found') gaps?.push(`sessions/facts ${sessionRef.sessionId}: ${body?.status ?? 'no answer'} ${body?.code ?? ''}`);
  return value?.waits ?? [];
}

/** The saved message, or null; given `gaps`, a read that does not answer is named there. */
async function message(project, ref, gaps = null) {
  const body = await project.host.client.read('messages/read', project.scope, ref);
  const value = ready(body);
  if (value === null) gaps?.push(`messages/read ${ref.messageId}: ${body?.status ?? 'no answer'} ${body?.code ?? ''}`);
  return value;
}

/** The expiry acceptance that consumed the wait, or undefined; it names the Run that received it (`mailbox.ts:112`). */
const expiryConsumerOf = value =>
  value?.acceptedInputs?.find(entry => entry.part === 'expiry' && entry.consumesWait === true);

/**
 * When the expiry itself consumed the wait, or null. P6 diagnosis 2 #28: a reply after `expiredAt` but before the
 * expiry was consumed is still the formal reply and consumes the wait (`STATE-MACHINES-SPEC.md:3650`); only a reply
 * after the expiry's own consuming acceptance is late.
 */
const expiryConsumedAt = latest => {
  const entry = expiryConsumerOf(latest);
  return entry === undefined ? null : Date.parse(entry.acceptedAt);
};

/** A response accepted after the expiry consumed the wait: a late reply (it must not consume the old wait). */
const lateReplyOf = latest => {
  const at = expiryConsumedAt(latest);
  return at === null ? undefined : (latest.acceptedInputs ?? []).find(entry => entry.part === 'response' && Date.parse(entry.acceptedAt) > at);
};

/**
 * P6 #18: a reply that came after the expiry consumed the wait and is saved in the reply slot (`mailbox.ts:72-80`).
 * P2: a reply opens no round (MVP-BEHAVIOR.md:310), so while the member line is idle it is only saved, not yet accepted.
 */
const lateSaved = latest => {
  const at = expiryConsumedAt(latest);
  return at !== null && latest?.response?.respondedAt != null && Date.parse(latest.response.respondedAt) > at;
};

/** A wait message whose wait is over: consumed by an acceptance, withdrawn or cancelled. */
const settledWait = value => (value?.acceptedInputs ?? []).some(entry => entry.consumesWait === true)
  || value?.withdrawnAt != null || value?.waitCancelledAt != null;

/**
 * The member's sent messages (refs from its successful `send_session_message` results) with their arguments and the
 * line that sent each (P6 #15). P6 diagnosis 2 #29: `members` is every line that ran t-wait (a restart can continue it
 * on a new Session), so the sends of the continuation line are seen too. Given `gaps`, a history page that does not
 * answer is named there.
 */
async function memberSends(project, members, gaps = null) {
  const out = [];
  for (const line of members) {
    out.push(...(await sessionTurns(project, line, gaps)).flatMap(turn => turn.results).filter(result => result.name === 'send_session_message')
      .map(result => ({ args: result.args, ref: messageRefOf(result), line }))
      .filter(entry => entry.ref !== null));
  }
  return out;
}

/**
 * The accepted expiry input of the message that expired, read from the Run its acceptance names: that Run may be on
 * a continuation line the member list has not caught yet.
 */
async function readExpiryInput(project, runRef, messageRef) {
  const gaps = [];
  const accepted = turnsOf(await runHistory(project, runRef, gaps)).flatMap(turn => turn.accepted).find(({ sourceRef }) =>
    sourceRef?.kind === 'SessionMessage' && sourceRef.part === 'expiry'
    && sourceRef.messageRef.messageId === messageRef.messageId);
  return accepted === undefined ? { text: '', gaps } : { text: accepted.text, gaps: [] };
}

/**
 * P6K ruling (waiting window): the one moment the existing expiry poll first sees `expiredAt`, kept as evidence: that
 * observed moment (`observedAt`) and the letter's own `expiredAt`, the original yielding Run's status/`endedAt`
 * (`executions/list`), the Task's eligibility at that moment (`tasks/query`: disposition/effectivePhase) and the line's
 * occupancy (`sessions/read`: availability and `record.occupancy`). A read that does not answer is a gap; nothing here
 * judges.
 */
export async function expiryWindow(project, { goalRef, messageRef, expiredAt, runId, taskId, line }) {
  const observedAt = new Date().toISOString();
  const gaps = [];
  const runs = await executions(project, goalRef, gaps);
  const row = runs.find(item => item.run.ref.runId === runId) ?? null;
  if (row === null) gaps.push(`executions/list 里没有原 Run ${runId}`);
  const taskBody = await project.host.client.read('tasks/query', project.scope, { goalRef });
  const graph = ready(taskBody);
  if (graph === null) gaps.push(taskBody === null ? 'tasks/query 没有回答' : `tasks/query: ${taskBody?.status ?? 'no answer'} ${taskBody?.code ?? ''}`.trim());
  const task = (graph?.tasks ?? []).find(entry => entry.ref.taskId === taskId) ?? null;
  if (graph !== null && task === null) gaps.push(`tasks/query 里找不到 ${taskId}`);
  const cardBody = await project.host.client.read('sessions/read', project.scope, line);
  const card = ready(cardBody);
  if (card === null) gaps.push(`sessions/read ${line.sessionId}: ${cardBody?.status ?? 'no answer'} ${cardBody?.code ?? ''}`.trim());
  return {
    letter: { ...messageRef, expiredAt, observedAt },
    run: row === null ? null : { runId, status: row.run.status ?? null, endedAt: row.run.endedAt ?? null },
    task: task === null ? null : { disposition: task.disposition ?? null, effectivePhase: task.effectivePhase ?? null,
      eligibility: task.eligibility ?? null },
    line: card === null ? null : { sessionId: line.sessionId, availability: card.availability ?? null,
      occupancy: card.record?.occupancy ?? null },
    gaps };
}

/**
 * P6K ruling (waiting window): what the moment says about a claimable continuation, as evidence only. A gap or a
 * missing Run/Task/line read never claims a window; a Task without `eligibility` cannot be told; an ineligible Task is
 * skipped with its reasons (the platform's own `!row.eligibility.eligible`, `workflow.ts:2940`); a satisfied (or
 * otherwise terminal) Task is where the platform skips (`workflow.ts:2936-2937`); an occupied line names its holder.
 * Even an eligible, unsatisfied Task on a free line never proves a claimable window: `eligibility` is only the
 * Task-state check, and the platform also checks claim deferral/occupancy (`plan-service.ts:1032`,
 * `workflow.ts:2936`), so that case says it cannot confirm a claim.
 */
export const claimableVerdict = window => {
  if (window === null || window.gaps.length > 0 || window.run === null || window.task === null || window.line === null) {
    return '无法确认可领取';
  }
  const eligibility = window.task.eligibility ?? null;
  if (eligibility === null) return '无法确认可领取';
  if (eligibility.eligible !== true) {
    const reasons = (eligibility.reasons ?? []).map(reason => reason?.code ?? JSON.stringify(reason));
    return `观察时（${window.letter.observedAt ?? '缺口'}）Task 不可领取，平台会跳过（eligibility ${String(eligibility.eligible)}${
      reasons.length === 0 ? '' : `：${reasons.join(', ')}`}）`;
  }
  if (window.task.effectivePhase === 'satisfied' || window.task.effectivePhase === 'failed'
    || window.task.disposition !== 'active') {
    const how = window.task.effectivePhase === 'satisfied' ? '已满足'
      : window.task.effectivePhase === 'failed' ? '已失败' : `处置 ${window.task.disposition ?? '-'}`;
    return `观察时（${window.letter.observedAt ?? '缺口'}）Task ${how}（${window.task.effectivePhase ?? '-'}/${window.task.disposition ?? '-'}），平台会跳过`;
  }
  const occupancy = window.line.occupancy ?? null;
  if (window.line.availability !== 'idle' || occupancy !== null) {
    const holding = [];
    if (window.line.availability !== 'idle') holding.push(`availability ${window.line.availability ?? '-'}`);
    if (occupancy !== null) holding.push(`${occupancy.kind ?? '占用'} ${occupancy.executionRef?.runId ?? occupancy.executionRef?.queryJobId ?? '-'}`);
    return `观察时（${window.letter.observedAt ?? '缺口'}）线 ${window.line.sessionId} 被 ${holding.join('，')} 占着`;
  }
  return '观察时无法确认可领取（eligibility 只是 Task 状态资格，平台还会查领取暂缓/占用：plan-service.ts:1032、workflow.ts:2936）';
};

/**
 * P6K (diagnosis "只能等第六次" table, waiting row): extra evidence only, judged nowhere. It copies what the public
 * reads already give — the original letter's `expiredAt`, the interjection Run's final answer and `endedAt`, the moment
 * the Task became satisfied, the Runs of that Task that carry a continuation (with their claim and start times), and the
 * letter's `acceptedInputs`. P6K ruling (waiting satisfied moment): the satisfying moment is the CURRENT effective
 * satisfied reduction's `reducedAt` (`plan-service.ts:1010`, `plan-readers.ts:2562`), never derived from a Run; the
 * satisfying Run's own `endedAt` is kept beside it, and a missing reduction is a gap ("归约证据缺失"). The note opens
 * with the `expiredAt`–`satisfiedAt` window so a continuation that was claimable during it can be read. P6K ruling
 * (waiting window): the expiry poll passes in the moment it took (`expiryWindow`, whose `expiredAt` and `observedAt`
 * stay separate), and the final `acceptedInputs` come from the last successfully read original letter of the chain
 * (`chainLetter`), not an older re-read, so an acceptance the chain saw is never dropped and each entry keeps its
 * `executionRef`. When the chain read nothing, that is a gap and the last previously known acceptance (`lastLetter`,
 * the restart re-read) is kept instead of falling back to the older `letter` the expiry poll took. Read failures go
 * into `gaps`, into the note; nothing here throws or judges. `letter` is the already-read `messages/read` snapshot, so
 * no read is repeated for it.
 */
export async function waitingEvidence(project, rec, { goalRef, wait = null, taskId, interjectRunId = null, letter = null,
  window = null, chainLetter = null, lastLetter = null } = {}) {
  const gaps = [];
  const evidence = { letter: wait?.messageRef?.messageId ?? null, expiredAt: null, observedAt: null, interject: null,
    satisfiedAt: null, satisfiedRunId: null, satisfiedRunEndedAt: null, continuations: [], claimable: null,
    acceptedInputs: [], gaps };
  evidence.expiredAt = letter?.expiredAt ?? null;
  evidence.observedAt = window?.letter?.observedAt ?? null;
  if (evidence.expiredAt === null) gaps.push('原信没有 expiredAt');
  const runs = await executions(project, goalRef, gaps);
  if (interjectRunId === null) gaps.push('插话 Run：没有 Run 接这条插话');
  else {
    const row = runs.find(item => item.run.ref.runId === interjectRunId) ?? null;
    if (row === null) gaps.push(`插话 Run ${interjectRunId}：executions/list 里没有`);
    else {
      const final = lastFinalOf(turnsOf(await runHistory(project, row.run.ref, gaps)));
      evidence.interject = { runId: interjectRunId, endedAt: row.run.endedAt ?? null, final };
      if (row.run.endedAt == null) gaps.push(`插话 Run ${interjectRunId} 没有 endedAt`);
      if (final === null) gaps.push(`插话 Run ${interjectRunId} 的轮里没有最终回答`);
    }
  }
  const taskBody = await project.host.client.read('tasks/query', project.scope, { goalRef });
  const graph = ready(taskBody);
  if (graph === null) gaps.push(taskBody === null ? 'tasks/query 没有回答' : `tasks/query: ${taskBody?.status ?? 'no answer'} ${taskBody?.code ?? ''}`.trim());
  if (graph !== null) {
    const task = (graph.tasks ?? []).find(entry => entry.ref.taskId === taskId);
    if (task === undefined) gaps.push(`tasks/query 里找不到 ${taskId}`);
    else if (task.effectivePhase !== 'satisfied') gaps.push(`Task ${taskId} 还不是 satisfied（${task.effectivePhase ?? '-'}）`);
    else {
      const reduction = task.reduction ?? null;
      if (reduction?.phase !== 'satisfied' || reduction.reducedAt == null) gaps.push(`Task ${taskId} 的归约证据缺失`);
      else evidence.satisfiedAt = reduction.reducedAt;
      const runId = task.execution?.runId ?? null;
      const row = runId === null ? null : runs.find(item => item.run.ref.runId === runId) ?? null;
      evidence.satisfiedRunId = runId;
      if (runId === null) gaps.push(`让 Task ${taskId} 满足的 Run 在 tasks/query 行里没有`);
      else if (row?.run.endedAt == null) gaps.push(`让 Task ${taskId} 满足的 Run ${runId} 在 executions/list 里没有 endedAt`);
      else evidence.satisfiedRunEndedAt = row.run.endedAt;
    }
  }
  const linked = item => item.run.requeueRef != null || item.run.continuation != null
    || item.run.consumedWait != null || item.run.previousRun != null;
  evidence.continuations = runs.filter(item => item.run.task?.taskId === taskId && linked(item)).map(item => ({
    runId: item.run.ref.runId, status: item.run.status ?? null, outcome: item.run.outcome ?? null, endedAt: item.run.endedAt ?? null,
    claim: claimSession(item), claimedAt: item.outbox?.claim?.claimedAt ?? null, startedAt: item.run.startedAt ?? null,
    requeueRef: item.run.requeueRef ?? null, continuation: item.run.continuation ?? null,
    consumedWait: item.run.consumedWait ?? null, previousRun: item.run.previousRun ?? null }));
  evidence.claimable = { window, verdict: claimableVerdict(window) };
  const letterRead = chainLetter ?? lastLetter;
  if (chainLetter === null) {
    gaps.push(lastLetter === null ? '追链没有成功读到的原信，此前也没有已知的接受读数'
      : '追链没有成功读到的原信，接受记录沿用此前最后一次已知的读数');
  }
  const accepted = letterRead?.acceptedInputs ?? null;
  if (accepted === null) gaps.push('追链和此前读数都没有 acceptedInputs');
  else evidence.acceptedInputs = accepted.map(entry => ({ ...entry, part: entry.part ?? null,
    consumesWait: entry.consumesWait === true, acceptedAt: entry.acceptedAt ?? null }));
  const continuations = evidence.continuations.length === 0 ? '无'
    : evidence.continuations.map(entry => `${entry.runId} ${entry.status}/${entry.outcome ?? '-'}，ended ${
      entry.endedAt ?? '-'}，claim ${entry.claim ?? '-'}，claimed ${entry.claimedAt ?? '缺口'}，started ${
      entry.startedAt ?? '缺口'}，requeueRef ${entry.requeueRef?.runId ?? '-'}，continuation ${
      entry.continuation?.kind ?? '-'}/${entry.continuation?.messageRef?.messageId ?? '-'}，consumedWait ${
      entry.consumedWait?.kind ?? '-'}，previousRun ${entry.previousRun?.runId ?? '-'}`).join('；');
  const acceptedText = evidence.acceptedInputs.length === 0 ? '无（0 条接受）'
    : evidence.acceptedInputs.map(entry => `${entry.part}/${entry.consumesWait}@${entry.acceptedAt ?? '-'}`).join(', ');
  const w = evidence.claimable.window;
  const occupancyText = w?.line?.occupancy == null ? '无'
    : `${w.line.occupancy.kind ?? '占用'} ${w.line.occupancy.executionRef?.runId ?? w.line.occupancy.executionRef?.queryJobId ?? '-'}`;
  const windowText = w === null ? '观察时缺失（没有观察到 expiredAt）'
    : `原信 ${w.letter.messageId} expiredAt ${w.letter.expiredAt}；observedAt ${w.letter.observedAt ?? '缺口'}；原 Run ${
      w.run?.runId ?? '-'} ${w.run?.status ?? '-'}/ended ${w.run?.endedAt ?? '缺口'}；Task ${
      w.task?.disposition ?? '-'}/${w.task?.effectivePhase ?? '-'}；线 ${w.line?.sessionId ?? '-'} ${
      w.line?.availability ?? '-'}/占用 ${occupancyText}${w.gaps.length === 0 ? '' : `；缺口 ${w.gaps.join('；')}`}`;
  rec.facts.waitingEvidence = evidence;
  rec.note(`P6K waiting 取证（窗口 expiredAt ${evidence.expiredAt ?? '缺口'}–satisfiedAt ${evidence.satisfiedAt ?? '缺口'}；原信 ${
    evidence.letter ?? '-'}；只取证，不改判据）：原信 expiredAt ${evidence.expiredAt ?? '缺口'}；observedAt ${
    evidence.observedAt ?? '缺口'}；插话 Run ${evidence.interject?.runId ?? '无'} 的最终回答「${
    evidence.interject?.final ?? '缺口'}」，结束 ${evidence.interject?.endedAt ?? '缺口'}；Task ${taskId} 的满足时刻 ${
    evidence.satisfiedAt ?? '缺口'}（Task 的 satisfied 归约 reducedAt${
    evidence.satisfiedRunId === null ? '' : `；让任务满足的 Run ${evidence.satisfiedRunId} 结束于 ${
      evidence.satisfiedRunEndedAt ?? '缺口'}`}）；到期窗口证据：${windowText}；判定：${evidence.claimable.verdict}；接续：${
    continuations}；acceptedInputs：${acceptedText}${gaps.length === 0 ? '' : `；读缺口：${gaps.join('；')}`}`);
  return evidence;
}

/**
 * P6K ruling (waiting real finalize): the close tail of `run()` — the extra evidence and the `consumes` verdict on the
 * member's current wait — as one entry, so a test can feed the same path the scenario takes (`tasks/query` empty
 * included) instead of hand-writing the later verdict. `chain` is `followChain`'s result; `memberLines` re-reads the
 * lines that ran the Task.
 */
export async function finalizeWaiting(project, rec, { goalRef, wait, taskId, interjectRunId = null, letter = null,
  window = null, chainLetter = null, lastLetter = null, chain, memberLines }) {
  const evidence = await waitingEvidence(project, rec, { goalRef, wait, taskId, interjectRunId, letter, window,
    chainLetter, lastLetter });
  // P6 diagnosis 2 #28: `consumes` is judged on the member's current wait — the first message of the chain, else the
  // member's other waits (a continuation line may have asked again) — that has acceptances; a wait nobody accepted yet
  // is not run here (the platform half of #26 is judged on restart-kept), never a fail on an empty list.
  const memberWaits = [];
  for (const entry of (await memberSends(project, await memberLines())).filter(item => item.args?.waitAfterSend === true)) {
    if (!memberWaits.some(item => item.ref.messageId === entry.ref.messageId)) memberWaits.push({ ref: entry.ref, line: entry.line });
  }
  const current = [];
  for (const candidate of [...chain.chain.map((value, index) => ({ ref: chain.chainRefs[index], value })),
    ...await Promise.all(memberWaits.filter(item => !chain.chainRefs.some(ref => same(ref, item.ref)))
      .map(async item => ({ ref: item.ref, value: await message(project, item.ref) })))]) {
    if ((candidate.value?.acceptedInputs ?? []).length > 0) current.push(candidate);
  }
  const consumedOn = current[0] ?? null;
  const accepted = consumedOn?.value?.acceptedInputs ?? [];
  if (consumedOn === null) {
    rec.uncover('consumes', 'not-run', `成员的等待（${[...chain.chainRefs, ...memberWaits.map(item => item.ref)].map(ref => ref.messageId).join(', ')}）还没有一条被执行接受，消费无从判`);
  } else {
    rec.check('consumes', accepted.filter(entry => entry.consumesWait === true).length === 1,
      `等待 ${consumedOn.ref.messageId} 的接受条目：${accepted.map(entry => `${entry.part}:${entry.consumesWait}@${entry.acceptedAt}`).join(', ')}（只认一次真实接受消费等待）`);
  }
  return { evidence, memberWaits };
}

/** Bodies of host notices already read, by messageId: a notice's text never changes. */
const bodies = new Map();

/**
 * P6 #14: the platform's own notices in a line's inbox: sender `host`, `wake: false`, no reply wanted
 * (`host-notices.ts:17-26`); inbox items carry only a bodyRef, so the text comes from `messages/body`. Only those
 * whose text starts with `head` (`断开通知` `:99`, `中断通知` `:146`).
 */
async function hostNotices(project, recipient, head) {
  const items = ready(await project.host.client.read('messages/inbox', project.scope, { recipient, page: { limit: 100 } }))?.items ?? [];
  const out = [];
  for (const item of items.filter(entry => entry.sender?.kind === 'host' && entry.wake === false && entry.needsReply !== true)) {
    const id = item.ref?.messageId;
    if (!bodies.has(id)) bodies.set(id, await messageBody(project, item.ref));
    const body = bodies.get(id);
    if (typeof body === 'string' && body.startsWith(head)) out.push({ item, body });
  }
  return out;
}

/** Poll `read` until `done` or `ms` passes and return the last value; nothing is judged here (the caller judges). */
async function watch(ctx, read, done, ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    await ctx.budget.tick();
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await sleep(10_000);
  }
}

/**
 * Follow the same wait chain event by event (second review #12): the first question and every follow-up that names
 * it. It ends only on facts: both events came (a second real expiry, and a late reply unless the first was answered
 * before its expiry); or the chain is over (the Task is no longer active-unsatisfied and every wait of the chain is
 * settled); or the authorization window ends. A quiet moment is never taken as the end. P6 #18: a late reply that is
 * saved but not yet accepted (a reply opens no round) is an event too.
 * P6J4: every poll also runs the README question's round (`secondQuestionRound`) with the receiver re-chosen then.
 */
export async function followChain(ctx, project, { memberLines, first, goalRef, windowEnd, receiverOf = async () => undefined }) {
  const capAt = Date.now() + CHAIN_CAP_MS;
  let taskDoneAt = null;
  // P6J waiting: the independent second question is followed on every poll beside the first chain, so its open window
  // is observed even while the first chain still waits. Its read gaps are kept apart from the first chain's.
  let second = null;
  let transfer = null;
  // P6K ruling (waiting accepted record): the last successfully read original letter of the chain, passed to the evidence.
  let lastLetter = null;
  for (;;) {
    await ctx.budget.tick();
    const chainGaps = [];
    const secondGaps = [];
    const sendGaps = [];
    const sends = await memberSends(project, await memberLines(sendGaps), sendGaps);
    chainGaps.push(...sendGaps);
    secondGaps.push(...sendGaps);
    // lead 11-25 (P6 run: the chain read [647b, 647b]): one entry per message id, the first question never twice.
    const followups = sends.filter(entry => entry.args?.followupOf?.messageId === first.messageRef.messageId).map(entry => entry.ref);
    const chainRefs = [...new Map([first.messageRef, ...followups].map(ref => [ref.messageId, ref])).values()];
    const chain = [];
    for (const ref of chainRefs) chain.push(await message(project, ref, chainGaps));
    if (chain[0] != null) lastLetter = chain[0];
    // P6J waiting: one shared round — lock the README question first, re-read it, re-select the qualified receiver on
    // this round, and transfer at most once. A reply that came first is judged on its acceptance by `judgeSecond`.
    const round = await secondQuestionRound(project, { sends, chainRefs, prior: second, receiverOf });
    if (round !== null) {
      second = round;
      transfer = round.attempt ?? transfer;
      secondGaps.push(...(round.gaps ?? []));
    }
    const expired = chain.filter(value => value?.expiredAt != null).length;
    const late = lateReplyOf(chain[0]);
    const saved = lateSaved(chain[0]);
    const answeredFirst = chain[0]?.expiredAt == null
      && (chain[0]?.response != null || (chain[0]?.acceptedInputs ?? []).some(entry => entry.part === 'response'));
    const taskGaps = [];
    const taskBody = await project.host.client.read('tasks/query', project.scope, { goalRef });
    const task = ready(taskBody)?.tasks?.find(entry => entry.ref.taskId === 't-wait');
    if (ready(taskBody) === null && taskBody?.status !== 'not_found') taskGaps.push(`tasks/query: ${taskBody?.status ?? 'no answer'} ${taskBody?.code ?? ''}`);
    chainGaps.push(...taskGaps);
    const taskOpen = task === undefined || (task.disposition === 'active' && task.effectivePhase !== 'satisfied');
    const over = !taskOpen && chain.every(settledWait);
    // A direct follow-up gets expiry count 2 when its parent has an expiry record. A second expiry is an event only
    // with what follows it: its own expiry acceptance and the accepted input saying "第 2 次到期" in its first line, the
    // platform's notice (`wait-expiry-delivery.txt`; the question quoted below it may repeat the words). Until then the
    // chain is not done. A reply may be written before its expiry, so a message may have no `expiredAt` at all.
    const secondConsumer = chain[1]?.acceptedInputs?.find(entry => entry.consumesWait === true);
    const expiryIndex = chain[0]?.expiredAt == null ? -1
      : chain.findIndex((value, index) => index > 0 && expiryConsumerOf(value) !== undefined);
    const secondAccepted = expiryIndex !== -1;
    const expiryInput = secondAccepted
      ? await readExpiryInput(project, expiryConsumerOf(chain[expiryIndex]).executionRef, chainRefs[expiryIndex])
      : null;
    const secondSaid = expiryInput !== null && /第\s*2\s*次到期/.test(expiryInput.text.split('\n', 1)[0]);
    // 任务一旦不再开着就记下时刻；之后又开着（例如返工）就清掉重计。
    taskDoneAt = taskOpen ? null : taskDoneAt ?? Date.now();
    const now = Date.now();
    const ended = secondAccepted && secondSaid && (late !== undefined || saved || answeredFirst) ? 'events' : over ? 'chain-over'
      : taskDoneAt !== null && now - taskDoneAt > TASK_DONE_GRACE_MS ? 'task-done'
      : now > capAt ? 'cap' : now > windowEnd ? 'window' : null;
    if (ended !== null) return { chain, chainRefs, letter: lastLetter, expired, late, saved, answeredFirst, ended, task,
      secondAccepted, secondConsumer, secondSaid, expiryInput, gaps: chainGaps, secondGaps, second, transfer };
    await sleep(15_000);
  }
}

async function run(ctx, rec) {
  const project = await openProject(ctx, ctx.hosts['w-accept'], 'wait', SEED);
  rec.facts.project = project;
  rec.facts.model = await chooseModel(ctx, project.host, project);
  rec.facts.userCommand = [SEED_REQUEST];
  // The seed brings the trusted checks a settings workspace gets only from a cold-start adoption (README "Seed Goals").
  const seed = await coldStart(ctx, project, SEED_REQUEST, rec);
  await waitGoal(ctx, project, seed.goalRef, { timeoutMs: 60 * MINUTE, rec });
  const rows = await lines(project);
  const secretary = rows.find(row => row.duty === 'secretary');
  if (secretary === undefined) throw broken(ctx, 'after the seed Goal, lines/list has no secretary line');
  await ensurePolicy(ctx, project, ['static']);
  const goalId = newId('g6-wait');
  const goal = await createGoal(ctx, project, goalId, '先问清楚 num.js 的导出，再加 triple(n)', rec);
  await proposeAndApply(ctx, project, goal.ref, draft(goalId, secretary.key.sessionId), 'waiting: the member asks and waits', rec,
    [testCheck(goalId, ['t-wait', 'gate'])]);
  rec.facts.userCommand.push(`goals/create + plans/propose（t-wait 的指令：${instruction(secretary.key.sessionId)}）`);
  await driverStart(ctx, project, goal.ref, { flowId: newId('wait'), taskId: 't-wait' });

  // The member is the line whose Run works the Task; its own wait is the subject from here on.
  const work = await waitFor(ctx, 'the member\'s Work Run', async () => (await executions(project, goal.ref))
    .find(item => item.run.task.taskId === 't-wait' && item.outbox?.claim?.sessionRef !== undefined) ?? null, value => value !== null,
  { timeoutMs: 40 * MINUTE, check: 'wait-open' });
  const member = { projectId: work.outbox.claim.sessionRef.projectId, sessionId: work.outbox.claim.sessionRef.sessionId };
  // P6 diagnosis 2 #29: after the restart t-wait can go on in a continuation Session (crash → requeue → new line);
  // every line that ran t-wait is the member from then on, the first one first and the newest last.
  const memberLines = async (gaps = null) => {
    const lines = new Map([[member.sessionId, member]]);
    const runs = (await executions(project, goal.ref, gaps)).filter(item => item.run.task.taskId === 't-wait' && claimSession(item) !== null)
      .sort((left, right) => (Date.parse(left.run.startedAt ?? '') || 0) - (Date.parse(right.run.startedAt ?? '') || 0));
    for (const item of runs) {
      const ref = item.outbox.claim.sessionRef;
      if (!lines.has(ref.sessionId)) lines.set(ref.sessionId, { projectId: ref.projectId, sessionId: ref.sessionId });
    }
    return [...lines.values()];
  };
  const waitsOfMembers = async () => (await Promise.all((await memberLines()).map(line => waitsOf(project, line)))).flat();
  // lead 11-18（G6 第十一次）：成员的 Run 已结束、结局不是 yielded、又没开等待，再等也不会有等待了：收，
  // 写出它 send_session_message 的拒绝原文（wait-open 判 fail，用平台自己的话）。指令里不补项目号：补了会盖住平台缺口。
  // 检查 FAIL 以后，返工 Run 要等检查轮定稿、自动返工才建：这个任务没有别的没结束的 Run、第一个 Run 结束满 2 分钟才收。
  let noWait = null;
  const wait = await waitFor(ctx, 'the member\'s open wait', async () => {
    const open = (await waitsOf(project, member)).find(entry => entry.state?.state === 'open') ?? null;
    if (open !== null) return open;
    const runs = (await executions(project, goal.ref)).filter(item => item.run.task.taskId === 't-wait');
    const first = runs.find(item => JSON.stringify(item.run.ref) === JSON.stringify(work.run.ref));
    const live = runs.some(item => item.run.status !== 'ended');
    const since = first?.run?.endedAt == null ? 0 : Date.now() - Date.parse(first.run.endedAt);
    if (first?.run.status === 'ended' && first.run.outcome !== 'yielded' && !live && since >= 2 * MINUTE) {
      // 只读这个 Run 的轮：成员线可能是被复用的种子目标执行者线，整条线的历史会混进种子 Run 的拒绝。
      const refused = turnsOf(await runHistory(project, work.run.ref)).flatMap(turn => turn.refusals)
        .filter(entry => entry.tool === 'send_session_message');
      noWait = `成员的 Work Run ${work.run.ref.runId} 已结束（${first.run.outcome ?? '-'}），没开等待；send_session_message ${
        refused.length === 0 ? '没被拒（没调，或没带 waitAfterSend）'
          : `被拒 ${refused.length} 次：${refused.map(entry => `${entry.code}: ${entry.reason}`).join('；')}`}`;
    }
    return null;
  }, value => value !== null, { timeoutMs: 30 * MINUTE, check: 'wait-open', ended: () => noWait });
  rec.link('message', wait.messageRef);
  const sentRecord = await message(project, wait.messageRef);
  const toolCall = (await sessionTurns(project, member)).flatMap(turn => [...turn.calls.values()])
    .find(call => call.name === 'send_session_message' && call.status === 'tool.completed' && call.args?.waitAfterSend === true);
  // P6: the save really yielded: the Run that sent the wait (`waits[].originalRun`) ended `yielded` and its
  // continuation names this wait (`dispatch.ts:121`, `:287-288`). The yield follows the durable save, so it is
  // waited for briefly.
  const yieldRunId = wait.originalRun?.runId ?? work.run.ref.runId;
  const yielded = await orNull(waitFor(ctx, 'the waiting Run to yield', async () => (await executions(project, goal.ref))
    .find(item => item.run.ref.runId === yieldRunId) ?? null, item => item?.run.status === 'ended', { timeoutMs: 5 * MINUTE, check: 'wait-open' }));
  const continuation = yielded?.run.continuation ?? null;
  const yieldOk = yielded?.run.outcome === 'yielded' && continuation?.messageRef?.messageId === wait.messageRef.messageId;
  rec.check('wait-open', toolCall !== undefined && sentRecord?.waitAfterSend === true && sentRecord?.needsReply === true && wait.deadline !== null
    && wait.recipient?.sessionId === secretary.key.sessionId && yieldOk,
  `成员 ${member.sessionId} 的 Work（Run ${work.run.ref.runId}）经工具发出等待 ${wait.messageRef.messageId}：收信人 ${wait.recipient?.sessionId}，期限 ${wait.deadline}，waitAfterSend ${
    sentRecord?.waitAfterSend}；发信的 Run ${yieldRunId} ${yielded?.run.status ?? '?'}/${yielded?.run.outcome ?? '-'}，continuation ${
    continuation === null ? '无' : `${continuation.kind} → ${continuation.messageRef?.messageId}`}`);

  // P6 Q8: while this wait is open (the one moment the driver reliably holds it open) and before the close, the
  // person interjects on the member line through the UI's direct-intervention entry. The member's Task is unfinished
  // and its line idle (yielded), so the message claims the Task: a Run with `consumedWait.kind === 'intervention'`
  // (`dispatch.ts:330`), which consumes no wait; the Host then sends each party of the line's open waits one
  // interruption notice (`host.ts:3359`, `host-notices.ts:113-146`). That Run is an extra turn on the member line the
  // chain below runs after; the notes say so.
  // P6K (diagnosis "只能等第六次" waiting row): the Run that claims the interjection is kept for the evidence read below.
  let interjectRunId = null;
  const interruptBefore = {
    member: new Set((await hostNotices(project, member, '中断通知')).map(entry => entry.item.ref.messageId)),
    secretary: new Set((await hostNotices(project, secretary.key, '中断通知')).map(entry => entry.item.ref.messageId)),
  };
  const memberRow = (await lines(project)).find(row => row.key.sessionId === member.sessionId) ?? null;
  const interject = await interveneLine(project, member, INTERJECT,
    { goalRef: memberRow === null ? goal.ref : pageGoalRef(project, memberRow, goal.ref) });
  rec.facts.userCommand.push(INTERJECT);
  if (!interject.ok) rec.fail('interject-keeps-wait', `等待 ${wait.messageRef.messageId} 开着时插话被拒：${interject.said}`);
  else {
    rec.link('message', interject.value.ref, interject.value.revision ?? null);
    const fresh = async (who, before) => (await hostNotices(project, who, '中断通知'))
      .filter(entry => !before.has(entry.item.ref.messageId) && entry.body.includes(`Session ${member.sessionId}`));
    const after = await watch(ctx, async () => ({
      run: (await executions(project, goal.ref)).find(item => item.run.consumedWait?.kind === 'intervention'
        && item.run.consumedWait.messageRef?.messageId === interject.value.ref.messageId) ?? null,
      member: await fresh(member, interruptBefore.member), secretary: await fresh(secretary.key, interruptBefore.secretary),
    }), value => value.run !== null && value.member.length > 0 && value.secretary.length > 0, INTERJECT_WATCH_MS);
    interjectRunId = after.run?.run.ref.runId ?? null;
    const kept = (await waitsOf(project, member)).find(entry => same(entry.messageRef, wait.messageRef));
    // Under the default wake the secretary may answer within the 2-minute deadline: `sessions/facts` then lists the wait
    // as answered, or not at all once a Run consumed it (`session-facts-contracts.ts:87-88`); the record is read then.
    const record = kept?.state?.state === 'open' ? null : await message(project, wait.messageRef);
    const keptOk = kept !== undefined ? kept.deadline === wait.deadline && ['open', 'expired', 'answered'].includes(kept.state?.state)
      : record !== null && record.deadline === wait.deadline && record.withdrawnAt == null && record.waitCancelledAt == null;
    // Answered or expired before the interjection was claimed: no interruption notice (only open waits get one,
    // `host-notices.ts:119-125`) and the message may go into the continuing Run instead of its own.
    const closedAt = record?.response?.respondedAt ?? record?.expiredAt ?? null;
    const noticesOk = after.member.length > 0 && after.secretary.length > 0;
    const text = `插话 ${interject.value.ref.messageId}（${interject.sendStatus}）：接它的 Run ${after.run?.run.ref.runId ?? '无'}（consumedWait ${
      after.run?.run.consumedWait?.kind ?? '-'}，在 ${claimSession(after.run) ?? '-'}）；原等待 ${wait.messageRef.messageId} ${
      kept === undefined ? `不在 sessions/facts 里（原记录：期限 ${record?.deadline ?? '-'}，回复 ${record?.response?.respondedAt ?? '无'}，到期 ${record?.expiredAt ?? '无'}）`
        : `${kept.state?.state}，期限 ${kept.deadline}（原 ${wait.deadline}）`}；新中断通知 成员侧 ${after.member.length} 条、秘书侧 ${after.secretary.length} 条`;
    if (after.run === null && closedAt !== null) {
      rec.uncover('interject-keeps-wait', 'not-run', `${text}：插话被领之前原等待已回复或到期（${closedAt}，默认叫醒下秘书先答），没有开着的等待可保留，也不会发中断通知`);
    } else if (after.run === null) rec.fail('interject-keeps-wait', `${text}：${INTERJECT_WATCH_MS / MINUTE} 分钟里没有 Run 接这条插话`);
    else if (!keptOk) rec.fail('interject-keeps-wait', `${text}：原等待没有保留`);
    else if (!noticesOk && kept?.state?.state !== 'open') {
      rec.uncover('interject-keeps-wait', 'env-unavailable', `${text}：原等待现在已不开着（${kept?.state?.state ?? '已被消费'}），插话被领时它可能已不开着（中断通知只发给开着的等待的两侧，host-notices.ts:119-125），通知这一半无从判`);
    } else rec.check('interject-keeps-wait', noticesOk, text);
    rec.note(`P6 Q8 插话在第一个等待开着时发出；它让成员线多开了一个 Run（${after.run?.run.ref.runId ?? '无'}），之后的到期链在这之后发生`);
  }

  // P6 diagnosis 2 #26 (driver half): a member Run still working at the close (e.g. the interjection's) is interrupted
  // by it and comes back as a crash and an ordinary requeue, not as the wait's continuation; the close is not delayed
  // (the 2-minute deadline must fall while the Host is down), so the Runs alive at the close are recorded and the
  // continuation half of restart-kept reads as not reached when one was.
  const liveAtClose = (await executions(project, goal.ref)).filter(item => item.run.task.taskId === 't-wait' && item.run.status !== 'ended')
    .map(item => ({ runId: item.run.ref.runId, status: item.run.status }));
  const startingAtClose = liveAtClose.filter(item => item.status === 'starting').map(item => item.runId);
  const runningAtClose = liveAtClose.filter(item => item.status === 'running').map(item => item.runId);
  if (startingAtClose.length > 0) {
    rec.note(`关 Host 时 t-wait 的 Run 在 starting（${startingAtClose.join(', ')}）：已领取、未进入，重启后同一次领取续驱（W-01..W-03），不是等待的接续`);
  }
  if (runningAtClose.length > 0) {
    rec.note(`关 Host 时 t-wait 的 Run 在 running（${runningAtClose.join(', ')}）：重启后记中断、按普通重新入队接着做，不是等待的接续`);
  }
  // Normal close right away, down past the deadline, a new Host on the same ledger: the one checked close path.
  const closing = await ctx.close('w-accept', { restart: true, downUntil: Date.parse(wait.deadline) + MINUTE, check: 'restart-kept' });
  project.host = closing.host;
  rec.note(`close and restart: ${closing.closed}`);
  const settings = ready(await project.host.client.settings('snapshot', {}));
  rec.note(`restart: resumeOnStartup = ${settings?.automation?.resumeOnStartup}`);
  // P6 #16: under the default wake the reply can be written before the close and consumed by the continuing Run after
  // the restart; `sessions/facts` then no longer lists the wait (only open, answered, expired; `session-facts.ts:355`),
  // so the original record is the fallback; the note says which one was read.
  const keptWait = (await waitsOf(project, member)).find(entry => same(entry.messageRef, wait.messageRef));
  const keptRecord = keptWait === undefined ? await message(project, wait.messageRef) : null;
  const keptFrom = keptWait !== undefined ? `sessions/facts 的 waits（${keptWait.state?.state}）`
    : keptRecord === null ? null : '原消息记录 messages/read（已不在 waits 里，等待可能已被接续的 Run 消费）';
  const keptDeadline = keptWait?.deadline ?? keptRecord?.deadline ?? null;
  const keptRecipient = keptWait?.recipient ?? keptRecord?.recipient ?? null;
  const keptOk = keptFrom !== null && keptDeadline === wait.deadline && keptRecipient?.sessionId === wait.recipient?.sessionId;
  const keptText = `重启后同一等待：${keptFrom === null ? 'waits 和原记录都读不到' : `从${keptFrom}读到，期限 ${keptDeadline}（原 ${wait.deadline}），收信人 ${keptRecipient?.sessionId}`}`;
  if (!keptOk) rec.fail('restart-kept', keptText);

  // P6 diagnosis 2 #25: a wait the secretary answered before its deadline never expires (`expiredAt` stays null, the
  // reply sits in the reply slot with no acceptance yet); the wait ends on the reply too, and that branch is not run.
  // The expiry is then judged on the member's current wait at the end (`judgeCurrentExpiry`).
  // P6K ruling (waiting window): the FIRST poll that shows `expiredAt` also takes the moment's evidence once — the same
  // original letter, the original yielding Run, the Task's eligibility and the line's occupancy — inside this existing
  // poll, with no extra timer. A read that fails is a gap inside the point, never a throw.
  let expiryWindowPoint = null;
  // P6L2 A7: every successfully read original letter updates the one last-known snapshot; a later failed read never
  // erases an acceptance the chain already saw.
  let lastKnown = null;
  const expired = await waitFor(ctx, 'the expiry or the reply', async () => {
    const value = await message(project, wait.messageRef);
    if (value !== null) lastKnown = value;
    if (value?.expiredAt != null && expiryWindowPoint === null) {
      expiryWindowPoint = await expiryWindow(project, { goalRef: goal.ref, messageRef: wait.messageRef,
        expiredAt: value.expiredAt, runId: yieldRunId, taskId: work.run.task.taskId, line: member });
    }
    return value;
  }, value => value?.expiredAt != null || value?.response != null || (value?.acceptedInputs ?? []).length > 0,
    { timeoutMs: 20 * MINUTE, check: 'expiry-once' });
  const firstAccepted = expired.acceptedInputs ?? [];
  if (expired !== null) lastKnown = expired;
  const expiredFirst = expired.expiredAt != null;
  if (!expiredFirst) {
    rec.uncover('expiry-once', 'not-run', `收信方在到期之前就回答了（回复 ${expired.response?.respondedAt ?? '-'}；接受 ${
      firstAccepted.map(entry => entry.part).join(',') || '无'}），这条等待不会到期`);
  } else {
    const consumed = await orNull(waitFor(ctx, 'the expiry acceptance to consume the wait', async () => {
      const value = await message(project, wait.messageRef);
      if (value !== null) lastKnown = value;
      return value;
    }, value => (value?.acceptedInputs ?? []).some(entry => entry.consumesWait === true), { timeoutMs: 20 * MINUTE, check: 'expiry-once' }));
    rec.check('expiry-once', consumed !== null && (consumed.acceptedInputs.find(entry => entry.consumesWait)?.part === 'expiry'),
      `expiredAt ${expired.expiredAt}；记下时消费 ${firstAccepted.some(entry => entry.consumesWait)}；之后由 ${consumed?.acceptedInputs?.find(entry => entry.consumesWait)?.part ?? '无'} 消费`);
  }
  // P6: the continuing Run: the acceptance that consumed the wait names its Run, whose `consumedWait` is `expiry` or
  // `wait_reply` on this message with the original Run, on the member line (`dispatch.ts:289-290`, `:325-330`).
  // P6K: the re-read is kept for the waiting evidence below (null when restart-kept's first half did not read).
  let latest = null;
  if (keptOk) {
    latest = await message(project, wait.messageRef);
    if (latest !== null) lastKnown = latest;
    const consumer = (latest?.acceptedInputs ?? []).find(entry => entry.consumesWait === true) ?? null;
    const next = consumer?.executionRef?.aggregateType === 'Run'
      ? (await executions(project, goal.ref)).find(item => item.run.ref.runId === consumer.executionRef.runId) ?? null : null;
    const used = next?.run.consumedWait ?? null;
    const nextText = `${keptText}；消费它的接受 ${consumer === null ? '无' : `${consumer.part} → ${consumer.executionRef?.aggregateType} ${consumer.executionRef?.runId ?? ''}`}；接续的 Run ${
      next?.run.ref.runId ?? '-'} consumedWait ${used?.kind ?? '-'}，messageRef ${used?.messageRef?.messageId ?? '-'}，originalRun ${used?.originalRun?.runId ?? '-'}（原 ${yieldRunId}），在 ${claimSession(next) ?? '-'}（成员 ${member.sessionId}）`;
    if (consumer === null && liveAtClose.length > 0) {
      rec.uncover('restart-kept', 'not-run', `${nextText}：关 Host 时未结束的 Run ${liveAtClose.map(item => `${item.runId}(${item.status})`).join(', ')}；这一半没走到`);
    } else if (consumer === null) rec.uncover('restart-kept', 'not-run', `${nextText}：还没有一个执行接受消费这条等待，接续这一半没走到`);
    else if (used?.kind === 'intervention') rec.uncover('restart-kept', 'not-run', `${nextText}：等待在插话开的 Run 里被接受，接续不是新领的 Run`);
    else {
      rec.check('restart-kept', next !== null && ['expiry', 'wait_reply'].includes(used?.kind) && used.messageRef?.messageId === wait.messageRef.messageId
        && used.originalRun?.runId === yieldRunId && claimSession(next) === member.sessionId, nextText);
    }
  }

  // The rest of the chain, as it really comes (second review #12). The independent README question is followed in the
  // same rounds, and a qualified receiver line is re-selected on every round, so a line that qualifies later still lets
  // one transfer happen there, not after the first chain exits.
  const nextReceiver = receiverFor(project, { memberLines, secretary: secretary.key });
  const chain = await followChain(ctx, project, { memberLines, first: wait, goalRef: goal.ref, windowEnd: Date.parse(ctx.cfg.window.to),
    receiverOf: nextReceiver });
  const why = chain.ended === 'window' ? ['not-run', '授权窗口结束时还没来']
    : chain.ended === 'cap' ? ['not-run', `等了 ${CHAIN_CAP_MS / MINUTE} 分钟还没来`]
    : chain.ended === 'task-done' ? ['env-unavailable',
      `t-wait 已做完（${chain.task?.effectivePhase ?? '-'}），又等了 ${TASK_DONE_GRACE_MS / MINUTE} 分钟，链上 ${chain.chain.filter(value => !settledWait(value)).length} 条等待还没了结`]
    : ['env-unavailable', `等待链已结束（t-wait ${chain.task?.effectivePhase ?? '-'}，链上 ${chain.chain.length} 条等待都已了结）`];
  // "第 2 次到期" is rendered into the member's accepted input: judged on the expiry acceptance itself. When none was
  // found, a chain read with gaps may have missed it, so the gaps decide before the reply branch.
  if (chain.secondAccepted && chain.expiryInput.gaps.length > 0) {
    rec.uncover('second-expiry', 'env-unavailable', chain.expiryInput.gaps.join('；'));
  } else if (chain.secondAccepted) {
    rec.check('second-expiry', chain.secondSaid, `追问链的第二次到期已由 expiry 接受；该次输入首行写“第 2 次到期”：${chain.secondSaid}`);
  } else if (chain.gaps.length > 0) {
    rec.uncover('second-expiry', 'env-unavailable', chain.gaps.join('；'));
  } else if (chain.secondConsumer?.part === 'response') {
    rec.uncover('second-expiry', 'not-run', `第二封等待已由回复消费（${chain.secondConsumer.acceptedAt}），回复胜过到期（STATE-MACHINES-SPEC.md:3650）`);
  } else if (chain.expired >= 2) {
    rec.uncover('second-expiry', why[0], `${why[1]}；第二次到期已记下，但它的 expiry 接受和后继输入还没出现`);
  } else rec.uncover('second-expiry', why[0], `${why[1]}；同一追问链实际到期 ${chain.expired} 次（没有时钟缝，不伪造）`);

  // P6K (diagnosis "只能等第六次" waiting row): copy the extra waiting evidence into the notes and judge `consumes` on
  // the member's current wait, in one entry (`finalizeWaiting`); a read that fails goes into the note's gaps instead of
  // throwing, and the checks after the evidence still run.
  const { memberWaits } = await finalizeWaiting(project, rec, { goalRef: goal.ref, wait, taskId: work.run.task.taskId, interjectRunId,
    letter: expired, window: expiryWindowPoint, chainLetter: chain.letter, lastLetter: lastKnown, chain, memberLines });

  const firstOfChain = chain.chain[0];
  // P6 #18 / Q9, diagnosis 2 #28: a reply is late only after the expiry itself consumed the wait; one accepted then must
  // not consume; one saved and not yet accepted (a reply opens no round) is a pass: "已保存，等成员下一轮".
  if (chain.late !== undefined) rec.check('late-reply', chain.late.consumesWait === false, `迟回 ${chain.late.acceptedAt} consumesWait ${chain.late.consumesWait}`);
  else if (chain.saved) {
    rec.check('late-reply', true, `迟回 ${firstOfChain.response.respondedAt} 在到期 ${firstOfChain.expiredAt} 被 expiry 消费之后，已保存，等成员下一轮（回复不开轮，MVP-BEHAVIOR.md:310）`);
  } else if (chain.answeredFirst || !expiredFirst) rec.uncover('late-reply', 'not-run', '收信方在到期前就回答了，不会有迟回');
  else rec.uncover('late-reply', why[0], `${why[1]}；到期（${firstOfChain?.expiredAt}）被消费之后没有回复（回复槽空，也没有接受的回复）`);
  // P6 diagnosis 2 #25: when the first wait was answered before its deadline, the expiry is judged on the member's
  // current wait that did expire: recorded first, consumed later by its expiry or (a reply before that acceptance,
  // `STATE-MACHINES-SPEC.md:3650`) by the reply — never at the moment it was recorded.
  if (!expiredFirst) {
    for (const item of memberWaits.filter(entry => entry.ref.messageId !== wait.messageRef.messageId)) {
      const value = await message(project, item.ref);
      if (value?.expiredAt == null) continue;
      const consumer = (value.acceptedInputs ?? []).find(entry => entry.consumesWait === true) ?? null;
      const text = `第一条等待到期前已被回答，改看成员当前的等待 ${item.ref.messageId}（线 ${item.line.sessionId}）：expiredAt ${value.expiredAt}；消费它的接受 ${
        consumer === null ? '还没有' : `${consumer.part}@${consumer.acceptedAt}`}`;
      if (consumer === null) rec.note(`expiry-once：${text}，消费还没发生`);
      else rec.check('expiry-once', ['expiry', 'response'].includes(consumer.part) && Date.parse(consumer.acceptedAt) >= Date.parse(value.expiredAt), text);
      break;
    }
  }

  // The member's second question (long deadline), found by the member's own send. P6J waiting: `followChain` already
  // tracked it on every poll, so its open window was observed even while the first chain waited; only a second question
  // sent after the chain ended is watched for here.
  const isChain = ref => chain.chainRefs.some(entry => same(entry, ref));
  const secondSend = chain.second?.send ?? await watch(ctx, async () => {
    const sends = (await memberSends(project, await memberLines())).filter(entry => entry.args?.waitAfterSend === true && !isChain(entry.ref));
    return secondQuestionOf(sends, chain.chainRefs);
  }, value => value !== null, 30 * MINUTE);
  const seenOpen = chain.second === null ? '链结束后才读到'
    : `第一次在 ${chain.second.firstSeenAt} 轮询到（当时回复 ${chain.second.firstValue?.response?.respondedAt ?? '无'}，到期 ${chain.second.firstValue?.expiredAt ?? '无'}）`;
  // P6 diagnosis 2 #29: re-read after the restart; never a member line (a continuation line is one too).
  if (secondSend === null) {
    const noSecond = '成员 30 分钟里没有发第二个要等的问题（waitAfterSend、不在第一条等待链上），这一支没走到';
    rec.uncover('reply-first', 'not-run', noSecond);
    rec.uncover('transfer', 'not-run', `${noSecond}，转交无从做起`);
    rec.note(`waiting: ${noSecond}；reply-first、transfer 记未覆盖（lead 11-25）`);
  } else {
    rec.link('message', secondSend.ref);
    await closeSecondQuestion(ctx, project, rec, { chain, secondSend, seenOpen, receiverOf: nextReceiver });
  }
  // P6HD (diagnosis row 14): the public read already gives the acceptance order (`run.input_accepted` with its
  // `sourceRef` and text, `flows.mjs` `turnsOf`); copy it in order, per Run and turn, keeping the source ref. Whether
  // acceptance order equals supply order has no written basis, so this is a note and `not-run`, never a pass. Only an
  // unreadable order is `entry-missing`.
  const supplied = [];
  for (const line of await memberLines()) {
    for (const turn of await sessionTurns(project, line)) {
      for (const entry of turn.accepted) {
        const ref = entry.sourceRef;
        supplied.push(`${turn.runId}/${turn.turnId}: ${ref?.kind ?? '-'}/${ref?.part ?? '-'} ${ref?.messageRef?.messageId ?? '-'} ${
          entry.text.replace(/\s+/g, ' ').slice(0, 120)}`);
      }
    }
  }
  if (supplied.length > 0) {
    rec.note(`供给顺序旁证（run.input_accepted 的接受顺序，不作判据）：${supplied.join(' ｜ ')}`);
    rec.uncover('supply-order', 'not-run', `公开读口给出 ${supplied.length} 项接受顺序（见 notes），但“接受顺序等于供给顺序”没有书面依据，不判 pass`);
  } else rec.uncover('supply-order', 'entry-missing', '成员线的 turn 历史里读不到任何 run.input_accepted，接受顺序无从读');
  rec.note(`等待链 ${chain.chainRefs.map(ref => ref.messageId).join(' → ')}；结束方式 ${chain.ended}`);

  // Lead ruling Q7, the last step (second review #16: both sides). Re-read the member's waits, take one still open,
  // archive the line on its far side; the queue must show a `disconnect` item for that wait and that line, and each
  // side must get its own new Host notice naming that line (`disconnect-notices.ts:66-69`, `:186-194`;
  // `host-notices.ts:99`: "断开通知 · Session X · …").
  const picked = await disconnectTarget(project, await memberLines());
  if (picked.target === null) {
    rec.uncover('disconnect', picked.code, picked.note);
    return;
  }
  const { target, holder } = picked;
  const far = { projectId: target.recipient.projectId, sessionId: target.recipient.sessionId };
  // Quick check #16 / P6 #14: a notice is the platform's own (`host`, `wake:false`, no reply wanted) and its body,
  // read through `messages/body`, names that line. Each must then be tied to THIS wait: a notice whose body or public
  // record does not carry the wait's message cannot be tied, so the check is then `uncovered` with that missing link,
  // never a pass on "a notice arrived".
  const notices = async recipient => (await hostNotices(project, recipient, '断开通知'))
    .filter(entry => entry.body.includes(`Session ${far.sessionId}`));
  const before = { far: new Set((await notices(far)).map(entry => entry.item.ref.messageId)),
    member: new Set((await notices(holder)).map(entry => entry.item.ref.messageId)) };
  const card = ready(await project.host.client.read('sessions/read', project.scope, far));
  if (card === null) throw broken(ctx, `sessions/read of ${far.sessionId} failed before the archive`, 'disconnect');
  const archived = await project.host.client.write('sessions/archive-line', project.scope,
    { sessionRef: far, reason: 'G6 waiting: archive the far side of an open wait (disconnect)', tasks: [], wait: null },
    [{ ref: { aggregateType: 'Session', ...far }, revision: card.record.revision }]);
  if (archived?.status !== 'ready') {
    rec.fail('disconnect', `sessions/archive-line of ${far.sessionId} refused: ${archived?.code} ${archived?.reason}`);
    return;
  }
  const seen = await orNull(waitFor(ctx, 'the disconnect item and both Host notices for that wait', async () => {
    const queue = ready(await project.host.client.read('decisions/queue', project.scope, { workspace: project.scope,
      sections: ['waiting_answer', 'answered_pending_application', 'history', 'notices'], page: { limit: 50 } }));
    const items = findAll(queue, node => node.category === 'disconnect').filter(item => String(item.itemKey).includes(target.messageRef.messageId)
      && String(item.summary).includes(far.sessionId));
    return { items, far: (await notices(far)).filter(entry => !before.far.has(entry.item.ref.messageId)),
      member: (await notices(holder)).filter(entry => !before.member.has(entry.item.ref.messageId)) };
  }, value => value.items.length > 0 && value.far.length > 0 && value.member.length > 0, { timeoutMs: 10 * MINUTE, check: 'disconnect' }));
  if (seen !== null) {
    const tied = list => list.some(entry => `${entry.body}\n${textOf(entry.item)}`.includes(target.messageRef.messageId));
    const text = `归档 ${far.sessionId}（${archived.value?.state}）后：等待 ${target.messageRef.messageId} 的 disconnect 项「${seen.items[0].summary}」；新断开通知 归档侧 ${
      seen.far.length} 条（${seen.far[0].body}）、成员侧 ${seen.member.length} 条`;
    if (tied(seen.far) && tied(seen.member)) rec.pass('disconnect', `${text}，两侧都带这条等待的消息`);
    else rec.uncover('disconnect', 'entry-missing', `${text}；接不上：${tied(seen.far) ? '' : '归档侧'}${tied(seen.member) ? '' : ' 成员侧'} 的通知正文和公开记录里不带这条等待的消息，无法证明是这次断开的通知`);
  }
}

export default { ...def, run };
