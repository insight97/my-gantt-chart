import {useEffect,useRef,useState} from 'react';
import type {ChangeEvent,DragEvent,FormEvent} from 'react';
import {emptyTask,normalizeWorkspaceData,uid,validateImport} from './data';
import {
 adjustManualAllocationDay,
 getDailyCapacity,
 getProjectEstimatedHours,
 getTaskPendingHours,
 recalculateAutomaticAllocations,
 recalculateWorkspace,
 trimManualAllocationsToEstimate,
 today,
} from './capacity';
import {createEmptyWorkspace,loadWorkspace,saveWorkspace} from './db';
import CapacityGantt from './CapacityGantt';
import {hoursLabel} from './formatters';
import {timelineZoomPreset} from './timeline';
import type {Allocation,AllocationMode,DailyCapacity,ExportFile,Project,Task,TaskPriority,TaskStatus,ViewMode,WorkspaceData} from './types';
import type {TimelineZoom} from './timeline';

const clone=<T,>(value:T):T=>structuredClone(value);
const now=()=>new Date().toISOString();
const statusLabels:Record<TaskStatus,string>={backlog:'Backlog',scheduled:'已排程',in_progress:'進行中',completed:'已完成'};
const priorityLabels:Record<TaskPriority,string>={high:'高',medium:'中',low:'低'};
type EditingTask={projectId:string;task:Task};

function initialTimelineZoom():TimelineZoom{
 const savedView=localStorage.getItem('gantt-view');
 if(savedView==='day'||savedView==='week'||savedView==='month'){
  const savedPixels=Number(localStorage.getItem('gantt-pixels-per-day'));
  return Number.isFinite(savedPixels)&&savedPixels>0
   ? {view:savedView,pixelsPerDay:savedPixels}
   : timelineZoomPreset(savedView);
 }
 return timelineZoomPreset('week');
}

function replaceTaskAndAllocations(workspace:WorkspaceData,projectId:string,task:Task,taskAllocations?:Allocation[],moveTaskToEnd=false):WorkspaceData{
 return {
  ...workspace,
  projects:workspace.projects.map(project=>project.id===projectId
   ? {...project,tasks:moveTaskToEnd?[...project.tasks.filter(value=>value.id!==task.id),task]:project.tasks.some(value=>value.id===task.id)?project.tasks.map(value=>value.id===task.id?task:value):[...project.tasks,task],updatedAt:now()}
   : project),
  allocations:taskAllocations
   ? [...workspace.allocations.filter(item=>item.taskId!==task.id),...taskAllocations]
   : workspace.allocations,
 };
}

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

