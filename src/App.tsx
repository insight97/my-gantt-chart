import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {ChangeEvent,CSSProperties,FormEvent,KeyboardEvent,PointerEvent} from 'react';
import {addDays,applyTaskDrag,datesBetween,emptyTask,uid,validateImport} from './data';
import {
 getDailyAllocatedHours,
 getDailyCapacity,
 getProjectEstimatedHours,
 getTaskAllocatedHours,
 recalculateAutomaticAllocations,
 recalculateWorkspace,
 validateTaskDateRange,
 daysBetween,
} from './capacity';
import {createEmptyWorkspace,loadWorkspace,saveWorkspace} from './db';
import type {Allocation,DailyCapacity,ExportFile,Project,Task,TaskStatus,ViewMode,WorkspaceData} from './types';

const clone=<T,>(value:T):T=>structuredClone(value);
const now=()=>new Date().toISOString();
const statusLabels:Record<TaskStatus,string>={backlog:'Backlog',scheduled:'已排程',in_progress:'進行中',completed:'已完成'};
type EditingTask={projectId:string;task:Task};
type AllocationTarget={projectId:string;taskId:string};

function download(data:string,name:string,type:string){
 const link=document.createElement('a');
 link.href=URL.createObjectURL(new Blob([data],{type}));
 link.download=name;
 link.click();
 URL.revokeObjectURL(link.href);
}

function dateLabel(date:string){
 return new Date(`${date}T00:00:00`).toLocaleDateString('zh-TW',{month:'numeric',day:'numeric',weekday:'short'});
}

function compactDateLabel(date:string){
 return new Date(`${date}T00:00:00`).toLocaleDateString('zh-TW',{month:'numeric',day:'numeric'});
}

function hoursLabel(hours:number){
 const value=Number.isInteger(hours)?String(hours):hours.toFixed(1).replace(/\.0$/,'');
 return `${value}h`;
}

function formatRange(task:Task){
 if(task.start&&task.end)return `${task.start} → ${task.end}`;
 if(task.start)return `${task.start} → 未設定`;
 if(task.end)return `未設定 → ${task.end}`;
 return '尚未設定日期';
}

