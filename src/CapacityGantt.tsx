import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {CSSProperties,KeyboardEvent,PointerEvent} from 'react';
import {addDays,applyTaskDrag,datesBetween} from './data';
import {daysBetween,getDailyAllocatedHours,getDailyCapacity} from './capacity';
import {compactDateLabel,formatRange,hourValueLabel,hoursLabel} from './formatters';
import type {Allocation,DailyCapacity,Task,ViewMode} from './types';

const MIN_TIMELINE_SCALE:Record<ViewMode,number>={day:24,week:32,month:40};
const MAX_TIMELINE_ZOOM=3;
const CONTEXT_ROW_HEIGHT=20;
const CAPACITY_ROW_HEIGHT=60;

type DragMode='move'|'start'|'end';
type DragState={task:Task;mode:DragMode;startX:number;delta:number};
type PanState={startX:number;startScrollLeft:number};
type CapacityState='available'|'full'|'overloaded';

type TimelinePeriod={start:string;end:string;dates:string[];label:string};
type TimelineContextCell={
 key:string;
 index:number;
 year:number;
 month:number;
 yearStart:boolean;
 monthStart:boolean;
 weekStart:boolean;
};

export type CapacityGanttProps={
 tasks:Task[];
 allocations:Allocation[];
 capacityAllocations:Allocation[];
 capacities:DailyCapacity[];
 view:ViewMode;
 onEdit:(task:Task)=>void;
 onAllocate:(taskId:string)=>void;
 onAuto:(taskId:string)=>void;
 onDelete:(taskId:string)=>void;
 onEditCapacity:(date:string)=>void;
 onChangeDates:(next:Task)=>void;
};

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

function dateParts(date:string){
 const value=new Date(`${date}T00:00:00Z`);
 return {year:value.getUTCFullYear(),month:value.getUTCMonth()+1,day:value.getUTCDate()};
}

