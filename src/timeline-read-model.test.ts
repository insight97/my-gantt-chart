import { describe, expect, it } from 'vitest';
import { emptyTask } from './data';
import { buildTaskTree } from './task-tree';
import { buildDailyDistributionRows, buildTimelineReadModel } from './timeline-read-model';
import type { Allocation, Task } from './types';

const task = (id: string, parentId: string | null = null, overrides: Partial<Task> = {}): Task => ({
  ...emptyTask(),
  id,
  parentId,
  ...overrides,
});

const allocation = (
  id: string,
  taskId: string,
  date: string,
  allocatedHours: number,
): Allocation => ({ id, taskId, date, allocatedHours });

describe('timeline read model', () => {
  it('rolls allocations up once for task rows and date indexes', () => {
    const root = task('root');
    const childA = task('child-a', 'root', { status: 'scheduled', order: 0 });
    const childB = task('child-b', 'root', { status: 'scheduled', order: 1 });
    const allTasks = [root, childA, childB];
    const taskTree = buildTaskTree(allTasks);
    const allocations = [
      allocation('a', 'child-a', '2026-08-10', 4),
      allocation('b', 'child-b', '2026-08-11', 2),
      allocation('root-direct', 'root', '2026-08-10', 1),
    ];
    const model = buildTimelineReadModel({
      tasks: allTasks,
      allTasks,
      taskTree,
      allocations,
      allAllocations: allocations,
      periods: [
        {
          start: '2026-08-10',
          end: '2026-08-11',
          dates: ['2026-08-10', '2026-08-11'],
          label: '測試',
        },
      ],
    });

    expect(model.capacityAllocatedByDate).toEqual(
      new Map([
        ['2026-08-10', 5],
        ['2026-08-11', 2],
      ]),
    );
    expect(model.taskAllocations.get('root')?.map(item => item.id)).toEqual([
      'a',
      'b',
      'root-direct',
    ]);
    expect(model.taskAllocations.get('child-a')?.map(item => item.id)).toEqual(['a']);
    expect(model.allocatedByTask).toEqual(
      new Map([
        ['root', 7],
        ['child-a', 4],
        ['child-b', 2],
      ]),
    );
    expect(model.hoursByTask.get('root')).toEqual(
      new Map([
        ['2026-08-10', 5],
        ['2026-08-11', 2],
      ]),
    );
    expect(model.dailyDistributionDates).toEqual(['2026-08-10', '2026-08-11']);
  });

  it('projects only active leaves and reveals completed leaves when the view includes them', () => {
    const root = task('root');
    const scheduled = task('scheduled', 'root', { status: 'scheduled', order: 0 });
    const backlog = task('backlog', 'root', { status: 'backlog', order: 1 });
    const completed = task('completed', 'root', { status: 'completed', order: 2 });
    const allTasks = [root, scheduled, backlog, completed];
    const taskTree = buildTaskTree(allTasks);
    const baseInput = {
      allTasks,
      taskTree,
      allocations: [],
      allAllocations: [],
      periods: [],
    };

    const activeModel = buildTimelineReadModel({
      ...baseInput,
      tasks: [root, scheduled],
    });
    expect(activeModel.dailyDistributionTasks.map(item => item.id)).toEqual(['root', 'scheduled']);

    const completedModel = buildTimelineReadModel({
      ...baseInput,
      tasks: [root, scheduled, completed],
    });
    expect(completedModel.dailyDistributionTasks.map(item => item.id)).toEqual([
      'root',
      'scheduled',
      'completed',
    ]);
  });

  it('builds stable sorted rows and clips only the visible part at daily capacity', () => {
    const root = task('root');
    const childA = task('child-a', 'root', { status: 'scheduled', order: 0 });
    const childB = task('child-b', 'root', { status: 'scheduled', order: 1 });
    const tasks = [root, childA, childB];
    const taskTree = buildTaskTree(tasks);
    const hoursByTask = new Map([
      ['root', new Map([['2026-08-10', 30]])],
      ['child-a', new Map([['2026-08-10', 20]])],
      ['child-b', new Map([['2026-08-10', 10]])],
    ]);

    const descending = buildDailyDistributionRows({
      dates: ['2026-08-10'],
      tasks,
      taskTree,
      hoursByTask,
      allocationOrder: 'descending',
      hierarchyDepth: 2,
    });
    expect(descending[0].allocated).toBe(30);
    expect(
      descending[0].segments.map(segment => [
        segment.task.id,
        segment.startHour,
        segment.visibleHours,
      ]),
    ).toEqual([
      ['child-a', 0, 20],
      ['child-b', 20, 4],
    ]);

    const ascending = buildDailyDistributionRows({
      dates: ['2026-08-10'],
      tasks,
      taskTree,
      hoursByTask,
      allocationOrder: 'ascending',
      hierarchyDepth: 2,
    });
    expect(ascending[0].segments.map(segment => segment.task.id)).toEqual(['child-b', 'child-a']);

    const parentDepth = buildDailyDistributionRows({
      dates: ['2026-08-10'],
      tasks,
      taskTree,
      hoursByTask,
      allocationOrder: 'descending',
      hierarchyDepth: 1,
    });
    expect(parentDepth[0].segments.map(segment => segment.task.id)).toEqual(['root']);
  });
});
