// Schema version of WorkspaceData/ExportFile. The one place a future field addition
// that isn't safely defaultable bumps — db.ts's migrateWorkspace and data.ts's
// validation import it instead of each holding their own copy of the number.
export const CURRENT_WORKSPACE_VERSION = 3;

export type ViewMode = 'day' | 'week' | 'month';
export type TaskStatus = 'backlog' | 'scheduled' | 'in_progress' | 'completed';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface Task {
  id: string;
  name: string;
  /** @deprecated Kept only so old exports can be migrated without data loss. */
  start: string | null;
  /** @deprecated Kept only so old exports can be migrated without data loss. */
  end: string | null;
  deadline: string | null;
  estimatedHours: number;
  priority: TaskPriority;
  status: TaskStatus;
  notes: string;
  owner: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  /** Null means this is a root work item. */
  parentId?: string | null;
  /** Stable sibling ordering; old data falls back to array order. */
  order?: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  tasks: Task[];
}

export interface DailyCapacity {
  date: string;
  totalCapacityHours: number;
  unavailableHours: number;
  availableHours: number;
}

export interface Allocation {
  id: string;
  taskId: string;
  date: string;
  allocatedHours: number;
}

export interface WorkspaceData {
  version: typeof CURRENT_WORKSPACE_VERSION;
  projects: Project[];
  dailyCapacities: DailyCapacity[];
  allocations: Allocation[];
}

export interface ExportFile extends WorkspaceData {
  schema: 'gantt-capacity-local';
  exportedAt: string;
}
