/**
 * Host settings UI — Stage-1 contract tests (DELIBERATELY RED).
 *
 * These cases freeze the settings surface BEFORE Stage 2 implements it. They
 * run against the pure `src/ui/settings.ts` skeleton with an injected typed
 * `HostSettingsPort` and a render callback, so no DOM library is needed and no
 * production controller is faked. Every case is expected to fail with a loud
 * `settings ... is not implemented yet (stage 2)` error. An import/collection
 * or TypeScript setup error is NOT an intended failure and must be fixed.
 *
 * Spec: the frozen DTO `src/app/host-settings-types.ts` (which already carries
 * `OpenSettingsWorkspace.projectId?` — omitted creates a project, set adds a
 * workspace to it) plus the principal's settings product brief. No backend,
 * views or history change, no model call and no real workspace browsing.
 */
import { describe, expect, it } from 'vitest';
import type { BootstrapResponse, CoreScope } from '../../src/app/core-http-types.js';
import type {
  HostSettingsPort,
  HostSettingsSnapshot,
  SettingsResponse,
  SettingsRoute,
  SettingsRoutes,
  SettingsWorkspace,
} from '../../src/app/host-settings-types.js';
import {
  createSettingsController,
  groupWorkspacesByProject,
  renderSettingsDialog,
  renderSettingsEntry,
  type SettingsState,
} from '../../src/ui/settings.js';

const scopeA: CoreScope = { projectId: 'project-1', workspaceId: 'workspace-1' };
const scopeB: CoreScope = { projectId: 'project-1', workspaceId: 'workspace-2' };
const scopeC: CoreScope = { projectId: 'project-2', workspaceId: 'workspace-3' };

const emptySnapshot: HostSettingsSnapshot = { models: [], workspaces: [] };
const emptyBootstrap: BootstrapResponse = {
  workspaces: [], review: null, execution: { queryProfiles: [], workflowScopes: [] },
};

function settingsWorkspace(scope: CoreScope, name: string): SettingsWorkspace {
  return {
    scope, name, root: `/roots/${scope.workspaceId}`,
    modelId: null, writeAllowed: false, commandsAllowed: false,
  };
}

const ready = <T>(value: T): SettingsResponse<T> => ({ status: 'ready', value });

type RecordedCall = { route: SettingsRoute; input: unknown };

/** Injects the typed frozen port and a render callback, exactly as the browser
 * entry will; the controller never touches the DOM. */
function harness(handler: (route: SettingsRoute, input: unknown) => SettingsResponse<unknown>) {
  const calls: RecordedCall[] = [];
  const port: HostSettingsPort = {
    async call<K extends SettingsRoute>(
      route: K,
      input: SettingsRoutes[K]['input'],
    ): Promise<SettingsResponse<SettingsRoutes[K]['value']>> {
      calls.push({ route, input });
      return handler(route, input) as SettingsResponse<SettingsRoutes[K]['value']>;
    },
  };
  const renders: number[] = [];
  const opened: unknown[] = [];
  const reloads: number[] = [];
  const controller = createSettingsController({
    port,
    render: (_state: SettingsState) => { renders.push(1); },
    onWorkspaceOpened: value => { opened.push(value); },
    reloadBootstrap: () => { reloads.push(1); },
  });
  return { calls, renders, opened, reloads, controller };
}

