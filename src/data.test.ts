import { describe, expect, it } from 'vitest';
import {
  addDays,
  adjustAllocationDay,
  capacityAvailableHours,
  datesBetween,
  getDailyAllocatedHours,
  getProjectEstimatedHours,
  getRemainingCapacity,
  getTaskAllocatedHours,
  getTaskPendingHours,
  isTaskOverdue,
  recalculateAutomaticAllocations,
  recalculateTaskSchedule,
  returnTaskToBacklog,
  scheduleTaskAt,
} from './capacity';
import { emptyTask, partitionProjectTasks, validateImport } from './data';
import type { Allocation, DailyCapacity, Project, Task } from './types';

const capacity = (date: string, total = 8, unavailable = 0): DailyCapacity => ({
  date,
  totalCapacityHours: total,
  unavailableHours: unavailable,
  availableHours: total - unavailable,
});

const task = (overrides: Partial<Task> = {}): Task => ({ ...emptyTask(), ...overrides });

describe('容量 domain', () => {
  it('計算每日可用與剩餘容量', () => {
    const capacities = [capacity('2026-01-01', 8, 2)];
    const allocations: Allocation[] = [
      { id: 'a', taskId: 'other', date: '2026-01-01', allocatedHours: 3 },
    ];
    expect(capacityAvailableHours(8, 2)).toBe(6);
    expect(getDailyAllocatedHours('2026-01-01', allocations)).toBe(3);
    expect(getRemainingCapacity('2026-01-01', capacities, allocations)).toBe(3);
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
      [capacity('2026-01-01', 8), capacity('2026-01-02', 8)],
    );
    expect(result.allocations.map(item => [item.date, item.allocatedHours])).toEqual([
      ['2026-01-01', 8],
      ['2026-01-02', 6],
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
      [capacity('2026-01-01')],
    );
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]).toMatchObject({
      taskId: 'task',
      date: '2026-01-01',
      allocatedHours: 6,
    });
    expect(result.allocations.some(item => item.id === old.id)).toBe(false);
  });

  it('沒有容量時保留 Pending Hours，不建立 overflow Allocation', () => {
    const result = recalculateAutomaticAllocations(
      task({ id: 'task', start: '2026-01-01', estimatedHours: 20 }),
      [],
      [capacity('2026-01-01', 8), capacity('2026-01-02', 0)],
      '2026-01-01',
      { horizonDays: 2 },
    );
    expect(getTaskAllocatedHours('task', result.allocations)).toBe(8);
    expect(getTaskPendingHours(task({ id: 'task', estimatedHours: 20 }), result.allocations)).toBe(
      12,
    );
    expect(result.allocations.every(item => item.allocatedHours <= 8)).toBe(true);
  });

  it('沒有容量時仍把已明確自動排程的 Task 留在 Timeline', () => {
    const scheduled = scheduleTaskAt(
      task({ id: 'task', estimatedHours: 8 }),
      [],
      [capacity('2026-01-01', 0)],
      '2026-01-01',
      { horizonDays: 1 },
    ).task;
    const result = partitionProjectTasks({ tasks: [scheduled] } as Project);
    expect(result.scheduled.map(item => item.id)).toEqual(['task']);
  });

  it('Backlog 優先依 stable order 排序，並以優先級作為 fallback', () => {
    const first = task({ id: 'first', order: 2, priority: 'high' });
    const second = task({ id: 'second', order: 1, priority: 'low' });
    const result = partitionProjectTasks({ tasks: [first, second] } as Project);

    expect(result.backlog.map(item => item.id)).toEqual(['second', 'first']);
  });

  it('排程保留 end metadata，end 不限制實際 Allocation 日期', () => {
    const result = scheduleTaskAt(
      task({ id: 'task', end: '2026-01-01', estimatedHours: 12 }),
      [],
      [capacity('2026-01-01', 8), capacity('2026-01-02', 8)],
      '2026-01-01',
    );
    expect(result.task).toMatchObject({ start: '2026-01-01', end: '2026-01-01' });
    expect(result.allocations.map(item => item.date)).toEqual(['2026-01-01', '2026-01-02']);
  });

  it('沒有 start 時使用明確排程 anchor，並保留其他 metadata', () => {
    const result = recalculateTaskSchedule(
      task({ id: 'task', deadline: '2026-01-10', estimatedHours: 10 }),
      [],
      [capacity('2026-01-05', 8), capacity('2026-01-06', 8)],
      '2026-01-05',
    );
    expect(result.task.start).toBe('2026-01-05');
    expect(result.task.deadline).toBe('2026-01-10');
    expect(result.allocations.map(item => item.allocatedHours)).toEqual([8, 2]);
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
        dailyCapacities: [],
        allocations: [],
      }),
    ).toBe(true);
    expect(
      validateImport({
        schema: 'gantt-capacity-local',
        version: 99,
        exportedAt: 'now',
        projects: [],
        dailyCapacities: [],
        allocations: [],
      }),
    ).toBe(false);
  });
});
