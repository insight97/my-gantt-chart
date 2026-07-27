import type {Allocation, DailyCapacity, Task, WorkspaceData} from './types';

const DAY_MS=86400000;
export const DEFAULT_PLANNING_HORIZON_DAYS=180;

export interface AllocationResult {
 allocations:Allocation[];
 start:string|null;
 end:string|null;
}

export interface AllocationValidation {
 valid:boolean;
 message?:string;
}

export interface RecalculateOptions {
 fillPending?:boolean;
 horizonDays?:number;
}

export function capacityAvailableHours(totalCapacityHours:number, unavailableHours:number){
 return Math.max(0,totalCapacityHours-unavailableHours);
}

export function normalizeCapacity(capacity:DailyCapacity):DailyCapacity{
 return {...capacity,availableHours:capacityAvailableHours(capacity.totalCapacityHours,capacity.unavailableHours)};
}

export function getProjectEstimatedHours(project:Pick<{tasks:Task[]},'tasks'>){
 return project.tasks.reduce((sum,task)=>sum+Math.max(0,task.estimatedHours),0);
}

export function getTaskAllocatedHours(taskId:string,allocations:Allocation[],source?:Allocation['source']){
 return allocations
  .filter(allocation=>allocation.taskId===taskId&&(!source||allocation.source===source))
  .reduce((sum,allocation)=>sum+allocation.allocatedHours,0);
}

export function getTaskPendingHours(task:Task,allocations:Allocation[]){
 return task.estimatedHours-getTaskAllocatedHours(task.id,allocations);
}

export function getTaskManualDates(taskId:string,allocations:Allocation[]){
 return new Set(allocations.filter(item=>item.taskId===taskId&&item.source==='manual').map(item=>item.date));
}

export function getDailyAllocatedHours(date:string,allocations:Allocation[],excludeTaskId?:string){
 return allocations
  .filter(allocation=>allocation.date===date&&allocation.taskId!==excludeTaskId)
  .reduce((sum,allocation)=>sum+allocation.allocatedHours,0);
}

export function getDailyCapacity(date:string,capacities:DailyCapacity[],fallbackHours=8){
 const existing=capacities.find(capacity=>capacity.date===date);
 return existing?normalizeCapacity(existing):{
  date,
  totalCapacityHours:fallbackHours,
  unavailableHours:0,
  availableHours:fallbackHours,
 };
}

export function getRemainingCapacity(date:string,capacities:DailyCapacity[],allocations:Allocation[],excludeTaskId?:string){
 const capacity=getDailyCapacity(date,capacities);
 return capacity.availableHours-getDailyAllocatedHours(date,allocations,excludeTaskId);
}

export function datesBetween(start:string,end:string){
 const first=new Date(`${start}T00:00:00Z`).getTime();
 const last=new Date(`${end}T00:00:00Z`).getTime();
 if(last<first)return [];
 return Array.from({length:Math.floor((last-first)/DAY_MS)+1},(_,index)=>addDays(start,index));
}

export function daysBetween(start:string,end:string){
 const first=new Date(`${start}T00:00:00Z`).getTime();
 const last=new Date(`${end}T00:00:00Z`).getTime();
 return Math.round((last-first)/DAY_MS);
}

export function addDays(date:string,days:number){
 const value=new Date(`${date}T00:00:00Z`);
 value.setUTCDate(value.getUTCDate()+days);
 return value.toISOString().slice(0,10);
}

export function today(){
 return new Date().toISOString().slice(0,10);
}

function taskPositiveDates(taskId:string,allocations:Allocation[]){
 return allocations
  .filter(item=>item.taskId===taskId&&item.allocatedHours>0)
  .map(item=>item.date)
  .sort();
}

function derivedRange(taskId:string,allocations:Allocation[]):Pick<AllocationResult,'start'|'end'>{
 const dates=taskPositiveDates(taskId,allocations);
 return {start:dates[0]||null,end:dates.at(-1)||null};
}

export function validateTaskDateRange(task:Task,allocations:Allocation[]):AllocationValidation{
 const manual=allocations.filter(allocation=>allocation.taskId===task.id&&allocation.source==='manual');
 if(!manual.length)return {valid:true};
 const outside=manual.find(allocation=>(task.start&&allocation.date<task.start)||(task.end&&allocation.date>task.end));
 return outside
  ? {valid:false,message:`日期範圍不可排除人工分配日期 ${outside.date}。`}
  : {valid:true};
}

