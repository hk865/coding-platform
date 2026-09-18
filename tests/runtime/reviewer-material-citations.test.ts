import { describe, expect, it, vi } from 'vitest';
import { createReviewerMaterialTools } from '../../src/execution/worker-runtime/reviewer-material-tools.js';
import type { ReviewerRuntimeAccess } from '../../src/contracts/reviewer-context.js';

function fixture(content: string, page: Record<string, unknown> = {}) {
  const ref = { kind: 'artifact', digest: 'a'.repeat(64), sizeBytes: Buffer.byteLength(content), contentType: 'application/json', source: {} };
  const readMaterial = vi.fn(async () => ({ ref, content, offset: 0, nextOffset: ref.sizeBytes, totalBytes: ref.sizeBytes, complete: true, ...page }));
  const current = vi.fn(async () => {});
  const access = { packet: { materials: [{ materialId: 'artifact:a', ref }] }, readMaterial } as unknown as ReviewerRuntimeAccess;
  const tool = createReviewerMaterialTools(access, current)[0]!;
  const run = async (args: Record<string, unknown> = { materialId: 'artifact:a' }, signal = new AbortController().signal) => {
    const result = await tool.handler.execute({ schemaVersion: 1, callId: 'citation', name: 'read_material', arguments: args } as never, { signal } as never);
    return result as unknown as { status: string; output: Array<{ value: { content: string; citationLocations?: { pointer: string; kind: string }[]; citationLocationsTruncated?: boolean; citationChecks?: { status: string; results?: Array<{ pointer: string; exists: boolean }> } } }> };
  };
  return { run, current, readMaterial };
}