export default function App(){
 const [workspace,setWorkspace]=useState<WorkspaceData|null>(null);
 const [expandedProjectIds,setExpandedProjectIds]=useState<Set<string>>(()=>new Set());
 const [view,setView]=useState<ViewMode>(()=>(localStorage.getItem('gantt-view') as ViewMode)||'week');
 const [ready,setReady]=useState(false);
 const [editingTask,setEditingTask]=useState<EditingTask|null>(null);
 const [allocationTarget,setAllocationTarget]=useState<AllocationTarget|null>(null);
 const [capacityDate,setCapacityDate]=useState<string|null>(null);
 const [notice,setNotice]=useState('');
 const [history,setHistory]=useState<WorkspaceData[]>([]);
 const [future,setFuture]=useState<WorkspaceData[]>([]);
 const fileRef=useRef<HTMLInputElement>(null);

 useEffect(()=>{
  let mounted=true;
  loadWorkspace().then(value=>{
   if(!mounted)return;
   const next=value||createEmptyWorkspace();
   setWorkspace(next);
   setExpandedProjectIds(new Set(next.projects.slice(0,1).map(item=>item.id)));
   setReady(true);
  }).catch(()=>setNotice('無法開啟瀏覽器本機資料庫。'));
  return()=>{mounted=false};
 },[]);

 useEffect(()=>{
  if(!workspace||!ready)return;
  const timer=setTimeout(()=>saveWorkspace(workspace).catch(()=>setNotice('自動儲存失敗，請先建立 JSON 備份。')),250);
  return()=>clearTimeout(timer);
 },[workspace,ready]);

 useEffect(()=>localStorage.setItem('gantt-view',view),[view]);

 const commit=(next:WorkspaceData)=>{
  if(!workspace)return;
  setHistory(items=>[...items.slice(-39),clone(workspace)]);
  setFuture([]);
  setWorkspace(next);
 };
 const patchProject=(projectId:string,fn:(value:Project)=>Project)=>{
  if(!workspace)return;
  commit({...workspace,projects:workspace.projects.map(item=>item.id===projectId?{...fn(item),updatedAt:now()}:item)});
 };
 const undo=()=>{
  if(!workspace||!history.length)return;
  const previous=history.at(-1)!;
  setFuture(items=>[clone(workspace),...items]);
  setHistory(items=>items.slice(0,-1));
  setWorkspace(previous);
 };
 const redo=()=>{
  if(!workspace||!future.length)return;
  const next=future[0];
  setHistory(items=>[...items,clone(workspace)]);
  setFuture(items=>items.slice(1));
  setWorkspace(next);
 };

 const addProject=()=>{
  if(!workspace)return;
  const timestamp=now();
  const next:Project={id:uid(),name:'未命名專案',description:'',createdAt:timestamp,updatedAt:timestamp,tasks:[]};
  commit({...workspace,projects:[...workspace.projects,next]});
  setExpandedProjectIds(ids=>new Set([...ids,next.id]));
 };

 const deleteProject=(projectId:string)=>{
  if(!workspace)return;
  const project=workspace.projects.find(item=>item.id===projectId);
  if(!project)return;
  if(workspace.projects.length===1)return setNotice('至少需要保留一個專案。');
  if(!confirm(`確定刪除「${project.name}」及其所有 Task？`))return;
  const taskIds=new Set(project.tasks.map(task=>task.id));
  const nextProjects=workspace.projects.filter(item=>item.id!==project.id);
  commit({...workspace,projects:nextProjects,allocations:workspace.allocations.filter(allocation=>!taskIds.has(allocation.taskId))});
  setExpandedProjectIds(ids=>{
   const next=new Set(ids);
   next.delete(projectId);
   return next;
  });
 };

 const addTask=(projectId:string)=>patchProject(projectId,projectValue=>({...projectValue,tasks:[...projectValue.tasks,emptyTask()]}));

 const saveTask=(projectId:string,draft:Task):string|null=>{
  if(!workspace)return '目前沒有可編輯的工作區。';
  const project=workspace.projects.find(item=>item.id===projectId);
  if(!project)return '找不到 Project。';
  if(!draft.name.trim())return '請輸入 Task 名稱。';
  if(draft.start&&draft.end&&draft.start>draft.end)return '結束日期不可早於開始日期。';
  const taskAllocations=workspace.allocations.filter(allocation=>allocation.taskId===draft.id);
  const rangeValidation=validateTaskDateRange(draft,workspace.allocations);
  if(!rangeValidation.valid)return rangeValidation.message||'日期範圍不可排除人工分配。';
  if(getTaskAllocatedHours(draft.id,taskAllocations,'manual')>draft.estimatedHours)return '預估工時不可小於人工分配工時。';
  let nextTask={...draft,name:draft.name.trim(),updatedAt:now()};
  let nextAllocations=workspace.allocations;
  try{
   if(taskAllocations.length){
    const result=recalculateAutomaticAllocations(nextTask,workspace.allocations,workspace.dailyCapacities);
    nextTask={...nextTask,start:result.start,end:result.end,status:nextTask.status==='backlog'?'scheduled':nextTask.status};
    nextAllocations=[...workspace.allocations.filter(allocation=>allocation.taskId!==draft.id),...result.allocations];
   }
  }catch(error){return error instanceof Error?error.message:'Task 更新失敗。';}
  commit({...workspace,projects:workspace.projects.map(item=>item.id===project.id?{...item,tasks:item.tasks.map(task=>task.id===draft.id?nextTask:task),updatedAt:now()}:item),allocations:nextAllocations});
  setEditingTask(null);
  return null;
 };

 const autoScheduleTask=(projectId:string,taskId:string)=>{
  if(!workspace)return;
  const project=workspace.projects.find(item=>item.id===projectId);
  if(!project)return;
  const task=project.tasks.find(item=>item.id===taskId);
  if(!task)return;
  try{
   const result=recalculateAutomaticAllocations(task,workspace.allocations,workspace.dailyCapacities);
   const nextTask:Task={...task,start:result.start,end:result.end,status:(task.status==='completed'?'completed':'scheduled') as TaskStatus,updatedAt:now()};
   commit({...workspace,projects:workspace.projects.map(item=>item.id===project.id?{...item,tasks:item.tasks.map(value=>value.id===task.id?nextTask:value),updatedAt:now()}:item),allocations:[...workspace.allocations.filter(allocation=>allocation.taskId!==task.id),...result.allocations]});
  }catch(error){setNotice(error instanceof Error?error.message:'自動分配失敗。');}
 };

 const saveManualAllocation=(projectId:string,taskId:string,date:string,hours:number):string|null=>{
  if(!workspace)return '目前沒有可編輯的工作區。';
  const project=workspace.projects.find(item=>item.id===projectId);
  if(!project)return '找不到 Project。';
  if(!date||!Number.isFinite(hours)||hours<=0)return '請輸入有效的日期與工時。';
  const task=project.tasks.find(item=>item.id===taskId);
  if(!task)return '找不到 Task。';
  const nextTask={...task};
  const knownDates=[task.start,task.end,date].filter((value):value is string=>Boolean(value)).sort();
  if(!task.start||!task.end){
   nextTask.start=knownDates[0];
   nextTask.end=knownDates.at(-1)||knownDates[0];
  }
  const nextAllocations=[...workspace.allocations,{id:uid(),taskId,date,allocatedHours:hours,source:'manual' as const,locked:true}];
  const validation=validateTaskDateRange(nextTask,nextAllocations);
  if(!validation.valid)return validation.message||'人工分配日期不在 Task 範圍內。';
  if(getTaskAllocatedHours(taskId,nextAllocations,'manual')>nextTask.estimatedHours)return '人工分配工時不可超過 Task 預估工時。';
  try{
   const result=recalculateAutomaticAllocations(nextTask,nextAllocations,workspace.dailyCapacities);
   const savedTask:Task={...nextTask,start:result.start,end:result.end,status:(task.status==='completed'?'completed':'scheduled') as TaskStatus,updatedAt:now()};
   commit({...workspace,projects:workspace.projects.map(item=>item.id===project.id?{...item,tasks:item.tasks.map(value=>value.id===taskId?savedTask:value),updatedAt:now()}:item),allocations:[...workspace.allocations.filter(allocation=>allocation.taskId!==taskId),...result.allocations]});
   setAllocationTarget(null);
   return null;
  }catch(error){return error instanceof Error?error.message:'人工分配失敗。';}
 };

 const deleteManualAllocation=(projectId:string,allocationId:string):string|null=>{
  if(!workspace)return '目前沒有可編輯的工作區。';
  const project=workspace.projects.find(item=>item.id===projectId);
  if(!project)return '找不到 Project。';
  const allocation=workspace.allocations.find(item=>item.id===allocationId);
  if(!allocation||allocation.source!=='manual')return '只能刪除人工分配。';
  const task=project.tasks.find(item=>item.id===allocation.taskId);
  if(!task)return '找不到 Task。';
  const remaining=workspace.allocations.filter(item=>item.id!==allocationId);
  try{
   const result=recalculateAutomaticAllocations(task,remaining,workspace.dailyCapacities);
   const nextTask:Task={...task,start:result.start,end:result.end,status:(result.allocations.length?(task.status==='completed'?'completed':'scheduled'):'backlog') as TaskStatus,updatedAt:now()};
   commit({...workspace,projects:workspace.projects.map(item=>item.id===project.id?{...item,tasks:item.tasks.map(value=>value.id===task.id?nextTask:value),updatedAt:now()}:item),allocations:[...remaining.filter(item=>item.taskId!==task.id),...result.allocations]});
   return null;
  }catch(error){return error instanceof Error?error.message:'刪除人工分配失敗。';}
 };

 const saveCapacity=(date:string,total:number,unavailable:number):string|null=>{
  if(!workspace||!Number.isFinite(total)||!Number.isFinite(unavailable)||total<0||unavailable<0)return '請輸入有效的容量數值。';
  const nextCapacity:DailyCapacity={date,totalCapacityHours:total,unavailableHours:unavailable,availableHours:Math.max(0,total-unavailable)};
  const capacities=workspace.dailyCapacities.some(item=>item.date===date)
   ?workspace.dailyCapacities.map(item=>item.date===date?nextCapacity:item)
   :[...workspace.dailyCapacities,nextCapacity].sort((a,b)=>a.date.localeCompare(b.date));
  try{
   const next=recalculateWorkspace({...workspace,dailyCapacities:capacities});
   commit(next);
   setCapacityDate(null);
   return null;
  }catch(error){return error instanceof Error?error.message:'容量更新失敗。';}
 };

 const deleteTask=(projectId:string,taskId:string)=>{
  if(!workspace||!confirm('確定刪除這個 Task 及其 Allocation？'))return;
  const project=workspace.projects.find(item=>item.id===projectId);
  if(!project)return;
  commit({...workspace,projects:workspace.projects.map(item=>item.id===project.id?{...item,tasks:item.tasks.filter(task=>task.id!==taskId),updatedAt:now()}:item),allocations:workspace.allocations.filter(allocation=>allocation.taskId!==taskId)});
 };

 const exportJson=()=>{
  if(!workspace)return;
  const file:ExportFile={schema:'gantt-capacity-local',version:2,exportedAt:now(),projects:workspace.projects,dailyCapacities:workspace.dailyCapacities,allocations:workspace.allocations};
  download(JSON.stringify(file,null,2),'capacity-gantt-backup.json','application/json');
  setNotice('JSON 備份已下載。');
 };

 const importJson=async(event:ChangeEvent<HTMLInputElement>)=>{
  const file=event.target.files?.[0];
  event.target.value='';
  if(!file)return;
  try{
   const value:unknown=JSON.parse(await file.text());
   if(!validateImport(value))throw new Error('檔案格式或版本不正確。');
   if(!confirm('匯入會取代目前工作區。請先確認已建立備份。'))return;
   commit(value);
   setExpandedProjectIds(new Set(value.projects.slice(0,1).map(item=>item.id)));
   setNotice('匯入完成。');
  }catch(error){setNotice(error instanceof Error?`匯入失敗：${error.message}`:'匯入失敗。');}
 };

 if(!ready||!workspace)return <main className="loading">正在開啟本機工作區…</main>;

 const allExpanded=workspace.projects.length>0&&workspace.projects.every(project=>expandedProjectIds.has(project.id));
 const toggleProject=(projectId:string)=>setExpandedProjectIds(ids=>{
  const next=new Set(ids);
  if(next.has(projectId))next.delete(projectId);else next.add(projectId);
  return next;
 });
 const expandAll=()=>setExpandedProjectIds(new Set(workspace.projects.map(project=>project.id)));
 const collapseAll=()=>setExpandedProjectIds(new Set());
 const editingProject=editingTask&&workspace.projects.find(project=>project.id===editingTask.projectId);
 const allocationProject=allocationTarget&&workspace.projects.find(project=>project.id===allocationTarget.projectId);
 const allocationTask=allocationProject&&allocationTarget&&allocationProject.tasks.find(task=>task.id===allocationTarget.taskId);

 return <div className="app">
  <header>
   <div className="brand"><span className="brandmark">容</span><div><b>Capacity Gantt</b><small>本機容量工作台</small></div></div>
   <div className="header-actions">
    <button onClick={undo} disabled={!history.length}>復原</button>
    <button onClick={redo} disabled={!future.length}>重做</button>
    <button onClick={exportJson}>建立備份</button>
    <button onClick={()=>fileRef.current?.click()}>匯入</button>
    <input ref={fileRef} hidden type="file" accept="application/json" onChange={importJson}/>
   </div>
  </header>
  <div className="local-note"><b>資料只儲存在這台裝置</b><span>請定期建立 JSON 備份。</span></div>
  {notice&&<div className="toast" role="status">{notice}<button aria-label="關閉通知" onClick={()=>setNotice('')}>×</button></div>}
  <main>
   <section className="project-list">
    <div className="project-list-toolbar">
     <div><h1>Projects</h1><p>{workspace.projects.length} 個 Project · 可在同一頁檢視、編輯與安排工作</p></div>
     <div className="project-list-actions"><button onClick={allExpanded?collapseAll:expandAll} disabled={!workspace.projects.length}>{allExpanded?'全部收合':'全部展開'}</button><button className="primary" onClick={addProject}>＋ 新增 Project</button></div>
    </div>
    {workspace.projects.length===0?<div className="empty-projects"><p>目前還沒有 Project。</p><button className="primary" onClick={addProject}>＋ 建立第一個 Project</button></div>:<div className="project-panels">{workspace.projects.map(project=>{
     const projectAllocations=workspace.allocations.filter(allocation=>project.tasks.some(task=>task.id===allocation.taskId));
     return <ProjectPanel key={project.id} project={project} allocations={projectAllocations} allAllocations={workspace.allocations} capacities={workspace.dailyCapacities} view={view} expanded={expandedProjectIds.has(project.id)} onToggle={()=>toggleProject(project.id)} onChange={fn=>patchProject(project.id,fn)} onDelete={()=>deleteProject(project.id)} onAddTask={()=>addTask(project.id)} onEditTask={task=>setEditingTask({projectId:project.id,task})} onAutoTask={taskId=>autoScheduleTask(project.id,taskId)} onAllocateTask={taskId=>setAllocationTarget({projectId:project.id,taskId})} onDeleteTask={taskId=>deleteTask(project.id,taskId)} onEditCapacity={setCapacityDate} onViewChange={setView} onChangeDates={next=>{
      const validation=validateTaskDateRange(next,workspace.allocations);
      if(!validation.valid){setNotice(validation.message||'日期範圍不可排除人工分配。');return;}
      const error=saveTask(project.id,next);
      if(error)setNotice(error);
     }}/>
    })}</div>}
   </section>
  </main>
  {editingTask&&editingProject&&<TaskDialog task={editingTask.task} allocations={workspace.allocations.filter(allocation=>allocation.taskId===editingTask.task.id)} onClose={()=>setEditingTask(null)} onSave={task=>saveTask(editingTask.projectId,task)}/>}
  {allocationTarget&&allocationProject&&allocationTask&&<AllocationDialog task={allocationTask} allocations={workspace.allocations.filter(allocation=>allocation.taskId===allocationTask.id)} onClose={()=>setAllocationTarget(null)} onSave={(taskId,date,hours)=>saveManualAllocation(allocationTarget.projectId,taskId,date,hours)} onDelete={allocationId=>deleteManualAllocation(allocationTarget.projectId,allocationId)}/>}
  {capacityDate&&<CapacityDialog date={capacityDate} capacity={getDailyCapacity(capacityDate,workspace.dailyCapacities)} onClose={()=>setCapacityDate(null)} onSave={saveCapacity}/>}
  <footer>Capacity Gantt · 所有資料皆留在您的瀏覽器 · <button onClick={exportJson}>立即備份</button></footer>
 </div>;
}

