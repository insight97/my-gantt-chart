import type { Task } from './types';

export const DEFAULT_TASK_COLOR = '#2f75bb';

export const TASK_COLOR_OPTIONS = [
  { name: '藍色', value: DEFAULT_TASK_COLOR },
  { name: '青色', value: '#4f9aa3' },
  { name: '綠色', value: '#5d9b63' },
  { name: '紫色', value: '#8b6fb5' },
  { name: '橘色', value: '#d48b45' },
  { name: '紅色', value: '#c85f5f' },
  { name: '金色', value: '#c09a38' },
  { name: '灰色', value: '#6f7f8f' },
] as const;

const TASK_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function normalizeTaskColor(value: unknown): string | null {
  return typeof value === 'string' && TASK_COLOR_PATTERN.test(value) ? value.toLowerCase() : null;
}

/** Resolves every Task to its nearest explicit ancestor color, or the app default. */
export function resolveTaskColors(tasks: readonly Task[]): ReadonlyMap<string, string> {
  const tasksById = new Map(tasks.map(task => [task.id, task]));
  const colors = new Map<string, string>();
  const resolving = new Set<string>();

  const resolve = (taskId: string): string => {
    const cached = colors.get(taskId);
    if (cached) return cached;
    const task = tasksById.get(taskId);
    if (!task || resolving.has(taskId)) return DEFAULT_TASK_COLOR;

    resolving.add(taskId);
    const explicit = normalizeTaskColor(task.color);
    const parentId = task.parentId ?? null;
    const color = explicit ?? (parentId ? resolve(parentId) : DEFAULT_TASK_COLOR);
    resolving.delete(taskId);
    colors.set(taskId, color);
    return color;
  };

  for (const task of tasks) resolve(task.id);
  return colors;
}

export function resolveTaskColor(taskId: string, tasks: readonly Task[]): string {
  return resolveTaskColors(tasks).get(taskId) ?? DEFAULT_TASK_COLOR;
}
