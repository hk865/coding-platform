// Waiting (draft §1.8; MVP-BEHAVIOR.md:279-292; slice-9-SPEC.md:667, :693). The wait is set up where the product lets
// it exist (second review #11): a member's Work Run calls the real tool `send_session_message` with `waitAfterSend`
// (a Query round is refused that combination, `communication-tools.ts:478-480`). The member's Task asks the
// secretary line a question with a short real deadline, asks once more on expiry (`followupOf`), then asks a second
// question with a long deadline. A normal close and a new Host on the same ledger keep the wait; the expiry is
// recorded once and only a real acceptance consumes it; a late reply is a new input; a transfer keeps question and
// deadline. There is no clock seam (9-start-rulings.frozen.md:969-970): the chain is followed event by event until each
// event came, the chain is over (its Task done and every wait of it settled), or the window ends.
import { newId, ready } from '../lib/http.mjs';
import { broken, chooseModel, coldStart, createGoal, driverStart, ensurePolicy, executions, findAll, lines, openProject, orNull,
  proposeAndApply, sessionTurns, sleep, textOf, waitFor, waitGoal } from '../lib/flows.mjs';

const MINUTE = 60_000;
const DEADLINE_MS = 2 * MINUTE;
const LONG_DEADLINE_MS = 30 * MINUTE;
const SEED = {
  'package.json': '{\n  "name": "g6-wait",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n',
  'README.md': '# g6-wait\n\nNumber helpers.\n',
  'num.js': 'export function double(n) {\n  return n * 2;\n}\n',
};
const SEED_REQUEST = '初始化这个项目：在 README.md 末尾加一行用法示例。验收：node --test 通过。只改 README.md。';
const QUESTION = 'num.js 现在有哪些导出函数？';
const SECOND_QUESTION = 'README 的标题要不要改成中文？';
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
    { id: 'wait-open', rows: ['C-188', 'C-225'], text: '成员 Work 经真实工具发出等待（waitAfterSend）：原问题、收信人、期限都在' },
    { id: 'restart-kept', rows: ['C-170', 'C-207'], text: '正常关闭重启后仍核对原等待（同一 messageRef、收信人、期限）' },
    { id: 'expiry-once', rows: ['C-171', 'C-190'], text: '到期先记下（expiredAt），不算消费；由 expiry 接受消费' },
    { id: 'second-expiry', rows: ['C-171', 'C-190', 'C-224'], text: '同一追问链第二次实际到期，后继输入写“第 2 次到期”' },
    { id: 'consumes', rows: ['C-187'], text: '真实接受才 consumesWait:true；迟到的普通回复写 false' },
    { id: 'late-reply', rows: ['C-224', 'C-189'], text: '迟回保存为下一个安全点的新输入，不重开旧等待' },
    { id: 'transfer', rows: ['C-224'], text: '转交保留问题和期限，未送达不自动换人' },
    { id: 'disconnect', rows: ['C-195', 'C-196'], text: '等待的一侧归档后 decisions/queue 出这条等待的 disconnect 项，Host 给两侧各发 notify' },
    { id: 'supply-order', rows: ['C-172', 'C-192', 'C-184'], text: '供给按冻结顺序：人的消息、续作、agent 消息' },
  ],
};

