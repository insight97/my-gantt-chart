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
import { emptyTask, validateImport, validWorkspaceData } from './data';
import { CURRENT_WORKSPACE_VERSION } from './types';
import type { Allocation, Project, Task, WorkspaceData } from './types';

const task = (overrides: Partial<Task> = {}): Task => ({
  ...emptyTask(),
  ...overrides,
  ...(Object.prototype.hasOwnProperty.call(overrides, 'estimatedHours') &&
  overrides.estimatedHoursMode === undefined
    ? { estimatedHoursMode: 'manual' as const }
    : {}),
});

describe('容量 domain', () => {
  it('新工作項目的預設預估工時為 0', () => {
    expect(emptyTask().estimatedHours).toBe(0);
    expect(emptyTask().estimatedHoursMode).toBe('auto');
  });

  it('自動預估工時跟隨已安排工時，且尚未安排時列為待安排', () => {
    const unplanned = task({ id: 'unplanned', estimatedHoursMode: 'auto' });
    const planned = task({ id: 'planned', estimatedHoursMode: 'auto' });
    const allocations = [
      { id: 'planned-allocation', taskId: planned.id, date: '2026-01-01', allocatedHours: 4 },
    ];

    expect(getTaskPendingHours(planned, allocations)).toBe(0);
    expect(
      getWorkspaceCapacityMetrics(
        [{ ...({} as Project), tasks: [unplanned, planned] }],
        allocations,
        '2026-01-01',
      ).pendingTaskCount,
    ).toBe(1);
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

  it('rejects duplicate, orphaned, cyclic, and over-depth Work Item hierarchy', () => {
    const workspace = (tasks: Task[]): WorkspaceData => ({
      version: CURRENT_WORKSPACE_VERSION,
      projects: [
        {
          id: 'project',
          name: 'Project',
          description: '',
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
          tasks,
        },
      ],
      allocations: [],
    });
    const root = task({ id: 'root', parentId: null, order: 0 });

    expect(validWorkspaceData(workspace([root, { ...root }]))).toBe(false);
    expect(
      validWorkspaceData(workspace([root, task({ id: 'orphan', parentId: 'missing', order: 0 })])),
    ).toBe(false);
    expect(
      validWorkspaceData(
        workspace([
          task({ id: 'cycle-a', parentId: 'cycle-b', order: 0 }),
          task({ id: 'cycle-b', parentId: 'cycle-a', order: 0 }),
        ]),
      ),
    ).toBe(false);
    expect(
      validWorkspaceData(
        workspace([
          root,
          task({ id: 'level-2', parentId: 'root', order: 0 }),
          task({ id: 'level-3', parentId: 'level-2', order: 0 }),
          task({ id: 'level-4', parentId: 'level-3', order: 0 }),
        ]),
      ),
    ).toBe(false);
  });
});
