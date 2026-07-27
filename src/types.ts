// Schema version of WorkspaceData/ExportFile. The one place a future field addition
// that isn't safely defaultable bumps — db.ts's migrateWorkspace and data.ts's
// validation import it instead of each holding their own copy of the number.
export const CURRENT_WORKSPACE_VERSION = 2;

export type ViewMode = 'day' | 'week' | 'month';
export type AllocationMode = 'general' | 'allocate';
export type AllocationStrategy = 'fastest' | 'balanced';
export type TaskStatus = 'backlog' | 'scheduled' | 'in_progress' | 'completed';
export type TaskPriority = 'low' | 'medium' | 'high';
export type AllocationSource = 'automatic' | 'manual';

export interface Task {
  id: string;
  name: string;
  start: string | null;
  end: string | null;
  deadline: string | null;
  estimatedHours: number;
  allocationStrategy: AllocationStrategy;
  priority: TaskPriority;
  status: TaskStatus;
  notes: string;
  owner: string;
  color: string;
  createdAt: string;
  updatedAt: string;
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
  source: AllocationSource;
  locked: boolean;
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
