import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { SEMANTIC_QUERY_RESPONSE_GUIDE_V7, SEMANTIC_QUERY_RESPONSE_GUIDE_V3, SEMANTIC_QUERY_RESPONSE_GUIDE_V4, SEMANTIC_QUERY_RESPONSE_GUIDE_V5, SEMANTIC_QUERY_RESPONSE_GUIDE_V6 } from '../../src/contracts/history/query-response-guides-v1-v9.js';

it('keeps the actual real09 v3 instruction byte identity when introducing the next guidance version', () => {
  expect(SEMANTIC_QUERY_RESPONSE_GUIDE_V3.id).toBe('semantic-query-response-v3');
  expect(createHash('sha256').update(SEMANTIC_QUERY_RESPONSE_GUIDE_V3.instruction).digest('hex')).toBe('270c66228fcbeee2ce7c583382bb754de2c1c6e8699036388a0fe2e0017d10cb');
  expect(SEMANTIC_QUERY_RESPONSE_GUIDE_V4.id).toBe('semantic-query-response-v4');
  expect(createHash('sha256').update(SEMANTIC_QUERY_RESPONSE_GUIDE_V4.instruction).digest('hex')).toBe('48602041d082217a6a3f0d44607bbe5191b03f31aad6d2bf58ca0b251b20d3a6');
  expect(SEMANTIC_QUERY_RESPONSE_GUIDE_V5.id).toBe('semantic-query-response-v5');
  expect(createHash('sha256').update(SEMANTIC_QUERY_RESPONSE_GUIDE_V5.instruction).digest('hex')).toBe('6f0118e1788686f5fb7008cbcf34994079649b3b8eb5e506df306deea1b773ee');
  expect(SEMANTIC_QUERY_RESPONSE_GUIDE_V6.id).toBe('semantic-query-response-v6');
  expect(createHash('sha256').update(SEMANTIC_QUERY_RESPONSE_GUIDE_V6.instruction).digest('hex')).toBe('44bfb3cc229ebcb52fd7f8ed759fd6c6f4b0e62333925906d69758654f14989b');
  expect(SEMANTIC_QUERY_RESPONSE_GUIDE_V7.id).toBe('semantic-query-response-v7');
});