export default function App(){
 const [workspace,setWorkspace]=useState<WorkspaceData|null>(null);
 const [expandedProjectIds,setExpandedProjectIds]=useState<Set<string>>(()=>new Set());
 const [timelineZoom,setTimelineZoom]=useState<TimelineZoom>(initialTimelineZoom);
 const [allocationMode,setAllocationMode]=useState<AllocationMode>('general');
 const [timelineScrollLeft,setTimelineScrollLeft]=useState(0);
 const [ready,setReady]=useState(false);
 const [editingTask,setEditingTask]=useState<EditingTask|null>(null);
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

 const view=timelineZoom.view;
 useEffect(()=>{
  localStorage.setItem('gantt-view',timelineZoom.view);
  localStorage.setItem('gantt-pixels-per-day',String(timelineZoom.pixelsPerDay));
 },[timelineZoom]);

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
 const reorderTasks=(projectId:string,sourceTaskId:string,targetTaskId:string)=>{
  if(!workspace||sourceTaskId===targetTaskId)return;
  const project=workspace.projects.find(item=>item.id===projectId);
  if(!project)return;
  const sourceIndex=project.tasks.findIndex(task=>task.id===sourceTaskId);
  const targetIndex=project.tasks.findIndex(task=>task.id===targetTaskId);
  if(sourceIndex<0||targetIndex<0)return;
  const tasks=[...project.tasks];
  [tasks[sourceIndex],tasks[targetIndex]]=[tasks[targetIndex],tasks[sourceIndex]];
  commit({...workspace,projects:workspace.projects.map(item=>item.id===projectId?{...item,tasks,updatedAt:now()}:item)});
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

 const addTask=(projectId:string)=>{
  if(!workspace||!workspace.projects.some(project=>project.id===projectId))return;
  setEditingTask({projectId,task:emptyTask()});
 };

 const saveTask=(projectId:string,draft:Task):string|null=>{
  if(!workspace)return '目前沒有可編輯的工作區。';
  const project=workspace.projects.find(item=>item.id===projectId);
  if(!project)return '找不到 Project。';
  if(!draft.name.trim())return '請輸入 Task 名稱。';
  const existingTask=project.tasks.find(value=>value.id===draft.id);
  const taskAllocations=workspace.allocations.filter(allocation=>allocation.taskId===draft.id);
  if(draft.start&&draft.end&&draft.start>draft.end)return '開始日期不可晚於結束日期。';
  const datesChanged=Boolean(existingTask&&(draft.start!==existingTask.start||draft.end!==existingTask.end));
  const dateSpecified=!existingTask&&Boolean(draft.start||draft.end);
  const allocationStrategy=datesChanged||dateSpecified?'balanced':draft.allocationStrategy;
  const enteredGantt=!existingTask||existingTask.status==='backlog';
  let nextTask:Task={...draft,name:draft.name.trim(),start:draft.start,end:draft.end,allocationStrategy,updatedAt:now()};
  let recalculatedAllocations:Allocation[]|undefined;
  try{
   if(nextTask.status==='backlog'){
    nextTask={...nextTask,start:null,end:null,allocationStrategy:'fastest'};
    recalculatedAllocations=[];
   }else if(taskAllocations.length||enteredGantt||datesChanged){
    const adjustedWorkspaceAllocations=trimManualAllocationsToEstimate(draft.id,workspace.allocations,draft.estimatedHours);
    const scheduleAnchor=nextTask.start||today();
    const scheduledTask=!nextTask.start&&!nextTask.end?{...nextTask,start:scheduleAnchor,allocationStrategy:'fastest' as const}:nextTask;
    const result=recalculateAutomaticAllocations(scheduledTask,adjustedWorkspaceAllocations,workspace.dailyCapacities,scheduleAnchor,{fillPending:true});
    const fallbackStart=scheduledTask.start;
    nextTask={...scheduledTask,start:result.start||fallbackStart,end:result.end||result.start||fallbackStart};
    recalculatedAllocations=result.allocations;
   }
  }catch(error){return error instanceof Error?error.message:'Task 更新失敗。';}
  commit(replaceTaskAndAllocations(workspace,project.id,nextTask,recalculatedAllocations,Boolean(existingTask?.status==='backlog'&&nextTask.status!=='backlog')));
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
   const fastestTask:Task={...task,allocationStrategy:'fastest'};
   const result=recalculateAutomaticAllocations(fastestTask,workspace.allocations,workspace.dailyCapacities,task.start||undefined,{fillPending:true});
   const nextTask:Task={...fastestTask,start:result.start,end:result.end,status:(task.status==='completed'?'completed':'scheduled') as TaskStatus,updatedAt:now()};
   commit(replaceTaskAndAllocations(workspace,project.id,nextTask,result.allocations));
  }catch(error){setNotice(error instanceof Error?error.message:'自動分配失敗。');}
 };

 const adjustAllocationDay=(projectId:string,taskId:string,date:string,delta:number):string|null=>{
  if(!workspace)return '目前沒有可編輯的工作區。';
  const project=workspace.projects.find(item=>item.id===projectId);
  if(!project)return '找不到 Project。';
  const task=project.tasks.find(item=>item.id===taskId);
  if(!task)return '找不到 Task。';
  if(task.status==='completed')return '已完成 Task 不可修改。';
  try{
   const result=adjustManualAllocationDay(task,workspace.allocations,workspace.dailyCapacities,date,delta,task.start||today());
   const savedTask:Task={...task,start:result.start,end:result.end,status:task.status==='in_progress'?'in_progress':'scheduled',updatedAt:now()};
   commit(replaceTaskAndAllocations(workspace,project.id,savedTask,result.allocations));
   return null;
  }catch(error){return error instanceof Error?error.message:'Allocation 更新失敗。';}
 };

 const scheduleTaskAtDate=(projectId:string,taskId:string,date:string)=>{
  if(!workspace)return;
  const project=workspace.projects.find(item=>item.id===projectId);
  const task=project?.tasks.find(item=>item.id===taskId);
  const hasAllocations=workspace.allocations.some(item=>item.taskId===taskId);
  if(!project||!task||task.status==='completed'||(task.status!=='backlog'&&hasAllocations))return;
  try{
   const anchored={...task,start:date,end:null,status:'scheduled' as const,allocationStrategy:'fastest' as const};
   const result=recalculateAutomaticAllocations(anchored,workspace.allocations,workspace.dailyCapacities,date,{fillPending:true});
   const nextTask:Task={...anchored,start:result.start,end:result.end,updatedAt:now()};
   commit(replaceTaskAndAllocations(workspace,projectId,nextTask,result.allocations,true));
  }catch(error){setNotice(error instanceof Error?error.message:'自動分配失敗。');}
 };

 const moveTaskToBacklog=(projectId:string,taskId:string)=>{
  if(!workspace)return;
  const project=workspace.projects.find(item=>item.id===projectId);
  const task=project?.tasks.find(item=>item.id===taskId);
  if(!project||!task||task.status==='completed')return;
  const nextTask:Task={...task,status:'backlog',start:null,end:null,updatedAt:now()};
  commit(replaceTaskAndAllocations(workspace,projectId,nextTask,[]));
 };

 const rescheduleTask=(projectId:string,next:Task):string|null=>{
  if(!workspace)return '目前沒有可編輯的工作區。';
  const project=workspace.projects.find(item=>item.id===projectId);
  const task=project?.tasks.find(item=>item.id===next.id);
  if(!project||!task)return '找不到 Task。';
  if(task.status==='completed')return '已完成 Task 不可修改。';
  const manualDates=workspace.allocations.filter(item=>item.taskId===task.id&&item.source==='manual').map(item=>item.date).sort();
  let start=next.start;
  let end=next.end;
  if(start&&manualDates.at(-1)&&start>manualDates.at(-1)!)start=manualDates.at(-1)!;
  if(end&&manualDates[0]&&end<manualDates[0])end=manualDates[0];
  if(start&&end&&start>end)end=start;
  try{
   const draft={...task,start,end,allocationStrategy:'balanced' as const};
   const result=recalculateAutomaticAllocations(draft,workspace.allocations,workspace.dailyCapacities,start||task.start||today(),{fillPending:true});
   const savedTask:Task={...draft,start:result.start||draft.start,end:result.end||draft.end,updatedAt:now()};
   commit(replaceTaskAndAllocations(workspace,projectId,savedTask,result.allocations));
   return null;
  }catch(error){return error instanceof Error?error.message:'排程更新失敗。';}
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
   commit(normalizeWorkspaceData(value));
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
 const editTask=(projectId:string,task:Task)=>{
  if(task.status==='completed'){setNotice('已完成 Task 不可修改。');return;}
  setEditingTask({projectId,task});
 };
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
     <div className="project-list-actions"><button onClick={()=>setAllocationMode(value=>value==='general'?'allocate':'general')} aria-pressed={allocationMode==='allocate'}>{allocationMode==='general'?'Allocate 模式':'一般模式'}</button><button onClick={allExpanded?collapseAll:expandAll} disabled={!workspace.projects.length}>{allExpanded?'全部收合':'全部展開'}</button><button className="primary" onClick={addProject}>＋ 新增 Project</button></div>
    </div>
    {workspace.projects.length===0?<div className="empty-projects"><p>目前還沒有 Project。</p><button className="primary" onClick={addProject}>＋ 建立第一個 Project</button></div>:<div className="project-panels">{workspace.projects.map(project=>{
     const projectAllocations=workspace.allocations.filter(allocation=>project.tasks.some(task=>task.id===allocation.taskId));
     return <ProjectPanel key={project.id} project={project} allocations={projectAllocations} allAllocations={workspace.allocations} capacities={workspace.dailyCapacities} view={view} timelineZoom={timelineZoom} allocationMode={allocationMode} timelineScrollLeft={timelineScrollLeft} expanded={expandedProjectIds.has(project.id)} onToggle={()=>toggleProject(project.id)} onChange={fn=>patchProject(project.id,fn)} onDelete={()=>deleteProject(project.id)} onAddTask={()=>addTask(project.id)} onEditTask={task=>editTask(project.id,task)} onReorderTasks={(sourceTaskId,targetTaskId)=>reorderTasks(project.id,sourceTaskId,targetTaskId)} onAdjustAllocation={(taskId,date,delta)=>{const error=adjustAllocationDay(project.id,taskId,date,delta);if(error)setNotice(error);}} onScheduleAtDate={(taskId,date)=>scheduleTaskAtDate(project.id,taskId,date)} onMoveToBacklog={taskId=>moveTaskToBacklog(project.id,taskId)} onDeleteTask={taskId=>deleteTask(project.id,taskId)} onEditCapacity={setCapacityDate} onViewChange={value=>setTimelineZoom(timelineZoomPreset(value))} onZoomChange={setTimelineZoom} onTimelineScroll={setTimelineScrollLeft} onChangeDates={next=>{
      const error=rescheduleTask(project.id,next);
      if(error)setNotice(error);
     }}/>
    })}</div>}
   </section>
  </main>
  {editingTask&&editingProject&&<TaskDialog task={editingTask.task} allocations={workspace.allocations.filter(allocation=>allocation.taskId===editingTask.task.id)} onClose={()=>setEditingTask(null)} onSave={task=>saveTask(editingTask.projectId,task)} onAutoSchedule={()=>{autoScheduleTask(editingTask.projectId,editingTask.task.id);setEditingTask(null);}}/>}
  {capacityDate&&<CapacityDialog date={capacityDate} capacity={getDailyCapacity(capacityDate,workspace.dailyCapacities)} onClose={()=>setCapacityDate(null)} onSave={saveCapacity}/>}
  <footer>Capacity Gantt · 所有資料皆留在您的瀏覽器 · <button onClick={exportJson}>立即備份</button></footer>
 </div>;
}

type ProjectPanelProps={
 project:Project;
 allocations:Allocation[];
 allAllocations:Allocation[];
 capacities:DailyCapacity[];
 view:ViewMode;
 timelineZoom:TimelineZoom;
 allocationMode:AllocationMode;
 timelineScrollLeft:number;
 expanded:boolean;
 onToggle:()=>void;
 onChange:(fn:(value:Project)=>Project)=>void;
 onDelete:()=>void;
 onAddTask:()=>void;
 onEditTask:(task:Task)=>void;
 onReorderTasks:(sourceTaskId:string,targetTaskId:string)=>void;
 onAdjustAllocation:(taskId:string,date:string,delta:number)=>void;
 onScheduleAtDate:(taskId:string,date:string)=>void;
 onMoveToBacklog:(taskId:string)=>void;
 onDeleteTask:(taskId:string)=>void;
 onEditCapacity:(date:string)=>void;
 onViewChange:(view:ViewMode)=>void;
 onZoomChange:(next:TimelineZoom)=>void;
 onTimelineScroll:(left:number)=>void;
 onChangeDates:(task:Task)=>void;
};

function ProjectPanel({project,allocations,allAllocations,capacities,view,timelineZoom,allocationMode,timelineScrollLeft,expanded,onToggle,onChange,onDelete,onAddTask,onEditTask,onReorderTasks,onAdjustAllocation,onScheduleAtDate,onMoveToBacklog,onDeleteTask,onEditCapacity,onViewChange,onZoomChange,onTimelineScroll,onChangeDates}:ProjectPanelProps){
 const allocatedHours=allocations.reduce((sum,item)=>sum+item.allocatedHours,0);
 const backlogTasks=project.tasks.filter(task=>task.status==='backlog').sort((a,b)=>({high:0,medium:1,low:2}[a.priority]-({high:0,medium:1,low:2}[b.priority]))||a.createdAt.localeCompare(b.createdAt));
 const hasPositiveAllocation=(task:Task)=>allocations.some(item=>item.taskId===task.id&&item.allocatedHours>0);
 const hasAllocationRecord=(task:Task)=>allocations.some(item=>item.taskId===task.id);
 const hasDatedSchedule=(task:Task)=>Boolean(task.start&&task.end);
 const isZeroHourTask=(task:Task)=>task.estimatedHours===0;
 const scheduledTasks=project.tasks.filter(task=>task.status!=='backlog'&&(hasPositiveAllocation(task)||hasAllocationRecord(task)||hasDatedSchedule(task)||isZeroHourTask(task)));
 const pendingTasks=project.tasks.filter(task=>task.status!=='backlog'&&!hasPositiveAllocation(task)&&!hasAllocationRecord(task)&&!hasDatedSchedule(task)&&!isZeroHourTask(task));
 return <article className={`project-card${expanded?' expanded':' collapsed'}`}>
  <div className="project-card-header">
   <button className="project-toggle" type="button" aria-expanded={expanded} aria-label={`${expanded?'收合':'展開'} ${project.name}`} onClick={onToggle}><span aria-hidden="true">{expanded?'⌄':'›'}</span><small>Project</small></button>
   <div className="project-identity"><input aria-label={`${project.name} Project 名稱`} value={project.name} onChange={event=>onChange(value=>({...value,name:event.target.value}))}/><input aria-label={`${project.name} Project 說明`} value={project.description} placeholder="Project 說明…" onChange={event=>onChange(value=>({...value,description:event.target.value}))}/></div>
   <div className="project-summary"><span>{project.tasks.length} 個 Task</span><span>Backlog {backlogTasks.length}</span>{pendingTasks.length>0&&<span className="pending-badge">待處理 {pendingTasks.length}</span>}<span>已分配 {hoursLabel(allocatedHours)} / {hoursLabel(getProjectEstimatedHours(project))}</span></div>
   <button className="danger project-delete" type="button" onClick={onDelete}>刪除</button>
  </div>
  {expanded&&<div className="project-card-content">
   <div className="workspace-title"><div><h2>{project.name}</h2><p>{project.tasks.length} 個 Task · 預估 {getProjectEstimatedHours(project)} 小時</p></div><div className="view-switch" aria-label={`${project.name} 時間檢視`}>{(['day','week','month'] as const).map(value=><button key={value} className={view===value?'active':''} onClick={()=>onViewChange(value)}>{value==='day'?'日':value==='week'?'週':'月'}</button>)}</div><button className="primary" onClick={onAddTask}>＋ 新增 Task</button></div>
   <div className="planning-layout">
    <Backlog projectId={project.id} tasks={backlogTasks} pendingTasks={pendingTasks} onEdit={onEditTask} onDropToBacklog={onMoveToBacklog}/>
    <CapacityGantt projectId={project.id} tasks={scheduledTasks} backlogTasks={[...backlogTasks,...pendingTasks]} allocations={allocations} capacityAllocations={allAllocations} capacities={capacities} timelineZoom={timelineZoom} allocationMode={allocationMode} scrollLeft={timelineScrollLeft} onZoomChange={onZoomChange} onEdit={onEditTask} onReorder={onReorderTasks} onAdjustAllocation={onAdjustAllocation} onScheduleAtDate={onScheduleAtDate} onMoveToBacklog={onMoveToBacklog} onDelete={onDeleteTask} onEditCapacity={onEditCapacity} onTimelineScroll={onTimelineScroll} onChangeDates={onChangeDates}/>
   </div>
  </div>}
 </article>;
}

function taskTransferData(projectId:string,taskId:string){
 return JSON.stringify({projectId,taskId});
}

function TaskCard({projectId,task,onEdit,onDragStart}:{projectId:string;task:Task;onEdit:(task:Task)=>void;onDragStart:(task:Task)=>void}){
 return <article className="backlog-item task-card" draggable onDragStart={event=>{event.dataTransfer.setData('application/x-gantt-task',taskTransferData(projectId,task.id));event.dataTransfer.effectAllowed='move';onDragStart(task);}} onClick={()=>onEdit(task)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onEdit(task);}}} tabIndex={0}>
  <div><b>{task.name}</b><span><em className={`priority ${task.priority}`}>{priorityLabels[task.priority]}</em> · 預估 {task.estimatedHours}h</span></div>
 </article>;
}

