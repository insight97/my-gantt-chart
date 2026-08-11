import { normalizeWorkspaceData, now, sampleWorkspace, uid, validWorkspaceData } from './data';
import type { Project, Task, WorkspaceData } from './types';
import { CURRENT_WORKSPACE_VERSION } from './types';
import { normalizeRecurrenceRule } from './recurrence';

const DB = 'gantt-local-db';
// IndexedDB's own store-schema version — bumps only when object stores are added or
// removed. Unrelated to CURRENT_WORKSPACE_VERSION, which versions the JSON payload.
const IDB_VERSION = 2;
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
      const request = indexedDB.open(DB, IDB_VERSION);
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

function migrateTask(value: Partial<Task> & Record<string, unknown>, order = 0): Task {
  const timestamp = now();
  return {
    id: typeof value.id === 'string' ? value.id : uid(),
    name: typeof value.name === 'string' ? value.name : '未命名工作',
    start: typeof value.start === 'string' ? value.start : null,
    end: typeof value.end === 'string' ? value.end : null,
    deadline: typeof value.deadline === 'string' ? value.deadline : null,
    estimatedHours:
      typeof value.estimatedHours === 'number' && Number.isFinite(value.estimatedHours)
        ? Math.max(0, value.estimatedHours)
        : 0,
    estimatedHoursMode: value.estimatedHoursMode === 'auto' ? 'auto' : 'manual',
    priority:
      value.priority === 'low' || value.priority === 'high' || value.priority === 'medium'
        ? value.priority
        : 'medium',
    status:
      value.status === 'scheduled' || value.status === 'in_progress' || value.status === 'completed'
        ? value.status
        : 'backlog',
    notes: typeof value.notes === 'string' ? value.notes : '',
    owner: typeof value.owner === 'string' ? value.owner : '',
    color: typeof value.color === 'string' ? value.color : '#2f75bb',
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : timestamp,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : timestamp,
    parentId: typeof value.parentId === 'string' ? value.parentId : null,
    order: typeof value.order === 'number' && Number.isFinite(value.order) ? value.order : order,
    recurrence: normalizeRecurrenceRule(value.recurrence),
  };
}

function migrateProject(value: Record<string, unknown>): Project {
  const timestamp = now();
  const tasks = Array.isArray(value.tasks)
    ? value.tasks.map((task, index) =>
        migrateTask((task || {}) as Partial<Task> & Record<string, unknown>, index),
      )
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

function migrateLegacyProjects(value: unknown): WorkspaceData {
  const sourceProjects = Array.isArray(value)
    ? value
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map(migrateProject)
    : [];
  const projects = mergeProjects(sourceProjects);
  return {
    version: CURRENT_WORKSPACE_VERSION,
    projects,
    allocations: [],
  };
}

/** Projects were only a storage grouping. The current model has one invisible workspace root. */
function mergeProjects(projects: Project[]): Project[] {
  const tasks = projects
    .flatMap(project => project.tasks)
    .map(task => ({
      ...task,
      parentId: task.parentId ?? null,
      order: task.order ?? 0,
    }));
  if (!tasks.length && !projects.length) return [];
  const timestamp = now();
  return [
    {
      id: 'workspace-root',
      name: '工作項目',
      description: '',
      createdAt: projects[0]?.createdAt || timestamp,
      updatedAt: timestamp,
      tasks,
    },
  ];
}

/**
 * Brings any stored or imported payload up to the current WorkspaceData shape: the
 * unversioned pre-workspace project list (the `LEGACY_STORE` format), or a workspace
 * object that may be missing fields added since it was written. The only place that
 * derives the next Task/Project shape from raw data, so a future schema version adds
 * one branch here instead of touching the IDB upgrade, the version literal, and the
 * validator independently. Never trusts an incoming `version` field — always
 * re-derives and re-stamps the current one.
 */
export function migrateWorkspace(raw: unknown): WorkspaceData {
  if (Array.isArray(raw)) return migrateLegacyProjects(raw);
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<WorkspaceData>;
  const projects = Array.isArray(value.projects)
    ? value.projects.map(project => migrateProject(project as unknown as Record<string, unknown>))
    : [];
  return normalizeWorkspaceData({
    version: CURRENT_WORKSPACE_VERSION,
    projects: mergeProjects(projects),
    allocations: Array.isArray(value.allocations) ? value.allocations : [],
  });
}

export async function loadWorkspace() {
  const db = await open();
  const stored = await readOne<WorkspaceRecord>(db, WORKSPACE_STORE, WORKSPACE_ID);
  if (stored) {
    const migrated = migrateWorkspace(stored);
    if (!validWorkspaceData(migrated)) throw new Error('工作區資料結構不正確。');
    return migrated;
  }
  if (db.objectStoreNames.contains(LEGACY_STORE)) {
    const legacy = await readAll<unknown>(db, LEGACY_STORE);
    if (legacy.length) {
      const migrated = migrateWorkspace(legacy);
      if (!validWorkspaceData(migrated)) throw new Error('工作區資料結構不正確。');
      return migrated;
    }
  }
  return null;
}

export async function saveWorkspace(value: WorkspaceData) {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(WORKSPACE_STORE, 'readwrite');
    transaction
      .objectStore(WORKSPACE_STORE)
      .put({ id: WORKSPACE_ID, ...migrateWorkspace(value) } satisfies WorkspaceRecord);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export function createEmptyWorkspace(): WorkspaceData {
  return sampleWorkspace();
}
