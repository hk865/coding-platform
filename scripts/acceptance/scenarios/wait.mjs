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
  messageRefOf, openProject, orNull, proposeAndApply, runHistory, sessionTurns, sleep, testCheck, textOf, turnsOf, waitFor,
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

async function waitsOf(project, sessionRef) {
  return ready(await project.host.client.read('sessions/facts', project.scope, sessionRef))?.waits ?? [];
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
 */
async function followChain(ctx, project, { memberLines, first, goalRef, windowEnd }) {
  const capAt = Date.now() + CHAIN_CAP_MS;
  let taskDoneAt = null;
  for (;;) {
    await ctx.budget.tick();
    // A read gap in this poll (member list, a line's history, a message) leaves the chain unknown.
    const gaps = [];
    const sends = await memberSends(project, await memberLines(gaps), gaps);
    // lead 11-25 (P6 run: the chain read [647b, 647b]): one entry per message id, the first question never twice.
    const followups = sends.filter(entry => entry.args?.followupOf?.messageId === first.messageRef.messageId).map(entry => entry.ref);
    const chainRefs = [...new Map([first.messageRef, ...followups].map(ref => [ref.messageId, ref])).values()];
    const chain = [];
    for (const ref of chainRefs) chain.push(await message(project, ref, gaps));
    const expired = chain.filter(value => value?.expiredAt != null).length;
    const late = lateReplyOf(chain[0]);
    const saved = lateSaved(chain[0]);
    const answeredFirst = chain[0]?.expiredAt == null
      && (chain[0]?.response != null || (chain[0]?.acceptedInputs ?? []).some(entry => entry.part === 'response'));
    const task = (ready(await project.host.client.read('tasks/query', project.scope, { goalRef }))?.tasks ?? []).find(entry => entry.ref.taskId === 't-wait');
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
    if (ended !== null) return { chain, chainRefs, expired, late, saved, answeredFirst, ended, task,
      secondAccepted, secondConsumer, secondSaid, expiryInput, gaps };
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
  const interruptBefore = {
    member: new Set((await hostNotices(project, member, '中断通知')).map(entry => entry.item.ref.messageId)),
    secretary: new Set((await hostNotices(project, secretary.key, '中断通知')).map(entry => entry.item.ref.messageId)),
  };
  const interject = await interveneLine(project, member, INTERJECT);
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
  const expired = await waitFor(ctx, 'the expiry or the reply', () => message(project, wait.messageRef),
    value => value?.expiredAt != null || value?.response != null || (value?.acceptedInputs ?? []).length > 0,
    { timeoutMs: 20 * MINUTE, check: 'expiry-once' });
  const firstAccepted = expired.acceptedInputs ?? [];
  const expiredFirst = expired.expiredAt != null;
  if (!expiredFirst) {
    rec.uncover('expiry-once', 'not-run', `收信方在到期之前就回答了（回复 ${expired.response?.respondedAt ?? '-'}；接受 ${
      firstAccepted.map(entry => entry.part).join(',') || '无'}），这条等待不会到期`);
  } else {
    const consumed = await orNull(waitFor(ctx, 'the expiry acceptance to consume the wait', () => message(project, wait.messageRef),
      value => (value?.acceptedInputs ?? []).some(entry => entry.consumesWait === true), { timeoutMs: 20 * MINUTE, check: 'expiry-once' }));
    rec.check('expiry-once', consumed !== null && (consumed.acceptedInputs.find(entry => entry.consumesWait)?.part === 'expiry'),
      `expiredAt ${expired.expiredAt}；记下时消费 ${firstAccepted.some(entry => entry.consumesWait)}；之后由 ${consumed?.acceptedInputs?.find(entry => entry.consumesWait)?.part ?? '无'} 消费`);
  }
  // P6: the continuing Run: the acceptance that consumed the wait names its Run, whose `consumedWait` is `expiry` or
  // `wait_reply` on this message with the original Run, on the member line (`dispatch.ts:289-290`, `:325-330`).
  if (keptOk) {
    const latest = await message(project, wait.messageRef);
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

  // The rest of the chain, as it really comes (second review #12).
  const chain = await followChain(ctx, project, { memberLines, first: wait, goalRef: goal.ref, windowEnd: Date.parse(ctx.cfg.window.to) });
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

  const firstOfChain = chain.chain[0];
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

  // The member's second question (long deadline), found by the member's own send (P6 #17: under the default wake the
  // secretary may answer it before the driver ever sees it open). Q8: a reply before its expiry judges reply-first;
  // only a question still open is transferred by the person; otherwise the transfer is uncovered.
  const isChain = ref => chain.chainRefs.some(entry => same(entry, ref));
  // lead 11-25: the member not sending the second question is a branch not reached (the model's choice), not the
  // platform failing: watched without judging, then `uncovered (not-run)` with that fact.
  const secondSend = await watch(ctx, async () => {
    const sends = (await memberSends(project, await memberLines())).filter(entry => entry.args?.waitAfterSend === true && !isChain(entry.ref));
    return sends.find(entry => String(entry.args?.text ?? '').includes('README')) ?? sends[0] ?? null;
  }, value => value !== null, 30 * MINUTE);
  // P6 diagnosis 2 #29: re-read after the restart; never a member line (a continuation line is one too).
  const memberIds = new Set((await memberLines()).map(line => line.sessionId));
  const other = (await lines(project)).find(row => !memberIds.has(row.key.sessionId) && row.key.sessionId !== secretary.key.sessionId
    && row.status?.own !== 'archived');
  if (secondSend === null) {
    const noSecond = '成员 30 分钟里没有发第二个要等的问题（waitAfterSend、不在第一条等待链上），这一支没走到';
    rec.uncover('reply-first', 'not-run', noSecond);
    rec.uncover('transfer', 'not-run', `${noSecond}，转交无从做起`);
    rec.note(`waiting: ${noSecond}；reply-first、transfer 记未覆盖（lead 11-25）`);
  } else {
    rec.link('message', secondSend.ref);
    const secondMsg = await message(project, secondSend.ref);
    const respondedAt = secondMsg?.response?.respondedAt ?? null;
    const secondText = `第二个问题 ${secondSend.ref.messageId}（期限 ${secondMsg?.deadline ?? '-'}）`;
    if (secondMsg === null) {
      rec.uncover('reply-first', 'env-unavailable', `${secondText}：messages/read 读不到`);
      rec.uncover('transfer', 'env-unavailable', `${secondText}：messages/read 读不到`);
    } else if (respondedAt !== null && (secondMsg.expiredAt == null || Date.parse(respondedAt) < Date.parse(secondMsg.expiredAt))) {
      const consumed = await orNull(waitFor(ctx, 'the reply acceptance to consume the second wait', () => message(project, secondSend.ref),
        value => (value?.acceptedInputs ?? []).some(entry => entry.consumesWait === true), { timeoutMs: 10 * MINUTE, check: 'reply-first' }));
      const by = consumed?.acceptedInputs?.find(entry => entry.consumesWait === true);
      rec.check('reply-first', by?.part === 'response' && consumed.expiredAt == null,
        `${secondText}：回复 ${respondedAt}；消费它的接受 ${by === undefined ? '无' : `${by.part}@${by.acceptedAt}`}；expiredAt ${consumed?.expiredAt ?? '无'}`);
      rec.uncover('transfer', 'env-unavailable', `${secondText}：转交前已被回答（默认叫醒，P6 #17）`);
    } else if (secondMsg.expiredAt != null) {
      rec.uncover('reply-first', 'not-run', `${secondText}：先到期了（${secondMsg.expiredAt}），没有回复抢先`);
      rec.uncover('transfer', 'env-unavailable', `${secondText}：转交前已到期`);
    } else if (other === undefined) {
      rec.uncover('reply-first', 'not-run', `${secondText}：还开着，没有回复抢先`);
      rec.uncover('transfer', 'env-unavailable', '工作区里没有可转交的另一条线');
    } else {
      rec.uncover('reply-first', 'not-run', `${secondText}：还开着（没有回复），回复抢先没有发生，转去做转交（P6 Q8）`);
      // lead 11-25: a wait is transferred only once its sending line is archived, archiving or retired
      // (`STATE-MACHINES-SPEC.md:3727`, `message-machine.ts:1185-1194`: otherwise `invalid waiting_line_live`). The person
      // archives the member line first (`sessions/archive-line`), then transfers; an archive the platform refuses (e.g.
      // the line still has an unfinished Task to hand over or drop) leaves the transfer not reached.
      const sender = secondSend.line;
      const card = ready(await project.host.client.read('sessions/read', project.scope, sender));
      const archived = card === null ? null : await project.host.client.write('sessions/archive-line', project.scope,
        { sessionRef: sender, reason: 'G6 waiting: archive the sending line before transferring its open wait', tasks: [], wait: null },
        [{ ref: { aggregateType: 'Session', ...sender }, revision: card.record.revision }]);
      const archiveText = `归档发信的成员线 ${sender.sessionId}：${card === null ? 'sessions/read 读不到' : `${archived?.status ?? 'no answer'} ${
        archived?.value?.state ?? archived?.code ?? ''} ${archived?.reason ?? ''}`.trim()}`;
      if (archived?.status !== 'ready' || !['archived', 'pending'].includes(archived.value?.state)) {
        rec.uncover('transfer', 'not-run', `${secondText}：${archiveText}；发信线没有归档，平台按规格不许转交，这一支没走到`);
      } else {
        const transferred = await project.host.client.command('waits/dispose', project.scope,
          { commandId: newId('transfer'), messageRef: secondSend.ref, mode: 'transfer', to: other.key });
        const moved = await message(project, secondSend.ref);
        rec.check('transfer', transferred?.status === 'committed' && moved?.deadline === secondMsg.deadline,
          `${archiveText}；waits/dispose transfer → ${other.key.sessionId}：${transferred?.status} ${transferred?.code ?? ''} ${transferred?.reason ?? ''}；期限 ${secondMsg.deadline} → ${moved?.deadline}`);
        rec.note('waiting: 成员线为转交已归档；之后的断开格读的是成员线上仍开着的等待，可能因此记未覆盖');
      }
    }
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
  let target;
  let holder = member;
  for (const line of await memberLines()) {
    const open = (await waitsOf(project, line)).filter(entry => entry.state?.state === 'open' && entry.recipient?.sessionId !== undefined).at(-1);
    if (open !== undefined) { target = open; holder = line; }
  }
  if (target === undefined) {
    rec.uncover('disconnect', 'env-unavailable', '归档前成员线上已没有开着的等待（都已回答或处理），断开无从造出');
    return;
  }
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
