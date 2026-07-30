import { describe, expect, it } from 'vitest';
import {
  aggregateTaskAllocations,
  aggregateTaskEstimate,
  flattenTaskTree,
  emptyTask,
  taskDepth,
  taskHasChildren,
} from './data';
import {
  adjustAllocationDay,
  autoScheduleTask,
  moveTask,
  moveTaskToTimeline,
  moveTaskToTimelineAsChild,
  saveTask,
} from './workspace-operations';
import type { Allocation, Project, Task, WorkspaceData } from './types';

const workItem = (id: string, parentId: string | null = null, estimatedHours = 0): Task => ({
  ...emptyTask(),
  id,
  name: id,
  parentId,
  estimatedHours,
  order: 0,
});

const workspace = (tasks: Task[], allocations: Allocation[] = []): WorkspaceData => ({
  version: 3,
  projects: [
    {
      id: 'workspace-root',
      name: '工作項目',
      description: '',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      tasks,
    } satisfies Project,
  ],
  dailyCapacities: [],
  allocations,
});

describe('階層工作項目', () => {
  it('以 parentId 建立預排序樹，且父項目彙總後代工時', () => {
    const tasks = [
      workItem('root'),
      workItem('child', 'root', 5),
      workItem('grandchild', 'child', 7),
    ];
    const allocations: Allocation[] = [
      { id: 'a', taskId: 'child', date: '2026-01-01', allocatedHours: 2 },
      { id: 'b', taskId: 'grandchild', date: '2026-01-02', allocatedHours: 3 },
    ];

    expect(flattenTaskTree(tasks, new Set(['root', 'child'])).map(item => item.task.id)).toEqual([
      'root',
      'child',
      'grandchild',
    ]);
    expect(taskDepth(tasks, 'grandchild')).toBe(3);
    expect(taskHasChildren(tasks, 'root')).toBe(true);
    expect(aggregateTaskEstimate('root', tasks)).toBe(7);
    expect(aggregateTaskAllocations('root', tasks, allocations)).toHaveLength(2);
  });

  it('inside 目標會把整個來源子樹改掛到目標下', () => {
    const result = moveTask(
      workspace([workItem('root-a'), workItem('root-b'), workItem('child', 'root-a')]),
      'workspace-root',
      'root-a',
      'root-b',
      'inside',
    );
    expect(result.ok && result.changed && result.workspace.projects[0].tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'root-a', parentId: 'root-b' }),
        expect.objectContaining({ id: 'child', parentId: 'root-a' }),
      ]),
    );
  });

  it('從 Backlog 拖入 Timeline 的父項目時，會排程並保留在 Timeline', () => {
    const parent = workItem('parent');
    parent.status = 'scheduled';
    const child = workItem('child', null, 4);
    const result = moveTaskToTimelineAsChild(
      workspace([parent, child]),
      'workspace-root',
      'child',
      'parent',
    );

    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok || !result.changed) return;
    const savedChild = result.workspace.projects[0].tasks.find(task => task.id === 'child');
    expect(savedChild).toMatchObject({ parentId: 'parent', status: 'scheduled' });
    expect(result.workspace.allocations.some(allocation => allocation.taskId === 'child')).toBe(
      true,
    );
  });

  it('從 Backlog 拖到 Timeline 前後落點時，也會排程並保留排序位置', () => {
    const target = workItem('target');
    target.status = 'scheduled';
    target.order = 4;
    const source = workItem('source', null, 4);
    source.order = 8;
    const result = moveTaskToTimeline(
      workspace([target, source]),
      'workspace-root',
      'source',
      'target',
      'before',
    );

    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok || !result.changed) return;
    const tasks = result.workspace.projects[0].tasks;
    expect(tasks.find(task => task.id === 'source')).toMatchObject({
      status: 'scheduled',
      parentId: null,
      order: 0,
    });
    expect(tasks.find(task => task.id === 'target')).toMatchObject({ order: 1 });
    expect(result.workspace.allocations.some(allocation => allocation.taskId === 'source')).toBe(
      true,
    );
  });

  it('禁止超過三層或把節點移入自己的子樹', () => {
    const tasks = [workItem('a'), workItem('b', 'a'), workItem('c', 'b')];
    expect(moveTask(workspace(tasks), 'workspace-root', 'a', 'c', 'inside')).toMatchObject({
      ok: false,
    });
    expect(moveTask(workspace(tasks), 'workspace-root', 'a', 'c', 'before')).toMatchObject({
      ok: false,
    });
  });

  it('父項目不能直接排程或修改日工時', () => {
    const tasks = [workItem('parent'), workItem('leaf', 'parent', 8)];
    expect(autoScheduleTask(workspace(tasks), 'workspace-root', 'parent')).toMatchObject({
      ok: false,
    });
    expect(
      adjustAllocationDay(workspace(tasks), 'workspace-root', 'parent', '2026-01-01', 1),
    ).toMatchObject({ ok: false });
  });

  it('新增子任務時將父項目既有工作保留為未拆分工作', () => {
    const parent = workItem('parent', null, 12);
    parent.status = 'scheduled';
    parent.deadline = '2026-02-10';
    const allocation = {
      id: 'parent-allocation',
      taskId: parent.id,
      date: '2026-02-03',
      allocatedHours: 4,
    };
    const child = workItem('new-child', parent.id, 4);
    child.deadline = parent.deadline;

    const result = saveTask(workspace([parent], [allocation]), 'workspace-root', child);

    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok || !result.changed) return;
    const nextTasks = result.workspace.projects[0].tasks;
    const unsplit = nextTasks.find(task => task.name === '未拆分工作');
    expect(unsplit).toMatchObject({
      parentId: parent.id,
      estimatedHours: parent.estimatedHours,
      deadline: parent.deadline,
      status: parent.status,
    });
    expect(result.workspace.allocations).toEqual([
      expect.objectContaining({ id: allocation.id, taskId: unsplit?.id }),
    ]);
    expect(nextTasks).toEqual(expect.arrayContaining([expect.objectContaining({ id: child.id })]));
  });

  it('父項目只有預估工時但尚未分配時新增子任務不建立未拆分工作', () => {
    const parent = workItem('parent', null, 12);
    const child = workItem('new-child', parent.id, 4);
    const zeroAllocation = {
      id: 'zero-allocation',
      taskId: parent.id,
      date: '2026-02-03',
      allocatedHours: 0,
    };

    const result = saveTask(workspace([parent], [zeroAllocation]), 'workspace-root', child);

    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok || !result.changed) return;
    const nextTasks = result.workspace.projects[0].tasks;
    expect(nextTasks).toHaveLength(2);
    expect(nextTasks.some(task => task.name === '未拆分工作')).toBe(false);
    expect(result.workspace.allocations).toEqual([zeroAllocation]);
    expect(nextTasks).toEqual(expect.arrayContaining([expect.objectContaining({ id: child.id })]));
  });

  it('父節點截止日期不可晚於子任務截止日期', () => {
    const parent = workItem('parent');
    parent.deadline = '2026-02-10';
    const child = workItem('child', parent.id);
    child.deadline = '2026-02-11';

    expect(saveTask(workspace([parent], []), 'workspace-root', child)).toMatchObject({
      ok: false,
      error: '「child」的截止日期不可晚於父任務「parent」。',
    });
  });

  it('拖曳工作到父節點時同樣保留父節點既有工作', () => {
    const parent = workItem('parent', null, 8);
    parent.status = 'scheduled';
    const source = workItem('source', null, 4);
    source.status = 'scheduled';
    const parentAllocation = {
      id: 'parent-allocation',
      taskId: parent.id,
      date: '2026-02-03',
      allocatedHours: 2,
    };
    const sourceAllocation = {
      id: 'source-allocation',
      taskId: source.id,
      date: '2026-02-04',
      allocatedHours: 4,
    };

    const result = moveTask(
      workspace([parent, source], [parentAllocation, sourceAllocation]),
      'workspace-root',
      source.id,
      parent.id,
      'inside',
    );

    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok || !result.changed) return;
    const nextTasks = result.workspace.projects[0].tasks;
    const unsplit = nextTasks.find(task => task.name === '未拆分工作');
    expect(unsplit).toMatchObject({ parentId: parent.id, estimatedHours: parent.estimatedHours });
    expect(nextTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: source.id, parentId: parent.id }),
        expect.objectContaining({ id: unsplit?.id, parentId: parent.id }),
      ]),
    );
    expect(result.workspace.allocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: parentAllocation.id, taskId: unsplit?.id }),
        expect.objectContaining({ id: sourceAllocation.id, taskId: source.id }),
      ]),
    );
  });

  it('拖曳工作到尚未分配工時的父節點時不建立未拆分工作', () => {
    const parent = workItem('parent', null, 8);
    parent.status = 'scheduled';
    const source = workItem('source', null, 4);
    const zeroAllocation = {
      id: 'zero-allocation',
      taskId: parent.id,
      date: '2026-02-03',
      allocatedHours: 0,
    };

    const result = moveTask(
      workspace([parent, source], [zeroAllocation]),
      'workspace-root',
      source.id,
      parent.id,
      'inside',
    );

    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok || !result.changed) return;
    const nextTasks = result.workspace.projects[0].tasks;
    expect(nextTasks).toHaveLength(2);
    expect(nextTasks.some(task => task.name === '未拆分工作')).toBe(false);
    expect(nextTasks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: source.id, parentId: parent.id })]),
    );
    expect(result.workspace.allocations).toEqual([zeroAllocation]);
  });
});
