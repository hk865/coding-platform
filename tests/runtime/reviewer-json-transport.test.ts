import { describe, expect, it } from 'vitest';
import { modelRequestSchema, type ModelRequest } from '../../vendor/coding-agent/src/core/ports/model_client/model-client-port.js';
import { DeepSeekModelClient } from '../../vendor/coding-agent/src/model/providers/deepseek/deepseek-model-client.js';
import { OpenAIModelClient } from '../../vendor/coding-agent/src/model/providers/openai/openai-model-client.js';

const request: ModelRequest = { schemaVersion: 1, requestId: 'json-review', runId: 'review-run',
  systemPrompt: 'Return a JSON object. Example: {"decision":"INCONCLUSIVE"}.',
  messages: [{ role: 'user', messageId: 'question', content: 'Inspect using read before the final JSON report.' }],
  tools: [{ name: 'read', description: 'Read source', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } }],
  maxOutputTokens: 128 };
async function collect(stream: AsyncIterable<unknown>) { const events = []; for await (const event of stream) events.push(event); return events; }

describe('explicit Reviewer JSON transport', () => {
  it('accepts old requests unchanged and only the optional JSON object format', () => {
    expect(modelRequestSchema.parse(request)).toEqual(request);
    expect(modelRequestSchema.parse({ ...request, responseFormat: { type: 'json_object' } })).toHaveProperty('responseFormat.type', 'json_object');
    expect(modelRequestSchema.safeParse({ ...request, responseFormat: { type: 'arbitrary' } }).success).toBe(false);
  });

  it.each(['deepseek', 'openai'] as const)('%s actually transports JSON mode with tools, and omits it by default', async provider => {
    const bodies: Readonly<Record<string, unknown>>[] = [];
    const transport = { async create(body: Readonly<Record<string, unknown>>) { bodies.push(body); return (async function* () {
      if (provider === 'deepseek') yield { choices: [{ delta: { content: '{"decision":"INCONCLUSIVE"}' }, finish_reason: 'stop' }] };
      else { yield { type: 'response.output_text.delta', delta: '{"decision":"INCONCLUSIVE"}' }; yield { type: 'response.completed', response: {} }; }
    })(); } };
    const client = provider === 'deepseek' ? new DeepSeekModelClient({ model: 'test', transport }) : new OpenAIModelClient({ model: 'test', transport });
    for (const candidate of [request, { ...request, responseFormat: { type: 'json_object' as const } }]) {
      const events = await collect(client.stream(candidate, { signal: new AbortController().signal }));
      expect(events.at(-1)).toMatchObject({ type: 'completed', reason: 'final_answer', requestId: request.requestId });
    }
    expect(bodies).toHaveLength(2);
    const field = provider === 'deepseek' ? 'response_format' : 'text';
    expect(bodies[0]).not.toHaveProperty(field);
    expect(bodies[1]?.[field]).toEqual(provider === 'deepseek' ? { type: 'json_object' } : { format: { type: 'json_object' } });
    expect(bodies[1]?.['tools']).toEqual(bodies[0]?.['tools']);
    expect(bodies[1]?.['tools']).toHaveLength(1);
    if (provider === 'deepseek') expect(bodies[1]).toHaveProperty('thinking.type', 'enabled');
  });

  it.each(['deepseek', 'openai'] as const)('%s keeps JSON truncation as truncation, with no repair', async provider => {
    const transport = { async create() { return (async function* () {
      if (provider === 'deepseek') yield { choices: [{ delta: { content: '{"decision":' }, finish_reason: 'length' }] };
      else { yield { type: 'response.output_text.delta', delta: '{"decision":' }; yield { type: 'response.incomplete' }; }
    })(); } };
    const client = provider === 'deepseek' ? new DeepSeekModelClient({ model: 'test', transport }) : new OpenAIModelClient({ model: 'test', transport });
    const events = await collect(client.stream({ ...request, responseFormat: { type: 'json_object' } }, { signal: new AbortController().signal }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'text_delta', delta: '{"decision":' }));
    expect(events.at(-1)).toMatchObject({ type: 'truncated', reason: 'max_output_tokens' });
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'completed' }));
  });
});
