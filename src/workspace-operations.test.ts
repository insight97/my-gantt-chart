import { describe, expect, it } from 'vitest';
import { emptyTask } from './data';
import type { Allocation, Project, Task, WorkspaceData } from './types';
import {
  adjustAllocationDay,
  autoScheduleTask,
  moveTaskGroupToBacklog,
  moveTaskGroupToTimeline,
  moveTaskToBacklog,
  saveTask,
  scheduleTaskAtDate,
  type WorkspaceOperationResult,
} from './workspace-operations';

function task(overrides: Partial<Task> = {}): Task {
  return {
    ...emptyTask(),
    id: 'task-a',
    name: 'Task A',
    ...overrides,
  };
}

function workspace(taskValue: Task, allocations: Allocation[] = []): WorkspaceData {
  const project: Project = {
    id: 'project-a',
    name: 'Project A',
    description: '',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    tasks: [taskValue],
  };
  return {
    version: 3,
    projects: [project],
    dailyCapacities: [],
    allocations,
  };
}

function changed(result: WorkspaceOperationResult): WorkspaceData {
  if (!result.ok || !result.changed) throw new Error('Expected a changed workspace');
  return result.workspace;
}

describe('workspace operations', () => {
  it('schedules a task through one transition seam', () => {
    const result = autoScheduleTask(
      workspace(task({ status: 'backlog', start: '2026-01-01', estimatedHours: 10 })),
      'project-a',
      'task-a',
    );
    const next = changed(result);

    expect(next.projects[0].tasks[0]).toMatchObject({ status: 'scheduled', start: '2026-01-01' });
    expect(next.allocations.map(item => [item.date, item.allocatedHours])).toEqual([
      ['2026-01-01', 8],
      ['2026-01-02', 2],
    ]);
  });

  it('uses the explicit drop date when scheduling a backlog task', () => {
    const result = scheduleTaskAtDate(
      workspace(task({ status: 'backlog', estimatedHours: 10 })),
      'project-a',
      'task-a',
      '2026-01-05',
    );
    const next = changed(result);

    expect(next.projects[0].tasks[0]).toMatchObject({ status: 'scheduled', start: '2026-01-05' });
    expect(next.allocations.map(item => item.date)).toEqual(['2026-01-05', '2026-01-06']);
  });

  it('changes one allocation date without rebalance', () => {
    const result = adjustAllocationDay(
      workspace(task({ status: 'scheduled' }), [
        { id: 'allocation-a', taskId: 'task-a', date: '2026-01-01', allocatedHours: 2 },
        { id: 'allocation-b', taskId: 'task-a', date: '2026-01-02', allocatedHours: 1 },
      ]),
      'project-a',
      'task-a',
      '2026-01-01',
      1,
    );
    const next = changed(result);

    expect(next.allocations).toMatchObject([
      { date: '2026-01-01', allocatedHours: 3 },
      { date: '2026-01-02', allocatedHours: 1 },
    ]);
  });

  it('returns a leaf to backlog while preserving hierarchy, metadata, and clearing allocations', () => {
    const result = moveTaskToBacklog(
      workspace(
        task({
          status: 'scheduled',
          parentId: 'parent',
          start: '2026-01-01',
          end: '2026-01-10',
          deadline: '2026-01-08',
        }),
        [{ id: 'allocation-a', taskId: 'task-a', date: '2026-01-01', allocatedHours: 8 }],
      ),
      'project-a',
      'task-a',
    );
    const next = changed(result);

    expect(next.projects[0].tasks[0]).toMatchObject({
      status: 'backlog',
      parentId: 'parent',
      start: '2026-01-01',
      end: '2026-01-10',
      deadline: '2026-01-08',
    });
    expect(next.allocations).toEqual([]);
  });

  it('keeps a returned leaf in its sibling order when dropped before a backlog sibling', () => {
    const original = workspace(task({ id: 'parent', name: 'Parent' }));
    original.projects[0].tasks.push(
      task({
        id: 'scheduled',
        name: 'Scheduled',
        parentId: 'parent',
        order: 1,
        status: 'scheduled',
      }),
      task({ id: 'backlog', name: 'Backlog', parentId: 'parent', order: 0, status: 'backlog' }),
    );

    const result = moveTaskToBacklog(original, 'project-a', 'scheduled', 'backlog', 'before');
    const next = changed(result);
    const children = next.projects[0].tasks
      .filter(item => item.parentId === 'parent')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    expect(children.map(item => [item.id, item.status])).toEqual([
      ['scheduled', 'backlog'],
      ['backlog', 'backlog'],
    ]);
  });

  it('schedules a group backlog subtree in stable leaf order as one transition', () => {
    const original = workspace(task({ id: 'group', name: 'Group' }));
    original.projects[0].tasks.push(
      task({ id: 'first', name: 'First', parentId: 'group', order: 0, estimatedHours: 6 }),
      task({ id: 'second', name: 'Second', parentId: 'group', order: 1, estimatedHours: 6 }),
    );
    original.dailyCapacities = [
      {
        date: '2026-01-05',
        totalCapacityHours: 8,
        unavailableHours: 0,
        availableHours: 8,
      },
      {
        date: '2026-01-06',
        totalCapacityHours: 8,
        unavailableHours: 0,
        availableHours: 8,
      },
    ];

    const next = changed(moveTaskGroupToTimeline(original, 'project-a', 'group', '2026-01-05'));

    expect(next.projects[0].tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'group', status: 'backlog' }),
        expect.objectContaining({ id: 'first', status: 'scheduled', parentId: 'group' }),
        expect.objectContaining({ id: 'second', status: 'scheduled', parentId: 'group' }),
      ]),
    );
    expect(next.allocations.map(item => [item.taskId, item.date, item.allocatedHours])).toEqual([
      ['first', '2026-01-05', 6],
      ['second', '2026-01-05', 2],
      ['second', '2026-01-06', 4],
    ]);
  });

  it('returns only unfinished Timeline leaves in a group while preserving completed leaves', () => {
    const original = workspace(task({ id: 'group', name: 'Group' }));
    original.projects[0].tasks.push(
      task({ id: 'scheduled', parentId: 'group', status: 'scheduled' }),
      task({ id: 'progress', parentId: 'group', status: 'in_progress' }),
      task({ id: 'completed', parentId: 'group', status: 'completed' }),
      task({ id: 'backlog', parentId: 'group', status: 'backlog' }),
    );
    original.allocations = [
      { id: 'scheduled-allocation', taskId: 'scheduled', date: '2026-01-05', allocatedHours: 2 },
      { id: 'progress-allocation', taskId: 'progress', date: '2026-01-05', allocatedHours: 2 },
      { id: 'completed-allocation', taskId: 'completed', date: '2026-01-05', allocatedHours: 2 },
    ];

    const next = changed(moveTaskGroupToBacklog(original, 'project-a', 'group'));

    expect(next.projects[0].tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'scheduled', status: 'backlog', parentId: 'group' }),
        expect.objectContaining({ id: 'progress', status: 'backlog', parentId: 'group' }),
        expect.objectContaining({ id: 'completed', status: 'completed', parentId: 'group' }),
        expect.objectContaining({ id: 'backlog', status: 'backlog', parentId: 'group' }),
      ]),
    );
    expect(next.allocations).toEqual([
      { id: 'completed-allocation', taskId: 'completed', date: '2026-01-05', allocatedHours: 2 },
    ]);
  });

  it('keeps the parent when a new backlog child is saved', () => {
    const original = workspace(task({ id: 'parent', name: 'Parent' }));
    const result = saveTask(
      original,
      'project-a',
      task({ id: 'child', name: 'Child', parentId: 'parent' }),
    );

    const next = changed(result);
    expect(next.projects[0].tasks).toContainEqual(
      expect.objectContaining({ id: 'child', parentId: 'parent', status: 'backlog' }),
    );
  });

  it('rejects invalid task metadata without changing the workspace', () => {
    const original = workspace(task({ estimatedHours: 8 }));
    const result = saveTask(
      original,
      'project-a',
      task({ id: 'task-a', name: '  ', estimatedHours: 8 }),
    );

    expect(result).toEqual({ ok: false, error: '請輸入 Task 名稱。' });
    expect(original.projects[0].tasks[0].name).toBe('Task A');
  });

  it('rejects a parent change that would create a hierarchy cycle', () => {
    const parent = task({ id: 'parent', name: 'Parent' });
    const child = task({ id: 'child', name: 'Child', parentId: 'parent' });
    const original = workspace(parent);
    original.projects[0].tasks.push(child);

    const result = saveTask(original, 'project-a', { ...parent, parentId: 'child' });

    expect(result).toEqual({ ok: false, error: '不可把 Task 移到自己的子樹內。' });
  });
});
