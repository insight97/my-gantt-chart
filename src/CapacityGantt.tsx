import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {CSSProperties,DragEvent,PointerEvent} from 'react';
import {applyTaskDrag} from './data';
import {getTaskPendingHours,recalculateAutomaticAllocations,today} from './capacity';
import {formatRange,hoursLabel} from './formatters';
import type {Allocation,AllocationMode,DailyCapacity,Task,ViewMode} from './types';
import {
 buildTimelineContext,
 buildTimelinePeriods,
 capacityState,
 periodAvailableHours,
 periodCapacityLabel,
 periodDensity,
 periodDisplayLabel,
 periodHours,
 timelineDateAtPosition,
 timelinePositionForDate,
 timelineRange,
 timelineScale,
 taskRangeGeometry,
 TIMELINE_CAPACITY_ROW_HEIGHT,
 TIMELINE_CONTEXT_ROW_HEIGHT,
 weekendClass,
 zoomTimeline,
} from './timeline';
import type {TimelineContextCell,TimelinePeriod,TimelineZoom} from './timeline';

type DragMode='move'|'start'|'end';
type DragState={task:Task;mode:DragMode;startX:number;delta:number};
type PanState={startX:number;startScrollLeft:number;candidate:boolean;active:boolean};

export type CapacityGanttProps={
 projectId:string;
 tasks:Task[];
 backlogTasks:Task[];
 allocations:Allocation[];
 capacityAllocations:Allocation[];
 capacities:DailyCapacity[];
 timelineZoom:TimelineZoom;
 allocationMode:AllocationMode;
 scrollLeft:number;
 onZoomChange:(next:TimelineZoom)=>void;
 onEdit:(task:Task)=>void;
 onAddTask:()=>void;
 onReorder:(sourceTaskId:string,targetTaskId:string)=>void;
 onAdjustAllocation:(taskId:string,date:string,delta:number)=>void;
 onScheduleAtDate:(taskId:string,date:string)=>void;
 onMoveToBacklog:(taskId:string)=>void;
 onDelete:(taskId:string)=>void;
 onEditCapacity:(date:string)=>void;
 onTimelineScroll:(left:number)=>void;
 onChangeDates:(next:Task)=>void;
};

type TimelineContextProps={cells:TimelineContextCell[];scale:number};

function TimelineContext({cells,scale}:TimelineContextProps){
 return <div className="timeline-context-row" style={{height:TIMELINE_CONTEXT_ROW_HEIGHT}}>
  {cells.map(cell=>{
   const label=cell.yearStart?`${cell.year} 年`:cell.monthStart?`${cell.month} 月`:'';
   const className=['timeline-context-cell',cell.yearStart?'year-start':'',cell.monthStart?'month-start':'',cell.weekStart?'week-start':''].filter(Boolean).join(' ');
   return <span className={className} key={cell.key} style={{left:cell.index*scale,width:scale}}><b>{label}</b></span>;
  })}
 </div>;
}

type CapacityPeriodsProps={
 periods:TimelinePeriod[];
 capacities:DailyCapacity[];
 allocations:Allocation[];
 view:ViewMode;
 scale:number;
 onEditCapacity:(date:string)=>void;
};

function CapacityPeriods({periods,capacities,allocations,view,scale,onEditCapacity}:CapacityPeriodsProps){
 return <>
  {periods.map((period,index)=>{
   const allocated=periodHours(period,allocations);
   const available=periodAvailableHours(period,capacities);
   const state=capacityState(allocated,available);
   const editable=view==='day';
   const density=periodDensity(scale);
   const className=['capacity-period',state,density,editable?'editable':''].filter(Boolean).join(' ');
   const title=editable
    ?`${period.label} · 已分配 ${hoursLabel(allocated)} / 可用 ${hoursLabel(available)} · 點擊設定容量`
    :`${period.label} · ${period.dates.length} 天容量加總 · 已分配 ${hoursLabel(allocated)} / 可用 ${hoursLabel(available)}`;
   return <span className={className} key={period.start} role={editable?'button':undefined} tabIndex={editable?0:undefined} title={title} aria-label={`${period.label}，已分配 ${hoursLabel(allocated)}，可用容量 ${hoursLabel(available)}`} onClick={editable?()=>onEditCapacity(period.start):undefined} onKeyDown={editable?event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onEditCapacity(period.start);}}:undefined} style={{left:index*scale,width:scale,top:TIMELINE_CONTEXT_ROW_HEIGHT}}>
    <b>{periodDisplayLabel(period,view,scale)}</b><strong>{periodCapacityLabel(allocated,available,scale)}</strong>{!editable&&scale>=56&&<small>{period.dates.length} 天合計</small>}
   </span>;
  })}
 </>;
}

