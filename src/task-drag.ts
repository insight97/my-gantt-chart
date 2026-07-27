import type {Task} from './types';

export type TaskDragOrigin='backlog'|'gantt';
export type TaskDropTargetKind='backlog'|'gantt-sidebar'|'gantt-row'|'gantt-timeline';

export type TaskDropTarget={
 kind:TaskDropTargetKind;
 projectId:string;
 taskId?:string;
 date?:string;
};

export type TaskDragState={
 projectId:string;
 task:Task;
 origin:TaskDragOrigin;
 allocatedHours:number;
 pendingHours:number;
 x:number;
 y:number;
 active:boolean;
 target:TaskDropTarget|null;
};

export type TaskDropTargetHandler=(target:TaskDropTarget|null,element?:HTMLElement)=>void;

/** True when the pointer actually left `currentTarget` rather than moving between its descendants. */
export function pointerLeftElement(event:{relatedTarget:EventTarget|null;currentTarget:Element}){
 const related=event.relatedTarget;
 return !(related instanceof Node)||!event.currentTarget.contains(related);
}
