import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {CSSProperties,KeyboardEvent,PointerEvent} from 'react';
import {applyTaskDrag} from './data';
import {formatRange,hoursLabel} from './formatters';
import type {Allocation,DailyCapacity,Task,ViewMode} from './types';
import {
 buildTimelineContext,
 buildTimelinePeriods,
 capacityState,
 periodAvailableHours,
 periodCapacityLabel,
 periodDensity,
 periodDisplayLabel,
 periodHours,
 taskRangeGeometry,
 timelineDateAtPosition,
 timelinePositionForDate,
 timelineRange,
 timelineScale,
 TIMELINE_CAPACITY_ROW_HEIGHT,
 TIMELINE_CONTEXT_ROW_HEIGHT,
 weekendClass,
 zoomTimeline,
} from './timeline';
import type {TimelineContextCell,TimelinePeriod,TimelineZoom} from './timeline';

type DragMode='move'|'start'|'end';
type DragState={task:Task;mode:DragMode;startX:number;delta:number};
type PanState={startX:number;startScrollLeft:number};

export type CapacityGanttProps={
 tasks:Task[];
 allocations:Allocation[];
 capacityAllocations:Allocation[];
 capacities:DailyCapacity[];
 timelineZoom:TimelineZoom;
 onZoomChange:(next:TimelineZoom)=>void;
 onEdit:(task:Task)=>void;
 onAllocate:(taskId:string)=>void;
 onAuto:(taskId:string)=>void;
 onDelete:(taskId:string)=>void;
 onEditCapacity:(date:string)=>void;
 onChangeDates:(next:Task)=>void;
};

type TimelineContextProps={cells:TimelineContextCell[];scale:number};

function TimelineContext({cells,scale}:TimelineContextProps){
 return (
  <div className="timeline-context-row" style={{height:TIMELINE_CONTEXT_ROW_HEIGHT}}>
   {cells.map(cell=>{
    const label=cell.yearStart?`${cell.year} 年`:cell.monthStart?`${cell.month} 月`:'';
    const className=[
     'timeline-context-cell',
     cell.yearStart?'year-start':'',
     cell.monthStart?'month-start':'',
     cell.weekStart?'week-start':'',
    ].filter(Boolean).join(' ');

    return (
     <span className={className} key={cell.key} style={{left:cell.index*scale,width:scale}}>
      <b>{label}</b>
     </span>
    );
   })}
  </div>
 );
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
 return (
  <>
   {periods.map((period,index)=>{
    const allocated=periodHours(period,allocations);
    const available=periodAvailableHours(period,capacities);
    const state=capacityState(allocated,available);
    const editable=view==='day';
    const density=periodDensity(scale);
    const className=['capacity-period',state,density,editable?'editable':''].filter(Boolean).join(' ');
    const title=editable
     ? `${period.label} · 已分配 ${hoursLabel(allocated)} / 可用 ${hoursLabel(available)} · 點擊設定容量`
     : `${period.label} · ${period.dates.length} 天容量加總 · 已分配 ${hoursLabel(allocated)} / 可用 ${hoursLabel(available)}`;

    const handleKeyDown=(event:KeyboardEvent<HTMLSpanElement>)=>{
     if(event.key==='Enter'||event.key===' '){
      event.preventDefault();
      onEditCapacity(period.start);
     }
    };

    return (
     <span
      className={className}
      key={period.start}
      role={editable?'button':undefined}
      tabIndex={editable?0:undefined}
      title={title}
      aria-label={`${period.label}，已分配 ${hoursLabel(allocated)}，可用容量 ${hoursLabel(available)}`}
      onClick={editable?()=>onEditCapacity(period.start):undefined}
      onKeyDown={editable?handleKeyDown:undefined}
      style={{left:index*scale,width:scale,top:TIMELINE_CONTEXT_ROW_HEIGHT}}
     >
      <b>{periodDisplayLabel(period,view,scale)}</b>
      <strong>{periodCapacityLabel(allocated,available,scale)}</strong>
      {!editable&&scale>=56&&<small>{period.dates.length} 天合計</small>}
     </span>
    );
   })}
  </>
 );
}