function ProjectPanel({project,allocations,allAllocations,capacities,view,expanded,onToggle,onChange,onDelete,onAddTask,onEditTask,onAutoTask,onAllocateTask,onDeleteTask,onEditCapacity,onViewChange,onChangeDates}:{project:Project;allocations:Allocation[];allAllocations:Allocation[];capacities:DailyCapacity[];view:ViewMode;expanded:boolean;onToggle:()=>void;onChange:(fn:(value:Project)=>Project)=>void;onDelete:()=>void;onAddTask:()=>void;onEditTask:(task:Task)=>void;onAutoTask:(taskId:string)=>void;onAllocateTask:(taskId:string)=>void;onDeleteTask:(taskId:string)=>void;onEditCapacity:(date:string)=>void;onViewChange:(view:ViewMode)=>void;onChangeDates:(task:Task)=>void}){
 const allocatedHours=allocations.reduce((sum,item)=>sum+item.allocatedHours,0);
 const backlogCount=project.tasks.filter(task=>!allocations.some(item=>item.taskId===task.id)).length;
 return <article className={`project-card${expanded?' expanded':' collapsed'}`}>
  <div className="project-card-header">
   <button className="project-toggle" type="button" aria-expanded={expanded} aria-label={`${expanded?'收合':'展開'} ${project.name}`} onClick={onToggle}><span aria-hidden="true">{expanded?'⌄':'›'}</span><small>Project</small></button>
   <div className="project-identity"><input aria-label={`${project.name} Project 名稱`} value={project.name} onChange={event=>onChange(value=>({...value,name:event.target.value}))}/><input aria-label={`${project.name} Project 說明`} value={project.description} placeholder="Project 說明…" onChange={event=>onChange(value=>({...value,description:event.target.value}))}/></div>
   <div className="project-summary"><span>{project.tasks.length} 個 Task</span><span>Backlog {backlogCount}</span><span>已分配 {hoursLabel(allocatedHours)} / {hoursLabel(getProjectEstimatedHours(project))}</span></div>
   <button className="danger project-delete" type="button" onClick={onDelete}>刪除</button>
  </div>
  {expanded&&<div className="project-card-content">
   <div className="workspace-title"><div><h2>{project.name}</h2><p>{project.tasks.length} 個 Task · 預估 {getProjectEstimatedHours(project)} 小時</p></div><div className="view-switch" aria-label={`${project.name} 時間檢視`}>{(['day','week','month'] as const).map(value=><button key={value} className={view===value?'active':''} onClick={()=>onViewChange(value)}>{value==='day'?'日':value==='week'?'週':'月'}</button>)}</div><button className="primary" onClick={onAddTask}>＋ 新增 Task</button></div>
   <div className="planning-layout">
    <Backlog tasks={project.tasks.filter(task=>!allocations.some(allocation=>allocation.taskId===task.id))} onEdit={onEditTask} onAuto={onAutoTask} onAllocate={onAllocateTask}/>
    <CapacityGantt tasks={project.tasks} allocations={allocations} capacityAllocations={allAllocations} capacities={capacities} view={view} onEdit={onEditTask} onAllocate={onAllocateTask} onAuto={onAutoTask} onDelete={onDeleteTask} onEditCapacity={onEditCapacity} onChangeDates={onChangeDates}/>
   </div>
  </div>}
 </article>;
}

