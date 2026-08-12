import { describe, expect, it } from 'vitest';
import { emptyTask } from './data';
import { DEFAULT_TASK_COLOR, resolveTaskColors } from './task-colors';
import type { Task } from './types';

const task = (id: string, parentId: string | null, color: string | null): Task => ({
  ...emptyTask(),
  id,
  name: id,
  parentId,
  color,
});

describe('Task colors', () => {
  it('inherits the nearest explicit ancestor color through multiple levels', () => {
    const colors = resolveTaskColors([
      task('root', null, '#5d9b63'),
      task('child', 'root', null),
      task('grandchild', 'child', null),
    ]);

    expect(colors.get('root')).toBe('#5d9b63');
    expect(colors.get('child')).toBe('#5d9b63');
    expect(colors.get('grandchild')).toBe('#5d9b63');
  });

  it('keeps an explicit child color and lets its descendants inherit that override', () => {
    const colors = resolveTaskColors([
      task('root', null, '#5d9b63'),
      task('child', 'root', '#c85f5f'),
      task('grandchild', 'child', null),
      task('default-root', null, null),
    ]);

    expect(colors.get('child')).toBe('#c85f5f');
    expect(colors.get('grandchild')).toBe('#c85f5f');
    expect(colors.get('default-root')).toBe(DEFAULT_TASK_COLOR);
  });
});
