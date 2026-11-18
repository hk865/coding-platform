/**
 * R13 冻结稿第五节 C2（PL §7.1.1 第五项，冻结稿 A5，N3）：Task 被 `no_new_basis` 停下，参谋的偏差正文在停因之后列出没过的
 * 检查（哪条、谁装的、退出码；命令和 stderr 末尾照原样放在围栏里）；参谋答“不改计划”后，人的请知悉仍是四项，不带这一块。
 * 世界照 PL-36 的 no_new_basis 一支，Host 启动配置的检查换成带反斜杠的命令。只走公开入口，脚本模型；只跑 memory（RULES S3）。
 */
import { afterEach, expect, it } from 'vitest';
import { advanceUntil, post } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { heartbeatUntil, readBody, readPlanningQuery, waitForResponse } from '../helpers/IV-host-fixture.js';
import {
  drivePLTaskRunsToStop, openPLDeviationConsumptionWorld, type PLDeviationConsumptionWorld,
} from '../helpers/PL-deviation-fixture.js';
import { R13_COMMAND, R13_STDERR, fencedAfter } from '../helpers/R13-verbatim.js';
import { OPERATOR, S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { checkConfiguration, ready } from '../helpers/S7A-fixture.js';
import { systemRoundMessageRef } from '../helpers/system-round-ref.js';

let opened: PLDeviationConsumptionWorld | null = null;
afterEach(async () => { await opened?.close().catch(() => undefined); opened = null; });

it('C2：no_new_basis 的偏差正文带没过的检查（命令和 stderr 照原样）；人的请知悉不带', async () => {
  const configured = checkConfiguration({ ...OPERATOR, kind: 'human' });
  const fixture = opened = await openPLDeviationConsumptionWorld({ label: 'r13-c2', taskIds: ['r13-c2-a', 'r13-c2-b'],
    checks: { ...configured, checks: configured.checks.map(check => ({ ...check, command: R13_COMMAND })) } });
  const { world, goal, line, adviser } = fixture;
  expect(await world.settings('automation/save', { autoReworkLimit: 3, resumeOnStartup: 'auto' }))
    .toMatchObject({ status: 'ready' });
  // 两个 Run 都不改源码：第一次自动返工照做，第二次判 no_new_basis，Task 停下。
  await drivePLTaskRunsToStop(world, { goal, line, taskId: 'r13-c2-a', flowId: 'r13-c2-runs',
    replies: [{ kind: 'text', text: 'R13 C2 Run 1' }, { kind: 'text', text: 'R13 C2 Run 2' }] });
  const send = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'r13-c2-send', sessionHint: null,
    kind: 'select_work' }, 'send_system_round');
  ready(await post(world.ag2b, 'workflow/advance', plain(S6A_SCOPE, send)), 'the deviation send');
  const requestId = `deviation:${goal.goalId}:r13-c2-a:stop:1`;
  const ref = systemRoundMessageRef(S6A_SCOPE, requestId);
  if (ref.status !== 'ready') throw new Error('R13 C2: the request id has no message ref');
  const body = await readBody(world, ref.value, 'message');
  const lines = body.split('\n');
  const stop = lines.indexOf('stop cause: no_new_basis');
  expect(stop, body).toBeGreaterThan(0);
  expect(lines.slice(stop + 1, stop + 3)).toEqual(['failing checks (command and output verbatim, not JSON):',
    '- s7a-static-check (static; taskIds: all; installed by: Host start-up configuration): exit 5']);
  expect(fencedAfter(body, 'command:')).toBe(R13_COMMAND);
  expect(fencedAfter(body, 'stderr tail:')).toBe(R13_STDERR.slice(0, -1));

  // 参谋答“不改计划”：人的请知悉是四项加答话，不带检查块。
  await world.scripted.script(adviser, [{ kind: 'text', text: 'R13 C2: no plan change' }]);
  await heartbeatUntil(world, () => readPlanningQuery(world, ref.value), value => value?.job.job.status === 'answered');
  await waitForResponse(world, ref.value);
  const notices = (await fixture.main.readNotices({ goal, categories: ['plan_notice'], limit: 100 })).notices
    .filter(notice => notice.itemKey === `deviation-notice:${goal.goalId}:${requestId}`);
  expect(notices).toHaveLength(1);
  expect(notices[0]!.summary).toContain('stop cause: no_new_basis');
  expect(notices[0]!.summary).not.toContain('failing checks');
  expect(notices[0]!.summary).not.toContain(R13_COMMAND);
}, 240_000);