function Backlog({tasks,onEdit,onAuto,onAllocate}:{tasks:Task[];onEdit:(task:Task)=>void;onAuto:(taskId:string)=>void;onAllocate:(taskId:string)=>void}){
 return <aside className="backlog"><div className="section-heading"><div><h2>Backlog</h2><small>{tasks.length} 個尚未分配工時的 Task</small></div></div>{tasks.length===0?<div className="empty">目前沒有 Backlog Task。</div>:<div className="backlog-list">{tasks.map(task=><article className="backlog-item" key={task.id}><div><b>{task.name}</b><span>{formatRange(task)} · 預估 {task.estimatedHours}h</span></div><div className="item-actions"><button onClick={()=>onEdit(task)}>編輯</button><button onClick={()=>onAllocate(task.id)}>人工分配</button><button className="primary" onClick={()=>onAuto(task.id)}>自動分配</button></div></article>)}</div>}
 </aside>;
}

type DragState={task:Task;mode:'move'|'start'|'end';startX:number;delta:number};
type PanState={startX:number;startScrollLeft:number};

type TimelinePeriod={start:string;end:string;dates:string[];label:string};

function startOfWeek(date:string){
 const weekday=new Date(`${date}T00:00:00Z`).getUTCDay();
 return addDays(date,-((weekday+6)%7));
}

