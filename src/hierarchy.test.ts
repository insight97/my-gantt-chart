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
  moveTaskToTimelineAsChild,
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
});
