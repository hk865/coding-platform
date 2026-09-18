import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { createCollaborationHttpClient } from './collaboration-http-client.js';

it.each(['/api/real/verifications/reviews/read', '/api/real/queries/runs', '/api/real/architecture-reviews/view', '/api/state?goalId=g'])(
  'a reset during observation does not abort the scenario: %s', async path => {
    let calls = 0;
    const server = createServer((request, response) => { request.resume(); request.on('end', () => {
      calls++;
      if (calls === 1) request.socket.resetAndDestroy();
      else { response.setHeader('content-type', 'application/json'); response.end('{"phase":"awaiting_result"}'); }
    }); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const events: unknown[] = [];
    const client = createCollaborationHttpClient('http://127.0.0.1:' + (server.address() as {port:number}).port, 'fixture', (kind, value) => events.push({kind,...value}));
    try {
      const result = path.startsWith('/api/state?') ? await client.state({goalId:'g'}) : await client.post(path, {requestId:'same'});
      expect(result).toEqual({phase:'awaiting_result'}); expect(calls).toBe(2);
      expect(events).toEqual([{kind:'retry',path,method:path.startsWith('/api/state?')?'GET':'POST',code:'ECONNRESET',retry:1}]);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });

it.each(['/api/real/verifications/reviews/start', '/api/real/queries', '/api/real/architecture-reviews/decide'])(
  'a lost mutation receipt is recorded and never blindly resent: %s', async path => {
    let committed = 0;
    const server = createServer((request) => { request.resume(); request.on('end', () => { committed++; request.socket.resetAndDestroy(); }); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const events: unknown[] = [];
    const client = createCollaborationHttpClient('http://127.0.0.1:' + (server.address() as {port:number}).port, 'fixture', (kind,value) => events.push({kind,...value}));
    try {
      await expect(client.post(path,{requestId:'same'})).rejects.toMatchObject({cause:{code:'ECONNRESET'}});
      expect(committed).toBe(1); expect(events).toEqual([{kind:'failure',path,method:'POST',code:'ECONNRESET'}]);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });

it('repeated broken observations stop after one retry and keep the original path', async () => {
  let calls=0;
  const server=createServer(request=>{request.resume();request.on('end',()=>{calls++;request.socket.resetAndDestroy();});});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const events:unknown[]=[];
  const client=createCollaborationHttpClient('http://127.0.0.1:'+(server.address() as {port:number}).port,'fixture',(kind,value)=>events.push({kind,...value}));
  try {
    await expect(client.post('/api/real/verifications/reviews/read',{})).rejects.toMatchObject({cause:{code:'ECONNRESET'}});
    expect(calls).toBe(2);expect(events).toHaveLength(2);
    expect(events[1]).toEqual({kind:'failure',path:'/api/real/verifications/reviews/read',method:'POST',code:'ECONNRESET'});
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
