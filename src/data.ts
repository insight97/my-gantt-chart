import type {ExportFile, Project, Task, ViewMode, WorkspaceData} from './types';
import {addDays as addCapacityDays, datesBetween} from './capacity';

export const uid=()=>crypto.randomUUID();
export const addDays=addCapacityDays;
export {datesBetween};

const offsetDate=(offset:number)=>addDays(new Date().toISOString().slice(0,10),offset);
const now=()=>new Date().toISOString();

export const emptyTask=():Task=>({
 id:uid(),
 name:'新工作',
 start:null,
 end:null,
 estimatedHours:8,
 status:'backlog',
 notes:'',
 owner:'',
 color:'#2f75bb',
 createdAt:now(),
 updatedAt:now(),
});

export const sampleProject=():Project=>{
 const createdAt=now();
 return {
  id:uid(),
  name:'網站改版計畫',
  description:'Capacity Gantt 範例工作群組',
  createdAt,
  updatedAt:createdAt,
  tasks:[
   {...emptyTask(),name:'整理需求與訪談',estimatedHours:12},
   {...emptyTask(),name:'介面設計',start:offsetDate(1),end:offsetDate(4),estimatedHours:20},
   {...emptyTask(),name:'第一版開發',start:offsetDate(5),end:offsetDate(10),estimatedHours:32},
  ],
 };
};

export function sampleWorkspace():WorkspaceData{
 const start=offsetDate(-2);
 const project=sampleProject();
 return {
  version:2,
  projects:[project],
  dailyCapacities:datesBetween(start,offsetDate(45)).map(date=>({date,totalCapacityHours:8,unavailableHours:0,availableHours:8})),
  allocations:[],
 };
}

const statuses=new Set(['backlog','scheduled','in_progress','completed']);
const sources=new Set(['automatic','manual']);
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const isDate=(value:unknown):value is string=>typeof value==='string'&&datePattern.test(value);
const isNullableDate=(value:unknown):value is string|null=>value===null||isDate(value);

function validTask(value:unknown):value is Task{
 if(!value||typeof value!=='object')return false;
 const task=value as Partial<Task>;
 return typeof task.id==='string'
  &&typeof task.name==='string'
  &&isNullableDate(task.start)
  &&isNullableDate(task.end)
  &&typeof task.estimatedHours==='number'
  &&Number.isFinite(task.estimatedHours)
  &&task.estimatedHours>=0
  &&typeof task.status==='string'
  &&statuses.has(task.status)
  &&typeof task.createdAt==='string'
  &&typeof task.updatedAt==='string';
}

function validProject(value:unknown):value is Project{
 if(!value||typeof value!=='object')return false;
 const project=value as Partial<Project>;
 return typeof project.id==='string'
  &&typeof project.name==='string'
  &&typeof project.description==='string'
  &&typeof project.createdAt==='string'
  &&typeof project.updatedAt==='string'
  &&Array.isArray(project.tasks)
  &&project.tasks.every(validTask);
}

export function validateImport(value:unknown):value is ExportFile{
 if(!value||typeof value!=='object')return false;
 const file=value as Partial<ExportFile>;
 if(file.schema!=='gantt-capacity-local'||file.version!==2||typeof file.exportedAt!=='string')return false;
 if(!Array.isArray(file.projects)||!file.projects.every(validProject))return false;
 if(!Array.isArray(file.dailyCapacities)||!file.dailyCapacities.every(capacity=>{
  if(!capacity||typeof capacity!=='object')return false;
  const value=capacity as unknown as Record<string,unknown>;
  return isDate(value.date)
   &&typeof value.totalCapacityHours==='number'
   &&value.totalCapacityHours>=0
   &&typeof value.unavailableHours==='number'
   &&value.unavailableHours>=0
   &&typeof value.availableHours==='number';
 }))return false;
 return Array.isArray(file.allocations)&&file.allocations.every(allocation=>{
  if(!allocation||typeof allocation!=='object')return false;
  const value=allocation as unknown as Record<string,unknown>;
  return typeof value.id==='string'
   &&typeof value.taskId==='string'
   &&isDate(value.date)
   &&typeof value.allocatedHours==='number'
   &&Number.isFinite(value.allocatedHours)
   &&value.allocatedHours>0
   &&typeof value.source==='string'
   &&sources.has(value.source)
   &&typeof value.locked==='boolean';
 });
}

export type TaskDragMode='move'|'start'|'end';

function shiftTaskDate(date:string,delta:number,view:ViewMode){
 if(view!=='month')return addDays(date,delta*(view==='week'?7:1));
 const value=new Date(`${date}T00:00:00Z`);
 const day=value.getUTCDate();
 value.setUTCDate(1);
 value.setUTCMonth(value.getUTCMonth()+delta);
 const lastDay=new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth()+1,0)).getUTCDate();
 value.setUTCDate(Math.min(day,lastDay));
 return value.toISOString().slice(0,10);
}

export function applyTaskDrag(task:Task,mode:TaskDragMode,delta:number,view:ViewMode='day'){
 if(!task.start||!task.end)return task;
 if(mode==='move')return {...task,start:shiftTaskDate(task.start,delta,view),end:shiftTaskDate(task.end,delta,view)};
 if(mode==='start'){
  const start=shiftTaskDate(task.start,delta,view);
  return {...task,start:start<=task.end?start:task.end};
 }
 const end=shiftTaskDate(task.end,delta,view);
 return {...task,end:end>=task.start?end:task.start};
}
