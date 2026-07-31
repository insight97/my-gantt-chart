import { describe, expect, it } from 'vitest';
import { emptyTask } from './data';
import { buildTaskTree } from './task-tree';
import type { Task } from './types';

const task = (id: string, parentId: string | null = null, order = 0): Task => ({
  ...emptyTask(),
  id,
  parentId,
  order,
});

describe('task tree index', () => {
  it('reuses one ordered hierarchy for depth, descendants, leaves, and flattening', () => {
    const tree = buildTaskTree([
      task('child-b', 'root', 1),
      task('root', null, 0),
      task('grandchild', 'child-a', 0),
      task('child-a', 'root', 0),
    ]);

    expect(tree.children(null).map(item => item.id)).toEqual(['root']);
    expect(tree.children('root').map(item => item.id)).toEqual(['child-a', 'child-b']);
    expect(tree.depth('root')).toBe(1);
    expect(tree.depth('grandchild')).toBe(3);
    expect(tree.descendants('root')).toEqual(new Set(['child-a', 'child-b', 'grandchild']));
    expect(tree.leafDescendants('root').map(item => item.id)).toEqual(['grandchild', 'child-b']);
    expect(tree.flatten(new Set(['root', 'child-a']))).toEqual([
      { task: expect.objectContaining({ id: 'root' }), depth: 1 },
      { task: expect.objectContaining({ id: 'child-a' }), depth: 2 },
      { task: expect.objectContaining({ id: 'grandchild' }), depth: 3 },
      { task: expect.objectContaining({ id: 'child-b' }), depth: 2 },
    ]);
  });

  it('supports a temporary parent override without mutating tasks', () => {
    const tasks = [task('root'), task('other'), task('child', 'other')];
    const tree = buildTaskTree(tasks, new Map([['child', 'root']]));

    expect(tree.parentId('child')).toBe('root');
    expect(tree.children('root').map(item => item.id)).toEqual(['child']);
    expect(tasks.find(item => item.id === 'child')?.parentId).toBe('other');
  });

  it('returns defensive descendant sets', () => {
    const tree = buildTaskTree([task('root'), task('child', 'root')]);
    const descendants = tree.descendants('root');
    descendants.clear();
    expect(tree.descendants('root')).toEqual(new Set(['child']));
  });
});
