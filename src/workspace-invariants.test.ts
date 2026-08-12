import { describe, expect, it } from 'vitest';
import { emptyTask } from './data';
import { CURRENT_WORKSPACE_VERSION } from './types';
import type { Allocation, Project, Task, WorkspaceData } from './types';
import { reconcileWorkspaceInvariants } from './workspace-invariants';

const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  ...emptyTask(),
  id,
  name: id,
  updatedAt: 'task-original',
  ...overrides,
  ...(Object.prototype.hasOwnProperty.call(overrides, 'estimatedHours') &&
  overrides.estimatedHoursMode === undefined
    ? { estimatedHoursMode: 'manual' as const }
    : {}),
});

const project = (id: string, tasks: Task[], updatedAt = 'project-original'): Project => ({
  id,
  name: id,
  description: '',
  createdAt: '2026-01-01',
  updatedAt,
  tasks,
});

const workspace = (projects: Project[], allocations: Allocation[] = []): WorkspaceData => ({
  version: CURRENT_WORKSPACE_VERSION,
  projects,
  allocations,
});

describe('Workspace Invariant module', () => {
  it('derives automatic leaves and parent estimates from canonical allocations', () => {
    const parent = task('parent', { estimatedHours: 99 });
    const automatic = task('automatic', {
      parentId: parent.id,
      estimatedHours: 0,
      estimatedHoursMode: 'auto',
    });
    const manual = task('manual', { parentId: parent.id, estimatedHours: 7 });
    const original = workspace(
      [project('project-a', [parent, automatic, manual])],
      [{ id: 'automatic-allocation', taskId: automatic.id, date: '2026-01-01', allocatedHours: 4 }],
    );

    const next = reconcileWorkspaceInvariants(original);

    expect(next.projects[0].tasks).toEqual([
      { ...parent, estimatedHours: 11 },
      { ...automatic, estimatedHours: 4 },
      manual,
    ]);
    expect(next.projects[0].tasks[0].estimatedHours).toBe(11);
    expect(original.projects[0].tasks[0].estimatedHours).toBe(99);
  });

  it('derives recurring leaves from occupied dates, missing rule dates, and manual extras', () => {
    const recurring = task('recurring', {
      estimatedHours: 0,
      recurrence: {
        frequency: 'daily',
        startDate: '2026-01-01',
        endDate: '2026-01-03',
        hoursPerOccurrence: 2,
        weekdays: [],
        monthDays: [],
      },
    });
    const original = workspace(
      [project('project-a', [recurring])],
      [
        { id: 'occupied', taskId: recurring.id, date: '2026-01-01', allocatedHours: 3 },
        { id: 'extra', taskId: recurring.id, date: '2026-01-05', allocatedHours: 4 },
      ],
    );

    const next = reconcileWorkspaceInvariants(original);

    expect(next.projects[0].tasks[0]).toMatchObject({ estimatedHours: 11 });
  });

  it('scopes live reconciliation and touches changed timestamps once', () => {
    const first = task('first', { estimatedHoursMode: 'auto' });
    const second = task('second', { estimatedHoursMode: 'auto' });
    const original = workspace(
      [project('project-a', [first]), project('project-b', [second])],
      [{ id: 'first-allocation', taskId: first.id, date: '2026-01-01', allocatedHours: 5 }],
    );

    const next = reconcileWorkspaceInvariants(original, {
      projectId: 'project-a',
      updatedAt: 'transition-time',
    });

    expect(next.projects[0]).toMatchObject({ updatedAt: 'transition-time' });
    expect(next.projects[0].tasks[0]).toMatchObject({
      estimatedHours: 5,
      updatedAt: 'transition-time',
    });
    expect(next.projects[1]).toBe(original.projects[1]);
    expect(next.projects[1].tasks[0]).toBe(second);
    expect(second.estimatedHours).toBe(0);
  });

  it('reconciles every project during migration without changing timestamps', () => {
    const first = task('first', { estimatedHoursMode: 'auto' });
    const second = task('second', { estimatedHoursMode: 'auto' });
    const original = workspace(
      [project('project-a', [first]), project('project-b', [second])],
      [
        { id: 'first-allocation', taskId: first.id, date: '2026-01-01', allocatedHours: 5 },
        { id: 'second-allocation', taskId: second.id, date: '2026-01-01', allocatedHours: 3 },
      ],
    );

    const next = reconcileWorkspaceInvariants(original);

    expect(next.projects.map(item => item.tasks[0].estimatedHours)).toEqual([5, 3]);
    expect(next.projects.map(item => item.updatedAt)).toEqual([
      'project-original',
      'project-original',
    ]);
    expect(next.projects.flatMap(item => item.tasks).map(item => item.updatedAt)).toEqual([
      'task-original',
      'task-original',
    ]);
  });

  it('returns the same workspace when all invariant values already match', () => {
    const automatic = task('automatic', { estimatedHoursMode: 'auto', estimatedHours: 4 });
    const original = workspace(
      [project('project-a', [automatic])],
      [{ id: 'allocation', taskId: automatic.id, date: '2026-01-01', allocatedHours: 4 }],
    );

    expect(reconcileWorkspaceInvariants(original)).toBe(original);
  });
});