type TimelineHeaderProps={
 periods:TimelinePeriod[];
 context:TimelineContextCell[];
 capacities:DailyCapacity[];
 allocations:Allocation[];
 view:ViewMode;
 scale:number;
 onEditCapacity:(date:string)=>void;
};

function TimelineHeader({periods,context,capacities,allocations,view,scale,onEditCapacity}:TimelineHeaderProps){
 return (
  <div className="dates capacity-dates" style={{width:periods.length*scale,height:TIMELINE_CONTEXT_ROW_HEIGHT+TIMELINE_CAPACITY_ROW_HEIGHT}}>
   <TimelineContext cells={context} scale={scale}/>
   <CapacityPeriods periods={periods} capacities={capacities} allocations={allocations} view={view} scale={scale} onEditCapacity={onEditCapacity}/>
  </div>
 );
}

function WeekendColumns({periods,view,scale}:{periods:TimelinePeriod[];view:ViewMode;scale:number}){
 if(view!=='day')return null;

 return (
  <>
   {periods.map((period,index)=>{
    const weekend=weekendClass(period.start,view);
    if(!weekend)return null;
    return <span className={`timeline-weekend-column ${weekend}`} key={period.start} style={{left:index*scale,width:scale,borderRight:'1px solid #d4e0e7'}} aria-hidden="true"/>;
   })}
  </>
 );
}

type TaskRangeProps={
 task:Task;
 taskAllocations:Allocation[];
 periods:TimelinePeriod[];
 scale:number;
 left:number;
 width:number;
 dragging:DragState|null;
 onBeginDrag:(event:PointerEvent<HTMLElement>,task:Task,mode:DragMode)=>void;
 onMoveDrag:(event:PointerEvent<HTMLDivElement>)=>void;
 onEndDrag:(event:PointerEvent<HTMLDivElement>)=>void;
};

function TaskRange({
 task,
 taskAllocations,
 periods,
 scale,
 left,
 width,
 dragging,
 onBeginDrag,
 onMoveDrag,
 onEndDrag,
}:TaskRangeProps){
 const rangePadding=Math.min(9,Math.max(2,Math.round(scale/10)));
 const rangeLabelStyle:CSSProperties={
  display:'block',
  minWidth:0,
  maxWidth:'100%',
  overflow:'hidden',
  textOverflow:'ellipsis',
  whiteSpace:'nowrap',
 };
 const className=[
  'task-range',
  task.status==='backlog'?'backlog-range':'scheduled-range',
  dragging?.task.id===task.id?'dragging':'',
 ].filter(Boolean).join(' ');

 return (
  <div
   className={className}
   style={{left,width,backgroundColor:task.color,padding:`0 ${rangePadding}px`}}
   onPointerDown={event=>onBeginDrag(event,task,'move')}
   onPointerMove={onMoveDrag}
   onPointerUp={onEndDrag}
   onPointerCancel={onEndDrag}
   title={`${task.name} · 拖曳以調整日期範圍`}
  >
   <span className="range-label" style={rangeLabelStyle}>{task.name}</span>
   {periods.flatMap((period,index)=>(['automatic','manual'] as const).map(source=>{
    const hours=periodHours(period,taskAllocations,source);
    if(!hours)return null;
    return (
     <i
      className={`allocation ${source}`}
      key={`${period.start}-${source}`}
      title={`${period.label} · ${hoursLabel(hours)} · ${source==='manual'?'人工':'自動'}`}
      style={{left:index*scale-left,width:Math.max(5,scale-4)}}
     />
    );
   }))}
   <button className="resize-handle start" aria-label="調整開始日期" onPointerDown={event=>onBeginDrag(event,task,'start')}/>
   <button className="resize-handle end" aria-label="調整結束日期" onPointerDown={event=>onBeginDrag(event,task,'end')}/>
  </div>
 );
}

type TimelineTaskRowsProps={
 tasks:Task[];
 allocations:Allocation[];
 periods:TimelinePeriod[];
 scale:number;
 dragging:DragState|null;
 preview:(task:Task)=>Task;
 onBeginDrag:(event:PointerEvent<HTMLElement>,task:Task,mode:DragMode)=>void;
 onMoveDrag:(event:PointerEvent<HTMLDivElement>)=>void;
 onEndDrag:(event:PointerEvent<HTMLDivElement>)=>void;
};

