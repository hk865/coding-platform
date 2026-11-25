import { afterEach, describe, expect, it } from 'vitest';
import {
  blockOf, fieldIn, heldSettingsPage, setBox, typeField,
} from './helpers/E3ST-settings.js';
import {
  findAllClass, findButton, findClass, findElement, findLink,
} from './helpers/boot-page.js';
import {
  bootE3N, callsTo, countRoute, hasClass, settledN, textOf, turns, waitFor,
} from './helpers/E3N-page.js';
import { click, clickIfEnabled } from './helpers/E3N-interact.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { openKLS1BTwoProjects, type KLS1BTwoProjects } from '../helpers/KLS1B-two-projects.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * Settings page, the project reads (7D2 batch 2, group 2): the autonomy rule
 * list, the inline rule edits, and “只留在本机，不进 git”. Rules are created
 * through the public route; the page only clicks. A B C D are the four rows of
 * the frozen run sheet (⑥ ⑦ ⑨ ⑩).
 */

const worlds: KLS1BTwoProjects[] = [];
afterEach(async () => {
  await Promise.allSettled(worlds.splice(0).map((world) => world.dispose()));
});

const GOAL = 'st-g';

type ProjectWorld = { world: KLS1BTwoProjects; r1: string; r2: string };

async function openProjectWorld(): Promise<ProjectWorld> {
  const world = await openKLS1BTwoProjects({ backend: 'memory', gitA: true });
  worlds.push(world);
  const goal = await world.createGoal(world.A, GOAL);
  expect(goal.body.status).toBe('committed');
  const create = async (actions: string[], scope: unknown[], limits: unknown, requestId: string) => {
    const answer = await world.post(world.A, 'autonomy-rules/create',
      graphWrite(world.A, { actions, scope, limits, expiresAt: null, approvedFrom: null }, requestId));
    expect(answer.body.status, JSON.stringify(answer.body)).toBe('committed');
    return answer;
  };
  const r1 = await create(['refine_future', 'auto_reverify'],
    [{ kind: 'goal', goalRef: { aggregateType: 'Goal', projectId: world.A.projectId, goalId: GOAL } }],
    { open: {} }, 'st-r1');
  const r2 = await create(['create_member', 'short_change_duty'], [{ kind: 'project' }], { open: { executor: 4 } }, 'st-r2');
  const ruleIdOf = (answer: { body: { value: { rules: Array<{ actions: string[]; ref: { ruleId: string } }> } } },
    action: string): string => answer.body.value.rules.find((rule) => rule.actions.includes(action))!.ref.ruleId;
  return { world, r1: ruleIdOf(r1, 'refine_future'), r2: ruleIdOf(r2, 'create_member') };
}

const pageSearch = '?from=Main&goal=' + GOAL;

function ruleRow(root: FakeElement, ruleId: string): FakeElement | undefined {
  return findAllClass(root, 'rl').find((row) => row.getAttribute('data-rule') === ruleId);
}

function ruleBlock(root: FakeElement): FakeElement {
  const found = blockOf(root, '规则');
  expect(found).toBeDefined();
  return found!;
}

function reviseRow(root: FakeElement, ruleId: string): FakeElement {
  const row = ruleRow(root, ruleId);
  expect(row, ruleId).toBeDefined();
  return row!;
}

