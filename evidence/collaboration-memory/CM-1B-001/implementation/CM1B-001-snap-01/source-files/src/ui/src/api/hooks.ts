import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Api } from './client';
import { ApiError } from './client';
import type { CheckReportsResponse, DirectoryListing, FilePreview, GoalScope, GuiState, Meta, ModelSettingsView, ProjectEntry, Scope, TerminalOutput, TerminalSession } from './types';

export const queryKeys = {
  meta: () => ['meta'] as const,
  state: (scope: Scope, goalId: string) => ['state', scope.projectId, scope.workspaceId, goalId] as const,
  directory: (scope: Scope, path: string) => ['directory', scope.projectId, scope.workspaceId, path] as const,
  preview: (scope: Scope, path: string) => ['preview', scope.projectId, scope.workspaceId, path] as const,
  terminals: (scope: Scope) => ['terminals', scope.projectId, scope.workspaceId] as const,
  terminalOutput: (scope: Scope, sessionId: string, after: number) => ['terminal-output', scope.projectId, scope.workspaceId, sessionId, after] as const,
  modelSettings: () => ['model-settings'] as const,
  checkReport: (scope: GoalScope, runId: string, requestId: string) => ['check-report', scope.projectId, scope.workspaceId, scope.goalId, runId, requestId] as const,
};

export function useMeta(api: Api) {
  return useQuery<Meta>({ queryKey: queryKeys.meta(), queryFn: ({ signal }) => api.meta({ signal }), staleTime: 30_000, retry: 1 });
}

/**
 * The single scoped read of project state. The query key contains project,
 * workspace and goal, so a scope switch is a different query: the previous
 * request is cancelled and a late answer for the old scope cannot be rendered.
 */
export function useGuiState(api: Api, scope: Scope | null, goalId: string) {
  return useQuery<GuiState>({
    queryKey: queryKeys.state(scope ?? { projectId: '', workspaceId: '' }, goalId),
    enabled: !!scope,
    queryFn: ({ signal }) => api.state({ ...scope!, ...(goalId ? { goalId } : {}) }, { signal, timeoutMs: 20000 }),
    refetchInterval: 2500,
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: false,
  });
}

export function useDirectory(api: Api, scope: Scope | null, path: string, enabled: boolean) {
  return useQuery<DirectoryListing>({
    queryKey: queryKeys.directory(scope ?? { projectId: '', workspaceId: '' }, path),
    enabled: enabled && !!scope,
    queryFn: ({ signal }) => api.files(scope!, path, { signal }),
    staleTime: 5000,
    retry: false,
  });
}

export function usePreview(api: Api, scope: Scope | null, path: string | null) {
  return useQuery<FilePreview>({
    queryKey: queryKeys.preview(scope ?? { projectId: '', workspaceId: '' }, path ?? ''),
    enabled: !!scope && !!path,
    queryFn: ({ signal }) => api.preview(scope!, path!, { signal }),
    staleTime: 2000,
    retry: false,
  });
}

export function useTerminals(api: Api, scope: Scope | null, enabled: boolean) {
  return useQuery<{ sessions: TerminalSession[] }>({
    queryKey: queryKeys.terminals(scope ?? { projectId: '', workspaceId: '' }),
    enabled: enabled && !!scope,
    queryFn: ({ signal }) => api.terminals(scope!, { signal }),
    refetchInterval: enabled ? 4000 : false,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

export function useTerminalOutput(api: Api, scope: Scope | null, sessionId: string, after: number, enabled: boolean) {
  return useQuery<TerminalOutput>({
    queryKey: queryKeys.terminalOutput(scope ?? { projectId: '', workspaceId: '' }, sessionId, after),
    enabled: enabled && !!scope && !!sessionId,
    queryFn: ({ signal }) => api.terminalOutput(scope!, sessionId, after, { signal, timeoutMs: 8000 }),
    staleTime: 0,
    retry: false,
  });
}

export function useModelSettings(api: Api, enabled: boolean) {
  return useQuery<ModelSettingsView>({ queryKey: queryKeys.modelSettings(), enabled, queryFn: ({ signal }) => api.modelSettings({ signal }), staleTime: 0, retry: false });
}

export function useCheckReport(api: Api, scope: GoalScope | null) {
  return useMutation<CheckReportsResponse, Error, { runId: string; requestId: string }>({
    mutationFn: input => api.checkReport(scope!, input.runId, input.requestId) as Promise<CheckReportsResponse>,
  });
}

export function invalidateScope(client: QueryClient, scope: Scope | null): void {
  void client.invalidateQueries({ queryKey: ['state'] });
  void client.invalidateQueries({ queryKey: ['directory', scope?.projectId ?? '', scope?.workspaceId ?? ''] });
  void client.invalidateQueries({ queryKey: ['preview'] });
}

export function mutationError(error: unknown): { message: string; unknown: boolean } {
  if (error instanceof ApiError) return { message: error.message, unknown: error.outcomeUnknown };
  return { message: error instanceof Error ? error.message : String(error), unknown: false };
}

export type MutationState = { pending: boolean; unknown: boolean; error: string | null; accepted: string | null };

export function useProjectAdder(api: Api, projectId?: string) {
  const client = useQueryClient();
  return useMutation<ProjectEntry, Error, string>({
    mutationFn: path => projectId ? api.addWorkspace(projectId, path) : api.addProject(path),
    onSuccess: () => { void client.invalidateQueries({ queryKey: queryKeys.meta() }); },
  });
}

export function useLayoutReset(api: Api) { return useMemo(() => ({ api }), [api]); }
