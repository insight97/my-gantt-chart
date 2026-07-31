import { describe, expect, it } from 'vitest';
import { backlogDropRelation, resolveTaskDrop, taskRowDropRelation } from './task-drag';
import type { TaskDragState, TaskDropTarget } from './task-drag';
import type { Task } from './types';

const dragState = (overrides: Partial<TaskDragState> = {}): TaskDragState => ({
  projectId: 'project-1',
  task: { id: 'task-1' } as Task,
  origin: 'backlog',
  isGroup: false,
  allocatedHours: 0,
  pendingHours: 0,
  x: 0,
  y: 0,
  active: true,
  target: null,
  ...overrides,
});

const target = (overrides: Partial<TaskDropTarget>): TaskDropTarget => ({
  kind: 'backlog',
  projectId: 'project-1',
  ...overrides,
});

describe('task row drop relation', () => {
  it('uses the next row as the only insertion boundary between adjacent tasks', () => {
    expect(taskRowDropRelation(58, 70, false)).toBe('inside');
    expect(taskRowDropRelation(4, 70, false)).toBe('before');
  });

  it('keeps an explicit after position only at the end of the visible list', () => {
    expect(taskRowDropRelation(66, 70, true)).toBe('after');
    expect(taskRowDropRelation(66, 70, false)).toBe('inside');
  });

  it('uses the upper and lower halves of a Backlog card as sorting targets', () => {
    expect(backlogDropRelation(20, 70)).toBe('before');
    expect(backlogDropRelation(50, 70)).toBe('after');
  });
});

describe('task drop command resolver', () => {
  it('schedules a backlog leaf on an explicit timeline date', () => {
    expect(
      resolveTaskDrop(
        dragState(),
        target({ kind: 'gantt-timeline', date: '2026-08-01' }),
        '2026-07-31',
      ),
    ).toEqual({
      type: 'schedule-task',
      projectId: 'project-1',
      taskId: 'task-1',
      date: '2026-08-01',
    });
  });

  it('moves a backlog group to today when dropped on the timeline sidebar', () => {
    expect(
      resolveTaskDrop(
        dragState({ isGroup: true }),
        target({ kind: 'gantt-sidebar' }),
        '2026-07-31',
      ),
    ).toEqual({
      type: 'move-group-to-timeline',
      projectId: 'project-1',
      groupId: 'task-1',
      date: '2026-07-31',
    });
  });

  it('turns a timeline group reorder into a subtree move command', () => {
    expect(
      resolveTaskDrop(
        dragState({ origin: 'gantt', isGroup: true }),
        target({ kind: 'gantt-row', taskId: 'task-2', relation: 'inside' }),
        '2026-07-31',
      ),
    ).toEqual({
      type: 'move-task',
      projectId: 'project-1',
      sourceTaskId: 'task-1',
      targetTaskId: 'task-2',
      relation: 'inside',
      scheduleFromBacklog: false,
    });
  });

  it('returns null for a cross-project target or a group timeline date drop', () => {
    expect(
      resolveTaskDrop(dragState(), { kind: 'backlog', projectId: 'project-2' }, '2026-07-31'),
    ).toBeNull();
    expect(
      resolveTaskDrop(
        dragState({ origin: 'gantt', isGroup: true }),
        target({ kind: 'gantt-timeline', date: '2026-08-01' }),
        '2026-07-31',
      ),
    ).toBeNull();
  });
});
