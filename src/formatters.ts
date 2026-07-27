import type { Task, TaskPriority } from './types';

export const priorityLabels: Record<TaskPriority, string> = { high: '高', medium: '中', low: '低' };
export const priorityOrder: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

export function compactDateLabel(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('zh-TW', {
    month: 'numeric',
    day: 'numeric',
  });
}

export function weekdayDateLabel(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });
}

export function hourValueLabel(hours: number) {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(/\.0$/, '');
}

export function hoursLabel(hours: number) {
  return `${hourValueLabel(hours)}h`;
}

export function formatRange(task: Task) {
  if (task.start && task.end) return `${task.start} → ${task.end}`;
  if (task.start) return `${task.start} → 未設定`;
  if (task.end) return `未設定 → ${task.end}`;
  return '尚未設定日期';
}