function Backlog({projectId,tasks,pendingTasks,onEdit,onDropToBacklog}:{projectId:string;tasks:Task[];pendingTasks:Task[];onEdit:(task:Task)=>void;onDropToBacklog:(taskId:string)=>void}){
 const readTransfer=(event:DragEvent<HTMLElement>)=>{
  try{return JSON.parse(event.dataTransfer.getData('application/x-gantt-task')) as {projectId:string;taskId:string};}catch{return null;}
 };
 const handleDrop=(event:DragEvent<HTMLElement>)=>{
  event.preventDefault();
  const value=readTransfer(event);
  if(value?.projectId===projectId)onDropToBacklog(value.taskId);
 };
 const handleDragOver=(event:React.DragEvent)=>{event.preventDefault();event.dataTransfer.dropEffect='move';};
 return <aside className="backlog" onDragOver={handleDragOver} onDrop={handleDrop}>
  <div className="section-heading"><div><h2>Backlog</h2><small>{tasks.length} 個待排程 Task</small></div></div>
  {tasks.length===0?<div className="empty">把 Gantt Task 拖回這裡，或新增 Task。</div>:<div className="backlog-list">{tasks.map(task=><TaskCard key={task.id} projectId={projectId} task={task} onEdit={onEdit} onDragStart={()=>undefined}/>)}</div>}
  {pendingTasks.length>0&&<div className="pending-tray"><div className="section-heading"><div><h3>待處理</h3><small>尚未安排工時的 Gantt Task</small></div></div><div className="backlog-list">{pendingTasks.map(task=><TaskCard key={task.id} projectId={projectId} task={task} onEdit={onEdit} onDragStart={()=>undefined}/>)}</div></div>}
 </aside>;
}

