import { describe, expect, it } from 'vitest';
import { clampPaneWidths, defaultLayout, LAYOUT_VERSION, layoutKey, nextFileTabId, parseLayout, serializeLayout } from '../../src/ui/src/state/layout';
import { emptyDraft, goalKey, referenceState, upsertReference } from '../../src/ui/src/state/drafts';

describe('workbench layout persistence', () => {
  it('round-trips a scoped layout and rejects unknown or version-mismatched data', () => {
    const scope = { projectId: 'p/1', workspaceId: 'w 2' };
    expect(layoutKey(scope)).toBe('agent-platform.workbench.v2::p%2F1::w%202');

    const state = { ...defaultLayout(), left: 300, right: 500, bottom: 220, bottomOpen: true, activeTab: 'files' };
    const restored = parseLayout(serializeLayout(state));
    expect(restored.dropped).toEqual([]);
    expect(restored.state.left).toBe(300);
    expect(restored.state.right).toBe(500);
    expect(restored.state.bottomOpen).toBe(true);
    expect(restored.state.activeTab).toBe('files');

    const old = parseLayout(JSON.stringify({ ...state, version: LAYOUT_VERSION - 1 }));
    expect(old.state).toEqual(defaultLayout());
    expect(old.dropped[0]).toContain('布局版本');

    const unknown = parseLayout(JSON.stringify({ ...state, tabs: [{ id: 'x', view: 'not-a-view', title: 'x', pinned: false, payload: {} }] }));
    expect(unknown.dropped.some(reason => reason.includes('未知视图'))).toBe(true);
    expect(unknown.state.tabs.length).toBeGreaterThan(0);

    const missingPath = parseLayout(JSON.stringify({ ...state, tabs: [{ id: 'file-1', view: 'file', title: 'a', pinned: false, payload: {} }] }));
    expect(missingPath.dropped.some(reason => reason.includes('缺少路径'))).toBe(true);

    expect(parseLayout('{not json').dropped[0]).toContain('无法解析');
  });

  it('keeps the centre column at 280px and gives way from the side panes first', () => {
    expect(clampPaneWidths({ left: 240, right: 440, viewport: 1440, rightOpen: true })).toEqual({ left: 240, right: 440 });
    // A narrow window must not push the centre below its minimum.
    const narrow = clampPaneWidths({ left: 380, right: 900, viewport: 900, rightOpen: true });
    expect(narrow.left + narrow.right).toBeLessThanOrEqual(900 - 280 - 12);
    // The left pane never goes below its own minimum even when space runs out.
    const tiny = clampPaneWidths({ left: 380, right: 440, viewport: 460, rightOpen: true });
    expect(tiny.left).toBeGreaterThanOrEqual(160);
    expect(clampPaneWidths({ left: 240, right: 440, viewport: 1440, rightOpen: false }).right).toBe(0);
  });

  it('allocates unique file tab ids', () => {
    expect(nextFileTabId([{ id: 'file-1', view: 'file', title: 'a', pinned: false, payload: {} }])).toBe('file-2');
    expect(nextFileTabId([{ id: 'tasks', view: 'tasks', title: 't', pinned: false, payload: {} }])).toBe('file-1');
  });
});

describe('drafts and file references', () => {
  it('keys drafts by project, workspace and goal', () => {
    expect(goalKey({ projectId: 'p', workspaceId: 'w', goalId: 'g' })).toBe('p::w::g');
    expect(emptyDraft()).toEqual({ instruction: '', references: [], allowWrite: false });
  });

  it('replaces an existing path, refuses a ninth file and detects a changed digest', () => {
    const first = { path: 'src/a.ts', sha256: 'a'.repeat(64) };
    let result = upsertReference([], first);
    expect(result.references).toHaveLength(1);
    result = upsertReference(result.references, { ...first, lines: { start: 3, end: 4 } });
    expect(result.replaced).toBe(true);
    expect(result.references[0]?.lines).toEqual({ start: 3, end: 4 });
    expect(result.references).toHaveLength(1);

    let many: { path: string; sha256: string }[] = [];
    for (let index = 0; index < 8; index += 1) many = upsertReference(many, { path: 'f' + index, sha256: 'b'.repeat(64) }).references;
    expect(upsertReference(many, { path: 'f9', sha256: 'b'.repeat(64) }).overflow).toBe(true);

    expect(referenceState(first, 'a'.repeat(64))).toBe('current');
    expect(referenceState(first, 'c'.repeat(64))).toBe('stale');
    expect(referenceState(first, null)).toBe('unknown');
  });
});
