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
  /** A group drag transfers eligible descendant leaves as one workspace operation. */
  isGroup: boolean;
  allocatedHours: number;
  pendingHours: number;
  x: number;
  y: number;
  active: boolean;
  target: TaskDropTarget | null;
};

export type TaskDropTargetHandler = (target: TaskDropTarget | null, element?: HTMLElement) => void;

export type TaskDropCommand =
  | { type: 'move-group-to-backlog'; projectId: string; groupId: string }
  | { type: 'move-group-to-timeline'; projectId: string; groupId: string; date: string }
  | {
      type: 'move-task-to-backlog';
      projectId: string;
      taskId: string;
      targetTaskId?: string;
      relation?: 'before' | 'after';
    }
  | {
      type: 'move-task';
      projectId: string;
      sourceTaskId: string;
      targetTaskId: string;
      relation: 'inside' | 'before' | 'after';
      scheduleFromBacklog: boolean;
    }
  | { type: 'schedule-task'; projectId: string; taskId: string; date: string };

/** Converts a pointer drop into one domain command without touching workspace state. */
export function resolveTaskDrop(
  drag: TaskDragState,
  target: TaskDropTarget | null,
  todayDate: string,
): TaskDropCommand | null {
  if (!target || target.projectId !== drag.projectId) return null;

  if (drag.isGroup) {
    if (drag.origin === 'gantt' && target.kind === 'backlog')
      return { type: 'move-group-to-backlog', projectId: drag.projectId, groupId: drag.task.id };
    if (
      drag.origin === 'gantt' &&
      target.kind === 'gantt-row' &&
      target.taskId &&
      target.relation
    ) {
      return {
        type: 'move-task',
        projectId: drag.projectId,
        sourceTaskId: drag.task.id,
        targetTaskId: target.taskId,
        relation: target.relation,
        scheduleFromBacklog: false,
      };
    }
    if (
      drag.origin === 'backlog' &&
      target.kind === 'backlog' &&
      target.taskId &&
      (target.relation === 'before' || target.relation === 'after')
    ) {
      return {
        type: 'move-task',
        projectId: drag.projectId,
        sourceTaskId: drag.task.id,
        targetTaskId: target.taskId,
        relation: target.relation,
        scheduleFromBacklog: false,
      };
    }
    if (drag.origin === 'backlog' && target.kind === 'gantt-timeline' && target.date)
      return {
        type: 'move-group-to-timeline',
        projectId: drag.projectId,
        groupId: drag.task.id,
        date: target.date,
      };
    if (
      drag.origin === 'backlog' &&
      (target.kind === 'gantt-row' || target.kind === 'gantt-sidebar')
    ) {
      return {
        type: 'move-group-to-timeline',
        projectId: drag.projectId,
        groupId: drag.task.id,
        date: todayDate,
      };
    }
    return null;
  }

  if (target.kind === 'backlog') {
    if (drag.origin === 'gantt')
      return {
        type: 'move-task-to-backlog',
        projectId: drag.projectId,
        taskId: drag.task.id,
        targetTaskId: target.taskId,
        relation:
          target.relation === 'before' || target.relation === 'after' ? target.relation : undefined,
      };
    if (target.taskId && target.relation)
      return {
        type: 'move-task',
        projectId: drag.projectId,
        sourceTaskId: drag.task.id,
        targetTaskId: target.taskId,
        relation: target.relation,
        scheduleFromBacklog: false,
      };
    return null;
  }

  if (target.kind === 'gantt-row' && target.taskId)
    return {
      type: 'move-task',
      projectId: drag.projectId,
      sourceTaskId: drag.task.id,
      targetTaskId: target.taskId,
      relation: target.relation || 'before',
      scheduleFromBacklog: drag.origin === 'backlog',
    };
  if (target.kind === 'gantt-sidebar' && drag.origin === 'backlog')
    return {
      type: 'schedule-task',
      projectId: drag.projectId,
      taskId: drag.task.id,
      date: todayDate,
    };
  if (target.kind === 'gantt-timeline' && target.date)
    return {
      type: 'schedule-task',
      projectId: drag.projectId,
      taskId: drag.task.id,
      date: target.date,
    };
  return null;
}

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
