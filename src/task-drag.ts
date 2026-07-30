import type { Task } from './types';

export type TaskDragOrigin = 'backlog' | 'gantt';
export type TaskDropTargetKind = 'backlog' | 'gantt-sidebar' | 'gantt-row' | 'gantt-timeline';

export type TaskDropTarget = {
  kind: TaskDropTargetKind;
  projectId: string;
  taskId?: string;
  date?: string;
  relation?: 'inside' | 'before' | 'after';
};

export type TaskDragState = {
  projectId: string;
  task: Task;
  origin: TaskDragOrigin;
  allocatedHours: number;
  pendingHours: number;
  x: number;
  y: number;
  active: boolean;
  target: TaskDropTarget | null;
};

export type TaskDropTargetHandler = (target: TaskDropTarget | null, element?: HTMLElement) => void;

/**
 * Keep one ordering boundary between adjacent rows. The end of a row is a
 * child target unless it is the last visible row, where it can append a sibling.
 */
export function taskRowDropRelation(
  relativeY: number,
  rowHeight: number,
  isLastVisibleRow: boolean,
): 'inside' | 'before' | 'after' {
  const ratio = rowHeight > 0 ? relativeY / rowHeight : 0;
  if (ratio < 0.4) return 'before';
  if (isLastVisibleRow && ratio > 0.8) return 'after';
  return 'inside';
}

/** Backlog leaf rows expose before/after sorting targets within their visible hierarchy context. */
export function backlogDropRelation(relativeY: number, rowHeight: number): 'before' | 'after' {
  return relativeY < rowHeight / 2 ? 'before' : 'after';
}

/** True when the pointer actually left `currentTarget` rather than moving between its descendants. */
export function pointerLeftElement(event: {
  relatedTarget: EventTarget | null;
  currentTarget: Element;
}) {
  const related = event.relatedTarget;
  return !(related instanceof Node) || !event.currentTarget.contains(related);
}
