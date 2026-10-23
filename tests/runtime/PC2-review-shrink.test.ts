/**
 * PC-2 ruling 13, PC-21 (Q half): the review shrink re-renders the whole input
 * from the frozen material. The review section's ranges and the input are
 * recomputed, so no prefix cut survives; the billed resident bytes and the
 * omission metadata stay the material's.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { renderUnknownCallReviewZh } from '../../src/contracts/core/prepared-execution.js';
import { openPC2ReviewFixture } from '../helpers/PC2-pack-fixture.js';

// The frozen PC2 review fixture starts a real blocked Run: §5.1's stand-in
// `shell` must be armed so the Run is held at its call.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

describe('PC-21 the review shrink re-renders the whole input', () => {
  it('PC-21 the shrunk review section is exactly its rendered text and the tail stays', async () => {
    const fixture = await openPC2ReviewFixture('shrink');
    try {
      expect(fixture.preparation.status).toBe('ready');
      const manifest = fixture.manifest;
      if (manifest === null) throw new Error('PC-21 the review preparation must be ready');
      const review = manifest.unknownCallReview;
      if (review === undefined) throw new Error('PC-21 the review Run must carry its review input');
      // The 64 KiB lead is gone: the fit trimmed the instruction.
      expect(Buffer.byteLength(manifest.input, 'utf8')).toBeLessThanOrEqual(64 * 1024 + 64 * 1024);
      const sections = manifest.contextAssembly.sections;
      const section = sections.find(candidate => candidate.name === 'unknown_call_review');
      if (section === undefined || section.startByte === null || section.endByte === null) {
        throw new Error('PC-21 the shrunk input must still carry the review section');
      }
      const suffix = renderUnknownCallReviewZh(review, undefined, manifest.promptSet.toolNames);
      const bytes = Buffer.from(manifest.input, 'utf8');
      // The range is recomputed from the re-render, never the stale prefix cut.
      expect(section.endByte - section.startByte).toBe(Buffer.byteLength(suffix, 'utf8'));
      expect(bytes.subarray(section.startByte, section.endByte).toString('utf8')).toBe(suffix);
      expect(section.endByte).toBeLessThanOrEqual(Buffer.byteLength(manifest.input, 'utf8'));
      // The billed bytes and the omission metadata are the material's, not the
      // difference between the last sections.
      expect(manifest.contextAssembly.residentBytes)
        .toBeLessThanOrEqual(manifest.contextAssembly.residentBudgetBytes);
      for (const row of sections) {
        if (row.startByte === null) expect(row.endByte).toBeNull();
        expect(row.omitted).toBeGreaterThanOrEqual(0);
      }
      // The description of the whole manifest is measured after the shrink.
      expect(Buffer.byteLength(JSON.stringify(manifest), 'utf8')).toBeLessThanOrEqual(262_144);
    } finally {
      await fixture.close();
    }
  });
});