describe('Reviewer read_material original citation locations', () => {
  it('checks proposed pointers against the original decision and descriptor before final submission', async () => {
    const content = JSON.stringify({ readonlyReport: { collaborationFacts: { decisions: [{ review: { status: 'accepted', proposalDigest: 'digest', summary: 'decision' }, works: [] }] } }, requiredReviewerCoverage: [{ requirementId: 'review-contract' }] });
    const f = fixture(content);
    const wrong = ['/readonlyReport/collaborationFacts/decisions/0/status', '/readonlyReport/collaborationFacts/decisions/0/proposalDigest', '/readonlyReport/collaborationFacts/decisions/0/summary', '/readonlyReport/collaborationFacts/works', '/coverage/0/requirementId'];
    const first = await f.run({ materialId: 'artifact:a', citationPointers: wrong });
    expect(first.status).toBe('success');
    expect(first.output[0]!.value.citationChecks).toEqual({ status: 'checked', results: wrong.map(pointer => ({ pointer, exists: false })) });
    expect(first.output[0]!.value.content).toBe(content);
    const corrected = ['/readonlyReport/collaborationFacts/decisions/0/review/status', '/readonlyReport/collaborationFacts/decisions/0/review/proposalDigest', '/readonlyReport/collaborationFacts/decisions/0/review/summary', '/readonlyReport/collaborationFacts/decisions/0/works', '/requiredReviewerCoverage/0/requirementId'];
    const second = await f.run({ materialId: 'artifact:a', citationPointers: corrected });
    expect(second.output[0]!.value.citationChecks).toEqual({ status: 'checked', results: corrected.map(pointer => ({ pointer, exists: true })) });
    expect(f.readMaterial).toHaveBeenCalledTimes(2);
    expect(f.current).toHaveBeenCalledTimes(4);
  });

  it('does not call a missing pointer false when the original page is incomplete', async () => {
    const r = await fixture('{"first":1}', { complete: false }).run({ materialId: 'artifact:a', citationPointers: ['/later'] });
    expect(r.status).toBe('success');
    expect(r.output[0]!.value.citationChecks).toMatchObject({ status: 'unavailable' });
    expect(r.output[0]!.value.citationChecks?.results).toBeUndefined();
  });

  it('checks RFC6901 escaping, empty keys, scalar roots and invalid escapes exactly', async () => {
    const pointers = ['', '/a~1b/~0key/0/', '/a~2b', '/missing', '/toString', '/a~1b/~0key/length'];
    const r = await fixture(JSON.stringify({ 'a/b': { '~key': [{ '': false }] } })).run({ materialId: 'artifact:a', citationPointers: pointers });
    expect(r.output[0]!.value.citationChecks).toEqual({ status: 'checked', results: pointers.map((pointer, i) => ({ pointer, exists: i < 2 })) });
    const scalar = await fixture('plain report').run({ materialId: 'artifact:a', citationPointers: ['', '/text'] });
    expect(scalar.output[0]!.value.citationChecks).toEqual({ status: 'checked', results: [{ pointer: '', exists: true }, { pointer: '/text', exists: false }] });
  });

  it('bounds requested checks and response bytes without cutting the original or pretending checks passed', async () => {
    const f = fixture('{}');
    expect((await f.run({ materialId: 'artifact:a', citationPointers: Array.from({ length: 33 }, () => '') })).status).toBe('error');
    expect(f.readMaterial).not.toHaveBeenCalled();
    const content = JSON.stringify({ text: 'x'.repeat(30000) });
    const pointers = Array.from({ length: 32 }, (_, i) => '/' + String(i).padStart(2047, 'x'));
    const r = await fixture(content).run({ materialId: 'artifact:a', citationPointers: pointers });
    expect(r.status).toBe('success');
    expect(r.output[0]!.value.content).toBe(content);
    expect(r.output[0]!.value.citationChecks).toMatchObject({ status: 'unavailable' });
    expect(Buffer.byteLength(JSON.stringify(r.output[0]!.value))).toBeLessThan(64 * 1024);
  });

  it('offers actual descriptor root tools paths without guessing toolRound nesting', async () => {
    const f = fixture(JSON.stringify({ toolRound: { roundId: 'r' }, tools: [{ result: 'PASS' }] }));
    const r = await f.run();
    expect(r.status).toBe('success');
    expect(r.output[0]!.value.citationLocations).toContainEqual({ kind: 'artifact-section', pointer: '/tools/0/result' });
    expect(r.output[0]!.value.citationLocations).not.toContainEqual({ kind: 'artifact-section', pointer: '/toolRound/tools/0/result' });
    expect(f.current).toHaveBeenCalledTimes(2);
    expect(f.readMaterial).toHaveBeenCalledTimes(1);
  });

  it('escapes original keys and preserves the full original content', async () => {
    const content = JSON.stringify({ 'a/b': { '~key': [{ '': true }] } });
    const r = await fixture(content).run();
    expect(r.output[0]!.value.content).toBe(content);
    expect(r.output[0]!.value.citationLocations).toContainEqual({ kind: 'artifact-section', pointer: '/a~1b/~0key/0/' });
    expect(r.output[0]!.value.citationLocationsTruncated).toBe(false);
  });

  it.each([{ complete: false }, { offset: 5 }, { nextOffset: 999 }, { totalBytes: 999 }])('does not invent full locations for partial or inconsistent pages %j', async page => {
    expect((await fixture('{}', page).run()).output[0]!.value.citationLocations).toBeUndefined();
  });

  it.each(['plain report text', '{broken json', 'null', '42'])('offers only the original root for non-object originals %s', async content => {
    expect((await fixture(content).run()).output[0]!.value.citationLocations).toEqual([{ kind: 'artifact-section', pointer: '' }]);
  });

  it('bounds count breadth-first, depth and UTF-8 index bytes without cutting original content', async () => {
    const wide = JSON.stringify({ early: Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`k${i}`, i])), tools: [{ result: 'PASS' }] });
    const widePage = (await fixture(wide).run()).output[0]!.value;
    expect(widePage.citationLocations!.length).toBeLessThanOrEqual(256);
    expect(widePage.citationLocations!.slice(0, 3).map(x => x.pointer)).toEqual(['', '/early', '/tools']);
    expect(widePage.citationLocationsTruncated).toBe(true);
    let deep: unknown = true;
    for (let i = 0; i < 12; i++) deep = { next: deep };
    const deepPage = (await fixture(JSON.stringify(deep)).run()).output[0]!.value;
    expect(deepPage.citationLocations!.every(x => x.pointer.split('/').length <= 9)).toBe(true);
    expect(deepPage.citationLocationsTruncated).toBe(true);
    const content = JSON.stringify(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`${i}${'汉'.repeat(500)}`, true])));
    const bytePage = (await fixture(content).run()).output[0]!.value;
    expect(Buffer.byteLength(JSON.stringify(bytePage.citationLocations))).toBeLessThanOrEqual(8192);
    expect(bytePage.content).toBe(content);
    expect(bytePage.citationLocationsTruncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(bytePage))).toBeLessThan(64 * 1024);
  });

  it('omits overlong pointers and never sacrifices original content for index space', async () => {
    const long = (await fixture(JSON.stringify({ ['x'.repeat(2050)]: true })).run()).output[0]!.value;
    expect(long.citationLocations).toEqual([{ kind: 'artifact-section', pointer: '' }]);
    expect(long.citationLocationsTruncated).toBe(true);
    const content = JSON.stringify({ text: '\u0000'.repeat(5000) });
    const page = (await fixture(content).run()).output[0]!.value;
    expect(page.content).toBe(content);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(64 * 1024);
  });

  it('keeps packet authorization, currentness and cancellation fail-closed', async () => {
    const f = fixture('{}');
    const args = { materialId: 'artifact:a', citationPointers: ['/missing'] };
    expect((await f.run({ ...args, materialId: 'not-in-packet' })).status).toBe('error');
    expect(f.readMaterial).not.toHaveBeenCalled();
    f.current.mockRejectedValueOnce(Error('stale'));
    expect((await f.run(args)).status).toBe('error');
    expect(f.readMaterial).not.toHaveBeenCalled();
    f.current.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('revoked after read'));
    const revoked = await f.run(args);
    expect(revoked.status).toBe('error');
    expect(revoked.output).toEqual([]);
    const controller = new AbortController(); controller.abort();
    expect((await f.run(args, controller.signal)).status).toBe('cancelled');
  });
});
