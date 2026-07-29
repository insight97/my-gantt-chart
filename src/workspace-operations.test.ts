import { describe, expect, it } from 'vitest';
import { emptyTask } from './data';
import type { Allocation, Project, Task, WorkspaceData } from './types';
import {
  adjustAllocationDay,
  autoScheduleTask,
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

  it('returns a task to backlog while preserving metadata and clearing allocations', () => {
    const result = moveTaskToBacklog(
      workspace(
        task({
          status: 'scheduled',
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
      start: '2026-01-01',
      end: '2026-01-10',
      deadline: '2026-01-08',
    });
    expect(next.allocations).toEqual([]);
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
