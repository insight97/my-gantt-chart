import { describe, expect, it } from 'vitest';
import { emptyTask } from './data';
import { DEFAULT_TASK_COLOR, resolveTaskColors, TASK_COLOR_OPTIONS } from './task-colors';
import type { Task } from './types';

const task = (id: string, parentId: string | null, color: string | null): Task => ({
  ...emptyTask(),
  id,
  name: id,
  parentId,
  color,
});

describe('Task colors', () => {
  it('uses the light macaron palette for the built-in task colors', () => {
    expect(TASK_COLOR_OPTIONS.map(option => option.value)).toEqual([
      '#5eb1ef',
      '#53b9ab',
      '#5bb98b',
      '#be93e4',
      '#ec9455',
      '#eb8e90',
      '#d5ae39',
      '#b9bbc6',
    ]);
  });

  it('inherits the nearest explicit ancestor color through multiple levels', () => {
    const colors = resolveTaskColors([
      task('root', null, '#5bb98b'),
      task('child', 'root', null),
      task('grandchild', 'child', null),
    ]);

    expect(colors.get('root')).toBe('#5bb98b');
    expect(colors.get('child')).toBe('#5bb98b');
    expect(colors.get('grandchild')).toBe('#5bb98b');
  });

  it('keeps an explicit child color and lets its descendants inherit that override', () => {
    const colors = resolveTaskColors([
      task('root', null, '#5bb98b'),
      task('child', 'root', '#eb8e90'),
      task('grandchild', 'child', null),
      task('default-root', null, null),
    ]);

    expect(colors.get('child')).toBe('#eb8e90');
    expect(colors.get('grandchild')).toBe('#eb8e90');
    expect(colors.get('default-root')).toBe(DEFAULT_TASK_COLOR);
  });
});
