import { resolveTaskDrop } from './task-drag';
import type { TaskDragOrigin, TaskDragState, TaskDropCommand, TaskDropTarget } from './task-drag';
import type { Task } from './types';

const DEFAULT_ACTIVATION_DISTANCE = 5;

type TrackedDropTarget = { target: TaskDropTarget; element: HTMLElement };

export type TaskDragStart = {
  projectId: string;
  task: Task;
  origin: TaskDragOrigin;
  allocatedHours?: number;
  pendingHours?: number;
  isGroup?: boolean;
  x: number;
  y: number;
};

export type TaskDragMoveResult = {
  state: TaskDragState;
  activated: boolean;
};

export type TaskDragRelease = {
  state: TaskDragState;
  command: TaskDropCommand | null;
};

export interface TaskDragSession {
  begin(start: TaskDragStart): TaskDragState;
  move(x: number, y: number): TaskDragMoveResult | null;
  updateTarget(target: TaskDropTarget | null, element?: HTMLElement): TaskDragState | null;
  release(x: number, y: number, hit: Element | null, todayDate: string): TaskDragRelease | null;
  cancel(): TaskDragState | null;
  current(): TaskDragState | null;
}

export function sameDropTarget(a: TaskDropTarget | null, b: TaskDropTarget | null) {
  if (!a || !b) return a === b;
  return (
    a.kind === b.kind &&
    a.projectId === b.projectId &&
    a.taskId === b.taskId &&
    a.date === b.date &&
    a.relation === b.relation
  );
}

export function createTaskDragSession(
  activationDistance = DEFAULT_ACTIVATION_DISTANCE,
): TaskDragSession {
  let state: TaskDragState | null = null;
  let trackedTarget: TrackedDropTarget | null = null;

  return {
    begin(start) {
      state = {
        projectId: start.projectId,
        task: start.task,
        origin: start.origin,
        isGroup: start.isGroup ?? false,
        allocatedHours: start.allocatedHours ?? 0,
        pendingHours: start.pendingHours ?? 0,
        x: start.x,
        y: start.y,
        active: false,
        target: null,
      };
      trackedTarget = null;
      return state;
    },

    move(x, y) {
      if (!state) return null;
      const activated = !state.active && Math.hypot(x - state.x, y - state.y) >= activationDistance;
      if (!state.active && !activated) return null;
      state = { ...state, x, y, active: state.active || activated };
      return { state, activated };
    },

    updateTarget(target, element) {
      if (!state?.active) return null;
      const nextTarget = target && element && target.projectId === state.projectId ? target : null;
      trackedTarget = nextTarget && element ? { target: nextTarget, element } : null;
      if (sameDropTarget(state.target, nextTarget)) return null;
      state = { ...state, target: nextTarget };
      return state;
    },

    release(x, y, hit, todayDate) {
      if (!state) return null;
      const released = { ...state, x, y };
      const command =
        released.active && trackedTarget && (!hit || trackedTarget.element.contains(hit))
          ? resolveTaskDrop(released, trackedTarget.target, todayDate)
          : null;
      state = null;
      trackedTarget = null;
      return { state: released, command };
    },

    cancel() {
      const cancelled = state;
      state = null;
      trackedTarget = null;
      return cancelled;
    },

    current() {
      return state;
    },
  };
}
