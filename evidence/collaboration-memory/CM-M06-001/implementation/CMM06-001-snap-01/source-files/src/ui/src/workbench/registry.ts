import { lazy, type ComponentType } from 'react';
import { AgentsView } from '../features/agents';
import { ConversationView } from '../features/conversation';
import { DiffView } from '../features/diff';
import { ExplorationView } from '../features/exploration';
import { FileView, FilesView } from '../features/files';
import { ActivityView, ArchitectureView, ContinuationView, LogsView, MemoryView, ReviewerView } from '../features/misc';
import { PlanChangesView } from '../features/plan-changes';
import { ReworkView } from '../features/rework';
import { SettingsView } from '../features/settings';
import { TasksView } from '../features/tasks';

import { VerificationView } from '../features/verification';
import type { ViewId } from '../state/layout';
import type { ViewProps } from './view-props';

// Heavy graph and terminal code is loaded on demand; the rest of the shell stays small.
const TaskGraphView = lazy(() => import('../features/task-graph').then(module => ({ default: module.TaskGraphView })));
const TerminalView = lazy(() => import('../features/terminal').then(module => ({ default: module.TerminalView })));

/**
 * Single view registry. Features are added here and receive the same props;
 * a view never reaches into another view's DOM or private state.
 */
export const VIEW_REGISTRY: Record<ViewId, ComponentType<ViewProps>> = {
  conversation: ConversationView,
  files: FilesView,
  file: FileView,
  diff: DiffView,
  tasks: TasksView,
  'task-graph': TaskGraphView,
  agents: AgentsView,
  verification: VerificationView,
  activity: ActivityView,
  exploration: ExplorationView,
  settings: SettingsView,
  architecture: ArchitectureView,
  reviewer: ReviewerView,
  memory: MemoryView,
  continuation: ContinuationView,
  rework: ReworkView,
  'plan-changes': PlanChangesView,
  terminal: TerminalView,
  logs: LogsView,
};