function TimelineTaskRows({
 tasks,
 allocations,
 periods,
 scale,
 dragging,
 preview,
 onBeginDrag,
 onMoveDrag,
 onEndDrag,
}:TimelineTaskRowsProps){
 return (
  <>
   {tasks.map(task=>{
    const taskAllocations=allocations.filter(item=>item.taskId===task.id);
    const value=preview(task);
    const geometry=taskRangeGeometry(value,periods,scale);
    const left=geometry?.left||0;
    const width=geometry?.width||0;

    return (
     <div className="timeline-row" key={task.id}>
      {width>0&&<TaskRange task={task} taskAllocations={taskAllocations} periods={periods} scale={scale} left={left} width={width} dragging={dragging} onBeginDrag={onBeginDrag} onMoveDrag={onMoveDrag} onEndDrag={onEndDrag}/>}
     </div>
    );
   })}
  </>
 );
}

function TimelineRowSeparators(){
 return <div className="timeline-row-separators" style={{position:'absolute',top:0,right:0,bottom:0,left:0,zIndex:3,pointerEvents:'none'}} aria-hidden="true"/>;
}

type TimelineGridProps=TimelineTaskRowsProps & {view:ViewMode};

function TimelineGrid({
 periods,
 view,
 scale,
 tasks,
 allocations,
 dragging,
 preview,
 onBeginDrag,
 onMoveDrag,
 onEndDrag,
}:TimelineGridProps){
 const style={width:periods.length*scale,'--scale':`${scale}px`} as CSSProperties;

 return (
  <div className="timeline-grid" style={style}>
   <WeekendColumns periods={periods} view={view} scale={scale}/>
   <TimelineTaskRows tasks={tasks} allocations={allocations} periods={periods} scale={scale} dragging={dragging} preview={preview} onBeginDrag={onBeginDrag} onMoveDrag={onMoveDrag} onEndDrag={onEndDrag}/>
   <TimelineRowSeparators/>
  </div>
 );
}

type GanttSidebarProps={
 tasks:Task[];
 allocations:Allocation[];
 headerHeight:number;
 onEdit:(task:Task)=>void;
 onAllocate:(taskId:string)=>void;
 onAuto:(taskId:string)=>void;
 onDelete:(taskId:string)=>void;
};

function GanttSidebar({tasks,allocations,headerHeight,onEdit,onAllocate,onAuto,onDelete}:GanttSidebarProps){
 return (
  <div className="gantt-sidebar">
   <div className="gantt-head capacity-gantt-head" style={{height:headerHeight,paddingTop:TIMELINE_CONTEXT_ROW_HEIGHT}}>
    <span>Task</span>
    <span>工時</span>
    <span>操作</span>
   </div>
   {tasks.map(task=>{
    const allocated=allocations.filter(item=>item.taskId===task.id).reduce((sum,item)=>sum+item.allocatedHours,0);
    return (
     <div className="gantt-side-row" key={task.id}>
      <button className="task-link" onClick={()=>onEdit(task)}>
       <b>{task.name}</b>
       <small>{formatRange(task)}</small>
      </button>
      <span className="hours"><b>{allocated}</b> / {task.estimatedHours}h</span>
      <div className="row-actions">
       <button title="人工分配" onClick={()=>onAllocate(task.id)}>＋</button>
       <button title="自動分配" onClick={()=>onAuto(task.id)}>↗</button>
       <button title="刪除" onClick={()=>onDelete(task.id)}>×</button>
      </div>
     </div>
    );
   })}
  </div>
 );
}

