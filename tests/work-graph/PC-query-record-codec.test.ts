/**
 * PC-1b ruling 27: the Query event codec checks every request of the list
 * strictly. These are pure codec calls with constructed wire input; no record
 * is written and no persisted fact is hand-seeded.
 */
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { QueryRequestPromptFactsV1 } from '../../src/contracts/prompts/prompt-set.js';
import type { QueryModelRequestV1, QueryRunRef } from '../../src/contracts/query-job.js';
import {
  decodeQueryExecutionRecordedEvent, encodeQueryExecutionRecordedEvent,
  type QueryExecutionRecordedEventV1,
} from '../../src/core/work-graph/queries/query-record-codecs.js';

const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', projectId: 'P', workspaceId: 'W',
  queryJobId: 'PC-QR-CODEC', runId: 'PC-QR-CODEC-run' };

function promptFacts(): QueryRequestPromptFactsV1 {
  return {
    systemDigest: sha256Hex('PC codec system text'),
    toolsDigest: sha256Hex('[{"name":"read"}]'),
    toolSpecsRef: {
      kind: 'artifact',
      contentType: 'application/vnd.coding-platform.prompt-tool-specs+json;version=1',
      digest: sha256Hex('[{"name":"read"}]'),
      sizeBytes: Buffer.byteLength('[{"name":"read"}]', 'utf8'),
      source: { kind: 'artifact', refId: 'pc-codec-tool-specs', revision: '1' },
    },
    selection: {
      inputTokens: 120,
      budget: 2000,
      removed: {
        memory: 0, skillReference: 0, additionalInstruction: 0, toolResultBody: 0,
        historyExchange: 0, historyConclusion: 0, currentExchange: 0,
      },
    },
  };
}

function requestRow(): QueryModelRequestV1 {
  return {
    requestId: 'pc-codec-model-request-1',
    requestDigest: sha256Hex('PC codec model request 1'),
    reservedInput: 120,
    reservedOutput: 64,
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
    usageStatus: 'reserved',
    admitted: false,
    prompt: promptFacts(),
  };
}

function event(): QueryExecutionRecordedEventV1 {
  return {
    eventId: 'pc-codec-event-1',
    eventType: 'QueryExecutionRecorded',
    schemaVersion: 1,
    identityKey: 'pc-codec-identity-1',
    fingerprint: 'a'.repeat(64),
    projectId: 'P',
    workspaceId: 'W',
    aggregateType: 'QueryRun',
    aggregateId: queryRunRef.runId,
    aggregateRevision: 1,
    causationId: 'pc-codec-cause',
    correlationId: 'pc-codec-correlation',
    idempotencyKey: 'pc-codec-idempotency',
    actor: { kind: 'human', id: 'operator' },
    occurredAt: '2026-10-08T00:00:00.000Z',
    payload: {
      queryRunRef,
      operation: 'usage',
      result: {},
      phase: 'entered',
      executionState: {
        schemaVersion: 1,
        phase: 'entered',
        sessionRef: { projectId: 'P', sessionId: 'PC-QR-CODEC-session' },
        sessionGeneration: 1,
        requests: [requestRow()],
        requestProfile: null,
      },
    },
  } as unknown as QueryExecutionRecordedEventV1;
}

function decodeTampered(change: (json: Record<string, any>) => void) {
  const encoded = encodeQueryExecutionRecordedEvent(event());
  const json = JSON.parse(encoded.json) as Record<string, any>;
  change(json);
  return decodeQueryExecutionRecordedEvent({ ...encoded, json: JSON.stringify(json) });
}

