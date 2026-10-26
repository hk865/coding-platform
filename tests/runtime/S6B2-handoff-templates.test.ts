/**
 * The two P7 handoff templates: their platform text, slot rows, pack/origin
 * entries, the three handoff strings and their rendering into the secretary
 * round's `task_round` slot; then the preparation that hands a round its
 * handoff material — an old secretary's understanding round renders
 * `handoff-write-understanding-secretary` with the live command's goal list in
 * front of the round, and a successor's round renders `handoff-brief-secretary`
 * once the brief is ready (a waiting brief prepares no round at all).
 *
 * Expected texts and digests are the specification's literals. The three
 * preparation rows reach their state through public steps only: a real
 * secretary world, the published hand-off owner's advance, `queries/claim`,
 * `queries/prepare` and the frozen manifest through `materials/open`; no fact,
 * receipt or prepared value is written by hand. Their expected text is the
 * frozen sample of `tests/helpers/S6B2-prompt-samples.ts` filled with values
 * the public steps returned.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { PreparedQueryExecution, PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { ResolvedPromptPackV1 } from '../../src/contracts/prompts/prompt-pack.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { parseTemplateV1, renderTemplate } from '../../src/contracts/prompts/render-template.js';
import { TEMPLATE_SLOTS } from '../../src/contracts/prompts/slot-tables.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { claimWithSecretaryProfile } from '../helpers/request-claim-steps.js';
import { SECTION_HEADERS } from '../helpers/S6A-prompt-samples.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { driveS6BHandoff, holdS6BUnderstandingRound } from '../helpers/S6B2-fixture.js';
import {
    s6b2Accept, s6b2Scene, type S6B2WorldValue,
} from '../helpers/S6B2-handoff-scene.js';
import {
    HANDOFF_RENDERED, HANDOFF_STRINGS, HANDOFF_TEMPLATE_DIGESTS, HANDOFF_TEMPLATE_TEXTS,
} from '../helpers/S6B2-prompt-samples.js';

const PACK: ResolvedPromptPackV1 = PLATFORM_PROMPT_PACK_V1;

const HANDOFF_IDS = [
    'handoff-write-understanding-secretary',
    'handoff-brief-secretary',
] as const;

describe('the P7 handoff templates', () => {
    it('declares both templates at version 1 with one required task_round slot and no tool mentions', () => {
        for (const id of HANDOFF_IDS) {
            expect(PACK.manifest.templates[id], `manifest entry ${id}`).toEqual({
                file: `templates/${id}.txt`, version: 1, mentionsTools: [],
            });
            expect(PACK.origins[id], `origin ${id}`).toEqual({
                packId: 'platform', version: 1, mentionsTools: [],
            });
            expect(TEMPLATE_SLOTS[id], `slot table ${id}`).toEqual({ task_round: { required: true } });
        }
    });

    it('keeps the committed template files byte-identical to the hand-written texts', () => {
        for (const id of HANDOFF_IDS) {
            expect(PACK.templates[id], `template text ${id}`).toBe(HANDOFF_TEMPLATE_TEXTS[id]);
            expect(parseTemplateV1(id, PACK.templates[id]!).status, `parse ${id}`).toBe('parsed');
            expect(sha256Hex(HANDOFF_TEMPLATE_TEXTS[id]), `literal sha256 ${id}`)
                .toBe(HANDOFF_TEMPLATE_DIGESTS[id]);
            expect(sha256Hex(PACK.templates[id]!), `committed sha256 ${id}`)
                .toBe(HANDOFF_TEMPLATE_DIGESTS[id]);
        }
    });

    it('renders both templates with a constructed task_round value', () => {
        for (const id of HANDOFF_IDS) {
            expect(renderTemplate(PACK, id, { task_round: 'ROUND MATERIAL' }, []).text, `rendered ${id}`)
                .toBe(HANDOFF_RENDERED[id]);
        }
    });

    it('carries the three handoff strings verbatim', () => {
        expect({
            'handoff.understandingInstruction': PACK.strings['handoff.understandingInstruction'],
            'handoff.briefHeading': PACK.strings['handoff.briefHeading'],
            'handoff.briefTools': PACK.strings['handoff.briefTools'],
        }).toEqual(HANDOFF_STRINGS);
    });
});

// ---------------------------------------------------------------------------
// The preparation hands the round its handoff material (SR3 item 6, §8.3)
// ---------------------------------------------------------------------------

/** The one section header the round's task segment starts with (`context.section.task`). */
const TASK_HEADER = SECTION_HEADERS.task;
/** `secretary.roundHeading` (strings.json:442): the round's own material follows it. */
const ROUND_HEADING = '## This round';

const scene = s6b2Scene();
afterAll(() => scene.closeAll());

/** `queries/prepare` of one round's current Run, at the revisions the public read returns. */
async function prepareRound(world: S6B2WorldValue, round: QueryJobRef, label: string) {
    return (await world.post('queries/prepare', plain(S6A_SCOPE, {
        queryRunRef: (await readQuery(world.ag2b, round)).run.ref, requestId: `${label}-prepare`,
    }))).body as ReadResult<PreparedQueryExecution>;
}

