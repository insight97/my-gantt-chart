import { describe, expect, it } from 'vitest';
import { backlogDropRelation, taskRowDropRelation } from './task-drag';

describe('task row drop relation', () => {
  it('uses the next row as the only insertion boundary between adjacent tasks', () => {
    expect(taskRowDropRelation(58, 70, false)).toBe('inside');
    expect(taskRowDropRelation(4, 70, false)).toBe('before');
  });

  it('keeps an explicit after position only at the end of the visible list', () => {
    expect(taskRowDropRelation(66, 70, true)).toBe('after');
    expect(taskRowDropRelation(66, 70, false)).toBe('inside');
  });

  it('uses the upper and lower halves of a Backlog card as sorting targets', () => {
    expect(backlogDropRelation(20, 70)).toBe('before');
    expect(backlogDropRelation(50, 70)).toBe('after');
  });
});