function createAutomaticAllocation(taskId:string,date:string,hours:number):Allocation{
 return {id:crypto.randomUUID(),taskId,date,allocatedHours:hours,source:'automatic',locked:false};
}

function forwardDates(start:string,count:number){
 return Array.from({length:Math.max(1,count)},(_,index)=>addDays(start,index));
}

function mergeAutomaticHours(allocations:Allocation[],taskId:string,date:string,hours:number){
 if(hours<=0)return;
 const existing=allocations.find(item=>item.taskId===taskId&&item.date===date&&item.source==='automatic');
 if(existing){
  existing.allocatedHours+=hours;
  return;
 }
 allocations.push(createAutomaticAllocation(taskId,date,hours));
}

function removeAutomaticHours(allocations:Allocation[],taskId:string,hours:number){
 let remaining=hours;
 const automatic=allocations
  .filter(item=>item.taskId===taskId&&item.source==='automatic')
  .sort((a,b)=>b.date.localeCompare(a.date));
 for(const allocation of automatic){
  if(remaining<=0)break;
  const removed=Math.min(remaining,allocation.allocatedHours);
  allocation.allocatedHours-=removed;
  remaining-=removed;
 }
 return allocations.filter(item=>item.allocatedHours>0||item.source==='manual');
}

function automaticTailDate(
 taskId:string,
 allocations:Allocation[],
 capacities:DailyCapacity[],
 manualDates:Set<string>,
 startDate:string,
 horizonDays:number,
){
 const taskDates=taskPositiveDates(taskId,allocations);
 const automaticDates=allocations.filter(item=>item.taskId===taskId&&item.source==='automatic').map(item=>item.date).sort();
 const base=automaticDates.at(-1)||taskDates.at(-1)||startDate;
 const otherAllocations=allocations.filter(item=>item.taskId!==taskId);
 const search=forwardDates(base,horizonDays);
 return search.find(date=>!manualDates.has(date)&&getRemainingCapacity(date,capacities,[...otherAllocations,...allocations.filter(item=>item.taskId===taskId)])>0)
  ||search.find(date=>!manualDates.has(date))
  ||base;
}

function appendAutomaticHours(
 taskId:string,
 allocations:Allocation[],
 capacities:DailyCapacity[],
 manualDates:Set<string>,
 startDate:string,
 hours:number,
 horizonDays:number,
){
 let remaining=hours;
 const otherAllocations=allocations.filter(item=>item.taskId!==taskId);
 const taskDates=taskPositiveDates(taskId,allocations);
 const automaticDates=allocations.filter(item=>item.taskId===taskId&&item.source==='automatic').map(item=>item.date).sort();
 const base=automaticDates.at(-1)||taskDates.at(-1)||startDate;
 for(const date of forwardDates(base,horizonDays)){
  if(remaining<=0)break;
  if(manualDates.has(date))continue;
  const available=getRemainingCapacity(date,capacities,otherAllocations.concat(allocations.filter(item=>item.taskId===taskId)));
  if(available<=0)continue;
  const hoursForDate=Math.min(remaining,available);
  mergeAutomaticHours(allocations,taskId,date,hoursForDate);
  remaining-=hoursForDate;
 }
 if(remaining>0){
  const overflow=automaticTailDate(taskId,allocations,capacities,manualDates,startDate,horizonDays);
  mergeAutomaticHours(allocations,taskId,overflow,remaining);
 }
}

export function recalculateAutomaticAllocations(
 task:Task,
 allocations:Allocation[],
 capacities:DailyCapacity[],
 startDate=today(),
 options:RecalculateOptions={},
):AllocationResult{
 const fillPending=options.fillPending??true;
 const horizonDays=options.horizonDays??DEFAULT_PLANNING_HORIZON_DAYS;
 const taskAllocations=allocations.filter(allocation=>allocation.taskId===task.id);
 const validation=validateTaskDateRange(task,allocations);
 if(!validation.valid)throw new Error(validation.message);
 const manual=taskAllocations.filter(allocation=>allocation.source==='manual');
 const manualDates=new Set(manual.map(item=>item.date));
 const manualHours=getTaskAllocatedHours(task.id,manual);
 const existingAutomaticHours=taskAllocations
  .filter(item=>item.source==='automatic'&&!manualDates.has(item.date))
  .reduce((sum,item)=>sum+item.allocatedHours,0);
 const automaticHours=fillPending
  ?Math.max(0,task.estimatedHours-manualHours)
  :existingAutomaticHours;
 const otherAllocations=allocations.filter(item=>item.taskId!==task.id);
 const anchor=[...manualDates].sort()[0]||task.start||startDate;
 const resultAllocations=[...manual];
 const searchEnd=Math.max(horizonDays,taskPositiveDates(task.id,allocations).length?daysBetween(anchor,taskPositiveDates(task.id,allocations).at(-1)!)+1:0);
 const searchDates=forwardDates(anchor,searchEnd);
 let remaining=automaticHours;
 for(const date of searchDates){
  if(remaining<=0)break;
  if(manualDates.has(date))continue;
  const available=getRemainingCapacity(date,capacities,otherAllocations);
  if(available<=0)continue;
  const hours=Math.min(remaining,available);
  resultAllocations.push(createAutomaticAllocation(task.id,date,hours));
  remaining-=hours;
 }
 if(remaining>0){
  const overflowCandidates=searchDates.filter(date=>!manualDates.has(date));
  const overflow=overflowCandidates.at(-1)||anchor;
  mergeAutomaticHours(resultAllocations,task.id,overflow,remaining);
 }
 return {allocations:resultAllocations,...derivedRange(task.id,resultAllocations)};
}

