/**
 * PC-2 row PC-05 (settings half): two models remember their own pack and replay
 * policy, a read shows a field only when it is set, and a save that omits either
 * field clears it so the restart still resolves the defaults.
 *
 * All state is reached through the real settings routes; expected values are the
 * literal pack ids written into the requests.
 */
import { describe, expect, it } from 'vitest';
import { openPC2HostFixture } from '../helpers/PC2-host-fixture.js';
import { SETTINGS_API_PREFIX } from '../../src/app/host-settings-types.js';
import { pc2PackCases } from '../helpers/PC2-pack-fixture.js';

const MODELS = [
  { id: 'pc2-model-a', label: 'Model A', provider: 'deepseek' as const, model: 'deepseek-chat' },
  { id: 'pc2-model-b', label: 'Model B', provider: 'deepseek' as const, model: 'deepseek-chat' },
];

describe('PC-05 model settings carry the pack and replay policy', () => {
  it('PC-05 two models keep their own pack; omission clears and a restart keeps the default', async () => {
    const cases = pc2PackCases();
    const fixture = await openPC2HostFixture({ models: MODELS, packs: cases.childChain });
    try {
      const initial = await fixture.call('snapshot', {});
      expect(initial.body.status).toBe('ready');
      if (initial.body.status !== 'ready') return;
      for (const model of initial.body.value.models) {
        expect(model).not.toHaveProperty('promptPack');
        expect(model).not.toHaveProperty('reasoningReplay');
      }

      const savedA = await fixture.call('models/save', {
        id: 'pc2-model-a', label: 'Model A', provider: 'deepseek', model: 'deepseek-chat',
        promptPack: 'pc2-child', reasoningReplay: 'none',
      });
      expect(savedA.status).toBe(200);
      expect(savedA.body.status).toBe('ready');
      if (savedA.body.status !== 'ready') return;
      expect(savedA.body.value.models.find(model => model.id === 'pc2-model-a')).toMatchObject({
        promptPack: 'pc2-child', reasoningReplay: 'none',
      });

      const savedB = await fixture.call('models/save', {
        id: 'pc2-model-b', label: 'Model B', provider: 'deepseek', model: 'deepseek-chat',
        promptPack: 'pc2-parent', reasoningReplay: 'current_run',
      });
      expect(savedB.body).toMatchObject({
        status: 'ready',
        value: { models: expect.arrayContaining([
          expect.objectContaining({ id: 'pc2-model-b', promptPack: 'pc2-parent', reasoningReplay: 'current_run' }),
        ]) },
      });

      // A save without the two fields clears them; the read shows no field.
      const cleared = await fixture.call('models/save', {
        id: 'pc2-model-a', label: 'Model A', provider: 'deepseek', model: 'deepseek-chat',
      });
      expect(cleared.status).toBe(200);
      expect(cleared.body.status).toBe('ready');
      if (cleared.body.status !== 'ready') return;
      const clearedModel = cleared.body.value.models.find(model => model.id === 'pc2-model-a');
      expect(clearedModel).not.toHaveProperty('promptPack');
      expect(clearedModel).not.toHaveProperty('reasoningReplay');

      // A restart reads the persisted later save, not the startup catalog.
      await fixture.restart();
      const afterRestart = await fixture.call('snapshot', {});
      expect(afterRestart.body.status).toBe('ready');
      if (afterRestart.body.status !== 'ready') return;
      const restartedA = afterRestart.body.value.models.find(model => model.id === 'pc2-model-a');
      expect(restartedA).not.toHaveProperty('promptPack');
      expect(restartedA).not.toHaveProperty('reasoningReplay');
      expect(afterRestart.body.value.models.find(model => model.id === 'pc2-model-b')).toMatchObject({
        promptPack: 'pc2-parent', reasoningReplay: 'current_run',
      });
    } finally { await fixture.close(); }
  });

  it('PC-05 save checks only the pack id and replay syntax', async () => {
    const fixture = await openPC2HostFixture({ models: MODELS });
    try {
      const badPack = await fixture.call('models/save', {
        id: 'pc2-model-a', label: 'Model A', provider: 'deepseek', model: 'deepseek-chat', promptPack: 'Bad_Pack',
      });
      expect(badPack.status).toBe(400);
      expect(badPack.body).toMatchObject({ status: 'rejected', code: 'invalid' });

      // The DTO type only admits the two legal values, so an out-of-syntax body
      // reaches the real route through the fixture's raw-body seam.
      const badReplay = await fixture.request(`${SETTINGS_API_PREFIX}models/save`, undefined, {
        rawBody: JSON.stringify({
          id: 'pc2-model-a', label: 'Model A', provider: 'deepseek', model: 'deepseek-chat',
          reasoningReplay: 'off',
        }),
      });
      expect(badReplay.status).toBe(400);
      expect(badReplay.body).toMatchObject({ status: 'rejected', code: 'invalid' });

      // `platform` is the default pack and a legal id; no pack existence check here.
      const accepted = await fixture.call('models/save', {
        id: 'pc2-model-a', label: 'Model A', provider: 'deepseek', model: 'deepseek-chat', promptPack: 'platform',
      });
      expect(accepted.status).toBe(200);
      expect(accepted.body).toMatchObject({
        status: 'ready', value: { models: expect.arrayContaining([
          expect.objectContaining({ id: 'pc2-model-a', promptPack: 'platform' }),
        ]) },
      });
    } finally { await fixture.close(); }
  });

  it('H2-01 a broken JSON body on a non-prompt settings route keeps the base body', async () => {
    const fixture = await openPC2HostFixture();
    try {
      const response = await fixture.request(`${SETTINGS_API_PREFIX}models/save`, undefined, {
        rawBody: '{"id":',
      });
      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        status: 'rejected', code: 'invalid', reason: 'request body is not valid JSON',
      });
    } finally { await fixture.close(); }
  });
});