function TimelineHeader({periods,context,capacities,allocations,view,scale,onEditCapacity}:{periods:TimelinePeriod[];context:TimelineContextCell[];capacities:DailyCapacity[];allocations:Allocation[];view:ViewMode;scale:number;onEditCapacity:(date:string)=>void}){
 return <div className="dates capacity-dates" style={{width:periods.length*scale,height:TIMELINE_CONTEXT_ROW_HEIGHT+TIMELINE_CAPACITY_ROW_HEIGHT}}>
  <TimelineContext cells={context} scale={scale}/>
  <CapacityPeriods periods={periods} capacities={capacities} allocations={allocations} view={view} scale={scale} onEditCapacity={onEditCapacity}/>
 </div>;
}

function TodayMarker({periods,scale}:{periods:TimelinePeriod[];scale:number}){
 const date=today();
 const left=timelinePositionForDate(date,periods,scale);
 return <span className="timeline-today-marker" style={{left}} title={`今天 ${date}`} aria-label={`今天 ${date}`}><i>今天</i></span>;
}

function WeekendColumns({periods,view,scale}:{periods:TimelinePeriod[];view:ViewMode;scale:number}){
 if(view!=='day')return null;
 return <>{periods.map((period,index)=>{
  const weekend=weekendClass(period.start,view);
  if(!weekend)return null;
  return <span className={`timeline-weekend-column ${weekend}`} key={period.start} style={{left:index*scale,width:scale,borderRight:'1px solid #d4e0e7'}} aria-hidden="true"/>;
 })}</>;
}

type TaskRangeProps={
 task:Task;
 scale:number;
 left:number;
 width:number;
 dragging:DragState|null;
 allocationMode:AllocationMode;
 onBeginDrag:(event:PointerEvent<HTMLElement>,task:Task,mode:DragMode)=>void;
 onMoveDrag:(event:PointerEvent<HTMLDivElement>)=>void;
 onEndDrag:(event:PointerEvent<HTMLDivElement>)=>void;
 onDragStart:(event:DragEvent<HTMLDivElement>,task:Task)=>void;
};

