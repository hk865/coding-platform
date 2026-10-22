/**
 * PC-1b joint step: J-03 (PC-07, §5.2 lines 684-685) and J-04 (PC-08, lines
 * 686-689). Every world comes from the frozen platform fixture's public steps.
 *
 * J-03: a formal pause is observed through `observeRun` (`controlState`
 * `paused`), the first start ends normally (no swallowed error), and the
 * explicit resume adds ONE new request with a new identity whose system is
 * byte-equal to the first. The workspace is a real git baseline with the
 * platform files ignored: the Kernel's own resume refuses a workspace whose
 * files changed while the Turn was paused, which is unrelated to the rule
 * under test. (Without it the fixture's SQLite files change the snapshot.)
 *
 * J-04: a literal base and Skill are injected and the Host instruction is off.
 * The old binding's whole system is hand-written; after a NEW Host binding is
 * installed the model still receives that literal, never a text re-read from
 * production.
 */
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { openPCWorkFixture, replyGate, scriptedModel } from '../helpers/PC-platform-fixture.js';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const runGit = promisify(execFile);
const git = async (directory: string, args: string[]): Promise<void> => {
  await runGit('git', args, { cwd: directory });
};

/** A committed git baseline so the Kernel's resume sees an unchanged workspace. */
async function gitBaseline(directory: string): Promise<void> {
  await git(directory, ['init']);
  await git(directory, ['config', 'user.email', 'pc@example.test']);
  await git(directory, ['config', 'user.name', 'PC']);
  await writeFile(`${directory}/.gitignore`, '*.sqlite*\n');
  await git(directory, ['add', '.gitignore', 'wp2-read.txt']);
  await git(directory, ['commit', '-m', 'PC joint baseline']);
}

const PIN_BASE = 'PC_PIN_BASE';
const PIN_SKILL = 'PC_CUSTOM_SKILL_V1';
const PIN_SKILL_SOURCE = `skill:pc-custom@sha256:${sha(PIN_SKILL)}`;
const PIN_SYSTEM = PIN_BASE + '\n\n'
  + `[skill_instruction id="pc-custom" source=${JSON.stringify(PIN_SKILL_SOURCE)}]\n${PIN_SKILL}`;

describe('J-03 PC-07: a formally paused Work resumes with one new byte-equal request', () => {
  it('observes the pause, ends the first start normally and resumes with a new identity', async () => {
    const gate = replyGate();
    const fixture = await openPCWorkFixture({
      model: scriptedModel([
        { toolCalls: [{ callId: 'pc-joint-pause-call', name: 'read', arguments: { path: 'wp2-read.txt' } }],
          beforeReply: gate.beforeReply },
        { text: 'PC joint resumed answer' },
      ]),
      systemInstruction: null,
      selection: { modelId: 'pc-joint-pause-model', promptPack: 'platform', reasoningReplay: 'none' },
    });
    try {
      await gitBaseline(fixture.base.fixture.directory);
      await fixture.work.prepare();
      const running = fixture.work.start();
      await gate.reached;
      await fixture.work.pause();
      const paused = await fixture.work.observe();
      expect(paused.status, JSON.stringify(paused)).toBe('ready');
      if (paused.status !== 'ready') return;
      expect(paused.value.run.controlState?.desiredState).toBe('paused');
      // The pause must take effect while the first start is still in flight.
      expect(paused.value.run.status).toBe('running');
      expect(fixture.model.calls()).toBe(1);

      gate.release();
      // No swallowed error: the first start resolves and its Turn left at the pause.
      const first = await running;
      expect(first.status, JSON.stringify(first)).toBe('ready');
      const beforeResume = fixture.model.calls();
      expect(beforeResume).toBe(1);

      fixture.packs.change({ base: 'PC_CHANGED_BASE', strings: { 'context.prelude.work': 'PC_CHANGED_PRELUDE' } });
      await fixture.skill.rewrite('PC_CHANGED_SKILL');
      const resumed = await fixture.work.resume();
      expect(resumed.status, JSON.stringify(resumed)).toBe('ready');
      await expect.poll(() => fixture.model.calls(), { timeout: 60_000 }).toBe(beforeResume + 1);

      expect(fixture.model.requests).toHaveLength(2);
      const firstRequest = fixture.model.requests[0]!;
      const resumedRequest = fixture.model.requests[1]!;
      expect(resumedRequest.requestId).not.toBe(firstRequest.requestId);
      expect(resumedRequest.systemPrompt).toBe(firstRequest.systemPrompt);
      // The changed pack and Skill file after the pause are not what resumes.
      expect(resumedRequest.systemPrompt).not.toContain('PC_CHANGED_BASE');
      expect(resumedRequest.systemPrompt).not.toContain('PC_CHANGED_SKILL');
      const after = await fixture.work.observe();
      expect(after.status, JSON.stringify(after)).toBe('ready');
      if (after.status === 'ready') {
        expect(after.value.run.status).toBe('ended');
        expect(after.value.run.outcome).toBe('completed');
      }
    } finally {
      await fixture.close();
    }
  }, 60_000);
});

describe('J-04 PC-08: a Host binding installed after preparation is not the execution\'s', () => {
  it('keeps the hand-written prepared base and Skill when a new binding is installed', async () => {
    const fixture = await openPCWorkFixture({
      model: scriptedModel([{ text: 'PC joint pinned answer' }]),
      systemInstruction: null,
      selection: { modelId: 'pc-joint-pin-model', promptPack: 'platform', reasoningReplay: 'none' },
    });
    try {
      fixture.packs.change({ base: PIN_BASE });
      await fixture.work.prepare();

      fixture.installBinding({
        selection: { modelId: 'pc-joint-pin-model', promptPack: 'pc-other-pack', reasoningReplay: 'none' },
      });
      const started = await fixture.work.start();
      expect(started.status, JSON.stringify(started)).toBe('ready');
      expect(fixture.model.calls()).toBe(1);
      expect(fixture.model.requests[0]!.systemPrompt).toBe(PIN_SYSTEM);
    } finally {
      await fixture.close();
    }
  }, 60_000);
});