export function adjustManualAllocationDay(
 task:Task,
 allocations:Allocation[],
 capacities:DailyCapacity[],
 date:string,
 delta:number,
 startDate=today(),
 options:RecalculateOptions={},
):AllocationResult{
 if(!delta)return {allocations, ...derivedRange(task.id,allocations)};
 const taskAllocations=allocations.filter(item=>item.taskId===task.id);
 const currentDayHours=taskAllocations.filter(item=>item.date===date).reduce((sum,item)=>sum+item.allocatedHours,0);
 const actualDelta=Math.max(0,currentDayHours+delta)-currentDayHours;
 const currentTotal=getTaskAllocatedHours(task.id,allocations);
 const pending=task.estimatedHours-currentTotal;
 const next=allocations.filter(item=>!(item.taskId===task.id&&item.date===date));
 const manualDates=new Set(taskAllocations.filter(item=>item.source==='manual').map(item=>item.date));
 manualDates.add(date);
 next.push({id:taskAllocations.find(item=>item.taskId===task.id&&item.date===date&&item.source==='manual')?.id||crypto.randomUUID(),taskId:task.id,date,allocatedHours:Math.max(0,currentDayHours+delta),source:'manual',locked:true});

 if(!actualDelta)return {allocations:next,...derivedRange(task.id,next)};

 if(actualDelta>0){
  const borrow=pending>0?Math.max(0,actualDelta-pending):pending===0?actualDelta:0;
  const adjusted=removeAutomaticHours(next,task.id,borrow);
  return {allocations:adjusted,...derivedRange(task.id,adjusted)};
 }

 if(pending<0){
  return {allocations:next,...derivedRange(task.id,next)};
 }

 appendAutomaticHours(task.id,next,capacities,manualDates,task.start||startDate,-actualDelta,options.horizonDays??DEFAULT_PLANNING_HORIZON_DAYS);
 return {allocations:next,...derivedRange(task.id,next)};
}

export function trimManualAllocationsToEstimate(taskId:string,allocations:Allocation[],estimatedHours:number){
 const manualHours=getTaskAllocatedHours(taskId,allocations,'manual');
 let excess=Math.max(0,manualHours-estimatedHours);
 if(!excess)return allocations;
 const next=allocations.map(item=>({...item}));
 const manual=next.filter(item=>item.taskId===taskId&&item.source==='manual').sort((a,b)=>b.date.localeCompare(a.date));
 for(const allocation of manual){
  if(excess<=0)break;
  const reduced=Math.min(excess,allocation.allocatedHours);
  allocation.allocatedHours-=reduced;
  excess-=reduced;
 }
 return next;
}

export function recalculateWorkspace(data:WorkspaceData):WorkspaceData{
 let allocations=[...data.allocations];
 const projects=data.projects.map(project=>({...project,tasks:project.tasks.map(task=>({...task}))}));
 for(const project of projects){
  for(const task of project.tasks){
   if(!allocations.some(allocation=>allocation.taskId===task.id&&allocation.source==='automatic'))continue;
   const result=recalculateAutomaticAllocations(task,allocations,data.dailyCapacities,today(),{fillPending:false});
   allocations=[...allocations.filter(allocation=>allocation.taskId!==task.id),...result.allocations];
   task.start=result.start;
   task.end=result.end;
   if(task.status==='backlog')task.status='scheduled';
   task.updatedAt=new Date().toISOString();
  }
 }
 return {...data,projects,allocations};
}