function startOfMonth(date:string){
 return `${date.slice(0,7)}-01`;
}

function startOfNextMonth(date:string){
 const value=new Date(`${startOfMonth(date)}T00:00:00Z`);
 value.setUTCMonth(value.getUTCMonth()+1);
 return value.toISOString().slice(0,10);
}

function periodStart(date:string,view:ViewMode){
 return view==='week'?startOfWeek(date):view==='month'?startOfMonth(date):date;
}

function periodEnd(date:string,view:ViewMode){
 if(view==='week')return addDays(startOfWeek(date),6);
 if(view==='month')return addDays(startOfNextMonth(date),-1);
 return date;
}

function periodLabel(start:string,end:string,view:ViewMode){
 if(view==='day')return compactDateLabel(start);
 if(view==='week')return `${compactDateLabel(start)}–${compactDateLabel(end)}`;
 return new Date(`${start}T00:00:00Z`).toLocaleDateString('zh-TW',{year:'numeric',month:'long'});
}

function buildTimelinePeriods(start:string,end:string,view:ViewMode):TimelinePeriod[]{
 const periods:TimelinePeriod[]=[];
 let cursor=periodStart(start,view);
 const final=periodEnd(end,view);
 while(cursor<=final){
  const last=periodEnd(cursor,view);
  periods.push({start:cursor,end:last,dates:datesBetween(cursor,last),label:periodLabel(cursor,last,view)});
  cursor=addDays(last,1);
 }
 return periods;
}

function periodHours(period:TimelinePeriod,allocations:Allocation[],source?:Allocation['source']){
 return period.dates.reduce((sum,date)=>sum+getDailyAllocatedHours(date,allocations.filter(item=>!source||item.source===source)),0);
}

function periodAvailableHours(period:TimelinePeriod,capacities:DailyCapacity[]){
 return period.dates.reduce((sum,date)=>sum+getDailyCapacity(date,capacities).availableHours,0);
}

