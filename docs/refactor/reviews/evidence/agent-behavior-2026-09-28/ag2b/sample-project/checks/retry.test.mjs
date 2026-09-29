import test from 'node:test';
import assert from 'node:assert/strict';
import { callClient } from '../src/client.mjs';
test('success on third attempt keeps policy and delays',async()=>{const attempts=[],delays=[];const value=await callClient(async n=>{attempts.push(n);if(n<3)throw Error('transient');return 17;},{maxAttempts:3,delayMs:25,sleep:async ms=>delays.push(ms)});assert.equal(value,17);assert.deepEqual(attempts,[1,2,3]);assert.deepEqual(delays,[25,25]);});
test('exhaustion preserves the exact error and does not sleep after final attempt',async()=>{const failure=Error('upstream');const attempts=[],delays=[];await assert.rejects(()=>callClient(async n=>{attempts.push(n);throw failure;},{maxAttempts:2,delayMs:7,sleep:async ms=>delays.push(ms)}),e=>e===failure);assert.deepEqual(attempts,[1,2]);assert.deepEqual(delays,[7]);});