describe('settings project reads (7D2 batch 2)', () => {
  it('⑥ draws the two rules, changes one expiry and revokes the other inline', async () => {
    const { world, r1, r2 } = await openProjectWorld();
    const page = await bootE3N(world, 'Settings', { search: pageSearch, gate: true });
    try {
      await waitFor(() => ruleRow(page.page.root, r1) !== undefined);
      const autoNav = findLink(page.page.root, '自动化与规则')!;
      expect(textOf(autoNav)).toContain('2 条规则');

      const row1 = reviseRow(page.page.root, r1);
      expect(textOf(findClass(row1, 'rl-name'))).toBe('范围内细化、自动重新检查');
      const sub1 = textOf(findClass(row1, 'rl-sub'));
      expect(sub1).toContain('目标 1 · KLS-1b st-g');
      expect(sub1).toContain('不限条数');
      expect(sub1).toContain('不过期');
      expect(sub1).toContain('你直接建的');

      const row2 = reviseRow(page.page.root, r2);
      /* 具名改坏: `RULE_ACTION_TEXT.short_change_duty` 写回“短期线改职责”；本行红（草图说明 §5 是“换”）。 */
      expect(textOf(findClass(row2, 'rl-name'))).toBe('创建成员、短期线换职责');
      const sub2 = textOf(findClass(row2, 'rl-sub'));
      expect(sub2).toContain('整个项目');
      expect(sub2).toContain('执行者最多保留 4 条');
      expect(sub2).toContain('不过期');

      click(findButton(row1, '改有效期')!);
      await waitFor(() => findClass(reviseRow(page.page.root, r1), 'rl-edit') !== undefined);
      const edit = () => findClass(reviseRow(page.page.root, r1), 'rl-edit')!;
      click(findAllClass(edit(), 'mode-btn').find((button) => textOf(button).startsWith('到某天'))!);
      await waitFor(() => fieldIn(edit(), '到哪天') !== undefined);
      const dateField = fieldIn(edit(), '到哪天')!;
      expect(dateField.value).toBe('');
      typeField(dateField, '2026-12-31');
      click(findButton(edit(), '保存')!);
      await settledN(page.log, 'autonomy-rules/update', 1);
      expect(countRoute(page.log, 'autonomy-rules/update')).toBe(1);
      const update = callsTo(page.log, 'autonomy-rules/update')[0]!;
      expect(update.input).toMatchObject({ ruleId: r1, expectedRevision: 1, expectedSetRevision: 2 });
      const expiresAt = String((update.input as Record<string, unknown>)['expiresAt']);
      const at = new Date(expiresAt);
      expect([at.getFullYear(), at.getMonth() + 1, at.getDate(), at.getHours(), at.getMinutes()])
        .toEqual([2026, 12, 31, 23, 59]);
      const meta = (update.body as { request: { meta: { requestId: string; expected: unknown[] } } }).request.meta;
      expect(meta.expected).toEqual([]);
      expect(meta.requestId).not.toBe('');
      await waitFor(() => textOf(findClass(reviseRow(page.page.root, r1), 'rl-sub')).includes('到 12-31 23:59'));
      /* Item 11: after a successful expiry save the focus is back on that row's 改有效期. */
      await waitFor(() => (document.activeElement as unknown as FakeElement | null)
        === findButton(reviseRow(page.page.root, r1), '改有效期'));

      click(findButton(reviseRow(page.page.root, r2), '撤销')!);
      await waitFor(() => textOf(findClass(reviseRow(page.page.root, r2), 'rl-edit')).includes('撤销以后，这类事又会先问你'));
      click(findButton(findClass(reviseRow(page.page.root, r2), 'rl-edit')!, '取消')!);
      expect(countRoute(page.log, 'autonomy-rules/revoke')).toBe(0);

      click(findButton(reviseRow(page.page.root, r2), '撤销')!);
      click(findButton(findClass(reviseRow(page.page.root, r2), 'rl-edit')!, '撤销')!);
      await settledN(page.log, 'autonomy-rules/revoke', 1);
      expect(countRoute(page.log, 'autonomy-rules/revoke')).toBe(1);
      const revoke = callsTo(page.log, 'autonomy-rules/revoke')[0]!;
      expect(revoke.input).toEqual({ ruleId: r2, expectedRevision: 1, expectedSetRevision: 3 });
      const revokeMeta = (revoke.body as { request: { meta: { requestId: string } } }).request.meta;
      expect(revokeMeta.requestId).not.toBe(meta.requestId);

      await waitFor(() => ruleRow(page.page.root, r2) === undefined);
      const fold = findAllClass(page.page.root, 'rl-fold').find((entry) => textOf(entry).includes('已撤销 1 条'));
      expect(fold).toBeDefined();
      /* Item 11: after a successful revoke the focus is on the fold button it opened. */
      await waitFor(() => (document.activeElement as unknown as FakeElement | null)
        === findButton(page.page.root, '已撤销 1 条'));
      expect(textOf(findLink(page.page.root, '自动化与规则')!)).toContain('1 条规则');
      click(fold!);
      await waitFor(() => ruleRow(page.page.root, r2) !== undefined);
      expect(textOf(findClass(reviseRow(page.page.root, r2), 'rl-sub'))).toBe('整个项目 · 已撤销');
    } finally {
      await page.page.restore();
    }
  }, 180_000);

  it('⑦ a stale rule write shows the conflict, rereads, and stays disabled while the next one is in flight', async () => {
    const { world, r1, r2 } = await openProjectWorld();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let revokes = 0;
    const page = await bootE3N(world, 'Settings', {
      search: pageSearch, gate: true,
      before: { 'autonomy-rules/revoke': async () => { revokes += 1; if (revokes === 2) await gate; } },
    });
    try {
      await waitFor(() => ruleRow(page.page.root, r2) !== undefined);
      /* The outside write moves the set to revision 3 after the page's read (2). */
      const outside = await world.post(world.A, 'autonomy-rules/update', graphWrite(world.A,
        { ruleId: r1, expectedRevision: 1, expectedSetRevision: 2, expiresAt: null }, 'st-outside'));
      expect(outside.body.status, JSON.stringify(outside.body)).toBe('committed');
      click(findButton(reviseRow(page.page.root, r2), '撤销')!);
      click(findButton(findClass(reviseRow(page.page.root, r2), 'rl-edit')!, '撤销')!);
      await settledN(page.log, 'autonomy-rules/revoke', 1);
      await waitFor(() => textOf(findClass(ruleBlock(page.page.root), 'rl-edit')).includes('这条规则刚被别处改过，已经重读，请再点一次。'));
      await waitFor(() => countRoute(page.log, 'autonomy-rules') >= 2, 5_000);

      const editOf = () => findClass(reviseRow(page.page.root, r2), 'rl-edit');
      const confirm = () => findButton(editOf()!, '撤销')!;
      const cancel = () => findButton(editOf()!, '取消')!;
      click(confirm());
      await turns(() => confirm().disabled, 5_000);
      expect(confirm().disabled).toBe(true);

      /* Item 8: opening another rule's editor must not untie the in-flight write. */
      click(findButton(reviseRow(page.page.root, r1), '改有效期')!);
      await waitFor(() => findClass(reviseRow(page.page.root, r1), 'rl-edit') !== undefined);
      expect(editOf()).toBeUndefined();
      click(findButton(reviseRow(page.page.root, r2), '撤销')!);
      await waitFor(() => editOf() !== undefined);
      await turns(() => confirm().disabled, 5_000);
      expect(confirm().disabled).toBe(true);

      const before = countRoute(page.log, 'autonomy-rules/revoke');
      clickIfEnabled(confirm());
      await turns(() => true, 30);
      expect(countRoute(page.log, 'autonomy-rules/revoke')).toBe(before);

      /* Item 7: 取消 is disabled in flight, so the confirm row stays open and a
         later failure still has a place to show its text. */
      expect(cancel().disabled).toBe(true);
      clickIfEnabled(cancel());
      await turns(() => true, 30);
      expect(editOf()).toBeDefined();

      release();
      await settledN(page.log, 'autonomy-rules/revoke', 2);
      /* Exactly one write for this phase, not two. */
      expect(countRoute(page.log, 'autonomy-rules/revoke')).toBe(2);
      expect(callsTo(page.log, 'autonomy-rules/revoke')[1]?.input)
        .toEqual({ ruleId: r2, expectedRevision: 1, expectedSetRevision: 3 });
    } finally {
      release();
      await page.page.restore();
    }
  }, 180_000);

  it('⑦b a failed revoke keeps its confirm row open and writes the failure there', async () => {
    const { world, r2 } = await openProjectWorld();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const page = await bootE3N(world, 'Settings', {
      search: pageSearch, gate: true,
      rejectOnce: { route: 'autonomy-rules/revoke', code: 'unavailable', reason: 'the rule write failed' },
      before: { 'autonomy-rules/revoke': async () => { await gate; } },
    });
    try {
      await waitFor(() => ruleRow(page.page.root, r2) !== undefined);
      click(findButton(reviseRow(page.page.root, r2), '撤销')!);
      const edit = () => findClass(reviseRow(page.page.root, r2), 'rl-edit');
      await waitFor(() => edit() !== undefined);
      click(findButton(edit()!, '撤销')!);
      await turns(() => true, 100);
      expect(findButton(edit()!, '取消')!.disabled).toBe(true);
      clickIfEnabled(findButton(edit()!, '取消')!);
      await turns(() => true, 30);
      expect(edit()).toBeDefined();
      release();
      await settledN(page.log, 'autonomy-rules/revoke', 1);
      expect(edit()).toBeDefined();
      await waitFor(() => textOf(findClass(edit()!, 'err')).includes('暂时写不了，可以重试。'));
      expect(countRoute(page.log, 'autonomy-rules/revoke')).toBe(1);
    } finally {
      release();
      await page.page.restore();
    }
  }, 120_000);

  /* Lead 11-25 (fix 2/3/4, item 6): while one rule's revoke is in flight another
     row's editor may take the one editor slot; the failure goes back to the row
     that sent it, never to the row that is open then. */
  it('⑦c a rule write keeps its own row: a failure lands under it, a success closes only it', async () => {
    const { world, r1, r2 } = await openProjectWorld();
    const held: Array<() => void> = [];
    const releaseOne = (): void => { held.shift()?.(); };
    const page = await bootE3N(world, 'Settings', {
      search: pageSearch, gate: true,
      rejectOnce: { route: 'autonomy-rules/revoke', code: 'unavailable', reason: 'the rule write failed' },
      before: { 'autonomy-rules/revoke': async () => { await new Promise<void>((resolve) => { held.push(resolve); }); } },
    });
    try {
      await waitFor(() => ruleRow(page.page.root, r2) !== undefined);
      click(findButton(reviseRow(page.page.root, r2), '撤销')!);
      const revokeRow = () => findClass(reviseRow(page.page.root, r2), 'rl-edit');
      await waitFor(() => revokeRow() !== undefined);
      click(findButton(revokeRow()!, '撤销')!);
      await waitFor(() => held.length === 1);
      click(findButton(reviseRow(page.page.root, r1), '改有效期')!);
      const expiryRow = () => findClass(reviseRow(page.page.root, r1), 'rl-edit');
      await waitFor(() => expiryRow() !== undefined);
      releaseOne();
      await settledN(page.log, 'autonomy-rules/revoke', 1);
      /* 具名改坏: 失败分支不把槽还给 r2（只设 `ruleError`）；失败字落在 r1 的有效期行里，下面两行红。 */
      await waitFor(() => revokeRow() !== undefined && textOf(findClass(revokeRow()!, 'err')).includes('暂时写不了，可以重试。'));
      expect(textOf(revokeRow())).toContain('撤销以后，这类事又会先问你');
      expect(expiryRow()).toBeUndefined();
      expect(countRoute(page.log, 'autonomy-rules/revoke')).toBe(1);

      /* The retry succeeds while r1's expiry editor is open again: only r2's slot closes. */
      click(findButton(revokeRow()!, '撤销')!);
      await waitFor(() => held.length === 1);
      click(findButton(reviseRow(page.page.root, r1), '改有效期')!);
      await waitFor(() => expiryRow() !== undefined);
      releaseOne();
      await settledN(page.log, 'autonomy-rules/revoke', 2);
      await waitFor(() => ruleRow(page.page.root, r2) === undefined);
      /* 具名改坏: 成功分支照旧 `editor: ''`；r1 刚打开的有效期行被一起关掉，本行红。 */
      expect(expiryRow()).toBeDefined();
    } finally {
      for (const release of held.splice(0)) release();
      await page.page.restore();
    }
  }, 120_000);

  /* 234f 表二 1: a revoke's success never drops the keyboard focus to <body>. */
  it('⑦c2 a revoke that lands while a row below it is open gives that row its focus back', async () => {
    const { world, r1, r2 } = await openProjectWorld();
    const held: Array<() => void> = [];
    const page = await bootE3N(world, 'Settings', {
      search: pageSearch, gate: true,
      before: { 'autonomy-rules/revoke': async () => { await new Promise<void>((resolve) => { held.push(resolve); }); } },
    });
    const active = () => document.activeElement as unknown as FakeElement | null;
    try {
      await waitFor(() => ruleRow(page.page.root, r1) !== undefined);
      /* The list draws r2 (the newer rule) above r1. */
      expect(findAllClass(page.page.root, 'rl').map((row) => row.getAttribute('data-rule')).slice(0, 2)).toEqual([r2, r1]);
      click(findButton(reviseRow(page.page.root, r2), '撤销')!);
      await waitFor(() => findClass(reviseRow(page.page.root, r2), 'rl-edit') !== undefined);
      click(findButton(findClass(reviseRow(page.page.root, r2), 'rl-edit')!, '撤销')!);
      await waitFor(() => held.length === 1);
      /* r1 sits below r2: its editor opens while r2's revoke is in flight. */
      click(findButton(reviseRow(page.page.root, r1), '改有效期')!);
      await waitFor(() => findClass(reviseRow(page.page.root, r1), 'rl-edit') !== undefined);
      findButton(reviseRow(page.page.root, r1), '改有效期')!.focus();
      held.shift()!();
      await settledN(page.log, 'autonomy-rules/revoke', 1);
      await waitFor(() => ruleRow(page.page.root, r2) === undefined);
      expect(findClass(reviseRow(page.page.root, r1), 'rl-edit')).toBeDefined();
      /* 具名改坏: `ruleWriteDone` 不记 `_focusIfLost`；r1 那一行按位置重画，焦点停在已经拆掉的旧按钮上（浏览器里是 <body>），本行红。 */
      await waitFor(() => active() === findButton(reviseRow(page.page.root, r1), '改有效期'));
      expect(active()?.isConnected).toBe(true);
    } finally {
      for (const release of held.splice(0)) release();
      await page.page.restore();
    }
  }, 120_000);

  it('⑦c3 a revoke that lands while its own row’s expiry editor is open puts the focus on the revoked fold', async () => {
    const { world, r2 } = await openProjectWorld();
    const held: Array<() => void> = [];
    const page = await bootE3N(world, 'Settings', {
      search: pageSearch, gate: true,
      before: { 'autonomy-rules/revoke': async () => { await new Promise<void>((resolve) => { held.push(resolve); }); } },
    });
    try {
      await waitFor(() => ruleRow(page.page.root, r2) !== undefined);
      click(findButton(reviseRow(page.page.root, r2), '撤销')!);
      await waitFor(() => findClass(reviseRow(page.page.root, r2), 'rl-edit') !== undefined);
      click(findButton(findClass(reviseRow(page.page.root, r2), 'rl-edit')!, '撤销')!);
      await waitFor(() => held.length === 1);
      /* The same row's 改有效期 takes the slot while its own revoke is in flight. */
      click(findButton(reviseRow(page.page.root, r2), '改有效期')!);
      findButton(reviseRow(page.page.root, r2), '改有效期')!.focus();
      held.shift()!();
      await settledN(page.log, 'autonomy-rules/revoke', 1);
      await waitFor(() => ruleRow(page.page.root, r2) === undefined);
      /* 具名改坏: `mine` 只认 `rule-revoke:X`、不认同一条规则的 `rule-expiry:X`；焦点没落到“已撤销 1 条”，本行红。 */
      await waitFor(() => (document.activeElement as unknown as FakeElement | null)
        === findButton(page.page.root, '已撤销 1 条'));
    } finally {
      for (const release of held.splice(0)) release();
      await page.page.restore();
    }
  }, 120_000);

  it('⑦d an expiry save that fails after another row opened comes back to its row with its own date', async () => {
    const { world, r1, r2 } = await openProjectWorld();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const page = await bootE3N(world, 'Settings', {
      search: pageSearch, gate: true,
      rejectOnce: { route: 'autonomy-rules/update', code: 'unavailable', reason: 'the rule write failed' },
      before: { 'autonomy-rules/update': async () => { await gate; } },
    });
    try {
      await waitFor(() => ruleRow(page.page.root, r1) !== undefined);
      click(findButton(reviseRow(page.page.root, r1), '改有效期')!);
      const edit1 = () => findClass(reviseRow(page.page.root, r1), 'rl-edit');
      await waitFor(() => edit1() !== undefined);
      click(findAllClass(edit1()!, 'mode-btn').find((button) => textOf(button).startsWith('到某天'))!);
      await waitFor(() => fieldIn(edit1()!, '到哪天') !== undefined);
      typeField(fieldIn(edit1()!, '到哪天')!, '2026-12-31');
      click(findButton(edit1()!, '保存')!);
      await turns(() => true, 100);
      /* r2 never expires: its editor switches the shared date mode to 不过期. */
      click(findButton(reviseRow(page.page.root, r2), '改有效期')!);
      await waitFor(() => findClass(reviseRow(page.page.root, r2), 'rl-edit') !== undefined);
      release();
      await settledN(page.log, 'autonomy-rules/update', 1);
      await waitFor(() => edit1() !== undefined && textOf(findClass(edit1()!, 'err')) !== '');
      expect(findClass(reviseRow(page.page.root, r2), 'rl-edit')).toBeUndefined();
      /* 具名改坏: 失败时不把发起时的日期还回去；r1 的行按 r2 的“不过期”画、没有日期框，本行红。 */
      expect(fieldIn(edit1()!, '到哪天')?.value).toBe('2026-12-31');
      expect(countRoute(page.log, 'autonomy-rules/update')).toBe(1);
    } finally {
      release();
      await page.page.restore();
    }
  }, 120_000);

  it('⑨ 只留在本机 is drawn per workspace and writes one setting per click', async () => {
    const { world } = await openProjectWorld();
    const page = await bootE3N(world, 'Settings', { search: pageSearch, gate: true });
    try {
      await waitFor(() => findAllClass(page.page.root, 'ws').some((row) => row.getAttribute('data-know-ws') !== null));
      expect(countRoute(page.log, 'knowledge/status')).toBe(2);
      expect(findLink(page.page.root, '架构图和注记')).toBeDefined();

      const knowRowOf = (scope: { projectId: string; workspaceId: string }) =>
        findAllClass(page.page.root, 'ws')
          .find((row) => row.getAttribute('data-know-ws') === scope.projectId + '/' + scope.workspaceId)!;
      const inputOf = (scope: { projectId: string; workspaceId: string }) =>
        findElement(knowRowOf(scope), (element) => element.tagName.toLowerCase() === 'input');
      expect(knowRowOf(world.A)).toBeDefined();
      expect(inputOf(world.A)!.checked).toBe(false);
      expect(knowRowOf(world.B)).toBeDefined();
      expect(inputOf(world.B)).toBeUndefined();
      expect(textOf(knowRowOf(world.B))).toContain('不在 git 仓库里，没有这一项。');

      setBox(inputOf(world.A)!, true);
      await settledN(page.log, 'settings/knowledge-local', 1);
      expect(countRoute(page.log, 'settings/knowledge-local')).toBe(1);
      expect(callsTo(page.log, 'settings/knowledge-local')[0]?.input)
        .toEqual({ projectId: world.A.projectId, workspaceId: world.A.workspaceId, localOnly: true });
      await waitFor(() => inputOf(world.A)!.checked === true);

      setBox(inputOf(world.A)!, false);
      await settledN(page.log, 'settings/knowledge-local', 2);
      expect(callsTo(page.log, 'settings/knowledge-local')[1]?.input)
        .toEqual({ projectId: world.A.projectId, workspaceId: world.A.workspaceId, localOnly: false });
      /* The saved line now says the other consequence: the exclude entry is gone. */
      await waitFor(() => textOf(findClass(knowRowOf(world.A), 'saved')).includes('已从 info/exclude 去掉'));
      expect(textOf(findClass(knowRowOf(world.A), 'saved'))).not.toContain('已写进 info/exclude');
    } finally {
      await page.page.restore();
    }
  }, 180_000);

  it.each([
    { answer: { status: 'rejected', code: 'unavailable', reason: 'the settings file could not be written' }, text: '设置文件写不进去，可以重试', holder: 'err' },
    { answer: { status: 'rejected', code: 'unavailable', reason: 'the knowledge local setting was saved but the Host configuration was not confirmed; retry the same save' }, text: '已保存，尚未生效', holder: 'saved' },
  ])('⑨b 只留在本机 drops the old saved line when the second write says $text', async ({ answer, text, holder }) => {
    const { world } = await openProjectWorld();
    const { page, log } = await heldSettingsPage(world, pageSearch, 'knowledge-local', answer, 2);
    try {
      const knowSavedRowOf = () => findAllClass(page.root, 'ws').find((row) =>
        row.getAttribute('data-know-ws') === world.A.projectId + '/' + world.A.workspaceId);
      const box = () => {
        const row = knowSavedRowOf();
        return row === undefined ? undefined
          : findElement(row, (element) => element.tagName.toLowerCase() === 'input');
      };
      await waitFor(() => box() !== undefined);
      setBox(box()!, true);
      await settledN(log, 'settings/knowledge-local', 1);
      await waitFor(() => box()!.checked === true);
      setBox(box()!, false);
      await settledN(log, 'settings/knowledge-local', 2);
      await waitFor(() => findAllClass(knowSavedRowOf()!, holder).map(textOf).join(' ').includes(text));
      /* The old “已写进 info/exclude” must be gone once the row has an error or is not effective. */
      expect(findAllClass(knowSavedRowOf()!, 'saved').map(textOf).join(' ')).not.toContain('已写进 info/exclude');
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('⑥b the #g-lim anchor scrolls to the limits section and lights its nav row after the first draw', async () => {
    const { world } = await openProjectWorld();
    const page = await bootE3N(world, 'Settings', { search: pageSearch, hash: '#g-lim', gate: true });
    try {
      await waitFor(() => blockOf(page.page.root, '工作线上限') !== undefined);
      const section = findElement(page.page.root, (element) => element.getAttribute('id') === 'g-lim');
      expect(section).toBeDefined();
      await waitFor(() => section!.scrollCalls.length === 1);
      expect(section!.scrollCalls).toHaveLength(1);
      expect(hasClass(findLink(page.page.root, '运行上限')!, 'is-on')).toBe(true);
      for (const name of ['工作区与权限', '自动化与规则', '架构图和注记']) {
        expect(hasClass(findLink(page.page.root, name)!, 'is-on')).toBe(false);
      }
    } finally {
      await page.page.restore();
    }
  }, 120_000);

  it('⑩ a failed rule read only empties its block and its 重试 rereads the page', async () => {
    const { world } = await openProjectWorld();
    const page = await bootE3N(world, 'Settings', {
      search: pageSearch, unavailable: 'autonomy-rules', gate: true,
    });
    try {
      await waitFor(() => blockOf(page.page.root, '规则') !== undefined);
      /* The snapshot read itself succeeded, so the page is not its error state. */
      expect(page.page.root.textContent).not.toContain('暂时读不到，可以重试。');
      expect(textOf(ruleBlock(page.page.root))).toContain('暂时读不到规则。');
      expect(textOf(findLink(page.page.root, '自动化与规则')!)).not.toContain('条规则');
      /* The role-limits table and the fourth group draw normally. */
      expect(findClass(block(page.page.root, '工作线上限'), 'lim')).toBeDefined();
      expect(findElement(page.page.root, (element) => element.getAttribute('id') === 'g-know')).toBeDefined();
      /* Only the rule block's own 重试, not a page-level snapshot retry. */
      const retries = findAllClass(page.page.root, 'btn-text').filter((entry) => textOf(entry) === '重试');
      expect(retries).toHaveLength(1);

      click(retries[0]!);
      await waitFor(() => countRoute(page.log, 'autonomy-rules') === 2, 5_000);
      expect(textOf(ruleBlock(page.page.root))).toContain('暂时读不到规则。');
    } finally {
      await page.page.restore();
    }
  }, 120_000);
});

function block(root: FakeElement, name: string): FakeElement {
  const found = blockOf(root, name);
  expect(found, name).toBeDefined();
  return found!;
}