function CapacityGantt({tasks,allocations,capacityAllocations,capacities,view,onEdit,onAllocate,onAuto,onDelete,onEditCapacity,onChangeDates}:{tasks:Task[];allocations:Allocation[];capacityAllocations:Allocation[];capacities:DailyCapacity[];view:ViewMode;onEdit:(task:Task)=>void;onAllocate:(taskId:string)=>void;onAuto:(taskId:string)=>void;onDelete:(taskId:string)=>void;onEditCapacity:(date:string)=>void;onChangeDates:(next:Task)=>void}){
 const timelineRef=useRef<HTMLDivElement>(null);
 const dragRef=useRef<DragState|null>(null);
 const panRef=useRef<PanState|null>(null);
 const zoomAnchorRef=useRef<{contentX:number;pointerOffset:number;previousScale:number}|null>(null);
 const [dragging,setDragging]=useState<DragState|null>(null);
 const [zoomByView,setZoomByView]=useState<Record<ViewMode,number>>({day:1,week:1,month:1});
 const [panning,setPanning]=useState(false);
 const baseScale=view==='day'?96:view==='week'?64:40;
 const zoom=zoomByView[view];
 const scale=Math.round(baseScale*zoom);
 const dated=tasks.flatMap(task=>[task.start,task.end].filter((date):date is string=>Boolean(date)));
 const min=dated.sort()[0]||new Date().toISOString().slice(0,10);
 const max=dated.sort().at(-1)||addDays(min,21);
 const timelineStart=view==='day'?addDays(min,-2):periodStart(min,view);
 const requestedEnd=view==='day'?addDays(max,5):periodEnd(max,view);
 const timelineEnd=view==='day'&&daysBetween(timelineStart,requestedEnd)<34?addDays(timelineStart,34):requestedEnd;
 const periods=buildTimelinePeriods(timelineStart,timelineEnd,view);
 useLayoutEffect(()=>{
  const timeline=timelineRef.current;
  const anchor=zoomAnchorRef.current;
  if(!timeline||!anchor)return;
  timeline.scrollLeft=Math.max(0,anchor.contentX*(scale/anchor.previousScale)-anchor.pointerOffset);
  zoomAnchorRef.current=null;
 },[scale]);
 useEffect(()=>{
  const timeline=timelineRef.current;
  if(!timeline)return;
  const handleWheel=(event:globalThis.WheelEvent)=>{
   if(!event.deltaY)return;
   event.preventDefault();
   event.stopPropagation();
   const factor=event.deltaY<0?1.12:.88;
   const nextZoom=Math.min(3,Math.max(.5,Number((zoom*factor).toFixed(3))));
   const nextScale=Math.round(baseScale*nextZoom);
   if(nextScale===scale)return;
   const pointerOffset=event.clientX-timeline.getBoundingClientRect().left;
   zoomAnchorRef.current={contentX:timeline.scrollLeft+pointerOffset,pointerOffset,previousScale:scale};
   setZoomByView(current=>({...current,[view]:nextZoom}));
  };
  timeline.addEventListener('wheel',handleWheel,{passive:false});
  return()=>timeline.removeEventListener('wheel',handleWheel);
 },[baseScale,scale,view,zoom]);
 const findPeriodIndex=(date:string)=>{
  const index=periods.findIndex(period=>date>=period.start&&date<=period.end);
  return index<0?(date<periods[0].start?0:periods.length-1):index;
 };
 const beginDrag=(event:PointerEvent<HTMLElement>,task:Task,mode:DragState['mode'])=>{
  if(!task.start||!task.end)return;
  event.preventDefault();
  event.stopPropagation();
  const next={task,mode,startX:event.clientX,delta:0};
  dragRef.current=next;
  event.currentTarget.setPointerCapture(event.pointerId);
  setDragging(next);
 };
 const moveDrag=(event:PointerEvent<HTMLDivElement>)=>{
  const current=dragRef.current;
  if(!current)return;
  const delta=Math.round((event.clientX-current.startX)/scale);
  if(delta===current.delta)return;
  const next={...current,delta};
  dragRef.current=next;
  setDragging(next);
 };
 const endDrag=(event:PointerEvent<HTMLDivElement>)=>{
  const current=dragRef.current;
  if(!current)return;
  const next=applyTaskDrag(current.task,current.mode,current.delta);
  if(next.start!==current.task.start||next.end!==current.task.end)onChangeDates(next);
  if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  dragRef.current=null;
  setDragging(null);
 };
 const beginPan=(event:PointerEvent<HTMLDivElement>)=>{
 if(event.button!==0)return;
 const target=event.target;
 const targetElement=target instanceof Element?target:null;
 const capacityPeriod=targetElement?.closest('.capacity-period');
 if(targetElement?.closest('button,[role="button"],.task-range')||capacityPeriod?.classList.contains('editable'))return;
  event.preventDefault();
  const timeline=event.currentTarget;
  panRef.current={startX:event.clientX,startScrollLeft:timeline.scrollLeft};
  if(typeof timeline.setPointerCapture==='function')timeline.setPointerCapture(event.pointerId);
  setPanning(true);
 };
 const movePan=(event:PointerEvent<HTMLDivElement>)=>{
  const current=panRef.current;
  if(!current)return;
  event.preventDefault();
  event.currentTarget.scrollLeft=current.startScrollLeft-(event.clientX-current.startX);
 };
 const endPan=(event:PointerEvent<HTMLDivElement>)=>{
  if(!panRef.current)return;
  if(typeof event.currentTarget.hasPointerCapture==='function'&&event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  panRef.current=null;
  setPanning(false);
 };
 const openCapacity=(event:KeyboardEvent<HTMLSpanElement>,date:string)=>{
  if(event.key==='Enter'||event.key===' '){
   event.preventDefault();
   onEditCapacity(date);
  }
 };
 const preview=(task:Task)=>dragging?.task.id===task.id?applyTaskDrag(task,dragging.mode,dragging.delta):task;
 const capacityMessage=view==='day'?'每日顯示已分配／可用容量；點擊日期可設定容量':view==='week'?'每週顯示該週每日容量加總':'每月顯示該月每日容量加總';
 return <section className="gantt-section"><div className="section-heading"><div><h2>Capacity Gantt</h2><small>{capacityMessage}；滾輪縮放、拖曳平移時間軸</small></div></div><div className="gantt"><div className="gantt-sidebar"><div className="gantt-head capacity-gantt-head"><span>Task</span><span>工時</span><span>操作</span></div>{tasks.map(task=>{const allocated=allocations.filter(item=>item.taskId===task.id).reduce((sum,item)=>sum+item.allocatedHours,0);return <div className="gantt-side-row" key={task.id}><button className="task-link" onClick={()=>onEdit(task)}><b>{task.name}</b><small>{formatRange(task)}</small></button><span className="hours"><b>{allocated}</b> / {task.estimatedHours}h</span><div className="row-actions"><button title="人工分配" onClick={()=>onAllocate(task.id)}>＋</button><button title="自動分配" onClick={()=>onAuto(task.id)}>↗</button><button title="刪除" onClick={()=>onDelete(task.id)}>×</button></div></div>})}</div><div className={`timeline${panning?' panning':''}`} ref={timelineRef} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}><div className="dates capacity-dates" style={{width:periods.length*scale}}>{periods.map(period=>{const allocated=periodHours(period,capacityAllocations);const available=periodAvailableHours(period,capacities);const remaining=available-allocated;const state=remaining<0?'overloaded':remaining===0?'full':'available';const editable=view==='day';return <span className={`capacity-period ${state}${editable?' editable':''}`} key={period.start} role={editable?'button':undefined} tabIndex={editable?0:undefined} title={editable?`${period.label} · 已分配 ${hoursLabel(allocated)} / 可用 ${hoursLabel(available)} · 點擊設定容量`:`${period.label} · ${period.dates.length} 天容量加總 · 已分配 ${hoursLabel(allocated)} / 可用 ${hoursLabel(available)}`} aria-label={`${period.label}，已分配 ${hoursLabel(allocated)}，可用容量 ${hoursLabel(available)}`} onClick={editable?()=>onEditCapacity(period.start):undefined} onKeyDown={editable?event=>openCapacity(event,period.start):undefined} style={{left:periods.indexOf(period)*scale,width:scale}}><b>{period.label}</b><strong>{hoursLabel(allocated)} / {hoursLabel(available)}</strong>{!editable&&<small>{period.dates.length} 天合計</small>}</span>})}</div><div className="timeline-grid" style={{width:periods.length*scale,'--scale':`${scale}px`} as CSSProperties}>{tasks.map(task=>{const taskAllocations=allocations.filter(item=>item.taskId===task.id);const value=preview(task);const startIndex=value.start?findPeriodIndex(value.start):0;const endIndex=value.end?findPeriodIndex(value.end):startIndex;const left=value.start?startIndex*scale:0;const width=value.start&&value.end?Math.max(scale*.7,(endIndex-startIndex+1)*scale):0;return <div className="timeline-row" key={task.id}>{width>0&&<div className={`task-range ${task.status==='backlog'?'backlog-range':'scheduled-range'}${dragging?.task.id===task.id?' dragging':''}`} style={{left,width,backgroundColor:task.color}} onPointerDown={event=>beginDrag(event,task,'move')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} title="拖曳以調整日期範圍"><span className="range-label">{task.name}</span>{periods.flatMap((period,index)=>(['automatic','manual'] as const).map(source=>{const hours=periodHours(period,taskAllocations,source);if(!hours)return null;return <i className={`allocation ${source}`} key={`${period.start}-${source}`} title={`${period.label} · ${hoursLabel(hours)} · ${source==='manual'?'人工':'自動'}`} style={{left:index*scale-left,width:Math.max(5,scale-4)}}/>}))}<button className="resize-handle start" aria-label="調整開始日期" onPointerDown={event=>beginDrag(event,task,'start')}/><button className="resize-handle end" aria-label="調整結束日期" onPointerDown={event=>beginDrag(event,task,'end')}/></div>}</div>})}</div></div></div></section>;
}

