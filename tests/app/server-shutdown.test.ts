import { it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { request } from 'node:http';
import { createGuiServer } from '../../src/app/server.js';

it('closes a real Host with an unused browser preconnection and shares the shutdown result', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'host-preconnect-'));
  const app = await createGuiServer(dir);
  await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done));
  const socket = connect((app.server.address() as { port: number }).port, '127.0.0.1');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>(done => socket.once('connect', done));
    const closing = app.close();
    expect(app.close()).toBe(closing);
    expect(await Promise.race([closing.then(() => true), new Promise<boolean>(done => { timer = setTimeout(() => done(false), 2000); })])).toBe(true);
  } finally { if (timer) clearTimeout(timer); socket.destroy(); await app.close(); await rm(dir, { recursive: true, force: true }); }
}, 20000);

it('drains an admitted HTTP body and response before closing storage, then reopens its committed goal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'host-http-drain-'));
  let app = await createGuiServer(dir);
  const listen = async () => { await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done)); return (app.server.address() as { port: number }).port; };
  try {
    const port = await listen();
    const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: 'drained-goal' };
    const body = JSON.stringify({ ...scope, requestId: 'drained-goal', objective: 'Retain the accepted shutdown request' });
    const admitted = new Promise<void>(done => app.server.once('request', () => done()));
    let finishBody!: () => void;
    const reply = new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path: '/api/goals', method: 'POST', agent: false,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => {
        let output = ''; res.on('data', chunk => { output += chunk; });
        res.on('end', () => resolve({ status: res.statusCode!, body: output }));
      });
      req.on('error', reject); req.flushHeaders();
      finishBody = () => req.end(body);
    });
    await admitted;
    const closing = app.close();
    finishBody();
    expect((await reply).status).toBe(200);
    await closing;
    app = await createGuiServer(dir);
    const reopenedPort = await listen();
    const result = await fetch(`http://127.0.0.1:${reopenedPort}/api/state?${new URLSearchParams(scope)}`);
    expect(result.status).toBe(200);
    expect(await result.text()).toContain('Retain the accepted shutdown request');
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
}, 20000);
