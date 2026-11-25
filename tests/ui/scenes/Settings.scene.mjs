/**
 * The Settings board-check scene (7D2 batch 2): `Settings.scene.json` is the
 * snapshot the page already drew in batch 1; this file adds the four project
 * reads the second batch draws (rules, role limits, the Goal names, the git
 * judgement) and the three project writes.
 *
 *   --scene tests/ui/scenes/Settings.scene.mjs
 *   SCENE_MODE=pending  --scene tests/ui/scenes/Settings.scene.mjs   (saved, not confirmed)
 *   SCENE_MODE=conflict --scene tests/ui/scenes/Settings.scene.mjs   (one stale rule/limits write)
 *   SCENE_MODE=machine  --scene tests/ui/scenes/Settings.scene.mjs   (no resource caps on this machine)
 *   SCENE_MODE=unknown  --scene tests/ui/scenes/Settings.scene.mjs   (the machine check has not run)
 *   SCENE_MODE=fail     --scene tests/ui/scenes/Settings.scene.mjs   (the rule read is unavailable)
 *
 * The write answers move this state, so the reread after a click shows the new
 * values. The shapes follow `contracts/role-lines.ts:391-404` (rule),
 * `contracts/role-lines.ts:272-275` (allocation) and `SessionMessageRecord`.
 */
import { readFileSync } from 'node:fs';

const HAVE = JSON.parse(readFileSync(new URL('./Settings.scene.json', import.meta.url), 'utf8'));
const MODE = process.env.SCENE_MODE || 'base';
const P = 'scene-settings';
const MAIN = 'scene-main';
const OTHER = 'scene-other';
const GOAL_REF = { aggregateType: 'Goal', projectId: P, goalId: 'scene-goal' };

const snapshot = HAVE.routes['settings/snapshot'].value;
const running = { secretary: 4, adviser: 4, scribe: 2, executor: 8 };
const open = { secretary: 8, adviser: 8, scribe: 4, executor: 12 };
const S = {
  rules: [
    {
      ref: { aggregateType: 'AutonomyRule', projectId: P, ruleId: 'scene-rule-refine' }, revision: 2,
      projectRef: { projectId: P }, actions: ['refine_future', 'auto_reverify'],
      scope: [{ kind: 'goal', goalRef: GOAL_REF }], limits: { open: {} },
      expiresAt: '2026-11-30T23:59:00+08:00', approvedBy: { kind: 'human', id: 'scene-person' },
      approvedFrom: {
        cardKey: 'scene-card',
        answerMessageRef: {
          aggregateType: 'SessionMessage', projectId: P, workspaceId: MAIN, messageId: 'scene-answer',
        },
      },
      state: 'active',
    },
    {
      ref: { aggregateType: 'AutonomyRule', projectId: P, ruleId: 'scene-rule-member' }, revision: 1,
      projectRef: { projectId: P }, actions: ['create_member'], scope: [{ kind: 'project' }],
      limits: { open: { executor: 4 } }, expiresAt: null, approvedBy: { kind: 'human', id: 'scene-person' },
      approvedFrom: null, state: 'active',
    },
    {
      ref: { aggregateType: 'AutonomyRule', projectId: P, ruleId: 'scene-rule-dispatch' }, revision: 2,
      projectRef: { projectId: P }, actions: ['agent_dispatch'], scope: [{ kind: 'project' }],
      limits: null, expiresAt: null, approvedBy: { kind: 'human', id: 'scene-person' },
      approvedFrom: null, state: 'revoked',
    },
  ],
  setRevision: 3,
  limitsRevision: 1,
  running: { ...running },
  open: { ...open },
  localOnly: { [MAIN]: false, [OTHER]: false },
  conflictRevoked: false,
  conflictLimits: false,
};
S.setRevision = 3;
if (MODE === 'machine') {
  snapshot.resourceCaps.machine = { status: 'unavailable', reason: 'no_user_session',
    text: '没有资源上限：没有 systemd 的用户会话' };
}
if (MODE === 'unknown') snapshot.resourceCaps.machine = { status: 'unknown' };

const readyAnswer = (value) => ({ status: 'ready', value });
const committedAnswer = (value) => ({ status: 'committed', value });
const rejectedAnswer = (code, reason) => ({ status: 'rejected', code, reason });
const NOT_CONFIRMED = 'the setting was saved but the Host configuration was not confirmed; retry the same save';

const ruleView = () => ({ set: { ref: { aggregateType: 'AutonomyRuleSet', projectId: P },
  projectRef: { projectId: P }, revision: S.setRevision }, rules: S.rules });
const replaceSnapshot = () => snapshot;

const source = {
  kind: 'message', key: 'scene-card', subject: { kind: 'goal', goalRef: GOAL_REF }, pins: [],
};

