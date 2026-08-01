import { describe, expect, it } from 'vitest';
import { today } from './capacity';
import { emptyTask } from './data';
import { CURRENT_WORKSPACE_VERSION } from './types';
import type { Allocation, Project, Task, WorkspaceData } from './types';
import {
  adjustAllocationDay,
  applyTaskRecurrence,
  autoScheduleTask,
  moveTaskGroupToBacklog,
  moveTaskGroupToTimeline,
  moveTask,
  moveTaskToTimeline,
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
    version: CURRENT_WORKSPACE_VERSION,
    projects: [project],
    allocations,
  };
}

function changed(result: WorkspaceOperationResult): WorkspaceData {
  if (!result.ok || !result.changed) throw new Error('Expected a changed workspace');
  return result.workspace;
}

describe('workspace operations', () => {
  it('schedules a recurring task by its recurrence dates when moved to Timeline', () => {
    const recurring = task({
      status: 'backlog',
      estimatedHours: 24,
      recurrence: {
        frequency: 'daily',
        startDate: '2026-01-01',
        endDate: '2026-01-03',
        hoursPerOccurrence: 8,
        weekdays: [],
        monthDays: [],
      },
    });
    const target = task({ id: 'target', name: 'Target', status: 'scheduled' });
    const original = workspace(recurring);
    original.projects[0].tasks.push(target);

    const next = changed(
      moveTaskToTimeline(original, 'project-a', 'task-a', 'target', 'after', true),
    );

    expect(next.allocations.filter(item => item.taskId === 'task-a')).toEqual([
      expect.objectContaining({ date: '2026-01-01', allocatedHours: 8 }),
      expect.objectContaining({ date: '2026-01-02', allocatedHours: 8 }),
      expect.objectContaining({ date: '2026-01-03', allocatedHours: 8 }),
    ]);
  });

  it('schedules a task through one transition seam', () => {
    const result = autoScheduleTask(
      workspace(task({ status: 'backlog', start: '2026-01-01', estimatedHours: 10 })),
      'project-a',
      'task-a',
    );
    const next = changed(result);

    expect(next.projects[0].tasks[0]).toMatchObject({ status: 'scheduled', start: today() });
    expect(next.allocations.map(item => [item.date, item.allocatedHours])).toEqual([[today(), 10]]);
  });

  it('schedules a recurring Timeline task by occurrence hours', () => {
    const recurring = task({
      status: 'backlog',
      estimatedHours: 24,
      recurrence: {
        frequency: 'daily',
        startDate: '2026-01-01',
        endDate: '2026-01-03',
        hoursPerOccurrence: 8,
        weekdays: [],
        monthDays: [],
      },
    });

    const next = changed(
      autoScheduleTask(workspace(task({ status: 'backlog' })), 'project-a', 'task-a', recurring),
    );

    expect(next.allocations.map(item => [item.date, item.allocatedHours])).toEqual([
      ['2026-01-01', 8],
      ['2026-01-02', 8],
      ['2026-01-03', 8],
    ]);
  });

  it('rebuilds stale recurring allocations during explicit auto scheduling', () => {
    const recurring = task({
      status: 'scheduled',
      estimatedHours: 24,
      recurrence: {
        frequency: 'daily',
        startDate: '2026-01-01',
        endDate: '2026-01-03',
        hoursPerOccurrence: 8,
        weekdays: [],
        monthDays: [],
      },
    });

    const next = changed(
      autoScheduleTask(
        workspace(recurring, [
          { id: 'stale', taskId: 'task-a', date: '2026-01-01', allocatedHours: 24 },
        ]),
        'project-a',
        'task-a',
        recurring,
      ),
    );

    expect(next.allocations.map(item => [item.date, item.allocatedHours])).toEqual([
      ['2026-01-01', 8],
      ['2026-01-02', 8],
      ['2026-01-03', 8],
    ]);
  });

  it('keeps an existing Timeline start when automatically rescheduling it', () => {
    const result = autoScheduleTask(
      workspace(task({ status: 'scheduled', start: '2026-01-01', estimatedHours: 10 })),
      'project-a',
      'task-a',
    );
    const next = changed(result);

    expect(next.projects[0].tasks[0]).toMatchObject({ status: 'scheduled', start: '2026-01-01' });
    expect(next.allocations[0]).toMatchObject({ date: '2026-01-01', allocatedHours: 10 });
  });

  it('keeps an in-progress task in progress when automatically rescheduling it', () => {
    const next = changed(
      autoScheduleTask(
        workspace(task({ status: 'in_progress', start: '2026-01-01', estimatedHours: 8 })),
        'project-a',
        'task-a',
      ),
    );

    expect(next.projects[0].tasks[0]).toMatchObject({ status: 'in_progress' });
  });

  it('rejects automatic scheduling when a draft deadline exceeds its parent deadline', () => {
    const original = workspace(task({ id: 'parent', name: 'Parent', deadline: '2026-02-10' }));
    const result = autoScheduleTask(
      original,
      'project-a',
      'child',
      task({
        id: 'child',
        name: 'Child',
        parentId: 'parent',
        deadline: '2026-02-11',
        status: 'scheduled',
      }),
    );

    expect(result).toEqual({
      ok: false,
      error: '「Child」的截止日期不可晚於父任務「Parent」。',
    });
    expect(original.projects[0].tasks).toHaveLength(1);
  });

  it("preserves a parent's direct work before automatically scheduling a new child", () => {
    const parent = task({ id: 'parent', name: 'Parent', status: 'scheduled', estimatedHours: 8 });
    const original = workspace(parent, [
      { id: 'parent-allocation', taskId: 'parent', date: '2026-01-01', allocatedHours: 8 },
    ]);

    const next = changed(
      autoScheduleTask(
        original,
        'project-a',
        'child',
        task({ id: 'child', name: 'Child', parentId: 'parent', status: 'scheduled' }),
      ),
    );

    const unsplit = next.projects[0].tasks.find(item => item.name === '未拆分工作');
    expect(unsplit).toMatchObject({ parentId: 'parent', estimatedHours: 8 });
    expect(next.projects[0].tasks.find(item => item.id === 'child')).toMatchObject({
      parentId: 'parent',
      status: 'scheduled',
    });
    expect(next.allocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'parent-allocation', taskId: unsplit?.id }),
      ]),
    );
  });

  it('puts an automatically scheduled Backlog task at the end of its sibling order', () => {
    const original = workspace(task({ id: 'first', name: 'First', order: 0 }));
    original.projects[0].tasks.push(
      task({ id: 'second', name: 'Second', order: 1, status: 'scheduled' }),
      task({ id: 'incoming', name: 'Incoming', order: 0, status: 'backlog' }),
    );

    const next = changed(autoScheduleTask(original, 'project-a', 'incoming'));
    const roots = next.projects[0].tasks
      .filter(item => item.parentId === null)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    expect(roots.map(item => item.id)).toEqual(['first', 'second', 'incoming']);
    expect(roots.map(item => item.order)).toEqual([0, 1, 2]);
  });

  it('puts a Backlog task dropped on a Timeline date at the end of its sibling order', () => {
    const original = workspace(task({ id: 'first', name: 'First', order: 0 }));
    original.projects[0].tasks.push(
      task({ id: 'second', name: 'Second', order: 1, status: 'scheduled' }),
      task({ id: 'incoming', name: 'Incoming', order: 0, status: 'backlog' }),
    );

    const next = changed(scheduleTaskAtDate(original, 'project-a', 'incoming', '2026-01-05'));
    const roots = next.projects[0].tasks
      .filter(item => item.parentId === null)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    expect(roots.map(item => item.id)).toEqual(['first', 'second', 'incoming']);
    expect(roots.map(item => item.order)).toEqual([0, 1, 2]);
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
    expect(next.allocations.map(item => item.date)).toEqual(['2026-01-05']);
  });

  it('can place a backlog task in Timeline without creating allocations', () => {
    const next = changed(
      scheduleTaskAtDate(
        workspace(task({ status: 'backlog', estimatedHours: 10 })),
        'project-a',
        'task-a',
        '2026-01-05',
        true,
        false,
      ),
    );

    expect(next.projects[0].tasks[0]).toMatchObject({
      status: 'scheduled',
      start: '2026-01-05',
      end: '2026-01-05',
    });
    expect(next.allocations).toEqual([]);
  });

  it('reschedules an existing Timeline task when dropped on an explicit date', () => {
    const original = workspace(
      task({ id: 'task-a', status: 'scheduled', start: '2026-01-01', estimatedHours: 8 }),
      [{ id: 'old-allocation', taskId: 'task-a', date: '2026-01-01', allocatedHours: 8 }],
    );
    const next = changed(scheduleTaskAtDate(original, 'project-a', 'task-a', '2026-01-05'));

    expect(next.projects[0].tasks[0]).toMatchObject({ status: 'scheduled', start: '2026-01-05' });
    expect(next.allocations).toEqual([
      expect.objectContaining({ taskId: 'task-a', date: '2026-01-05', allocatedHours: 8 }),
    ]);
    expect(next.allocations.some(item => item.id === 'old-allocation')).toBe(false);
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

  it('applies a recurring rule as marked allocations and derives total hours', () => {
    const original = workspace(
      task({
        id: 'task-a',
        status: 'backlog',
        recurrence: {
          frequency: 'weekly',
          startDate: '2026-01-05',
          endDate: '2026-01-19',
          hoursPerOccurrence: 2,
          weekdays: [1],
          monthDays: [],
        },
      }),
    );

    const next = changed(applyTaskRecurrence(original, 'project-a', 'task-a'));

    expect(next.projects[0].tasks[0]).toMatchObject({
      status: 'scheduled',
      estimatedHours: 6,
      start: '2026-01-05',
      end: '2026-01-19',
    });
    expect(next.allocations).toHaveLength(3);
    expect(next.allocations.every(item => item.recurrenceId === 'task-a')).toBe(true);
  });

  it('preserves a manually adjusted occurrence when recurring allocations are reapplied', () => {
    const original = workspace(
      task({
        status: 'backlog',
        recurrence: {
          frequency: 'daily',
          startDate: '2026-01-01',
          endDate: '2026-01-03',
          hoursPerOccurrence: 2,
          weekdays: [],
          monthDays: [],
        },
      }),
    );
    const applied = changed(applyTaskRecurrence(original, 'project-a', 'task-a'));
    const manuallyAdjusted = changed(
      adjustAllocationDay(applied, 'project-a', 'task-a', '2026-01-02', 1),
    );
    const next = changed(applyTaskRecurrence(manuallyAdjusted, 'project-a', 'task-a'));

    expect(next.allocations).toEqual(
      expect.arrayContaining([expect.objectContaining({ date: '2026-01-02', allocatedHours: 3 })]),
    );
    expect(next.allocations.find(item => item.date === '2026-01-02')).not.toHaveProperty(
      'recurrenceId',
    );
    expect(next.allocations.filter(item => item.recurrenceId === 'task-a')).toHaveLength(2);
  });

  it('clears generated occurrences without deleting manual allocations', () => {
    const original = workspace(
      task({
        status: 'scheduled',
        recurrence: {
          frequency: 'daily',
          startDate: '2026-01-01',
          endDate: '2026-01-02',
          hoursPerOccurrence: 2,
          weekdays: [],
          monthDays: [],
        },
      }),
      [
        {
          id: 'generated',
          taskId: 'task-a',
          date: '2026-01-01',
          allocatedHours: 2,
          recurrenceId: 'task-a',
        },
        { id: 'manual', taskId: 'task-a', date: '2026-01-03', allocatedHours: 1 },
      ],
    );

    const next = changed(
      applyTaskRecurrence(
        {
          ...original,
          projects: [
            {
              ...original.projects[0],
              tasks: [{ ...original.projects[0].tasks[0], recurrence: null }],
            },
          ],
        },
        'project-a',
        'task-a',
      ),
    );

    expect(next.allocations).toEqual([
      { id: 'manual', taskId: 'task-a', date: '2026-01-03', allocatedHours: 1 },
    ]);
  });

  it('moves a parent recurrence rule with preserved direct work into the unsplit child', () => {
    const original = workspace(
      task({
        id: 'parent',
        name: 'Parent',
        status: 'scheduled',
        recurrence: {
          frequency: 'daily',
          startDate: '2026-01-01',
          endDate: '2026-01-02',
          hoursPerOccurrence: 2,
          weekdays: [],
          monthDays: [],
        },
      }),
      [
        {
          id: 'generated',
          taskId: 'parent',
          date: '2026-01-01',
          allocatedHours: 2,
          recurrenceId: 'parent',
        },
      ],
    );

    const next = changed(
      saveTask(original, 'project-a', task({ id: 'child', name: 'Child', parentId: 'parent' })),
    );
    const unsplit = next.projects[0].tasks.find(item => item.name === '未拆分工作');

    expect(next.projects[0].tasks.find(item => item.id === 'parent')).toMatchObject({
      recurrence: null,
    });
    expect(unsplit).toMatchObject({
      parentId: 'parent',
      recurrence: original.projects[0].tasks[0].recurrence,
    });
    expect(next.allocations[0]).toMatchObject({
      taskId: unsplit?.id,
      recurrenceId: unsplit?.id,
    });
  });

  it('does not create a history-changing workspace update for an empty negative adjustment', () => {
    const original = workspace(task({ status: 'scheduled' }));
    const result = adjustAllocationDay(original, 'project-a', 'task-a', '2026-01-01', -1);

    expect(result).toEqual({ ok: true, changed: false });
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
      ['second', '2026-01-05', 6],
    ]);
  });

  it('schedules a recurring group leaf by its rule when moved to Timeline', () => {
    const original = workspace(task({ id: 'group', name: 'Group' }));
    original.projects[0].tasks.push(
      task({
        id: 'recurring-leaf',
        name: 'Recurring leaf',
        parentId: 'group',
        status: 'backlog',
        estimatedHours: 6,
        recurrence: {
          frequency: 'weekly',
          startDate: '2026-01-05',
          endDate: '2026-01-19',
          hoursPerOccurrence: 2,
          weekdays: [1],
          monthDays: [],
        },
      }),
    );

    const next = changed(moveTaskGroupToTimeline(original, 'project-a', 'group', '2026-08-01'));

    expect(next.allocations.filter(item => item.taskId === 'recurring-leaf')).toEqual([
      expect.objectContaining({ date: '2026-01-05', allocatedHours: 2 }),
      expect.objectContaining({ date: '2026-01-12', allocatedHours: 2 }),
      expect.objectContaining({ date: '2026-01-19', allocatedHours: 2 }),
    ]);
  });

  it('can move a group into Timeline without automatically allocating its leaves', () => {
    const original = workspace(task({ id: 'group', name: 'Group' }));
    original.projects[0].tasks.push(
      task({ id: 'first', name: 'First', parentId: 'group', estimatedHours: 6 }),
      task({ id: 'second', name: 'Second', parentId: 'group', estimatedHours: 6 }),
    );

    const next = changed(
      moveTaskGroupToTimeline(original, 'project-a', 'group', '2026-01-05', false),
    );

    expect(next.projects[0].tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'first', status: 'scheduled', start: '2026-01-05' }),
        expect.objectContaining({ id: 'second', status: 'scheduled', start: '2026-01-05' }),
      ]),
    );
    expect(next.allocations).toEqual([]);
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

  it('rejects saving a task under a completed parent', () => {
    const original = workspace(
      task({ id: 'completed-parent', name: 'Completed Parent', status: 'completed' }),
    );
    original.projects[0].tasks.push(task({ id: 'child', name: 'Child' }));

    const result = saveTask(
      original,
      'project-a',
      task({ id: 'child', name: 'Child', parentId: 'completed-parent' }),
    );

    expect(result).toEqual({ ok: false, error: '已完成工作不可作為父節點。' });
    expect(original.projects[0].tasks.find(item => item.id === 'child')).toMatchObject({
      parentId: null,
    });
  });

  it('rejects manually completing a group without changing the workspace', () => {
    const parent = task({ id: 'parent', name: 'Parent' });
    const child = task({ id: 'child', name: 'Child', parentId: 'parent', status: 'in_progress' });
    const original = workspace(parent);
    original.projects[0].tasks.push(child);

    const result = saveTask(original, 'project-a', { ...parent, status: 'completed' });

    expect(result).toEqual({ ok: false, error: '有子任務的工作項目不可標記為已完成。' });
    expect(original.projects[0].tasks.find(item => item.id === 'parent')).toMatchObject({
      status: 'backlog',
    });
  });

  it('rejects dragging a task inside a completed parent', () => {
    const original = workspace(
      task({ id: 'completed-parent', name: 'Completed Parent', status: 'completed' }),
    );
    original.projects[0].tasks.push(task({ id: 'child', name: 'Child' }));

    const result = moveTask(original, 'project-a', 'child', 'completed-parent', 'inside');

    expect(result).toEqual({ ok: false, error: '已完成工作不可作為父節點。' });
    expect(original.projects[0].tasks.find(item => item.id === 'child')).toMatchObject({
      parentId: null,
    });
  });
});