function TaskDialog({task,allocations,onClose,onSave}:{task:Task;allocations:Allocation[];onClose:()=>void;onSave:(task:Task)=>string|null}){
 const [draft,setDraft]=useState(task);
 const [error,setError]=useState('');
 const manualHours=allocations.filter(item=>item.source==='manual').reduce((sum,item)=>sum+item.allocatedHours,0);
 const submit=(event:FormEvent)=>{
  event.preventDefault();
  if(draft.estimatedHours<manualHours){setError('預估工時不可小於人工分配工時。');return;}
  const result=onSave({...draft,estimatedHours:Number(draft.estimatedHours)});
  if(result)setError(result);
 };
 return <div className="modal" role="presentation" onMouseDown={event=>event.target===event.currentTarget&&onClose()}><form className="dialog" role="dialog" aria-modal="true" onSubmit={submit}><div className="dialog-head"><div><small>Task 詳細資料</small><h2>{task.name==='新工作'?'新增 Task':'編輯 Task'}</h2></div><button type="button" onClick={onClose} aria-label="關閉">×</button></div><label>Task 名稱<input autoFocus required value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})}/></label><div className="form-grid"><label>開始日期<input type="date" value={draft.start||''} onChange={event=>setDraft({...draft,start:event.target.value||null})}/></label><label>結束日期<input type="date" min={draft.start||undefined} value={draft.end||''} onChange={event=>setDraft({...draft,end:event.target.value||null})}/></label><label>預估工時<input type="number" min="0" step="0.5" value={draft.estimatedHours} onChange={event=>setDraft({...draft,estimatedHours:Number(event.target.value)})}/></label><label>狀態<select value={draft.status} onChange={event=>setDraft({...draft,status:event.target.value as TaskStatus})}>{Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div><label>備註<textarea rows={3} value={draft.notes} onChange={event=>setDraft({...draft,notes:event.target.value})}/></label><p className="form-hint">{allocations.length?`目前已分配 ${allocations.reduce((sum,item)=>sum+item.allocatedHours,0)} 小時，其中人工 ${manualHours} 小時。儲存後會重算自動分配。`:'沒有 Allocation 時，Task 會保留在 Backlog。'}</p>{error&&<p className="error">{error}</p>}<div className="dialog-actions"><button type="button" onClick={onClose}>取消</button><button className="primary" type="submit">儲存</button></div></form></div>;
}