export const scene = {
  now: HAVE.now,
  routes: HAVE.routes,
  reply(route, input, body) {
    const scope = body && body.scope ? body.scope : {};
    if (route === 'messages/read') {
      return readyAnswer({
        ref: { aggregateType: 'SessionMessage', projectId: P, workspaceId: MAIN, messageId: 'scene-answer' },
        schemaVersion: 1, revision: 1, createdAt: '2026-11-10T09:30:00+08:00', status: 'responded',
        response: { decision: { source } }, decision: { source },
      });
    }
    if (route === 'decisions/card') return readyAnswer({ subject: { kind: 'goal', goalRef: GOAL_REF } });
    if (route === 'goals/list') {
      return readyAnswer({ goals: [{
        ref: GOAL_REF, revision: 1, since: 'c0000000001', ordinal: 2, objective: '工作台界面改版',
        desiredState: {}, desiredStateRevision: 1, order: 0, waitForGoalRef: null, activePlanRevision: null,
        display: { phase: null },
      }], sourceCursor: null });
    }
    if (route === 'knowledge/status') {
      return scope.workspaceId === OTHER
        ? rejectedAnswer('unsupported', 'the checkout is not a git repository')
        : readyAnswer({ branch: 'main', dirty: 0, files: 0, localOnly: false });
    }
    if (route === 'autonomy-rules') {
      if (MODE === 'fail') return rejectedAnswer('unavailable', 'the rule read is held unavailable');
      return readyAnswer(ruleView());
    }
    if (route === 'settings/automation/save') {
      snapshot.automation = { schemaVersion: 1, autoReworkLimit: input.autoReworkLimit,
        resumeOnStartup: input.resumeOnStartup };
      return MODE === 'pending' ? rejectedAnswer('unavailable', NOT_CONFIRMED) : readyAnswer(replaceSnapshot());
    }
    if (route === 'settings/run-budget/save') {
      const saved = input.workRunTokenBudget;
      snapshot.workRunTokenBudget = { saved, effective: saved === null ? 400000000 : saved, max: 600000000 };
      return MODE === 'pending' ? rejectedAnswer('unavailable', NOT_CONFIRMED) : readyAnswer(replaceSnapshot());
    }
    if (route === 'settings/resource-caps/save') {
      snapshot.resourceCaps.memoryMaxMiB = input.memoryMaxMiB;
      snapshot.resourceCaps.tasksMax = input.tasksMax;
      snapshot.resourceCaps.effective = {
        memoryMaxMiB: input.memoryMaxMiB === null ? snapshot.resourceCaps.defaults.memoryMaxMiB : input.memoryMaxMiB,
        tasksMax: input.tasksMax === null ? snapshot.resourceCaps.defaults.tasksMax : input.tasksMax,
      };
      return MODE === 'pending' ? rejectedAnswer('unavailable', NOT_CONFIRMED) : readyAnswer(replaceSnapshot());
    }
    if (route === 'settings/knowledge-local') {
      S.localOnly[input.workspaceId] = input.localOnly;
      snapshot.workspaces = snapshot.workspaces.map((workspace) =>
        workspace.scope.workspaceId === input.workspaceId
          ? { ...workspace, knowledgeLocalOnly: input.localOnly } : workspace);
      return MODE === 'pending' ? rejectedAnswer('unavailable', NOT_CONFIRMED) : readyAnswer(replaceSnapshot());
    }
    if (route === 'autonomy-rules/update') {
      S.rules = S.rules.map((rule) => rule.ref.ruleId === input.ruleId
        ? { ...rule, expiresAt: input.expiresAt, revision: rule.revision + 1 } : rule);
      S.setRevision += 1;
      return committedAnswer(ruleView());
    }
    if (route === 'autonomy-rules/revoke') {
      if (MODE === 'conflict' && !S.conflictRevoked) {
        S.conflictRevoked = true;
        return rejectedAnswer('revision_conflict', 'the rule set changed elsewhere');
      }
      S.rules = S.rules.map((rule) => rule.ref.ruleId === input.ruleId
        ? { ...rule, state: 'revoked', revision: rule.revision + 1 } : rule);
      S.setRevision += 1;
      return committedAnswer(ruleView());
    }
    if (route === 'projects/role-limits/set') {
      if (MODE === 'conflict' && !S.conflictLimits) {
        S.conflictLimits = true;
        return rejectedAnswer('revision_conflict', 'the role limits changed elsewhere');
      }
      if (input.running) S.running = { ...S.running, ...input.running };
      if (input.open) S.open = { ...S.open, ...input.open };
      S.limitsRevision += 1;
      return committedAnswer({ projectRef: { projectId: P }, revision: S.limitsRevision,
        running: S.running, open: S.open });
    }
    if (route === 'projects/role-limits') {
      return readyAnswer({ projectRef: { projectId: P }, revision: S.limitsRevision, running: S.running, open: S.open });
    }
    if (route === 'role-lines/allocation') {
      const duties = {};
      for (const duty of ['secretary', 'adviser', 'scribe', 'executor']) {
        const holders = duty === 'secretary' ? 2 : duty === 'adviser' ? 3 : duty === 'scribe' ? 1 : 9;
        duties[duty] = { duty, limit: S.open[duty],
          holders: Array.from({ length: holders }, (_, i) => ({ name: 'scene-' + String(i) })) };
      }
      return readyAnswer({ projectRef: { projectId: P }, duties });
    }
    if (route === 'settings/snapshot') {
      return readyAnswer(replaceSnapshot());
    }
    return HAVE.routes[route];
  },
};
