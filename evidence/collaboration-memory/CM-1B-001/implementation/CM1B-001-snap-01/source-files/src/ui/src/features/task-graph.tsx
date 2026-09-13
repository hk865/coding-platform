import { Box, Group, Stack, Text } from '@mantine/core';
import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo } from 'react';
import type { PlanMatrixRow } from '../api/types';
import { ErrorState, LoadingState, UnavailableState } from '../components/states';
import { taskPhaseLabels } from '../format';
import type { ViewProps } from '../workbench/view-props';
import { taskLabel } from './tasks';

type FlowEdge = { taskId: string; dependsOnId: string; requires: { kind: string; label: string } };

function layoutGraph(rows: PlanMatrixRow[], edges: FlowEdge[]): { nodes: Node[]; edges: Edge[] } {
  const depth = new Map<string, number>();
  const visit = (taskId: string, seen: Set<string>): number => {
    if (depth.has(taskId)) return depth.get(taskId)!;
    if (seen.has(taskId)) return 0;
    seen.add(taskId);
    const parents = edges.filter(edge => edge.taskId === taskId).map(edge => visit(edge.dependsOnId, seen));
    const value = parents.length ? Math.max(...parents) + 1 : 0;
    depth.set(taskId, value);
    return value;
  };
  for (const row of rows) visit(row.taskId, new Set());
  const columns = new Map<number, number>();
  const nodes: Node[] = rows.map(row => {
    const column = depth.get(row.taskId) ?? 0;
    const index = columns.get(column) ?? 0;
    columns.set(column, index + 1);
    const phase = String(row.livePhase ?? row.plannedPhase);
    return {
      id: row.taskId,
      position: { x: column * 240, y: index * 96 },
      data: { label: taskLabel(row) + ' · ' + (taskPhaseLabels[phase] ?? phase) },
      style: { width: 200, fontSize: 12, borderColor: phase === 'satisfied' ? '#2f9e44' : phase === 'failed' ? '#e03131' : '#adb5bd', borderWidth: 2, background: 'var(--mantine-color-body)' },
    };
  });
  const flowEdges: Edge[] = edges.map(edge => ({ id: edge.taskId + '->' + edge.dependsOnId, source: edge.dependsOnId, target: edge.taskId, animated: false, label: edge.requires.label }));
  return { nodes, edges: flowEdges };
}

export function TaskGraphView({ data, loading, error }: ViewProps) {
  const rows = data && data.matrix.status === 'ready' ? data.matrix.matrix.rows : [];
  const graph = data && data.graph.status === 'ready' ? data.graph.graph : null;
  const layout = useMemo(() => {
    if (!graph) return { nodes: [] as Node[], edges: [] as Edge[] };
    const source: PlanMatrixRow[] = rows.length ? rows : graph.tasks.map(task => ({ taskId: task.taskId, title: task.title, stageId: task.stageId, stageTitle: null, requirementLevel: task.requirementLevel, taskKind: task.taskKind, disposition: 'active', plannedPhase: 'pending' as const, livePhase: null, phaseMismatch: false, sourceCursor: '' }));
    return layoutGraph(source, graph.executionDag.dependsOn);
  }, [rows, graph]);
  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;
  if (data.graph.status !== 'ready') {
    return <UnavailableState title="任务图" reason={data.graph.status === 'not_found' ? '当前目标还没有被接受的计划。' : '计划投影尚未就绪，请稍后刷新。'} dependencies={['目标需先有被接受的计划版本']} />;
  }
  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <Group px="sm" py={6} className="panel-head"><Text size="sm" fw={600}>任务依赖图</Text><Text size="xs" c="dimmed">列表与图使用同一组正式事实</Text></Group>
      <Box style={{ flex: 1, minHeight: 0 }} data-testid="task-graph">
        <ReactFlow nodes={layout.nodes} edges={layout.edges} fitView nodesDraggable={false} nodesConnectable={false} proOptions={{ hideAttribution: true }}>
          <Background />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </Box>
    </Stack>
  );
}