/** The frozen manifest as the public `materials/open` route returns it. */
async function frozenManifest(world: S6B2WorldValue, prepared: PreparedQueryExecution) {
    const openedManifest = (await world.post('materials/open', plain(S6A_SCOPE, {
        ref: prepared.bundleRef, usage: 'historical_explanation',
    }))).body as ReadResult<{ body: string }>;
    if (openedManifest.status !== 'ready') {
        throw new Error(`the frozen manifest is not openable: ${JSON.stringify(openedManifest)}`);
    }
    return JSON.parse(openedManifest.value.body) as PreparedQueryManifestV1;
}

describe('the preparation hands the round its handoff material', () => {
    it('puts the understanding template and the live command\'s goal list in front of the old secretary\'s round', async () => {
        const { world, main } = await scene.open('memory', undefined,
            { secretaryTools: ['read', 'record_note'] });
        const source = await world.createSecretary('s6b2-templates-understanding-source');
        // The source owns one goal root, so its coverage is short and the real advance appends the live
        // `request_understanding` command that the understanding round carries.
        await main.submit({ label: 's6b2-templates-understanding', goalId: world.goals.first.goalId,
            recipient: source.ref });
        const round = await holdS6BUnderstandingRound(world, {
            secretary: source, goals: [world.goals.first],
        });
        const goal = world.goals.first;
        // Hand-computed: the instruction string, then one reference line per granted goal in canonical JSON order.
        const taskRound = [
            HANDOFF_STRINGS['handoff.understandingInstruction'],
            `- Goal {"goalId":"${goal.goalId}","projectId":"${goal.projectId}"}`,
        ].join('\n');
        const understanding = HANDOFF_TEMPLATE_TEXTS['handoff-write-understanding-secretary']
            .replace('{{task_round}}', taskRound);
        expect(round.manifest.input).toContain(`${TASK_HEADER}\n${understanding}\n\n${ROUND_HEADING}\n`);
    });

    it('answers the retryable incomplete for a successor round while the brief waits, and prepares no round', async () => {
        const { world, main } = await scene.open('memory');
        const source = await world.createSecretary('s6b2-templates-waiting-source');
        const target = await world.createSecretary('s6b2-templates-waiting-target');
        await s6b2Accept(world, { commandId: 's6b2-templates-waiting-accept',
            source: source.ref, target: target.ref });
        const request = await main.submit({ label: 's6b2-templates-waiting', goalId: null, recipient: target.ref });
        await claimWithSecretaryProfile(world, request.round, target, 's6b2-templates-waiting-claim');
        const prepared = await prepareRound(world, request.round, 's6b2-templates-waiting');
        // The guarded archive and the routing set are unfinished, so the round is not prepared at all.
        expect(prepared).toMatchObject({ status: 'rejected', code: 'incomplete' });
        const after = await readQuery(world.ag2b, request.round);
        expect(after.run.run.executionState?.phase).toBe('claimed');
    });

    it('puts the brief template in front of the successor round once the brief is ready', async () => {
        const { world, main } = await scene.open('memory');
        const source = await world.createSecretary('s6b2-templates-ready-source');
        const target = await world.createSecretary('s6b2-templates-ready-target');
        // A no-goal root needs no understanding write, so the advance reaches the routing and archive steps.
        const root = await main.submit({ label: 's6b2-templates-ready', goalId: null, recipient: source.ref });
        const operation = await s6b2Accept(world, { commandId: 's6b2-templates-ready-accept',
            source: source.ref, target: target.ref });
        expect((await driveS6BHandoff(world, { operation })).progress).toMatchObject({ stage: 'finished' });
        // The routed root now belongs to the successor; its follow-up round is the successor's own round, opened
        // through the public submit of the same request.
        const follow = await world.submit({ commandId: 's6b2-templates-ready-follow', goalId: null,
            text: 's6b2-templates-ready follow', continues: root.requestRoot });
        if (follow.status !== 'queued') throw new Error(`the follow-up was refused: ${JSON.stringify(follow)}`);
        await claimWithSecretaryProfile(world, follow.round, target, 's6b2-templates-ready-claim');
        const prepared = await prepareRound(world, follow.round, 's6b2-templates-ready');
        expect(prepared.status).toBe('ready');
        if (prepared.status !== 'ready') return;
        const manifest = await frozenManifest(world, prepared.value);
        // Hand-computed: the heading, the routed request with its original text and no answer yet, the old line link
        // and the tool line, each reference in canonical JSON order.
        const taskRound = [
            HANDOFF_STRINGS['handoff.briefHeading'],
            `- request QueryJob {"projectId":"${root.requestRoot.projectId}",`
                + `"queryJobId":"${root.requestRoot.queryJobId}","workspaceId":"${root.requestRoot.workspaceId}"}`,
            `  original text: ${root.text}`,
            '  last answer: (no answer)',
            `- old line: Session {"projectId":"${source.ref.projectId}","sessionId":"${source.ref.sessionId}"}`,
            HANDOFF_STRINGS['handoff.briefTools'],
        ].join('\n');
        const brief = HANDOFF_TEMPLATE_TEXTS['handoff-brief-secretary'].replace('{{task_round}}', taskRound);
        expect(manifest.input).toContain(`${TASK_HEADER}\n${brief}\n\n${ROUND_HEADING}\n`);
    });
});
