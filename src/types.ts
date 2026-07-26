export type ViewMode = 'day' | 'week' | 'month';
export interface Task { id:string; name:string; start:string; end:string; progress:number; owner:string; color:string; notes:string; milestone:boolean; dependencies:string[] }
export interface Project { id:string; name:string; description:string; createdAt:string; updatedAt:string; tasks:Task[] }
export interface ExportFile { schema:'gantt-local'; version:1; exportedAt:string; projects:Project[] }