describe('Host settings surface (stage 1, intentionally red)', () => {
  it('renders a fixed gear entry and one closeable Workspace/Models dialog', () => {
    const { controller } = harness(() => ready(emptySnapshot));
    const entry = renderSettingsEntry(controller.state);
    expect(entry).toContain('data-action="open-settings"');
    expect(entry).toContain('settings-entry');
    const dialog = renderSettingsDialog(controller.state);
    expect(dialog).toContain('data-view="settings-dialog"');
    expect(dialog).toContain('data-action="close-settings"');
    expect(dialog).toContain('data-section="workspace"');
    expect(dialog).toContain('data-section="models"');
  });

  it('never repopulates or persists a model API key and omits a blank key', async () => {
    const snapshot: HostSettingsSnapshot = {
      models: [{
        id: 'model-1', label: 'DeepSeek', provider: 'deepseek', model: 'deepseek-chat',
        baseUrl: 'https://api.deepseek.com', credentialConfigured: true,
      }],
      workspaces: [],
    };
    const { calls, controller } = harness(() => ready(snapshot));
    await controller.loadSnapshot();
    controller.editModel('model-1');
    // An existing configured credential is shown as "configured", never echoed.
    expect(controller.state.model.apiKey).toBe('');
    await controller.saveModel();
    // Blank key: the DTO `apiKey` is omitted so the server keeps the old one.
    expect(calls.at(-1)?.input).not.toHaveProperty('apiKey');
    controller.setModelField('apiKey', 'sk-live-secret');
    await controller.saveModel();
    expect(calls.at(-1)?.input).toMatchObject({ apiKey: 'sk-live-secret' });
    // The secret is cleared and never survives in page state or markup.
    expect(controller.state.model.apiKey).toBe('');
    expect(JSON.stringify(controller.state)).not.toContain('sk-live-secret');
  });

  it('opens a workspace via workspaces/open and hands bootstrap/scope to the merge owner', async () => {
    const opened = ready({ settings: emptySnapshot, bootstrap: emptyBootstrap, scope: scopeA });
    const { calls, opened: merged, controller } = harness(route =>
      route === 'workspaces/open' ? opened : ready(emptySnapshot));
    // Write and command permissions default OFF; command requires write.
    expect(controller.state.workspace.writeAllowed).toBe(false);
    expect(controller.state.workspace.commandsAllowed).toBe(false);
    controller.setWorkspaceField('path', '/home/me/checkout');
    controller.setWorkspaceField('name', 'checkout');
    controller.setWorkspaceField('projectId', 'project-1');
    controller.setWorkspaceField('modelId', 'model-1');
    await controller.openWorkspace();
    const call = calls.at(-1)!;
    expect(call.route).toBe('workspaces/open');
    expect(call.input).toMatchObject({
      path: '/home/me/checkout', name: 'checkout', projectId: 'project-1', modelId: 'model-1',
      writeAllowed: false, commandsAllowed: false,
    });
    // The controller owns no conversation/draft state: the merge owner does.
    expect(merged.at(-1)).toEqual({ settings: emptySnapshot, bootstrap: emptyBootstrap, scope: scopeA });
    // "New project" omits `projectId` instead of sending an empty string.
    controller.setWorkspaceField('projectId', '');
    await controller.openWorkspace();
    expect(calls.at(-1)?.input).not.toHaveProperty('projectId');
  });

  it('renders the settings shell for an empty-bootstrap Host without inventing a scope', async () => {
    const { controller } = harness(() => ready(emptySnapshot));
    await controller.open('workspace');
    expect(controller.state.open).toBe(true);
    expect(controller.state.snapshot).toEqual(emptySnapshot);
    const dialog = renderSettingsDialog(controller.state);
    expect(dialog).toContain('data-field="settings-directory-path"');
    expect(dialog).toContain('data-action="settings-open-workspace"');
    expect(dialog).not.toContain('workspaceId');
    expect(groupWorkspacesByProject(controller.state.snapshot?.workspaces ?? [])).toEqual([]);
  });

  it('groups two workspace scopes under the same project without dropping either', () => {
    const groups = groupWorkspacesByProject([
      settingsWorkspace(scopeA, 'one'), settingsWorkspace(scopeB, 'two'), settingsWorkspace(scopeC, 'three'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({
      projectId: 'project-1',
      workspaces: [settingsWorkspace(scopeA, 'one'), settingsWorkspace(scopeB, 'two')],
    });
    expect(groups[1]?.workspaces.map(workspace => workspace.scope.workspaceId)).toEqual(['workspace-3']);
    expect(groups.flatMap(group => group.workspaces).map(workspace => workspace.scope.workspaceId))
      .toEqual(['workspace-1', 'workspace-2', 'workspace-3']);
  });
});
