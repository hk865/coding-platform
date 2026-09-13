import type { Api } from '../api/client';
import type { GoalScope, GuiState, Scope } from '../api/types';
import type { AppStore } from '../state/app-store';
import type { Tab } from '../state/layout';

/** Props every registered workbench view receives. Views never touch each other's DOM. */
export type ViewProps = {
  api: Api;
  data: GuiState | undefined;
  loading: boolean;
  error: string | null;
  store: AppStore;
  scope: Scope | null;
  goalScope: GoalScope | null;
  refresh: () => void;
  /** The tab that opened this view (carries path / lines / runId payloads). */
  tab: Tab | null;
};