function TaskRange({task,scale,left,width,dragging,allocationMode,onBeginDrag,onMoveDrag,onEndDrag,onDragStart}:TaskRangeProps){
 const rangePadding=Math.min(9,Math.max(2,Math.round(scale/10)));
 const rangeLabelStyle:CSSProperties={display:'block',minWidth:0,maxWidth:'100%',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'};
 const canDrag=allocationMode==='general'&&task.status!=='completed';
 const className=['task-range',task.status==='backlog'?'backlog-range':'scheduled-range',dragging?.task.id===task.id?'dragging':''].filter(Boolean).join(' ');
 return <div className={className} style={{left,width,backgroundColor:task.color,padding:`0 ${rangePadding}px`}} draggable={canDrag} onDragStart={canDrag?event=>onDragStart(event,task):undefined} onPointerDown={canDrag?event=>onBeginDrag(event,task,'move'):undefined} onPointerMove={canDrag?onMoveDrag:undefined} onPointerUp={canDrag?onEndDrag:undefined} onPointerCancel={canDrag?onEndDrag:undefined} title={`${task.name} · ${canDrag?'拖曳以重新安排':'Allocate 模式下請操作每日工時'}`}>
  <span className="range-label" style={rangeLabelStyle}>{task.name}</span>
  {canDrag&&<><button className="resize-handle start" aria-label="調整開始日期" onPointerDown={event=>onBeginDrag(event,task,'start')}/><button className="resize-handle end" aria-label="調整結束日期" onPointerDown={event=>onBeginDrag(event,task,'end')}/></>}
 </div>;
}

function DeadlineMarker({task,periods,scale}:{task:Task;periods:TimelinePeriod[];scale:number}){
 if(!task.deadline)return null;
 const left=timelinePositionForDate(task.deadline,periods,scale);
 const overdue=Boolean(task.end&&task.end>task.deadline);
 return <span className={`deadline-marker${overdue?' overdue':''}`} style={{left}} title={`截止 ${task.deadline}${overdue?' · 已逾期':''}`}><i>截止</i></span>;
}

function AllocationSummaries({task,taskAllocations,periods,scale,view,onAdjustAllocation}:{task:Task;taskAllocations:Allocation[];periods:TimelinePeriod[];scale:number;view:ViewMode;onAdjustAllocation:(taskId:string,date:string,delta:number)=>void}){
 const editable=task.status!=='completed';
 return <div className={`allocation-summaries ${view==='day'?'editable':''}`}>
  {periods.map((period,index)=>{
   const hours=periodHours(period,taskAllocations);
   if(view==='day')return <button key={period.start} className={`allocation-cell${hours?' has-hours':''}`} disabled={!editable} style={{left:index*scale,width:scale}} title={`${period.label} · ${hoursLabel(hours)}${editable?' · 左鍵 +1h，右鍵 -1h':' · 已完成，不可修改'}`} aria-label={`${task.name} ${period.label} ${hoursLabel(hours)}${editable?'，左鍵增加一小時，右鍵減少一小時':'，已完成不可修改'}`} onClick={event=>{event.stopPropagation();onAdjustAllocation(task.id,period.start,1);}} onContextMenu={event=>{event.preventDefault();event.stopPropagation();onAdjustAllocation(task.id,period.start,-1);}}>{hours?hoursLabel(hours):''}</button>;
   return <span key={period.start} className={`allocation-summary${hours?' has-hours':''}`} style={{left:index*scale,width:scale}} title={`${period.label} · ${hoursLabel(hours)}`}>{hours?hoursLabel(hours):''}</span>;
  })}
 </div>;
}

function TimelineTaskRows({tasks,allocations,periods,scale,view,allocationMode,dragging,preview,onBeginDrag,onMoveDrag,onEndDrag,onDragStart,onAdjustAllocation}:{tasks:Task[];allocations:Allocation[];periods:TimelinePeriod[];scale:number;view:ViewMode;allocationMode:AllocationMode;dragging:DragState|null;preview:(task:Task)=>Task;onBeginDrag:(event:PointerEvent<HTMLElement>,task:Task,mode:DragMode)=>void;onMoveDrag:(event:PointerEvent<HTMLDivElement>)=>void;onEndDrag:(event:PointerEvent<HTMLDivElement>)=>void;onDragStart:(event:DragEvent<HTMLDivElement>,task:Task)=>void;onAdjustAllocation:(taskId:string,date:string,delta:number)=>void}){
 return <>{tasks.map(task=>{
  const taskAllocations=allocations.filter(item=>item.taskId===task.id);
  const value=preview(task);
  const geometry=taskRangeGeometry(value,periods,scale);
  const left=geometry?.left||0;
  const width=geometry?.width||0;
  const overdue=Boolean(task.deadline&&task.end&&task.end>task.deadline);
  return <div className={`timeline-row${overdue?' deadline-overdue':''}`} key={task.id}>
   {width>0&&<TaskRange task={task} scale={scale} left={left} width={width} dragging={dragging} allocationMode={allocationMode} onBeginDrag={onBeginDrag} onMoveDrag={onMoveDrag} onEndDrag={onEndDrag} onDragStart={onDragStart}/>}
   <DeadlineMarker task={task} periods={periods} scale={scale}/>
   {allocationMode==='allocate'&&<AllocationSummaries task={task} taskAllocations={taskAllocations} periods={periods} scale={scale} view={view} onAdjustAllocation={onAdjustAllocation}/>}
  </div>;
 })}</>;
}

function TimelineRowSeparators(){
 return <div className="timeline-row-separators" style={{position:'absolute',top:0,right:0,bottom:0,left:0,zIndex:3,pointerEvents:'none'}} aria-hidden="true"/>;
}

function DropPreview({task,periods,scale,rowIndex}:{task:Task;periods:TimelinePeriod[];scale:number;rowIndex:number}){
 const geometry=taskRangeGeometry(task,periods,scale);
 if(!geometry)return null;
 return <div className="drop-preview task-range" style={{left:geometry.left,width:geometry.width,top:rowIndex*70+19,backgroundColor:task.color}} title={`${task.name} · 預覽排程`}><span className="range-label">{task.name}</span></div>;
}

function TimelineGrid({projectId,periods,view,scale,tasks,allocations,allocationMode,dragging,preview,dropPreview,onDropPreview,onBeginDrag,onMoveDrag,onEndDrag,onDragStart,onAdjustAllocation,onScheduleAtDate}:{projectId:string;periods:TimelinePeriod[];view:ViewMode;scale:number;tasks:Task[];allocations:Allocation[];allocationMode:AllocationMode;dragging:DragState|null;preview:(task:Task)=>Task;dropPreview:Task|null;onDropPreview:(taskId:string,date:string|null)=>void;onBeginDrag:(event:PointerEvent<HTMLElement>,task:Task,mode:DragMode)=>void;onMoveDrag:(event:PointerEvent<HTMLDivElement>)=>void;onEndDrag:(event:PointerEvent<HTMLDivElement>)=>void;onDragStart:(event:DragEvent<HTMLDivElement>,task:Task)=>void;onAdjustAllocation:(taskId:string,date:string,delta:number)=>void;onScheduleAtDate:(taskId:string,date:string)=>void}){
 const style={width:periods.length*scale,minHeight:Math.max(70,tasks.length*70),'--scale':`${scale}px`} as CSSProperties;
 const readTransfer=(event:DragEvent<HTMLDivElement>)=>{try{return JSON.parse(event.dataTransfer.getData('application/x-gantt-task')) as {projectId:string;taskId:string};}catch{return null;}};
 const dropDate=(event:DragEvent<HTMLDivElement>)=>{const value=readTransfer(event);if(!value||value.projectId!==projectId)return null;const bounds=event.currentTarget.getBoundingClientRect();return timelineDateAtPosition(event.clientX-bounds.left+(event.currentTarget.parentElement?.scrollLeft||0),periods,scale)||null;};
 const handleDragOver=(event:DragEvent<HTMLDivElement>)=>{event.preventDefault();event.dataTransfer.dropEffect='move';const value=readTransfer(event);const date=dropDate(event);if(value?.projectId===projectId&&date)onDropPreview(value.taskId,date);};
 const handleDragLeave=(event:DragEvent<HTMLDivElement>)=>{const related=event.relatedTarget; if(!(related instanceof Node)||!event.currentTarget.contains(related))onDropPreview('',null);};
 const handleDrop=(event:DragEvent<HTMLDivElement>)=>{event.preventDefault();const value=readTransfer(event);const date=dropDate(event);onDropPreview('',null);if(value?.projectId===projectId&&date)onScheduleAtDate(value.taskId,date);};
 return <div className="timeline-grid" style={style} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
  <WeekendColumns periods={periods} view={view} scale={scale}/>
  <TimelineTaskRows tasks={tasks} allocations={allocations} periods={periods} scale={scale} view={view} allocationMode={allocationMode} dragging={dragging} preview={preview} onBeginDrag={onBeginDrag} onMoveDrag={onMoveDrag} onEndDrag={onEndDrag} onDragStart={onDragStart} onAdjustAllocation={onAdjustAllocation}/>
  {dropPreview&&<DropPreview task={dropPreview} periods={periods} scale={scale} rowIndex={Math.max(0,tasks.length-1)}/>}
  <TimelineRowSeparators/>
 </div>;
}

function GanttSidebar({projectId,tasks,allocations,headerHeight,onEdit,onAddTask,onDelete,onDragStart,onScheduleAtDate,onReorder}:{projectId:string;tasks:Task[];allocations:Allocation[];headerHeight:number;onEdit:(task:Task)=>void;onAddTask:()=>void;onDelete:(taskId:string)=>void;onDragStart:(event:DragEvent<HTMLButtonElement>,task:Task)=>void;onScheduleAtDate:(taskId:string,date:string)=>void;onReorder:(sourceTaskId:string,targetTaskId:string)=>void}){
 const taskIds=new Set(tasks.map(task=>task.id));
 const readTask=(event:DragEvent<HTMLDivElement>)=>{try{return JSON.parse(event.dataTransfer.getData('application/x-gantt-task')) as {projectId:string;taskId:string};}catch{return null;}};
 const handleDrop=(event:DragEvent<HTMLDivElement>)=>{event.preventDefault();const value=readTask(event);if(value?.projectId===projectId&&!taskIds.has(value.taskId))onScheduleAtDate(value.taskId,today());};
 const readReorder=(event:DragEvent<HTMLDivElement>)=>{try{return JSON.parse(event.dataTransfer.getData('application/x-gantt-reorder')) as {projectId:string;taskId:string};}catch{return null;}};
 return <div className="gantt-sidebar" onDragOver={event=>{event.preventDefault();event.dataTransfer.dropEffect='move';}} onDrop={handleDrop}>
  <div className="gantt-head capacity-gantt-head" style={{height:headerHeight,paddingTop:TIMELINE_CONTEXT_ROW_HEIGHT}}><span>Task</span><span>工時</span><span>操作</span></div>
  {tasks.map(task=>{
   const allocated=allocations.filter(item=>item.taskId===task.id).reduce((sum,item)=>sum+item.allocatedHours,0);
   const pending=getTaskPendingHours(task,allocations);
   const overdue=Boolean(task.deadline&&task.end&&task.end>task.deadline);
   const handleRowDrop=(event:DragEvent<HTMLDivElement>)=>{event.preventDefault();event.stopPropagation();const reorder=readReorder(event);if(reorder?.projectId===projectId&&reorder.taskId!==task.id){onReorder(reorder.taskId,task.id);return;}const value=readTask(event);if(value?.projectId===projectId&&!taskIds.has(value.taskId))onScheduleAtDate(value.taskId,today());};
   return <div className={`gantt-side-row${pending!==0?' has-pending':''}${overdue?' has-deadline-warning':''}`} key={task.id} onDragOver={event=>{event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';}} onDrop={handleRowDrop}>
    <button className="task-link" draggable={task.status!=='completed'} onDragStart={event=>onDragStart(event,task)} onClick={()=>onEdit(task)}><b>{task.name}</b><small>{task.deadline?`截止 ${task.deadline} · `:''}{formatRange(task)}</small></button>
    <span className="hours"><b>{hoursLabel(allocated)}</b> / {hoursLabel(task.estimatedHours)}{pending!==0&&<em>{pending>0?`待安排 ${hoursLabel(pending)}`:`需釋放 ${hoursLabel(Math.abs(pending))}`}</em>}</span>
    <div className="row-actions">{task.status!=='completed'&&<button title="刪除 Task" onClick={()=>onDelete(task.id)}>×</button>}</div>
   </div>;
  })}
  <button className="gantt-add-row" type="button" aria-label="Gantt 新增 Task" onClick={onAddTask}>＋ 新增 Task</button>
 </div>;
}

export default function CapacityGantt({projectId,tasks,backlogTasks,allocations,capacityAllocations,capacities,timelineZoom,allocationMode,scrollLeft,onZoomChange,onEdit,onAddTask,onReorder,onAdjustAllocation,onScheduleAtDate,onMoveToBacklog,onDelete,onEditCapacity,onTimelineScroll,onChangeDates}:CapacityGanttProps){
 const timelineRef=useRef<HTMLDivElement>(null);
 const dragRef=useRef<DragState|null>(null);
 const panRef=useRef<PanState|null>(null);
 const zoomAnchorRef=useRef<{date:string;pointerOffset:number}|null>(null);
 const layoutRef=useRef<{key:string;periods:TimelinePeriod[];scale:number}|null>(null);
 const skipScrollSyncRef=useRef(false);
 const [dragging,setDragging]=useState<DragState|null>(null);
 const [dropTarget,setDropTarget]=useState<{taskId:string;date:string}|null>(null);
 const [panning,setPanning]=useState(false);
 const suppressClickRef=useRef(false);
 const view=timelineZoom.view;
 const scale=timelineScale(view,timelineZoom.pixelsPerDay);
 const range=timelineRange(tasks,view);
 const periods=buildTimelinePeriods(range.start,range.end,view);
 const context=buildTimelineContext(periods,view);
 const headerHeight=TIMELINE_CONTEXT_ROW_HEIGHT+TIMELINE_CAPACITY_ROW_HEIGHT;
 const layoutKey=`${view}:${timelineZoom.pixelsPerDay}:${range.start}:${range.end}`;
 const timelineZoomRef=useRef(timelineZoom);
 const periodsRef=useRef(periods);
 const scaleRef=useRef(scale);
 const onZoomChangeRef=useRef(onZoomChange);
 const dropPreview=useMemo(()=>{
  if(!dropTarget)return null;
  const task=backlogTasks.find(item=>item.id===dropTarget.taskId);
  if(!task)return null;
  try{
   const result=recalculateAutomaticAllocations(task,capacityAllocations,capacities,dropTarget.date,{fillPending:true});
   return {...task,start:result.start||dropTarget.date,end:result.end||dropTarget.date,status:'scheduled' as const};
  }catch{return {...task,start:dropTarget.date,end:dropTarget.date,status:'scheduled' as const};}
 },[backlogTasks,capacityAllocations,capacities,dropTarget]);

 useEffect(()=>{
  timelineZoomRef.current=timelineZoom;periodsRef.current=periods;scaleRef.current=scale;onZoomChangeRef.current=onZoomChange;
 },[timelineZoom,periods,scale,onZoomChange]);
 useEffect(()=>{if(skipScrollSyncRef.current){skipScrollSyncRef.current=false;return;}if(timelineRef.current&&Math.abs(timelineRef.current.scrollLeft-scrollLeft)>1)timelineRef.current.scrollLeft=scrollLeft;},[scrollLeft]);
 useLayoutEffect(()=>{
  const timeline=timelineRef.current;if(!timeline)return;
  const previous=layoutRef.current;
  if(!previous){
   const initialLeft=Math.max(0,timelinePositionForDate(today(),periods,scale)-timeline.clientWidth/2);
   timeline.scrollLeft=initialLeft;
   skipScrollSyncRef.current=true;
   onTimelineScroll(initialLeft);
  }else if(previous.key!==layoutKey){
   const anchor=zoomAnchorRef.current;
   if(anchor){timeline.scrollLeft=Math.max(0,timelinePositionForDate(anchor.date,periods,scale)-anchor.pointerOffset);zoomAnchorRef.current=null;}
   else{const focusX=timeline.scrollLeft+timeline.clientWidth/2;const focusDate=timelineDateAtPosition(focusX,previous.periods,previous.scale);timeline.scrollLeft=Math.max(0,timelinePositionForDate(focusDate,periods,scale)-timeline.clientWidth/2);}
   onTimelineScroll(timeline.scrollLeft);
  }
  layoutRef.current={key:layoutKey,periods,scale};
 },[layoutKey,periods,scale,onTimelineScroll]);
 useEffect(()=>{
  const timeline=timelineRef.current;if(!timeline)return;
  const handleWheel=(event:globalThis.WheelEvent)=>{
   if(!event.deltaY)return;
   event.preventDefault();event.stopPropagation();
   const factor=event.deltaY<0?1.12:.88;const currentZoom=timelineZoomRef.current;const currentPeriods=periodsRef.current;const currentScale=scaleRef.current;const nextZoom=zoomTimeline(currentZoom,factor);
   if(nextZoom.pixelsPerDay===currentZoom.pixelsPerDay)return;
   const pointerOffset=event.clientX-timeline.getBoundingClientRect().left;
   zoomAnchorRef.current={date:timelineDateAtPosition(timeline.scrollLeft+pointerOffset,currentPeriods,currentScale),pointerOffset};
   timelineZoomRef.current=nextZoom;onZoomChangeRef.current(nextZoom);
  };
  timeline.addEventListener('wheel',handleWheel,{passive:false});
  return()=>timeline.removeEventListener('wheel',handleWheel);
 },[]);
 const beginDrag=(event:PointerEvent<HTMLElement>,task:Task,mode:DragMode)=>{
  if(allocationMode!=='general'||task.status==='completed'||!task.start||!task.end)return;
  event.preventDefault();event.stopPropagation();const next={task,mode,startX:event.clientX,delta:0};dragRef.current=next;if(typeof event.currentTarget.setPointerCapture==='function')event.currentTarget.setPointerCapture(event.pointerId);setDragging(next);
 };
 const moveDrag=(event:PointerEvent<HTMLDivElement>)=>{const current=dragRef.current;if(!current)return;const delta=Math.round((event.clientX-current.startX)/scale);if(delta===current.delta)return;const next={...current,delta};dragRef.current=next;setDragging(next);};
 const endDrag=(event:PointerEvent<HTMLDivElement>)=>{const current=dragRef.current;if(!current)return;const target=typeof document.elementFromPoint==='function'?document.elementFromPoint(event.clientX,event.clientY):null;const droppedOnBacklog=target instanceof Element&&Boolean(target.closest('.backlog'));if(droppedOnBacklog)onMoveToBacklog(current.task.id);else{const next=applyTaskDrag(current.task,current.mode,current.delta,view);if(next.start!==current.task.start||next.end!==current.task.end)onChangeDates(next);}if(typeof event.currentTarget.hasPointerCapture==='function'&&event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);dragRef.current=null;setDragging(null);};
 const beginPan=(event:PointerEvent<HTMLDivElement>)=>{
  if(event.button!==0)return;
  const target=event.target;const targetElement=target instanceof Element?target:null;
  const canPanFromAllocationSurface=allocationMode==='allocate'&&Boolean(targetElement?.closest('.allocation-cell,.task-range'));
  if(targetElement?.closest('button,[role="button"],.task-range,.allocation-cell')&&!canPanFromAllocationSurface)return;
  const timeline=event.currentTarget;
  const active=!canPanFromAllocationSurface;
  panRef.current={startX:event.clientX,startScrollLeft:timeline.scrollLeft,candidate:!active,active};
  if(active){event.preventDefault();if(typeof timeline.setPointerCapture==='function')timeline.setPointerCapture(event.pointerId);setPanning(true);}
 };
 const movePan=(event:PointerEvent<HTMLDivElement>)=>{const current=panRef.current;if(!current)return;if(current.candidate&&!current.active){if(Math.abs(event.clientX-current.startX)<4)return;current.active=true;event.preventDefault();if(typeof event.currentTarget.setPointerCapture==='function')event.currentTarget.setPointerCapture(event.pointerId);setPanning(true);}if(!current.active)return;event.preventDefault();event.currentTarget.scrollLeft=current.startScrollLeft-(event.clientX-current.startX);};
 const endPan=(event:PointerEvent<HTMLDivElement>)=>{const current=panRef.current;if(!current)return;if(current.active&&current.candidate){suppressClickRef.current=true;setTimeout(()=>{suppressClickRef.current=false;},0);}if(typeof event.currentTarget.hasPointerCapture==='function'&&event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);panRef.current=null;if(current.active)setPanning(false);};
 const preview=(task:Task)=>dragging?.task.id===task.id?applyTaskDrag(task,dragging.mode,dragging.delta,view):task;
 const handleTaskDragStart=(event:DragEvent<HTMLDivElement>|DragEvent<HTMLButtonElement>,task:Task)=>{const value=JSON.stringify({projectId,taskId:task.id});event.dataTransfer.setData('application/x-gantt-task',value);event.dataTransfer.setData('application/x-gantt-reorder',value);event.dataTransfer.effectAllowed='move';event.dataTransfer.setDragImage?.(event.currentTarget,12,12);};
 const canvasHeight=headerHeight+Math.max(70,tasks.length*70);
 return <section className="gantt-section">
  <div className="section-heading"><div><h2>Capacity Gantt</h2><small>{allocationMode==='allocate'?'Allocate 模式：日層級左鍵 +1h、右鍵 -1h；週／月只顯示摘要。':'一般模式：拖曳 Task bar 調整排程；可將 Task 拖回 Backlog。'} 滾輪縮放、拖曳平移時間軸</small></div></div>
  <div className="gantt">
   <GanttSidebar projectId={projectId} tasks={tasks} allocations={allocations} headerHeight={headerHeight} onEdit={onEdit} onAddTask={onAddTask} onDelete={onDelete} onDragStart={handleTaskDragStart} onScheduleAtDate={onScheduleAtDate} onReorder={onReorder}/>
   <div className={`timeline${panning?' panning':''}`} data-view={view} data-pixels-per-day={timelineZoom.pixelsPerDay} ref={timelineRef} onScroll={event=>onTimelineScroll(event.currentTarget.scrollLeft)} onClickCapture={event=>{if(suppressClickRef.current){event.preventDefault();event.stopPropagation();suppressClickRef.current=false;}}} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}>
    <div className="timeline-canvas" style={{width:periods.length*scale,minHeight:canvasHeight}}>
     <TimelineHeader periods={periods} context={context} capacities={capacities} allocations={capacityAllocations} view={view} scale={scale} onEditCapacity={onEditCapacity}/>
     <TimelineGrid projectId={projectId} periods={periods} view={view} scale={scale} tasks={tasks} allocations={allocations} allocationMode={allocationMode} dragging={dragging} preview={preview} dropPreview={dropPreview} onDropPreview={(taskId,date)=>setDropTarget(taskId&&date?{taskId,date}:null)} onBeginDrag={beginDrag} onMoveDrag={moveDrag} onEndDrag={endDrag} onDragStart={handleTaskDragStart} onAdjustAllocation={onAdjustAllocation} onScheduleAtDate={onScheduleAtDate}/>
     <TodayMarker periods={periods} scale={scale}/>
    </div>
   </div>
  </div>
 </section>;
}
