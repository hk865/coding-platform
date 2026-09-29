/** Host-local settings DTOs. These never form an Agent tool or a domain writer. */
import type { CoreScope, BootstrapResponse } from './core-http-types.js';
import type { QueryJobAnswerRef } from '../contracts/query-job.js';
import type { RegisteredCommandCheck } from '../contracts/verification.js';

export const SETTINGS_API_PREFIX = '/api/real/settings/';
export type SettingsProvider = 'deepseek' | 'openai';
export type SettingsModel = {
  id: string; label: string; provider: SettingsProvider; model: string; baseUrl: string;
  credentialConfigured: boolean;
  thinking?: 'enabled' | 'disabled';
  reasoningEffort?: 'low' | 'high' | 'max';
};
export type SettingsWorkspace = {
  scope: CoreScope; name: string; root: string; modelId: string | null;
  writeAllowed: boolean; commandsAllowed: boolean;
  /** R6: user-approved registered checks for exactly this workspace scope.
   * Absent for a scope that never approved any. The model's own suggestion is
   * never stored here; only an explicit Host user approval is. */
  checks?: RegisteredCommandCheck[];
};
export type HostSettingsSnapshot = {
  models: SettingsModel[]; workspaces: SettingsWorkspace[];
};
export type DirectoryListing = {
  path: string; parent: string | null;
  directories: { name: string; path: string }[]; truncated: boolean;
};
export type SaveSettingsModel = {
  id?: string; label: string; provider: SettingsProvider; model: string; baseUrl?: string;
  /** Omitted/empty retains an existing key. The server never sends a key back. */
  apiKey?: string;
  thinking?: 'enabled' | 'disabled';
  reasoningEffort?: 'low' | 'high' | 'max';
};
export type OpenSettingsWorkspace = {
  path: string; name?: string; modelId?: string;
  /** Omit to open a new project; set to add a workspace under an existing Host project. */
  projectId?: string;
  writeAllowed: boolean; commandsAllowed: boolean;
};

/**
 * R6 cold-start explicit user approval of the checks suggested by one saved
 * initial-plan Answer. The model suggestion is only a candidate; this route is
 * the narrow Host-user action that turns it into this workspace's trusted check
 * configuration. `answerRef` binds the approval to the real saved Answer and
 * `scope` binds it to exactly one workspace. Checks that a registered command
 * could execute require the workspace's real write+command grant.
 */
export type ApproveWorkspaceChecks = {
  scope: CoreScope;
  answerRef: QueryJobAnswerRef;
  checks: RegisteredCommandCheck[];
};
export type SettingsRoutes = {
  snapshot: { input: Record<string, never>; value: HostSettingsSnapshot };
  directories: { input: { path?: string; showHidden?: boolean }; value: DirectoryListing };
  'models/save': { input: SaveSettingsModel; value: HostSettingsSnapshot };
  'models/select': { input: { scope: CoreScope; modelId: string }; value: HostSettingsSnapshot };
  'workspaces/open': { input: OpenSettingsWorkspace; value: { settings: HostSettingsSnapshot; bootstrap: BootstrapResponse; scope: CoreScope } };
  'checks/approve': { input: ApproveWorkspaceChecks; value: HostSettingsSnapshot };
};
export type SettingsRoute = keyof SettingsRoutes;
export type SettingsResponse<T> = { status: 'ready'; value: T }
  | { status: 'rejected'; code: 'invalid' | 'forbidden' | 'not_found' | 'unavailable' | 'unsupported'; reason: string };
export interface HostSettingsPort {
  call<K extends SettingsRoute>(route: K, input: SettingsRoutes[K]['input']): Promise<SettingsResponse<SettingsRoutes[K]['value']>>;
}
