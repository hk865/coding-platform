/**
 * The secretary templates through PC-2's public routes on the real Host: a
 * person creates a pack, replaces `secretary-round` with another legal section
 * order and `secretary-answer` with other text, selects the pack for a model,
 * and reads everything back. A pack that splits or reorders the three task
 * slots, or drops one of them, is refused, with a byte snapshot showing the
 * pack directory did not change and a public read of the stored template.
 *
 * Every row runs on the in-memory store and on SQLite: the answer must not
 * depend on where the Host keeps its ledger, so one backend would hide a
 * difference the person would see.
 */
import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { templateSectionOrder } from '../../src/core/agent-runtime/context-rendering.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { snapshotPC2Step } from '../helpers/PC2-pack-fixture.js';

const PACK_ID = 's6a-t-pack';
/** The platform layout, written out: one blank line after the prelude. */
const PLATFORM_ROUND = '{{prelude}}\n\n{{role}}{{goal}}{{notes}}{{task_round}}{{task_batched}}{{task_earlier}}';
const MOVED_TASK_BLOCK = '{{prelude}}\n\n{{role}}{{goal}}{{task_round}}{{task_batched}}{{task_earlier}}{{notes}}';
const SEPARATED = '{{prelude}}\n\n{{role}}{{goal}}{{task_round}}{{notes}}{{task_batched}}{{task_earlier}}';
const REORDERED = '{{prelude}}\n\n{{role}}{{goal}}{{notes}}{{task_round}}{{task_earlier}}{{task_batched}}';
const WITHOUT_BATCHED = '{{prelude}}\n\n{{role}}{{goal}}{{notes}}{{task_round}}{{task_earlier}}';
const WITHOUT_EARLIER = '{{prelude}}\n\n{{role}}{{goal}}{{notes}}{{task_round}}{{task_batched}}';

const BACKENDS = ['memory', 'sqlite'] as const;

type SettingsCall = { path: string; status: number; body: unknown };

/**
 * A forwarding wrapper over `fetch` (rule A3): it records the HTTP status and
 * body of each settings route call and returns the real response unchanged, so
 * a row sees the status the person's client sees.
 */
function recordSettingsCalls(): { calls: SettingsCall[]; restore(): void } {
    const calls: SettingsCall[] = [];
    const real = globalThis.fetch.bind(globalThis);
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const response = await real(input, init);
        const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
        calls.push({ path, status: response.status, body: await response.clone().json().catch(() => null) });
        return response;
    });
    return { calls, restore: () => spy.mockRestore() };
}

/** The last call of one settings route. */
function lastCall(calls: readonly SettingsCall[], route: string): SettingsCall {
    const found = calls.filter(call => call.path === `/api/real/settings/${route}`).at(-1);
    if (found === undefined) throw new Error(`no ${route} call was made`);
    return found;
}

/**
 * The Host keeps its settings directory, and a person's packs under it, in
 * `<ledger directory>/host-settings` on both backends.
 */
const packDirectoryOf = (world: S6AHostWorld): string =>
    join(world.database, 'host-settings', 'prompts', PACK_ID);

