import type {Task} from './types';

export function compactDateLabel(date:string){
 return new Date(`${date}T00:00:00`).toLocaleDateString('zh-TW',{month:'numeric',day:'numeric'});
}

export function hourValueLabel(hours:number){
 return Number.isInteger(hours)?String(hours):hours.toFixed(1).replace(/\.0$/,'');
}

export function hoursLabel(hours:number){
 return `${hourValueLabel(hours)}h`;
}

export function formatRange(task:Task){
 if(task.start&&task.end)return `${task.start} → ${task.end}`;
 if(task.start)return `${task.start} → 未設定`;
 if(task.end)return `未設定 → ${task.end}`;
 return '尚未設定日期';
}
