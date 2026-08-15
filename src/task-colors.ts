import type { Task } from './types';

export const DEFAULT_TASK_COLOR = '#5eb1ef';

export const TASK_COLOR_OPTIONS = [
  { name: '藍色', value: DEFAULT_TASK_COLOR },
  { name: '青色', value: '#53b9ab' },
  { name: '綠色', value: '#5bb98b' },
  { name: '紫色', value: '#be93e4' },
  { name: '橘色', value: '#ec9455' },
  { name: '紅色', value: '#eb8e90' },
  { name: '金色', value: '#d5ae39' },
  { name: '灰色', value: '#b9bbc6' },
] as const;

const TASK_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const LEGACY_DEFAULT_TASK_COLOR = '#2f75bb';
const LEGACY_TASK_COLOR_MAP: Readonly<Record<string, string>> = {
  '#2f75bb': '#5eb1ef',
  '#4f9aa3': '#53b9ab',
  '#5d9b63': '#5bb98b',
  '#8b6fb5': '#be93e4',
  '#d48b45': '#ec9455',
  '#c85f5f': '#eb8e90',
  '#c09a38': '#d5ae39',
  '#6f7f8f': '#b9bbc6',
};

export function normalizeTaskColor(value: unknown): string | null {
  return typeof value === 'string' && TASK_COLOR_PATTERN.test(value) ? value.toLowerCase() : null;
}

export function migrateTaskColor(value: unknown): string | null {
  const normalized = normalizeTaskColor(value);
  return normalized ? (LEGACY_TASK_COLOR_MAP[normalized] ?? normalized) : null;
}

export function isLegacyDefaultTaskColor(value: unknown): boolean {
  return normalizeTaskColor(value) === LEGACY_DEFAULT_TASK_COLOR;
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