function weekday(date:string){
 return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function periodDisplayLabel(period:TimelinePeriod,view:ViewMode,scale:number){
 const start=dateParts(period.start);

 if(view==='day')return scale<18?String(start.day):`${start.month}/${start.day}`;

 if(view==='week'){
  const end=dateParts(period.end);
  if(scale>=88)return `${start.month}/${start.day}–${end.month}/${end.day}`;
  if(scale>=40)return `${start.month}/${start.day}–${end.day}`;
  if(scale>=18)return `${start.month}/${start.day}`;
  return String(start.day);
 }

 if(scale>=64)return `${start.year}/${start.month}`;
 if(scale>=28)return `${start.month}月`;
 return String(start.month);
}

function periodDensity(scale:number){
 if(scale>=56)return 'regular';
 if(scale>=24)return 'compact';
 return 'minimal';
}

function periodCapacityLabel(allocated:number,available:number,scale:number){
 if(scale>=56)return `${hoursLabel(allocated)} / ${hoursLabel(available)}`;
 if(scale>=20)return `${hourValueLabel(allocated)}/${hourValueLabel(available)}`;
 return hourValueLabel(available);
}

function buildTimelinePeriods(start:string,end:string,view:ViewMode):TimelinePeriod[]{
 const periods:TimelinePeriod[]=[];
 let cursor=periodStart(start,view);
 const final=periodEnd(end,view);

 while(cursor<=final){
  const last=periodEnd(cursor,view);
  periods.push({
   start:cursor,
   end:last,
   dates:datesBetween(cursor,last),
   label:periodLabel(cursor,last,view),
  });
  cursor=addDays(last,1);
 }

 return periods;
}

function buildTimelineContext(periods:TimelinePeriod[],view:ViewMode):TimelineContextCell[]{
 return periods.map((period,index)=>{
  const current=dateParts(period.start);
  const previous=index?dateParts(periods[index-1].start):null;
  const yearStart=!previous||current.year!==previous.year;
  const monthStart=!previous||current.year!==previous.year||current.month!==previous.month;

  return {
   key:period.start,
   index,
   year:current.year,
   month:current.month,
   yearStart,
   monthStart:view!=='month'&&monthStart,
   weekStart:view==='day'&&weekday(period.start)===1,
  };
 });
}

function periodHours(period:TimelinePeriod,allocations:Allocation[],source?:Allocation['source']){
 const sourceAllocations=source?allocations.filter(item=>item.source===source):allocations;
 return period.dates.reduce((sum,date)=>sum+getDailyAllocatedHours(date,sourceAllocations),0);
}

function periodAvailableHours(period:TimelinePeriod,capacities:DailyCapacity[]){
 return period.dates.reduce((sum,date)=>sum+getDailyCapacity(date,capacities).availableHours,0);
}

function capacityState(allocated:number,available:number):CapacityState{
 if(allocated>available)return 'overloaded';
 if(allocated===available)return 'full';
 return 'available';
}

function weekendClass(date:string,view:ViewMode){
 if(view!=='day')return '';
 if(weekday(date)===6)return 'weekend-saturday';
 if(weekday(date)===0)return 'weekend-sunday';
 return '';
}

function findPeriodIndex(periods:TimelinePeriod[],date:string){
 const index=periods.findIndex(period=>date>=period.start&&date<=period.end);
 return index<0?(date<periods[0].start?0:periods.length-1):index;
}

type TimelineContextProps={cells:TimelineContextCell[];scale:number};

function TimelineContext({cells,scale}:TimelineContextProps){
 return (
  <div className="timeline-context-row" style={{height:CONTEXT_ROW_HEIGHT}}>
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
    const weekend=weekendClass(period.start,view);
    const className=['capacity-period',state,density,editable?'editable':'',weekend].filter(Boolean).join(' ');
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
      style={{left:index*scale,width:scale,top:CONTEXT_ROW_HEIGHT}}
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
  <div className="dates capacity-dates" style={{width:periods.length*scale,height:CONTEXT_ROW_HEIGHT+CAPACITY_ROW_HEIGHT}}>
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
    return <span className={`timeline-weekend-column ${weekend}`} key={period.start} style={{left:index*scale,width:scale}} aria-hidden="true"/>;
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
    const startIndex=value.start?findPeriodIndex(periods,value.start):0;
    const endIndex=value.end?findPeriodIndex(periods,value.end):startIndex;
    const left=value.start?startIndex*scale:0;
    const width=value.start&&value.end?Math.max(scale*.7,(endIndex-startIndex+1)*scale):0;

    return (
     <div className="timeline-row" key={task.id}>
      {width>0&&<TaskRange task={task} taskAllocations={taskAllocations} periods={periods} scale={scale} left={left} width={width} dragging={dragging} onBeginDrag={onBeginDrag} onMoveDrag={onMoveDrag} onEndDrag={onEndDrag}/>}
     </div>
    );
   })}
  </>
 );
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
   <div className="gantt-head capacity-gantt-head" style={{height:headerHeight,paddingTop:CONTEXT_ROW_HEIGHT}}>
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
 view,
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
 const zoomAnchorRef=useRef<{contentX:number;pointerOffset:number;previousScale:number}|null>(null);
 const [dragging,setDragging]=useState<DragState|null>(null);
 const [zoomByView,setZoomByView]=useState<Record<ViewMode,number>>({day:1,week:1,month:1});
 const [panning,setPanning]=useState(false);
 const baseScale=view==='day'?96:view==='week'?64:40;
 const zoom=zoomByView[view];
 const scale=Math.round(baseScale*zoom);
 const zoomRef=useRef(zoom);
 const scaleRef=useRef(scale);
 const baseScaleRef=useRef(baseScale);
 const viewRef=useRef(view);
 const dated=tasks.flatMap(task=>[task.start,task.end].filter((date):date is string=>Boolean(date))).sort();
 const min=dated[0]||new Date().toISOString().slice(0,10);
 const max=dated.at(-1)||addDays(min,21);
 const timelineStart=view==='day'?addDays(min,-2):periodStart(min,view);
 const requestedEnd=view==='day'?addDays(max,5):periodEnd(max,view);
 const timelineEnd=view==='day'&&daysBetween(timelineStart,requestedEnd)<34?addDays(timelineStart,34):requestedEnd;
 const periods=buildTimelinePeriods(timelineStart,timelineEnd,view);
 const context=buildTimelineContext(periods,view);
 const headerHeight=CONTEXT_ROW_HEIGHT+CAPACITY_ROW_HEIGHT;

 useEffect(()=>{
  zoomRef.current=zoom;
  scaleRef.current=scale;
  baseScaleRef.current=baseScale;
  viewRef.current=view;
 },[baseScale,scale,view,zoom]);

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
   const currentZoom=zoomRef.current;
   const currentScale=scaleRef.current;
   const currentBaseScale=baseScaleRef.current;
   const currentView=viewRef.current;
   const minZoom=MIN_TIMELINE_SCALE[currentView]/currentBaseScale;
   const nextZoom=Math.min(MAX_TIMELINE_ZOOM,Math.max(minZoom,Number((currentZoom*factor).toFixed(3))));
   const nextScale=Math.round(currentBaseScale*nextZoom);
   if(nextScale===currentScale)return;

   const pointerOffset=event.clientX-timeline.getBoundingClientRect().left;
   zoomAnchorRef.current={contentX:timeline.scrollLeft+pointerOffset,pointerOffset,previousScale:currentScale};
   zoomRef.current=nextZoom;
   scaleRef.current=nextScale;
   setZoomByView(current=>({...current,[currentView]:nextZoom}));
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

 const preview=(task:Task)=>dragging?.task.id===task.id?applyTaskDrag(task,dragging.mode,dragging.delta):task;
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
    <div className={`timeline${panning?' panning':''}`} ref={timelineRef} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}>
     <TimelineHeader periods={periods} context={context} capacities={capacities} allocations={capacityAllocations} view={view} scale={scale} onEditCapacity={onEditCapacity}/>
     <TimelineGrid periods={periods} view={view} scale={scale} tasks={tasks} allocations={allocations} dragging={dragging} preview={preview} onBeginDrag={beginDrag} onMoveDrag={moveDrag} onEndDrag={endDrag}/>
    </div>
   </div>
  </section>
 );
}
