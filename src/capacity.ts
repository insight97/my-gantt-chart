import type {Allocation, DailyCapacity, Task, WorkspaceData} from './types';

const DAY_MS=86400000;

export interface AllocationResult {
 allocations:Allocation[];
 start:string|null;
 end:string|null;
}

export interface AllocationValidation {
 valid:boolean;
 message?:string;
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

export function getTaskRemainingHours(task:Task,allocations:Allocation[]){
 return Math.max(0,task.estimatedHours-getTaskAllocatedHours(task.id,allocations));
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

function distributeEvenly(taskId:string,dates:string,hours:number,allocations:Allocation[],capacities:DailyCapacity[]):Allocation[];
function distributeEvenly(taskId:string,dates:string[],hours:number,allocations:Allocation[],capacities:DailyCapacity[]):Allocation[];
function distributeEvenly(taskId:string,dates:string|string[],hours:number,allocations:Allocation[],capacities:DailyCapacity[]):Allocation[]{
 const candidates=(Array.isArray(dates)?dates:[dates]).filter(date=>getRemainingCapacity(date,capacities,allocations)>0);
 const targetDates=candidates.length?candidates:(Array.isArray(dates)?dates:[dates]);
 if(!targetDates.length||hours<=0)return [];
 const share=hours/targetDates.length;
 return targetDates.map(date=>createAutomaticAllocation(taskId,date,share));
}

function forwardDates(start:string,count:number){
 return Array.from({length:count},(_,index)=>addDays(start,index));
}

export function recalculateAutomaticAllocations(
 task:Task,
 allocations:Allocation[],
 capacities:DailyCapacity[],
 startDate=today(),
):AllocationResult{
 const taskAllocations=allocations.filter(allocation=>allocation.taskId===task.id);
 const manual=taskAllocations.filter(allocation=>allocation.source==='manual');
 const validation=validateTaskDateRange(task,allocations);
 if(!validation.valid)throw new Error(validation.message);

 const manualHours=getTaskAllocatedHours(task.id,manual);
 if(manualHours>task.estimatedHours){
  throw new Error('人工分配工時不可超過 Task 預估工時。');
 }
 const remainingHours=task.estimatedHours-manualHours;
 const otherAllocations=allocations.filter(allocation=>allocation.taskId!==task.id||allocation.source==='manual');
 if(remainingHours===0)return {allocations:manual,start:task.start,end:task.end};

 if(task.start&&task.end){
  const dates=datesBetween(task.start,task.end);
  const automatic=distributeEvenly(task.id,dates,remainingHours,otherAllocations,capacities);
  return {allocations:[...manual,...automatic],start:task.start,end:task.end};
 }

 const generatedDates=forwardDates(task.start||startDate,Math.max(1,Math.ceil(remainingHours/8)+30));
 const automatic:Allocation[]=[];
 let remaining=remainingHours;
 for(const date of generatedDates){
  if(remaining<=0)break;
  const capacity=Math.max(0,getRemainingCapacity(date,capacities,otherAllocations));
  if(capacity<=0)continue;
  const hours=Math.min(remaining,capacity);
  automatic.push(createAutomaticAllocation(task.id,date,hours));
  remaining-=hours;
 }
 if(remaining>0){
  const overflowDates=generatedDates.filter(date=>getDailyCapacity(date,capacities).availableHours>0);
  const fallback=overflowDates.length?overflowDates:[generatedDates[0]];
  automatic.push(...distributeEvenly(task.id,fallback,remaining,otherAllocations,capacities));
 }
 const all=[...manual,...automatic].map(allocation=>allocation.date).sort();
 return {allocations:[...manual,...automatic],start:all[0]||task.start,end:all.at(-1)||task.end};
}

export function recalculateWorkspace(data:WorkspaceData):WorkspaceData{
 let allocations=[...data.allocations];
 const projects=data.projects.map(project=>({...project,tasks:project.tasks.map(task=>({...task}))}));
 for(const project of projects){
  for(const task of project.tasks){
   if(!allocations.some(allocation=>allocation.taskId===task.id))continue;
   const result=recalculateAutomaticAllocations(task,allocations,data.dailyCapacities);
   allocations=[...allocations.filter(allocation=>allocation.taskId!==task.id),...result.allocations];
   task.start=result.start;
   task.end=result.end;
   if(task.status==='backlog')task.status='scheduled';
   task.updatedAt=new Date().toISOString();
  }
 }
 return {...data,projects,allocations};
}
