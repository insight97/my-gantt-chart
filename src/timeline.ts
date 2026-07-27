import {addDays,datesBetween,daysBetween,getDailyAllocatedHours,getDailyCapacity,today} from './capacity';
import {compactDateLabel,hourValueLabel,hoursLabel} from './formatters';
import type {Allocation,DailyCapacity,Task,ViewMode} from './types';

export const TIMELINE_CONTEXT_ROW_HEIGHT=20;
export const TIMELINE_CAPACITY_ROW_HEIGHT=60;
export const TIMELINE_MIN_PIXELS_PER_DAY=1.25;
export const TIMELINE_MAX_PIXELS_PER_DAY=288;

const DAY_TO_WEEK_ENTER=16;
const DAY_TO_WEEK_EXIT=20;
const WEEK_TO_MONTH_ENTER=4;
const WEEK_TO_MONTH_EXIT=5;
const NOMINAL_DAYS:Record<ViewMode,number>={day:1,week:7,month:30};

export type TimelineZoom={view:ViewMode;pixelsPerDay:number};
export type TimelinePeriod={start:string;end:string;dates:string[];label:string};
export type TimelineContextCell={
 key:string;
 index:number;
 year:number;
 month:number;
 yearStart:boolean;
 monthStart:boolean;
 weekStart:boolean;
};

export const TIMELINE_ZOOM_PRESETS:Record<ViewMode,TimelineZoom>={
 day:{view:'day',pixelsPerDay:96},
 week:{view:'week',pixelsPerDay:64/7},
 month:{view:'month',pixelsPerDay:40/30},
};

export function timelineZoomPreset(view:ViewMode):TimelineZoom{
 return {...TIMELINE_ZOOM_PRESETS[view]};
}

export function timelineScale(view:ViewMode,pixelsPerDay:number){
 return Math.max(1,Math.round(pixelsPerDay*NOMINAL_DAYS[view]));
}

export function resolveTimelineView(pixelsPerDay:number,previousView:ViewMode):ViewMode{
 if(previousView==='day')return pixelsPerDay<DAY_TO_WEEK_ENTER?'week':'day';
 if(previousView==='week'){
  if(pixelsPerDay<WEEK_TO_MONTH_ENTER)return 'month';
  if(pixelsPerDay>=DAY_TO_WEEK_EXIT)return 'day';
  return 'week';
 }
 return pixelsPerDay>=WEEK_TO_MONTH_EXIT?'week':'month';
}

export function zoomTimeline(current:TimelineZoom,factor:number):TimelineZoom{
 const pixelsPerDay=Math.min(
  TIMELINE_MAX_PIXELS_PER_DAY,
  Math.max(TIMELINE_MIN_PIXELS_PER_DAY,Number((current.pixelsPerDay*factor).toFixed(3))),
 );
 return {pixelsPerDay,view:resolveTimelineView(pixelsPerDay,current.view)};
}

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

export function periodStart(date:string,view:ViewMode){
 return view==='week'?startOfWeek(date):view==='month'?startOfMonth(date):date;
}

export function periodEnd(date:string,view:ViewMode){
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

export function periodDisplayLabel(period:TimelinePeriod,view:ViewMode,scale:number){
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

export function periodDensity(scale:number){
 if(scale>=56)return 'regular';
 if(scale>=24)return 'compact';
 return 'minimal';
}

export function periodCapacityLabel(allocated:number,available:number,scale:number){
 if(scale>=56)return `${hoursLabel(allocated)} / ${hoursLabel(available)}`;
 if(scale>=20)return `${hourValueLabel(allocated)}/${hourValueLabel(available)}`;
 return hourValueLabel(available);
}

export function buildTimelinePeriods(start:string,end:string,view:ViewMode):TimelinePeriod[]{
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

export function timelineRange(tasks:Task[],view:ViewMode){
 const dated=tasks.flatMap(task=>[task.start,task.end].filter((date):date is string=>Boolean(date))).sort();
 const min=dated[0]||today();
 const max=dated.at(-1)||addDays(min,21);
 const baseStart=addDays(min,-2);
 const requestedEnd=addDays(max,5);
 const minimumEnd=addDays(baseStart,34);
 const end=requestedEnd>minimumEnd?requestedEnd:minimumEnd;
 return {start:periodStart(baseStart,view),end:periodEnd(end,view)};
}

export function buildTimelineContext(periods:TimelinePeriod[],view:ViewMode):TimelineContextCell[]{
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

export function periodHours(period:TimelinePeriod,allocations:Allocation[],source?:Allocation['source']){
 const sourceAllocations=source?allocations.filter(item=>item.source===source):allocations;
 return period.dates.reduce((sum,date)=>sum+getDailyAllocatedHours(date,sourceAllocations),0);
}

export function periodAvailableHours(period:TimelinePeriod,capacities:DailyCapacity[]){
 return period.dates.reduce((sum,date)=>sum+getDailyCapacity(date,capacities).availableHours,0);
}

export type CapacityState='available'|'full'|'overloaded';

export function capacityState(allocated:number,available:number):CapacityState{
 if(allocated>available)return 'overloaded';
 if(allocated===available)return 'full';
 return 'available';
}

export function weekendClass(date:string,view:ViewMode){
 if(view!=='day')return '';
 if(weekday(date)===6||weekday(date)===0)return 'weekend';
 return '';
}

export function findPeriodIndex(periods:TimelinePeriod[],date:string){
 const index=periods.findIndex(period=>date>=period.start&&date<=period.end);
 return index<0?(date<periods[0].start?0:periods.length-1):index;
}

export function timelinePositionForDate(date:string,periods:TimelinePeriod[],scale:number){
 if(!periods.length)return 0;
 if(date<=periods[0].start)return 0;
 if(date>periods.at(-1)!.end)return periods.length*scale;
 const index=findPeriodIndex(periods,date);
 const period=periods[index];
 return index*scale+(daysBetween(period.start,date)/period.dates.length)*scale;
}

export function timelineDateAtPosition(position:number,periods:TimelinePeriod[],scale:number){
 if(!periods.length)return '';
 const bounded=Math.max(0,Math.min(periods.length*scale-0.001,position));
 const index=Math.min(periods.length-1,Math.floor(bounded/scale));
 const period=periods[index];
 const ratio=(bounded-index*scale)/scale;
 const offset=Math.min(period.dates.length-1,Math.floor(ratio*period.dates.length));
 return period.dates[offset];
}

export function taskRangeGeometry(task:Task,periods:TimelinePeriod[],scale:number){
 if(!task.start||!task.end)return null;
 const left=timelinePositionForDate(task.start,periods,scale);
 const end=timelinePositionForDate(addDays(task.end,1),periods,scale);
 return {left,width:Math.max(10,end-left)};
}