function draft(goalId, secretary) {
  return {
    schemaVersion: 2, planId: `${goalId}-plan`, planRevision: 1, goalId, stages: [],
    tasks: [
      { taskId: 't-wait', title: '先问清楚再加 triple', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
        scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: 'gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 't-wait', role: 'local-workbench', instruction: instruction(secretary) }],
    obligations: [{ obligationId: 'o-tests', title: '测试通过', requirementLevel: 'required', taskIds: ['t-wait', 'gate'],
      verificationRequirements: [{ requirementId: 'r-tests', requirementLevel: 'required', kind: 'static', description: 'node --test 全部通过' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

const same = (left, right) => left !== null && right !== null && left !== undefined && right !== undefined
  && left.sessionId === right.sessionId && left.messageId === right.messageId;

async function waitsOf(project, sessionRef) {
  return ready(await project.host.client.read('sessions/facts', project.scope, sessionRef))?.waits ?? [];
}

async function message(project, ref) {
  return ready(await project.host.client.read('messages/read', project.scope, ref));
}

/** A response accepted after the wait expired: a late reply (it must not consume the old wait). */
const lateReplyOf = latest => (latest?.expiredAt === null || latest?.expiredAt === undefined ? undefined
  : (latest.acceptedInputs ?? []).find(entry => entry.part === 'response' && Date.parse(entry.acceptedAt) > Date.parse(latest.expiredAt)));

/** A wait message whose wait is over: consumed by an acceptance, withdrawn or cancelled. */
const settledWait = value => (value?.acceptedInputs ?? []).some(entry => entry.consumesWait === true)
  || value?.withdrawnAt != null || value?.waitCancelledAt != null;

/** The member's sent messages (refs from its successful `send_session_message` results) with their arguments. */
async function memberSends(project, member) {
  return (await sessionTurns(project, member)).flatMap(turn => turn.results).filter(result => result.name === 'send_session_message')
    .map(result => ({ args: result.args, ref: findAll(result.values, node => typeof node.messageId === 'string' && typeof node.sessionId === 'string')[0] ?? null }))
    .filter(entry => entry.ref !== null);
}

/**
 * Follow the same wait chain event by event (second review #12): the first question and every follow-up that names
 * it. It ends only on facts: both events came (a second real expiry, and a late reply unless the first was answered
 * before its expiry); or the chain is over (the Task is no longer active-unsatisfied and every wait of the chain is
 * settled); or the authorization window ends. A quiet moment is never taken as the end.
 */
async function followChain(ctx, project, { member, first, goalRef, windowEnd }) {
  for (;;) {
    await ctx.budget.tick();
    const sends = await memberSends(project, member);
    const chainRefs = [first.messageRef, ...sends.filter(entry => entry.args?.followupOf?.messageId === first.messageRef.messageId).map(entry => entry.ref)];
    const chain = [];
    for (const ref of chainRefs) chain.push(await message(project, ref));
    const expired = chain.filter(value => value?.expiredAt != null).length;
    const late = lateReplyOf(chain[0]);
    const answeredFirst = chain[0]?.expiredAt == null && (chain[0]?.acceptedInputs ?? []).some(entry => entry.part === 'response');
    const task = (ready(await project.host.client.read('tasks/query', project.scope, { goalRef }))?.tasks ?? []).find(entry => entry.ref.taskId === 't-wait');
    const taskOpen = task === undefined || (task.disposition === 'active' && task.effectivePhase !== 'satisfied');
    const over = !taskOpen && chain.every(settledWait);
    // Quick check #12: a second expiry is an event only with what follows it: its own expiry acceptance on that
    // message and the member's next actual input saying "第 2 次到期". Until then the chain is not done.
    const second = chain.filter(value => value?.expiredAt != null)[1] ?? null;
    const secondAccepted = second !== null && (second.acceptedInputs ?? []).some(entry => entry.consumesWait === true && entry.part === 'expiry');
    const secondSaid = second !== null && /第\s*2\s*次到期/.test((await sessionTurns(project, member)).map(turn => turn.input).join('\n'));
    const ended = secondAccepted && secondSaid && (late !== undefined || answeredFirst) ? 'events' : over ? 'chain-over' : Date.now() > windowEnd ? 'window' : null;
    if (ended !== null) return { chain, chainRefs, expired, late, answeredFirst, ended, task, secondAccepted, secondSaid };
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
  await proposeAndApply(ctx, project, goal.ref, draft(goalId, secretary.key.sessionId), 'waiting: the member asks and waits', rec);
  rec.facts.userCommand.push(`goals/create + plans/propose（t-wait 的指令：${instruction(secretary.key.sessionId)}）`);
  await driverStart(ctx, project, goal.ref, { flowId: newId('wait'), taskId: 't-wait' });

  // The member is the line whose Run works the Task; its own wait is the subject from here on.
  const work = await waitFor(ctx, 'the member\'s Work Run', async () => (await executions(project, goal.ref))
    .find(item => item.run.task.taskId === 't-wait' && item.outbox?.claim?.sessionRef !== undefined) ?? null, value => value !== null,
  { timeoutMs: 40 * MINUTE, check: 'wait-open' });
  const member = { projectId: work.outbox.claim.sessionRef.projectId, sessionId: work.outbox.claim.sessionRef.sessionId };
  const wait = await waitFor(ctx, 'the member\'s open wait', async () =>
    (await waitsOf(project, member)).find(entry => entry.state?.state === 'open') ?? null, value => value !== null,
  { timeoutMs: 30 * MINUTE, check: 'wait-open' });
  rec.link('message', wait.messageRef);
  const sentRecord = await message(project, wait.messageRef);
  const toolCall = (await sessionTurns(project, member)).flatMap(turn => [...turn.calls.values()])
    .find(call => call.name === 'send_session_message' && call.status === 'tool.completed' && call.args?.waitAfterSend === true);
  const runNow = (await executions(project, goal.ref)).find(item => JSON.stringify(item.run.ref) === JSON.stringify(work.run.ref));
  rec.check('wait-open', toolCall !== undefined && sentRecord?.waitAfterSend === true && sentRecord?.needsReply === true && wait.deadline !== null
    && wait.recipient?.sessionId === secretary.key.sessionId,
  `成员 ${member.sessionId} 的 Work（Run ${work.run.ref.runId}，现在 ${runNow?.run.status}/${runNow?.run.outcome ?? '-'}）经工具发出等待 ${wait.messageRef.messageId}：收信人 ${wait.recipient?.sessionId}，期限 ${wait.deadline}，waitAfterSend ${sentRecord?.waitAfterSend}`);

  // Normal close right away, down past the deadline, a new Host on the same ledger: the one checked close path.
  const closing = await ctx.close('w-accept', { restart: true, downUntil: Date.parse(wait.deadline) + MINUTE, check: 'restart-kept' });
  project.host = closing.host;
  rec.note(`close and restart: ${closing.closed}`);
  const settings = ready(await project.host.client.settings('snapshot', {}));
  rec.note(`restart: resumeOnStartup = ${settings?.automation?.resumeOnStartup}`);
  const kept = (await waitsOf(project, member)).find(entry => same(entry.messageRef, wait.messageRef));
  rec.check('restart-kept', kept !== undefined && kept.deadline === wait.deadline && kept.recipient?.sessionId === wait.recipient?.sessionId,
    `重启后同一等待：${kept === undefined ? '不在' : `${kept.state?.state}，期限 ${kept.deadline}`}`);

  const expired = await waitFor(ctx, 'the expiry or the reply', () => message(project, wait.messageRef),
    value => value?.expiredAt != null || (value?.acceptedInputs ?? []).length > 0, { timeoutMs: 20 * MINUTE, check: 'expiry-once' });
  const firstAccepted = expired.acceptedInputs ?? [];
  const expiredFirst = expired.expiredAt != null;
  if (!expiredFirst) {
    rec.uncover('expiry-once', 'env-unavailable', `收信方在到期记下之前就回答了（接受 ${firstAccepted.map(entry => entry.part).join(',')}）`);
  } else {
    const consumed = await orNull(waitFor(ctx, 'the expiry acceptance to consume the wait', () => message(project, wait.messageRef),
      value => (value?.acceptedInputs ?? []).some(entry => entry.consumesWait === true), { timeoutMs: 20 * MINUTE, check: 'expiry-once' }));
    rec.check('expiry-once', consumed !== null && (consumed.acceptedInputs.find(entry => entry.consumesWait)?.part === 'expiry'),
      `expiredAt ${expired.expiredAt}；记下时消费 ${firstAccepted.some(entry => entry.consumesWait)}；之后由 ${consumed?.acceptedInputs?.find(entry => entry.consumesWait)?.part ?? '无'} 消费`);
  }

  // The rest of the chain, as it really comes (second review #12).
  const chain = await followChain(ctx, project, { member, first: wait, goalRef: goal.ref, windowEnd: Date.parse(ctx.cfg.window.to) });
  const why = chain.ended === 'window' ? ['not-run', '授权窗口结束时还没来']
    : ['env-unavailable', `等待链已结束（t-wait ${chain.task?.effectivePhase ?? '-'}，链上 ${chain.chain.length} 条等待都已了结）`];
  // "第 2 次到期" is rendered into the member's actual input: judged on its turn input (#9).
  if (chain.expired >= 2 && chain.secondAccepted) {
    rec.check('second-expiry', chain.secondSaid, `同一追问链实际到期 ${chain.expired} 次，第二次已由 expiry 接受；成员之后的 turn 输入写“第 2 次到期”：${chain.secondSaid}`);
  } else if (chain.expired >= 2) {
    rec.uncover('second-expiry', why[0], `${why[1]}；第二次到期已记下，但它的 expiry 接受和后继输入还没出现`);
  } else rec.uncover('second-expiry', why[0], `${why[1]}；同一追问链实际到期 ${chain.expired} 次（没有时钟缝，不伪造）`);

  const accepted = chain.chain[0]?.acceptedInputs ?? [];
  rec.check('consumes', accepted.filter(entry => entry.consumesWait === true).length === 1,
    `接受条目：${accepted.map(entry => `${entry.part}:${entry.consumesWait}@${entry.acceptedAt}`).join(', ') || '无'}（只认一次真实接受消费等待）`);
  if (chain.late !== undefined) rec.check('late-reply', chain.late.consumesWait === false, `迟回 ${chain.late.acceptedAt} consumesWait ${chain.late.consumesWait}`);
  else if (chain.answeredFirst || !expiredFirst) rec.uncover('late-reply', 'env-unavailable', '收信方在到期前就回答了，不会有迟回');
  else rec.uncover('late-reply', why[0], `${why[1]}；到期（${chain.chain[0]?.expiredAt}）之后没有收到回复`);

  // The member's second question (long deadline) is transferred by the person before it is answered.
  const isChain = ref => chain.chainRefs.some(entry => same(entry, ref));
  const second = await orNull(waitFor(ctx, 'the member\'s second open wait', async () => (await waitsOf(project, member))
    .find(entry => entry.state?.state === 'open' && !isChain(entry.messageRef)) ?? null, value => value !== null, { timeoutMs: 30 * MINUTE, check: 'transfer' }));
  const other = rows.find(row => row.key.sessionId !== member.sessionId && row.key.sessionId !== secretary.key.sessionId);
  if (second === null) rec.note('成员的第二个等待没出现；transfer 由等待超时判 fail');
  else if (other === undefined) rec.uncover('transfer', 'env-unavailable', '工作区里没有可转交的另一条线');
  else {
    const transferred = await project.host.client.command('waits/dispose', project.scope,
      { commandId: newId('transfer'), messageRef: second.messageRef, mode: 'transfer', to: other.key });
    const moved = await message(project, second.messageRef);
    rec.check('transfer', transferred?.status === 'committed' && moved?.deadline === second.deadline,
      `waits/dispose transfer ${transferred?.status} ${transferred?.code ?? ''} ${transferred?.reason ?? ''}；期限 ${second.deadline} → ${moved?.deadline}`);
  }
  rec.uncover('supply-order', 'entry-missing', '供给顺序只在 Kernel 的一次输入里，公开读口不给逐项来源顺序');
  rec.note(`等待链 ${chain.chainRefs.map(ref => ref.messageId).join(' → ')}；结束方式 ${chain.ended}`);

  // Lead ruling Q7, the last step (second review #16: both sides). Re-read the member's waits, take one still open,
  // archive the line on its far side; the queue must show a `disconnect` item for that wait and that line, and each
  // side must get its own new Host `notify` naming that line (`disconnect-notices.ts:66-69`, `:186-194`;
  // `host-notices.ts:60-80`).
  const target = (await waitsOf(project, member)).filter(entry => entry.state?.state === 'open' && entry.recipient?.sessionId !== undefined).at(-1);
  if (target === undefined) {
    rec.uncover('disconnect', 'env-unavailable', '归档前成员线上已没有开着的等待（都已回答或处理），断开无从造出');
    return;
  }
  const far = { projectId: target.recipient.projectId, sessionId: target.recipient.sessionId };
  // Quick check #16: the notices are counted per side as new Host `notify` items naming that line; each must then be
  // tied to THIS wait's disconnect fact. The Host's own request id for each notice carries the wait's message
  // (`host-notices.ts:69-75`); a notice whose public record does not carry it cannot be tied, so the check is then
  // `uncovered` with that missing link, never a pass on "a notice arrived".
  const notices = async recipient => (ready(await project.host.client.read('messages/inbox', project.scope,
    { recipient, page: { limit: 100 } }))?.items ?? [])
    .filter(item => item.sender?.kind === 'host' && item.intent === 'notify' && textOf(item).includes(`Session ${far.sessionId}`));
  const before = { far: new Set((await notices(far)).map(textOf)), member: new Set((await notices(member)).map(textOf)) };
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
    return { items, far: (await notices(far)).filter(item => !before.far.has(textOf(item))),
      member: (await notices(member)).filter(item => !before.member.has(textOf(item))) };
  }, value => value.items.length > 0 && value.far.length > 0 && value.member.length > 0, { timeoutMs: 10 * MINUTE, check: 'disconnect' }));
  if (seen !== null) {
    const tied = list => list.some(item => textOf(item).includes(target.messageRef.messageId));
    const text = `归档 ${far.sessionId}（${archived.value?.state}）后：等待 ${target.messageRef.messageId} 的 disconnect 项「${seen.items[0].summary}」；新 Host notify 归档侧 ${seen.far.length} 条、成员侧 ${seen.member.length} 条`;
    if (tied(seen.far) && tied(seen.member)) rec.pass('disconnect', `${text}，两侧都带这条等待的消息`);
    else rec.uncover('disconnect', 'entry-missing', `${text}；接不上：${tied(seen.far) ? '' : '归档侧'}${tied(seen.member) ? '' : ' 成员侧'} 的通知公开记录里不带这条等待的消息，无法证明是这次断开的通知`);
  }
}

export default { ...def, run };
