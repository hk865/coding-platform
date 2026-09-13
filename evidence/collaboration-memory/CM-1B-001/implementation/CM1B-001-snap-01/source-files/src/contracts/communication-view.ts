import type { CommitCursor } from './command-event.js';
export type CommunicationViewQuery = { projectId: string; workspaceId: string; goalId?: string; atLeastCursor?: CommitCursor };
export type CommunicationViewResult = {
  status: 'ready' | 'not_ready';
  sourceCursor: CommitCursor | null;
  reason: string | null;
  waits: { waitId: string; workId: string; mode: string; status: string; matched: number; delivered: number; total: number; reason: string; winnerDeliveryId: string | null }[];
  backlog: { pending: number; leased: number; retry: number; blocked: number };
  failures: { intentId: string; status: string; reason: string | null }[];
  timeline: { cursor: CommitCursor; type: string; id: string; at: string }[];
};