function AllocationDialog({task,allocations,onClose,onSave,onDelete}:{task:Task;allocations:Allocation[];onClose:()=>void;onSave:(taskId:string,date:string,hours:number)=>string|null;onDelete:(allocationId:string)=>string|null}){
 const [date,setDate]=useState(task.start||new Date().toISOString().slice(0,10));
 const [hours,setHours]=useState(1);
 const [error,setError]=useState('');
 const submit=(event:FormEvent)=>{event.preventDefault();const result=onSave(task.id,date,hours);if(result)setError(result);};
 return <div className="modal" role="presentation" onMouseDown={event=>event.target===event.currentTarget&&onClose()}><form className="dialog" role="dialog" aria-modal="true" onSubmit={submit}><div className="dialog-head"><div><small>Allocation</small><h2>{task.name}</h2></div><button type="button" onClick={onClose} aria-label="關閉">×</button></div><div className="form-grid"><label>分配日期<input type="date" value={date} onChange={event=>setDate(event.target.value)}/></label><label>人工工時<input type="number" min="0.5" step="0.5" value={hours} onChange={event=>setHours(Number(event.target.value))}/></label></div><button className="primary" type="submit">＋ 新增人工 Allocation</button><div className="allocation-list"><h3>目前分配</h3>{allocations.length===0?<p className="form-hint">尚無 Allocation。</p>:allocations.map(item=><div className="allocation-row" key={item.id}><span>{item.date}</span><b>{item.allocatedHours}h</b><small>{item.source==='manual'?'人工':'自動'}</small>{item.source==='manual'&&<button type="button" onClick={()=>{const result=onDelete(item.id);if(result)setError(result);}}>刪除</button>}</div>)}</div>{error&&<p className="error">{error}</p>}<div className="dialog-actions"><button type="button" onClick={onClose}>關閉</button></div></form></div>;
}

function CapacityDialog({date,capacity,onClose,onSave}:{date:string;capacity:DailyCapacity;onClose:()=>void;onSave:(date:string,total:number,unavailable:number)=>string|null}){
 const [total,setTotal]=useState(capacity.totalCapacityHours);
 const [unavailable,setUnavailable]=useState(capacity.unavailableHours);
 const [error,setError]=useState('');
 const submit=(event:FormEvent)=>{event.preventDefault();const result=onSave(date,total,unavailable);if(result)setError(result);};
 return <div className="modal" role="presentation" onMouseDown={event=>event.target===event.currentTarget&&onClose()}><form className="dialog small-dialog" role="dialog" aria-modal="true" onSubmit={submit}><div className="dialog-head"><div><small>Daily Capacity</small><h2>{dateLabel(date)}</h2></div><button type="button" onClick={onClose} aria-label="關閉">×</button></div><label>每日總容量（小時）<input type="number" min="0" step="0.5" value={total} onChange={event=>setTotal(Number(event.target.value))}/></label><label>不可用時間（小時）<input type="number" min="0" step="0.5" value={unavailable} onChange={event=>setUnavailable(Number(event.target.value))}/></label><p className="form-hint">可用容量會由總容量減去不可用時間計算。容量不足時仍允許分配，但會顯示超載。</p>{error&&<p className="error">{error}</p>}<div className="dialog-actions"><button type="button" onClick={onClose}>取消</button><button className="primary" type="submit">儲存</button></div></form></div>;
}