describe.each(BACKENDS)('the secretary pack routes on the %s backend', backend => {
    describe('a person pack over the secretary templates (public routes)', () => {
        it('accepts another legal order and another answer text, selected for a model', async () => {
            const world = await openS6AHostWorld({ backend });
            const seen = recordSettingsCalls();
            try {
                const created = await world.packs.create(PACK_ID);
                expect(created).toEqual({
                    status: 'ready',
                    value: { packId: PACK_ID, extends: 'platform', templates: [], strings: {}, tools: {} },
                });

                const round = await world.packs.saveTemplate(PACK_ID, 'secretary-round', MOVED_TASK_BLOCK);
                expect(lastCall(seen.calls, 'prompts/templates/save').status).toBe(200);
                expect(round).toMatchObject({
                    status: 'ready',
                    value: {
                        templateId: 'secretary-round', version: 2, fromPack: PACK_ID,
                        text: MOVED_TASK_BLOCK, mentionsTools: [],
                    },
                });

                const answer = await world.packs.saveTemplate(PACK_ID, 'secretary-answer', 'ANSWER FROM THE PERSON');
                expect(lastCall(seen.calls, 'prompts/templates/save').status).toBe(200);
                expect(answer).toMatchObject({
                    status: 'ready',
                    value: {
                        templateId: 'secretary-answer', version: 3, fromPack: PACK_ID, text: 'ANSWER FROM THE PERSON',
                    },
                });

                const readRound = await world.packs.readTemplate(PACK_ID, 'secretary-round');
                expect(readRound).toMatchObject({
                    status: 'ready',
                    value: {
                        templateId: 'secretary-round', version: 2, fromPack: PACK_ID, text: MOVED_TASK_BLOCK,
                        slots: {
                            prelude: { required: false }, role: { required: true }, goal: { required: false },
                            notes: { required: false }, task_round: { required: true },
                            task_batched: { required: false }, task_earlier: { required: false },
                        },
                    },
                });
                if (readRound.status !== 'ready') throw new Error('the saved round template was not readable');
                expect(templateSectionOrder({
                    templates: { 'secretary-round': readRound.value.text }, strings: {},
                }, 'secretary-round')).toEqual(['role', 'goal', 'task', 'notes']);
                const readAnswer = await world.packs.readTemplate(PACK_ID, 'secretary-answer');
                expect(readAnswer).toMatchObject({
                    status: 'ready', value: { text: 'ANSWER FROM THE PERSON', version: 3, slots: {} },
                });

                const list = await world.settings('prompts/packs/list', {});
                expect(list).toMatchObject({
                    status: 'ready',
                    value: { packs: expect.arrayContaining([
                        expect.objectContaining({ packId: PACK_ID, extends: 'platform', problems: [] }),
                    ]) },
                });

                const selected = await world.packs.select(PACK_ID);
                const carrying = selected.models.filter(model => model.promptPack === PACK_ID);
                expect(carrying).toHaveLength(1);
                // The save that put the pack on the model answered with it, before the selection.
                const saved = lastCall(seen.calls, 'models/save');
                expect(saved.status).toBe(200);
                expect(saved.body).toMatchObject({
                    status: 'ready',
                    value: { models: expect.arrayContaining([
                        expect.objectContaining({ id: carrying[0]!.id, promptPack: PACK_ID }),
                    ]) },
                });
                expect(selected.workspaces).toEqual(expect.arrayContaining([
                    expect.objectContaining({ scope: { ...S6A_SCOPE }, modelId: carrying[0]!.id }),
                ]));
            } finally { seen.restore(); await world.close(); }
        }, 60_000);
    });

    describe('rejects: invalid secretary task blocks', () => {
        /**
         * Creates the pack, attempts the save of `text` on top of the platform
         * version and checks the refusal: the pack directory's bytes unchanged,
         * the route's rejection, and the stored template still the platform one.
         */
        async function refusedSave(world: S6AHostWorld, text: string): Promise<void> {
            expect((await world.packs.create(PACK_ID)).status).toBe('ready');
            const seen = recordSettingsCalls();
            const step = await snapshotPC2Step(packDirectoryOf(world), async () => {
                try { return await world.packs.saveTemplate(PACK_ID, 'secretary-round', text); } finally { seen.restore(); }
            });
            expect(lastCall(seen.calls, 'prompts/templates/save').status).toBe(400);
            expect(step.difference.equal).toBe(true);
            expect(step.outcome.status).toBe('returned');
            if (step.outcome.status !== 'returned') throw new Error('the refused save threw instead of answering');
            expect(step.outcome.value.status).toBe('rejected');
            if (step.outcome.value.status !== 'rejected')
                throw new Error('the save of an invalid task block was accepted');
            expect(step.outcome.value.code).toBe('invalid');
            expect(step.outcome.value.problems).toEqual([
                { packId: PACK_ID, templateId: 'secretary-round', reason: expect.any(String) },
            ]);
            const read = await world.packs.readTemplate(PACK_ID, 'secretary-round');
            expect(read).toMatchObject({
                status: 'ready', value: { version: 1, fromPack: 'platform', text: PLATFORM_ROUND },
            });
        }

        it('separates the task block by another section and changes no byte', async () => {
            const world = await openS6AHostWorld({ backend });
            try { await refusedSave(world, SEPARATED); } finally { await world.close(); }
        }, 60_000);

        it('reorders the task slots and changes no byte', async () => {
            const world = await openS6AHostWorld({ backend });
            try { await refusedSave(world, REORDERED); } finally { await world.close(); }
        }, 60_000);

        it('drops task_batched from the template and changes no byte', async () => {
            const world = await openS6AHostWorld({ backend });
            try { await refusedSave(world, WITHOUT_BATCHED); } finally { await world.close(); }
        }, 60_000);

        it('drops task_earlier from the template and changes no byte', async () => {
            const world = await openS6AHostWorld({ backend });
            try { await refusedSave(world, WITHOUT_EARLIER); } finally { await world.close(); }
        }, 60_000);
    });
});
