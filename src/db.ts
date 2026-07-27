import { normalizeWorkspaceData, now, sampleWorkspace, uid } from './data';
import { addDays, datesBetween, defaultDailyCapacity, normalizeCapacity, today } from './capacity';
import type { DailyCapacity, Project, Task, WorkspaceData } from './types';

const DB = 'gantt-local-db';
const VERSION = 2;
const WORKSPACE_STORE = 'workspace';
const LEGACY_STORE = 'projects';
const WORKSPACE_ID = 'workspace';

interface WorkspaceRecord extends WorkspaceData {
  id: string;
}

let connection: Promise<IDBDatabase> | null = null;

function open() {
  // Saves are debounced on every workspace edit; reuse one connection instead of opening per write.
  if (!connection) {
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB, VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(WORKSPACE_STORE))
          request.result.createObjectStore(WORKSPACE_STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(error => {
      connection = null;
      throw error;
    });
  }
  return connection;
}

function readAll<T>(db: IDBDatabase, storeName: string) {
  return new Promise<T[]>((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

function readOne<T>(db: IDBDatabase, storeName: string, key: string) {
  return new Promise<T | undefined>((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

function migrateTask(value: Partial<Task> & Record<string, unknown>): Task {
  const timestamp = now();
  return {
    id: typeof value.id === 'string' ? value.id : uid(),
    name: typeof value.name === 'string' ? value.name : '未命名工作',
    start: typeof value.start === 'string' ? value.start : null,
    end: typeof value.end === 'string' ? value.end : null,
    deadline: typeof value.deadline === 'string' ? value.deadline : null,
    estimatedHours: 0,
    allocationStrategy: value.allocationStrategy === 'balanced' ? 'balanced' : 'fastest',
    priority:
      value.priority === 'low' || value.priority === 'high' || value.priority === 'medium'
        ? value.priority
        : 'medium',
    status: 'backlog',
    notes: typeof value.notes === 'string' ? value.notes : '',
    owner: typeof value.owner === 'string' ? value.owner : '',
    color: typeof value.color === 'string' ? value.color : '#2f75bb',
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : timestamp,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : timestamp,
  };
}

function migrateProject(value: Record<string, unknown>): Project {
  const timestamp = now();
  const tasks = Array.isArray(value.tasks)
    ? value.tasks.map(task => migrateTask((task || {}) as Partial<Task> & Record<string, unknown>))
    : [];
  return {
    id: typeof value.id === 'string' ? value.id : uid(),
    name: typeof value.name === 'string' ? value.name : '未命名專案',
    description: typeof value.description === 'string' ? value.description : '',
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : timestamp,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : timestamp,
    tasks,
  };
}

function migrationCapacities(projects: Project[]): DailyCapacity[] {
  const dates = projects
    .flatMap(project =>
      project.tasks.flatMap(task =>
        [task.start, task.end].filter((date): date is string => typeof date === 'string'),
      ),
    )
    .sort();
  const first = dates[0] || today();
  const last = dates.at(-1) || addDays(first, 45);
  return datesBetween(first, last).map(date => defaultDailyCapacity(date));
}

function migrateLegacyProjects(value: unknown): WorkspaceData {
  const projects = Array.isArray(value)
    ? value
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map(migrateProject)
    : [];
  return { version: 2, projects, dailyCapacities: migrationCapacities(projects), allocations: [] };
}

function normalizeWorkspace(value: WorkspaceData): WorkspaceData {
  return normalizeWorkspaceData({
    version: 2,
    projects: value.projects,
    dailyCapacities: value.dailyCapacities.map(normalizeCapacity),
    allocations: value.allocations,
  });
}

export async function loadWorkspace() {
  const db = await open();
  const stored = await readOne<WorkspaceRecord>(db, WORKSPACE_STORE, WORKSPACE_ID);
  if (stored) return normalizeWorkspace(stored);
  if (db.objectStoreNames.contains(LEGACY_STORE)) {
    const legacy = await readAll<unknown>(db, LEGACY_STORE);
    if (legacy.length) return migrateLegacyProjects(legacy);
  }
  return null;
}

export async function saveWorkspace(value: WorkspaceData) {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(WORKSPACE_STORE, 'readwrite');
    transaction
      .objectStore(WORKSPACE_STORE)
      .put({ id: WORKSPACE_ID, ...normalizeWorkspace(value) } satisfies WorkspaceRecord);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export function createEmptyWorkspace(): WorkspaceData {
  return sampleWorkspace();
}
