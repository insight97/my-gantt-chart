import type { Task } from './types';

type ParentOverride = ReadonlyMap<string, string | null>;

export type TaskTreeIndex = {
  task: (taskId: string) => Task | undefined;
  parentId: (taskId: string) => string | null;
  children: (parentId: string | null) => Task[];
  hasChildren: (taskId: string) => boolean;
  depth: (taskId: string) => number;
  descendants: (taskId: string) => Set<string>;
  leafDescendants: (taskId: string) => Task[];
  flatten: (expandedIds: Set<string>) => Array<{ task: Task; depth: number }>;
  flattenIncluded: (includedIds: Set<string>, expandedIds: Set<string>) => Task[];
};

/** Builds one reusable hierarchy view for a task array. */
export function buildTaskTree(tasks: Task[], parentOverride: ParentOverride = new Map()) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const parentById = new Map<string, string | null>();
  const childrenByParent = new Map<string | null, Task[]>();

  for (const task of tasks) {
    const parentId = parentOverride.has(task.id)
      ? (parentOverride.get(task.id) ?? null)
      : (task.parentId ?? null);
    parentById.set(task.id, parentId);
    const children = childrenByParent.get(parentId) || [];
    children.push(task);
    childrenByParent.set(parentId, children);
  }
  for (const children of childrenByParent.values())
    children.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const depthCache = new Map<string, number>();
  const descendantsCache = new Map<string, Set<string>>();
  const children = (parentId: string | null) => [...(childrenByParent.get(parentId) || [])];
  const parentId = (taskId: string) => parentById.get(taskId) ?? null;
  const depth = (taskId: string) => {
    const cached = depthCache.get(taskId);
    if (cached !== undefined) return cached;
    let currentId: string | null = taskId;
    let result = 0;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      if (!byId.has(currentId)) break;
      result += 1;
      currentId = parentById.get(currentId) ?? null;
    }
    depthCache.set(taskId, result);
    return result;
  };
  const descendants = (taskId: string) => {
    const cached = descendantsCache.get(taskId);
    if (cached) return new Set(cached);
    const result = new Set<string>();
    const pending = children(taskId);
    while (pending.length) {
      const child = pending.shift()!;
      if (result.has(child.id)) continue;
      result.add(child.id);
      pending.push(...children(child.id));
    }
    descendantsCache.set(taskId, result);
    return new Set(result);
  };
  const hasChildren = (taskId: string) => (childrenByParent.get(taskId)?.length || 0) > 0;
  const leafDescendants = (taskId: string) => {
    const result: Task[] = [];
    const visit = (currentId: string) => {
      const currentChildren = children(currentId);
      if (!currentChildren.length) {
        const current = byId.get(currentId);
        if (current) result.push(current);
        return;
      }
      currentChildren.forEach(child => visit(child.id));
    };
    visit(taskId);
    return result;
  };
  const flatten = (expandedIds: Set<string>) => {
    const result: Array<{ task: Task; depth: number }> = [];
    const visit = (parent: string | null, currentDepth: number) => {
      for (const task of children(parent)) {
        result.push({ task, depth: currentDepth });
        if (expandedIds.has(task.id)) visit(task.id, currentDepth + 1);
      }
    };
    visit(null, 1);
    return result;
  };
  const flattenIncluded = (includedIds: Set<string>, expandedIds: Set<string>) => {
    const result: Task[] = [];
    const visit = (parent: string | null) => {
      for (const task of children(parent)) {
        if (!includedIds.has(task.id)) continue;
        result.push(task);
        if (expandedIds.has(task.id)) visit(task.id);
      }
    };
    visit(null);
    return result;
  };

  return {
    task: (taskId: string) => byId.get(taskId),
    parentId,
    children,
    hasChildren,
    depth,
    descendants,
    leafDescendants,
    flatten,
    flattenIncluded,
  } satisfies TaskTreeIndex;
}
