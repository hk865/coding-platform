import { it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createModelSettings } from '../../src/app/model-settings.js';
import { architectureReviewScenario } from './architecture-review-scenario.js';
it.skipIf(!process.env['C1_REAL_MODEL'])('real DeepSeek successors consume the human architecture decision', async () => {
    const settings = await createModelSettings(resolve('.local/gui'), { directory: '/home/han001/.config/agent-platform/2925e9d16dbd6c81bc7fcb84' });
    const bound = await settings.bindRun('cm1c-real-sample');
    await architectureReviewScenario('accept', { successorModel: bound, completed: async (result) => {
            const dir = resolve('evidence/collaboration-memory/CM-1C-001/implementation/continuation-01');
            await mkdir(dir, { recursive: true });
            await writeFile(resolve(dir, 'real-model-02.json'), JSON.stringify({ model: bound.configuration.model, provider: bound.configuration.provider, scope: 'Two actual provider successor calls; report producer uses a labelled deterministic protocol stub; isolated empty workspace; no image or project quality assertion', result }, null, 2));
        } });
}, 240000);