export default function CapacityGantt({
 tasks,
 allocations,
 capacityAllocations,
 capacities,
 timelineZoom,
 onZoomChange,
 onEdit,
 onAllocate,
 onAuto,
 onDelete,
 onEditCapacity,
 onChangeDates,
}:CapacityGanttProps){
 const timelineRef=useRef<HTMLDivElement>(null);
 const dragRef=useRef<DragState|null>(null);
 const panRef=useRef<PanState|null>(null);
 const zoomAnchorRef=useRef<{date:string;pointerOffset:number}|null>(null);
 const layoutRef=useRef<{key:string;periods:TimelinePeriod[];scale:number}|null>(null);
 const [dragging,setDragging]=useState<DragState|null>(null);
 const [panning,setPanning]=useState(false);
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

 useEffect(()=>{
  timelineZoomRef.current=timelineZoom;
  periodsRef.current=periods;
  scaleRef.current=scale;
  onZoomChangeRef.current=onZoomChange;
 },[timelineZoom,periods,scale,onZoomChange]);

 useLayoutEffect(()=>{
  const timeline=timelineRef.current;
  if(!timeline)return;
  const previous=layoutRef.current;
  if(previous&&previous.key!==layoutKey){
   const anchor=zoomAnchorRef.current;
   if(anchor){
    timeline.scrollLeft=Math.max(0,timelinePositionForDate(anchor.date,periods,scale)-anchor.pointerOffset);
    zoomAnchorRef.current=null;
   }else{
    const focusX=timeline.scrollLeft+timeline.clientWidth/2;
    const focusDate=timelineDateAtPosition(focusX,previous.periods,previous.scale);
    timeline.scrollLeft=Math.max(0,timelinePositionForDate(focusDate,periods,scale)-timeline.clientWidth/2);
   }
  }
  layoutRef.current={key:layoutKey,periods,scale};
 },[layoutKey,periods,scale]);

 useEffect(()=>{
  const timeline=timelineRef.current;
  if(!timeline)return;

  const handleWheel=(event:globalThis.WheelEvent)=>{
   if(!event.deltaY)return;
   event.preventDefault();
   event.stopPropagation();
   const factor=event.deltaY<0?1.12:.88;
   const currentZoom=timelineZoomRef.current;
   const currentPeriods=periodsRef.current;
   const currentScale=scaleRef.current;
   const nextZoom=zoomTimeline(currentZoom,factor);
   if(nextZoom.pixelsPerDay===currentZoom.pixelsPerDay)return;

   const pointerOffset=event.clientX-timeline.getBoundingClientRect().left;
   zoomAnchorRef.current={date:timelineDateAtPosition(timeline.scrollLeft+pointerOffset,currentPeriods,currentScale),pointerOffset};
   timelineZoomRef.current=nextZoom;
   onZoomChangeRef.current(nextZoom);
  };

  timeline.addEventListener('wheel',handleWheel,{passive:false});
  return()=>timeline.removeEventListener('wheel',handleWheel);
 },[]);

 const beginDrag=(event:PointerEvent<HTMLElement>,task:Task,mode:DragMode)=>{
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
  const next=applyTaskDrag(current.task,current.mode,current.delta,view);
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

 const preview=(task:Task)=>dragging?.task.id===task.id?applyTaskDrag(task,dragging.mode,dragging.delta,view):task;
 const capacityMessage=view==='day'?'每日顯示已分配／可用容量；點擊日期可設定容量':view==='week'?'每週顯示該週每日容量加總':'每月顯示該月每日容量加總';

 return (
  <section className="gantt-section">
   <div className="section-heading">
    <div>
     <h2>Capacity Gantt</h2>
     <small>{capacityMessage}；滾輪縮放、拖曳平移時間軸</small>
    </div>
   </div>
   <div className="gantt">
    <GanttSidebar tasks={tasks} allocations={allocations} headerHeight={headerHeight} onEdit={onEdit} onAllocate={onAllocate} onAuto={onAuto} onDelete={onDelete}/>
    <div className={`timeline${panning?' panning':''}`} data-view={view} data-pixels-per-day={timelineZoom.pixelsPerDay} ref={timelineRef} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}>
     <TimelineHeader periods={periods} context={context} capacities={capacities} allocations={capacityAllocations} view={view} scale={scale} onEditCapacity={onEditCapacity}/>
     <TimelineGrid periods={periods} view={view} scale={scale} tasks={tasks} allocations={allocations} dragging={dragging} preview={preview} onBeginDrag={beginDrag} onMoveDrag={moveDrag} onEndDrag={endDrag}/>
    </div>
   </div>
  </section>
 );
}
