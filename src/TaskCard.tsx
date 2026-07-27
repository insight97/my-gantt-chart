import type {DragEvent,KeyboardEvent,PointerEvent} from 'react';
import {formatRange,hoursLabel} from './formatters';
import type {Task} from './types';

export type TaskCardVariant='backlog'|'gantt';

type TaskCardProps={
 task:Task;
 variant:TaskCardVariant;
 allocatedHours?:number;
 pendingHours?:number;
 isDragging?:boolean;
 isGhost?:boolean;
 onEdit?:(task:Task)=>void;
 onDelete?:(taskId:string)=>void;
 onPointerDown?:(event:PointerEvent<HTMLElement>)=>void;
 onNativeDragStart?:(event:DragEvent<HTMLElement>,task:Task)=>void;
};

const priorityLabels={high:'高',medium:'中',low:'低'} as const;

export default function TaskCard({task,variant,allocatedHours=0,pendingHours=0,isDragging=false,isGhost=false,onEdit,onDelete,onPointerDown,onNativeDragStart}:TaskCardProps){
 const canEdit=!isGhost&&Boolean(onEdit)&&task.status!=='completed';
 const className=['task-card',`task-card-${variant}`,isDragging?'dragging-source':'',isGhost?'task-card-ghost':''].filter(Boolean).join(' ');
 const handlePointerDown=(event:PointerEvent<HTMLElement>)=>{
  if(event.button!==0||isGhost)return;
  const target=event.target;
  if(target instanceof Element&&target.closest('button'))return;
  onPointerDown?.(event);
 };
 const handleClick=()=>{if(canEdit)onEdit?.(task);};
 const handleKeyDown=(event:KeyboardEvent<HTMLElement>)=>{
  if((event.key==='Enter'||event.key===' ')&&canEdit){event.preventDefault();onEdit?.(task);}
 };
 return <article className={className} draggable={false} tabIndex={isGhost?undefined:0} aria-hidden={isGhost||undefined} onPointerDown={onPointerDown?handlePointerDown:undefined} onDragStart={variant==='backlog'&&onNativeDragStart?event=>onNativeDragStart(event,task):undefined} onClick={handleClick} onKeyDown={handleKeyDown}>
  <div className={`task-card-info${variant==='gantt'?' task-link':''}`} draggable={false} onDragStart={variant==='gantt'&&onNativeDragStart?event=>{event.stopPropagation();onNativeDragStart(event,task);}:undefined}><b>{task.name}</b><small>{variant==='backlog'?<><em className={`priority ${task.priority}`}>{priorityLabels[task.priority]}</em> · 預估 {hoursLabel(task.estimatedHours)}</>:<>{task.deadline?`截止 ${task.deadline} · `:''}{formatRange(task)}</>}</small></div>
  {variant==='gantt'&&<div className="task-card-hours hours"><b>{hoursLabel(allocatedHours)}</b> / {hoursLabel(task.estimatedHours)}{pendingHours!==0&&<em>{pendingHours>0?`待安排 ${hoursLabel(pendingHours)}`:`需釋放 ${hoursLabel(Math.abs(pendingHours))}`}</em>}</div>}
  {!isGhost&&onDelete&&<div className="task-card-actions"><button className="task-card-delete" type="button" aria-label={`刪除 ${task.name}`} onClick={event=>{event.stopPropagation();onDelete(task.id);}}>×</button></div>}
 </article>;
}