function TaskDialog({task,allocations,onClose,onSave,onAutoSchedule}:{task:Task;allocations:Allocation[];onClose:()=>void;onSave:(task:Task)=>string|null;onAutoSchedule:()=>void}){
 const [draft,setDraft]=useState(task);
 const [error,setError]=useState('');
 const manualHours=allocations.filter(item=>item.source==='manual').reduce((sum,item)=>sum+item.allocatedHours,0);
 const saveDraft=()=>{
  const result=onSave({...draft,estimatedHours:Number(draft.estimatedHours)});
  if(result)setError(result);else setError('');
 };
 const submit=(event:FormEvent)=>{event.preventDefault();saveDraft();};
 return <div className="modal" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)saveDraft();}}>
  <form className="dialog" role="dialog" aria-modal="true" onSubmit={submit}>
   <div className="dialog-head"><div><small>Task 詳細資料</small><h2>{task.name==='新工作'?'新增 Task':'編輯 Task'}</h2></div><button type="button" onClick={onClose} aria-label="關閉">×</button></div>
   <label>Task 名稱<input autoFocus required value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})}/></label>
   <div className="form-grid">
    <label>開始日期<input type="date" value={draft.start||''} onChange={event=>setDraft({...draft,start:event.target.value||null})}/></label>
    <label>結束日期<input type="date" value={draft.end||''} onChange={event=>setDraft({...draft,end:event.target.value||null})}/></label>
    <label>優先順序<select value={draft.priority} onChange={event=>setDraft({...draft,priority:event.target.value as TaskPriority})}>{Object.entries(priorityLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label>預估工時<input type="number" min="0" step="0.5" value={draft.estimatedHours} onChange={event=>setDraft({...draft,estimatedHours:Number(event.target.value)})}/></label>
    <label>截止日期<input type="date" value={draft.deadline||''} onChange={event=>setDraft({...draft,deadline:event.target.value||null})}/></label>
    <label>狀態<select value={draft.status} onChange={event=>setDraft({...draft,status:event.target.value as TaskStatus})}>{Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   </div>
   <label>備註<textarea rows={3} value={draft.notes} onChange={event=>setDraft({...draft,notes:event.target.value})}/></label>
   <p className="form-hint">{allocations.length?`目前已分配 ${allocations.reduce((sum,item)=>sum+item.allocatedHours,0)} 小時，待處理 ${getTaskPendingHours(task,allocations)} 小時。儲存後會依分配模式重算。`:'尚未產生 Allocation；排程日期會在儲存或拖入 Gantt 後建立。'}{manualHours>0?' 已含人工分配。':''}</p>
   {error&&<p className="error">{error}</p>}
   <div className="dialog-actions"><button type="button" onClick={onClose}>取消</button>{allocations.length>0&&<button type="button" onClick={onAutoSchedule}>重新自動安排</button>}<button className="primary" type="submit">儲存</button></div>
  </form>
 </div>;
}

function CapacityDialog({date,capacity,onClose,onSave}:{date:string;capacity:DailyCapacity;onClose:()=>void;onSave:(date:string,total:number,unavailable:number)=>string|null}){
 const [total,setTotal]=useState(capacity.totalCapacityHours);
 const [unavailable,setUnavailable]=useState(capacity.unavailableHours);
 const [error,setError]=useState('');
 const submit=(event:FormEvent)=>{event.preventDefault();const result=onSave(date,total,unavailable);if(result)setError(result);};
 return <div className="modal" role="presentation" onMouseDown={event=>event.target===event.currentTarget&&onClose()}><form className="dialog small-dialog" role="dialog" aria-modal="true" onSubmit={submit}><div className="dialog-head"><div><small>Daily Capacity</small><h2>{dateLabel(date)}</h2></div><button type="button" onClick={onClose} aria-label="關閉">×</button></div><label>每日總容量（小時）<input type="number" min="0" step="0.5" value={total} onChange={event=>setTotal(Number(event.target.value))}/></label><label>不可用時間（小時）<input type="number" min="0" step="0.5" value={unavailable} onChange={event=>setUnavailable(Number(event.target.value))}/></label><p className="form-hint">可用容量會由總容量減去不可用時間計算。容量變更只會重排自動分配，手動分配會保留。</p>{error&&<p className="error">{error}</p>}<div className="dialog-actions"><button type="button" onClick={onClose}>取消</button><button className="primary" type="submit">儲存</button></div></form></div>;
}
