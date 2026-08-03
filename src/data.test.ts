import { describe, expect, it } from 'vitest';
import {
  addDays,
  adjustAllocationDay,
  datesBetween,
  getDailyAllocatedHours,
  getProjectEstimatedHours,
  getRemainingCapacity,
  getTaskAllocatedHours,
  getTaskPendingHours,
  getWorkspaceCapacityMetrics,
  isTaskOverdue,
  recalculateAutomaticAllocations,
  recalculateTaskSchedule,
  returnTaskToBacklog,
  scheduleTaskAt,
} from './capacity';
import { buildTaskTree, emptyTask, partitionProjectTasks, validateImport } from './data';
import type { Allocation, Project, Task } from './types';

const task = (overrides: Partial<Task> = {}): Task => ({ ...emptyTask(), ...overrides });

describe('容量 domain', () => {
  it('新工作項目的預設預估工時為 0', () => {
    expect(emptyTask().estimatedHours).toBe(0);
  });

  it('以固定 24 小時計算每日剩餘容量', () => {
    const allocations: Allocation[] = [
      { id: 'a', taskId: 'other', date: '2026-01-01', allocatedHours: 3 },
    ];
    expect(getDailyAllocatedHours('2026-01-01', allocations)).toBe(3);
    expect(getRemainingCapacity('2026-01-01', allocations)).toBe(21);
  });

  it('計算未來空閒容量與待安排葉節點數量', () => {
    const parent = task({ id: 'parent', estimatedHours: 999 });
    const scheduled = task({
      id: 'scheduled',
      parentId: 'parent',
      estimatedHours: 8,
      status: 'scheduled',
    });
    const pending = task({
      id: 'pending',
      parentId: 'parent',
      estimatedHours: 10,
      status: 'backlog',
    });
    const zeroHours = task({
      id: 'zero-hours',
      parentId: 'parent',
      estimatedHours: 0,
      status: 'backlog',
    });
    const completed = task({
      id: 'completed',
      parentId: 'parent',
      estimatedHours: 6,
      status: 'completed',
    });
    const metrics = getWorkspaceCapacityMetrics(
      [{ ...({} as Project), tasks: [parent, scheduled, pending, zeroHours, completed] }],
      [
        { id: 'a', taskId: 'scheduled', date: '2026-01-01', allocatedHours: 8 },
        { id: 'b', taskId: 'pending', date: '2026-01-02', allocatedHours: 4 },
      ],
      '2026-01-01',
    );

    expect(metrics).toEqual({
      futureSevenDayFreeHours: 156,
      futureThirtyDayFreeHours: 708,
      pendingTaskCount: 2,
    });
  });

  it('計算 Project 下所有 Task 的預估總工時', () => {
    const project = {
      tasks: [task({ estimatedHours: 3 }), task({ estimatedHours: 7 })],
    } as Project;
    expect(getProjectEstimatedHours(project)).toBe(10);
  });

  it('最快完成法從 anchor 開始逐日填滿可用容量', () => {
    const result = recalculateAutomaticAllocations(
      task({ id: 'task', start: '2026-01-01', estimatedHours: 14 }),
      [],
    );
    expect(result.allocations.map(item => [item.date, item.allocatedHours])).toEqual([
      ['2026-01-01', 14],
    ]);
  });

  it('將睡眠等 Allocation 視為每日時間消耗', () => {
    const result = recalculateAutomaticAllocations(
      task({ id: 'work', start: '2026-01-01', estimatedHours: 20 }),
      [{ id: 'sleep', taskId: 'sleep', date: '2026-01-01', allocatedHours: 8 }],
    );

    expect(result.allocations.map(item => [item.date, item.allocatedHours])).toEqual([
      ['2026-01-01', 16],
      ['2026-01-02', 4],
    ]);
  });

  it('自動排程會清除同一 Task 舊有 Allocation 並重新建立', () => {
    const old: Allocation = {
      id: 'old',
      taskId: 'task',
      date: '2025-12-31',
      allocatedHours: 4,
    };
    const result = recalculateAutomaticAllocations(
      task({ id: 'task', start: '2026-01-01', estimatedHours: 6 }),
      [old],
    );
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]).toMatchObject({
      taskId: 'task',
      date: '2026-01-01',
      allocatedHours: 6,
    });
    expect(result.allocations.some(item => item.id === old.id)).toBe(false);
  });

  it('超過單日 24 小時時延續到下一天', () => {
    const result = recalculateAutomaticAllocations(
      task({ id: 'task', start: '2026-01-01', estimatedHours: 28 }),
      [],
      '2026-01-01',
      { horizonDays: 2 },
    );
    expect(getTaskAllocatedHours('task', result.allocations)).toBe(28);
    expect(getTaskPendingHours(task({ id: 'task', estimatedHours: 28 }), result.allocations)).toBe(
      0,
    );
    expect(result.allocations).toEqual([
      expect.objectContaining({ date: '2026-01-01', allocatedHours: 24 }),
      expect.objectContaining({ date: '2026-01-02', allocatedHours: 4 }),
    ]);
  });

  it('沒有容量時仍把已明確自動排程的 Task 留在 Timeline', () => {
    const scheduled = scheduleTaskAt(task({ id: 'task', estimatedHours: 8 }), [], '2026-01-01', {
      horizonDays: 1,
    }).task;
    const result = partitionProjectTasks({ tasks: [scheduled] } as Project);
    expect(result.scheduled.map(item => item.id)).toEqual(['task']);
  });

  it('以葉節點狀態投影兩個視圖，並在每個視圖保留完整祖先鏈', () => {
    const parent = task({ id: 'parent', status: 'backlog' });
    const backlogChild = task({ id: 'backlog-child', parentId: 'parent', status: 'backlog' });
    const scheduledChild = task({
      id: 'scheduled-child',
      parentId: 'parent',
      status: 'scheduled',
    });
    const project = { tasks: [parent, backlogChild, scheduledChild] } as Project;

    expect(partitionProjectTasks(project).backlog.map(item => item.id)).toEqual([
      'parent',
      'backlog-child',
    ]);
    expect(
      partitionProjectTasks(project, new Set(['parent'])).scheduled.map(item => item.id),
    ).toEqual(['parent', 'scheduled-child']);
  });

  it('預設隱藏已完成 Timeline Leaf，並可切換顯示', () => {
    const active = task({ id: 'active', status: 'scheduled' });
    const completed = task({ id: 'completed', status: 'completed' });
    const project = { tasks: [active, completed] } as Project;
    const tree = buildTaskTree(project.tasks);

    expect(partitionProjectTasks(project).scheduled.map(item => item.id)).toEqual(['active']);
    expect(
      partitionProjectTasks(project, new Set(), tree, undefined, true).scheduled.map(
        item => item.id,
      ),
    ).toEqual(['active', 'completed']);
  });

  it('Backlog 完整顯示祖先鏈，不受 Timeline 收合狀態影響', () => {
    const parent = task({ id: 'parent' });
    const child = task({ id: 'child', parentId: 'parent' });
    const result = partitionProjectTasks({ tasks: [parent, child] } as Project);

    expect(result.backlog.map(item => item.id)).toEqual(['parent', 'child']);
    expect(result.scheduled).toEqual([]);
  });

  it('allows Backlog and Timeline to keep separate expansion state', () => {
    const parent = task({ id: 'parent' });
    const backlogChild = task({ id: 'backlog-child', parentId: 'parent' });
    const scheduledChild = task({ id: 'scheduled-child', parentId: 'parent', status: 'scheduled' });
    const project = { tasks: [parent, backlogChild, scheduledChild] } as Project;
    const tree = buildTaskTree(project.tasks);

    const result = partitionProjectTasks(project, new Set(['parent']), tree, new Set());

    expect(result.backlog.map(item => item.id)).toEqual(['parent']);
    expect(result.scheduled.map(item => item.id)).toEqual(['parent', 'scheduled-child']);
  });

  it('排程保留 end metadata，end 不限制實際 Allocation 日期', () => {
    const result = scheduleTaskAt(
      task({ id: 'task', end: '2026-01-01', estimatedHours: 12 }),
      [],
      '2026-01-01',
    );
    expect(result.task).toMatchObject({ start: '2026-01-01', end: '2026-01-01' });
    expect(result.allocations.map(item => item.date)).toEqual(['2026-01-01']);
  });

  it('沒有 start 時使用明確排程 anchor，並保留其他 metadata', () => {
    const result = recalculateTaskSchedule(
      task({ id: 'task', deadline: '2026-01-10', estimatedHours: 10 }),
      [],
      '2026-01-05',
    );
    expect(result.task.start).toBe('2026-01-05');
    expect(result.task.deadline).toBe('2026-01-10');
    expect(result.allocations.map(item => item.allocatedHours)).toEqual([10]);
  });

  it('直接調整只改被點擊的日期，且允許超過預估與容量', () => {
    const allocations: Allocation[] = [
      { id: 'a', taskId: 'task', date: '2026-01-01', allocatedHours: 8 },
      { id: 'b', taskId: 'task', date: '2026-01-02', allocatedHours: 2 },
    ];
    const result = adjustAllocationDay(
      task({ id: 'task', estimatedHours: 1 }),
      allocations,
      '2026-01-01',
      1,
    );
    expect(result.allocations).toMatchObject([
      { id: 'a', date: '2026-01-01', allocatedHours: 9 },
      { id: 'b', date: '2026-01-02', allocatedHours: 2 },
    ]);
  });

  it('負向調整最低為 0，並保留該日期的 Allocation record', () => {
    const result = adjustAllocationDay(
      task({ id: 'task' }),
      [{ id: 'a', taskId: 'task', date: '2026-01-01', allocatedHours: 1 }],
      '2026-01-01',
      -2,
    );
    expect(result.allocations).toEqual([
      { id: 'a', taskId: 'task', date: '2026-01-01', allocatedHours: 0 },
    ]);
  });

  it('空白日期負向調整不建立 0h Allocation', () => {
    const allocations: Allocation[] = [
      { id: 'a', taskId: 'task', date: '2026-01-01', allocatedHours: 2 },
    ];

    expect(adjustAllocationDay(task({ id: 'task' }), allocations, '2026-01-02', -1)).toEqual({
      allocations,
    });
  });

  it('拖回 Backlog 只清除 Allocation，保留日期與 deadline metadata', () => {
    const result = returnTaskToBacklog(
      task({ id: 'task', start: '2026-01-01', end: '2026-01-10', deadline: '2026-01-08' }),
    );
    expect(result.task).toMatchObject({
      status: 'backlog',
      start: '2026-01-01',
      end: '2026-01-10',
      deadline: '2026-01-08',
    });
    expect(result.allocations).toEqual([]);
  });

  it('Deadline 只根據正 Allocation 的最後日期警告', () => {
    const overdueTask = task({ id: 'task', end: '2099-01-01', deadline: '2026-01-05' });
    expect(isTaskOverdue(overdueTask, [])).toBe(false);
    expect(
      isTaskOverdue(overdueTask, [
        { id: 'a', taskId: 'task', date: '2026-01-06', allocatedHours: 0 },
      ]),
    ).toBe(false);
    expect(
      isTaskOverdue(overdueTask, [
        { id: 'b', taskId: 'task', date: '2026-01-06', allocatedHours: 1 },
      ]),
    ).toBe(true);
  });

  it('使用 UTC 日期運算處理跨月範圍', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(datesBetween('2026-01-30', '2026-02-02')).toEqual([
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
    ]);
  });

  it('接受可由 db migration 處理的舊版匯入 envelope', () => {
    expect(validateImport({ schema: 'gantt-local', version: 1, projects: [] })).toBe(false);
    expect(
      validateImport({
        schema: 'gantt-capacity-local',
        version: 2,
        exportedAt: 'now',
        projects: [],
        allocations: [],
      }),
    ).toBe(true);
    expect(
      validateImport({
        schema: 'gantt-capacity-local',
        version: 99,
        exportedAt: 'now',
        projects: [],
        allocations: [],
      }),
    ).toBe(false);
  });
});