describe('Query execution event request list (ruling 27)', () => {
  it('accepts the exact prompt fact shape', () => {
    const encoded = encodeQueryExecutionRecordedEvent(event());
    expect(decodeQueryExecutionRecordedEvent(encoded)).toMatchObject({ status: 'decoded' });
  });

  it('rejects an unknown field on a request prompt fact', () => {
    const decoded = decodeTampered(json => {
      json['payload']['executionState']['requests'][0]['prompt']['unknownFact'] = 'x';
    });
    expect(decoded).toMatchObject({ status: 'invalid' });
    if (decoded.status === 'invalid') expect(decoded.reason).toContain('requests[0].prompt');
  });

  it('rejects a missing field on a request prompt fact', () => {
    const decoded = decodeTampered(json => {
      delete json['payload']['executionState']['requests'][0]['prompt']['toolsDigest'];
    });
    expect(decoded).toMatchObject({ status: 'invalid' });
    if (decoded.status === 'invalid') expect(decoded.reason).toContain('requests[0].prompt');
  });

  it('rejects an unknown field inside the selection removal counts', () => {
    const decoded = decodeTampered(json => {
      json['payload']['executionState']['requests'][0]['prompt']['selection']['removed']['extra'] = 1;
    });
    expect(decoded).toMatchObject({ status: 'invalid' });
    if (decoded.status === 'invalid') expect(decoded.reason).toContain('requests[0].prompt.selection.removed');
  });

  it('rejects a non-digest system digest', () => {
    const decoded = decodeTampered(json => {
      json['payload']['executionState']['requests'][0]['prompt']['systemDigest'] = 'not-a-digest';
    });
    expect(decoded).toMatchObject({ status: 'invalid' });
  });

  it('rejects each request field and prompt fact broken alone', () => {
    const removedKeys = Object.keys(promptFacts().selection.removed);
    const changes: [string, (row: Record<string, any>) => void][] = [
      ['requestId', row => { row['requestId'] = ''; }],
      ['requestDigest', row => { row['requestDigest'] = ''; }],
      ['reservedInput', row => { row['reservedInput'] = -1; }],
      ['reservedOutput', row => { row['reservedOutput'] = 1.5; }],
      ['usageStatus', row => { row['usageStatus'] = 'pending'; }],
      ['admitted', row => { row['admitted'] = 'false'; }],
      ['systemDigest', row => { row['prompt']['systemDigest'] = 'not-a-digest'; }],
      ['toolsDigest', row => { row['prompt']['toolsDigest'] = sha256Hex('PC codec upper').toUpperCase(); }],
      ['toolSpecsRef.kind', row => { row['prompt']['toolSpecsRef']['kind'] = 'other'; }],
      ['toolSpecsRef.contentType', row => { row['prompt']['toolSpecsRef']['contentType'] = ''; }],
      ['toolSpecsRef.digest', row => { row['prompt']['toolSpecsRef']['digest'] = ''; }],
      ['toolSpecsRef.sizeBytes', row => { row['prompt']['toolSpecsRef']['sizeBytes'] = -1; }],
      ['source.kind', row => { row['prompt']['toolSpecsRef']['source']['kind'] = 'other'; }],
      ['source.refId', row => { row['prompt']['toolSpecsRef']['source']['refId'] = ''; }],
      ['source.revision', row => { row['prompt']['toolSpecsRef']['source']['revision'] = 1; }],
      ['source.digest', row => { row['prompt']['toolSpecsRef']['source']['digest'] = 1; }],
      ['selection.inputTokens', row => { row['prompt']['selection']['inputTokens'] = -1; }],
      ['selection.budget', row => { row['prompt']['selection']['budget'] = '2000'; }],
      ...removedKeys.map((key): [string, (row: Record<string, any>) => void] =>
        [`selection.removed.${key}`, row => { row['prompt']['selection']['removed'][key] = -1; }]),
    ];
    for (const [label, mutate] of changes) {
      const decoded = decodeTampered(json => mutate(json['payload']['executionState']['requests'][0]));
      expect(decoded, label).toMatchObject({ status: 'invalid' });
    }
  });

  it('rejects an unknown key at every request list level', () => {
    const unknown: [string, (row: Record<string, any>) => void][] = [
      ['request', row => { row['unknownRequestField'] = true; }],
      ['prompt', row => { row['prompt']['unknownPromptField'] = true; }],
      ['toolSpecsRef', row => { row['prompt']['toolSpecsRef']['unknownRefField'] = true; }],
      ['source', row => { row['prompt']['toolSpecsRef']['source']['unknownSourceField'] = true; }],
      ['selection', row => { row['prompt']['selection']['unknownSelectionField'] = true; }],
      ['removed', row => { row['prompt']['selection']['removed']['unknownRemovedField'] = 1; }],
    ];
    for (const [label, mutate] of unknown) {
      const decoded = decodeTampered(json => mutate(json['payload']['executionState']['requests'][0]));
      expect(decoded, label).toMatchObject({ status: 'invalid' });
    }
  });

  it('rejects a list whose first element is valid and second one broken', () => {
    const decoded = decodeTampered(json => {
      const requests = json['payload']['executionState']['requests'];
      requests.push({ ...requestRow(), requestId: 'pc-codec-model-request-2' });
      requests[1]['prompt']['systemDigest'] = 'not-a-digest';
    });
    expect(decoded).toMatchObject({ status: 'invalid' });
    if (decoded.status === 'invalid') expect(decoded.reason).toContain('requests[1].prompt.systemDigest');
  });
});
