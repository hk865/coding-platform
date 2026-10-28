/**
 * LG-1: a real execution only sends the model tool schemas whose top level is
 * an object. One secretary coordination round and one Work run carry the graph
 * tools; both requests are the scripted models' own captured `ModelRequest`s.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  initializeProject, newRequest, secretaryAnswer, submitRound, waitForRound,
} from '../helpers/S6A-history-fixture.js';
import { openS3Host, type S3Host } from '../scenarios/support/S3-host.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
});

describe('LG-1: the model receives tool schemas whose top level is an object', () => {
  it('the secretary round and the Work run both carry look_graph as a top-level object', async () => {
    const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'on' },
      secretaryTools: ['read', 'look_graph', 'find_graph', 'record_note'] });
    worlds.push(world);
    await initializeProject(world);
    const session = await world.createSecretary('lg');
    await world.scripted.script(session, [{ kind: 'text', text: secretaryAnswer({ body: 'LG-1 answer' }) }]);
    const gate = await world.gates.modelRequest(session);
    const round = await submitRound(world, newRequest('lg-1', session, 'LG-1 question'));
    const secretaryRequest = await gate.reached;
    gate.release();
    await waitForRound(world, round.requestRoot, round.round, 'ended');

    let work: S3Host | null = null;
    try {
      work = await openS3Host('lg-1-work', { replies: [{ kind: 'text', text: 'LG-1 tA completed' }] });
      const [workRequest] = work.modelRequests();
      if (workRequest === undefined) throw new Error('LG-1: the Work Run made no model request');
      const captured: readonly (readonly [string, ModelRequest])[] = [
        ['the S6A secretary round', secretaryRequest],
        ['the Work run', workRequest],
      ];
      for (const [label, request] of captured) {
        expect(request.tools.map(tool => tool.name), `${label} must carry look_graph`).toContain('look_graph');
        for (const tool of request.tools) {
          expect(tool.inputSchema.type, `${label}: ${tool.name} inputSchema.type`).toBe('object');
        }
      }
    } finally {
      await work?.close();
    }
  });
});
