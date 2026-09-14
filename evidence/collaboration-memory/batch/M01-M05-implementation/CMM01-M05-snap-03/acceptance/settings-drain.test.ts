import { it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { request } from 'node:http';
import { createGuiServer } from '/mnt/d/1.project/Software/agent_platform/src/app/server.js';

it('drains a model settings HTTP operation outside service.action during shutdown', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'host-http-drain-'));
  let app = await createGuiServer(dir);
  const listen = async () => { await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done)); return (app.server.address() as { port: number }).port; };
  try {
    const port = await listen();
    const token=(await (await fetch(`http://127.0.0.1:${port}/api/meta`)).json()).workspaceToken;
    const body = JSON.stringify({provider:'deepseek',model:'drained-model',baseUrl:'http://127.0.0.1',apiKey:'LOCAL_TEST_KEY'});
    const admitted = new Promise<void>(done => app.server.once('request', () => done()));
    let finishBody!: () => void;
    const reply = new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path: '/api/model-settings', method: 'POST', agent: false,
        headers: { 'x-platform-token':token, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => {
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
    const reopenedToken=(await (await fetch(`http://127.0.0.1:${reopenedPort}/api/meta`)).json()).workspaceToken;
    const result=await fetch(`http://127.0.0.1:${reopenedPort}/api/model-settings`,{headers:{'x-platform-token':reopenedToken}});
    expect(result.status).toBe(200);
    expect(await result.text()).toContain('drained-model');
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
}, 20000);
