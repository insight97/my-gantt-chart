import type { ExportFile, Project, Task } from './types';
export const uid=()=>crypto.randomUUID();
const iso=(offset:number)=>{const d=new Date();d.setDate(d.getDate()+offset);return d.toISOString().slice(0,10)};
export const emptyTask=():Task=>({id:uid(),name:'新工作',start:iso(0),end:iso(3),progress:0,owner:'',color:'#2f75bb',notes:'',milestone:false,dependencies:[]});
export const sampleProject=():Project=>{const tasks:Task[]=[
 { ...emptyTask(),id:'sample-discovery',name:'需求探索與訪談',start:iso(-2),end:iso(2),progress:100,owner:'怡君',color:'#2f75bb',notes:'整理利害關係人需求' },
 { ...emptyTask(),id:'sample-design',name:'介面設計',start:iso(1),end:iso(7),progress:65,owner:'子晴',color:'#7456a6',dependencies:['sample-discovery'],notes:'完成桌面與行動版流程' },
 { ...emptyTask(),id:'sample-build',name:'第一版開發',start:iso(6),end:iso(15),progress:30,owner:'家豪',color:'#16866b',dependencies:['sample-design'],notes:'功能開發與整合' },
 { ...emptyTask(),id:'sample-launch',name:'正式上線',start:iso(17),end:iso(17),progress:0,owner:'全員',color:'#d76535',dependencies:['sample-build'],milestone:true,notes:'發佈與檢核' }];
 return {id:uid(),name:'網站改版計畫',description:'可自由編輯的範例專案',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),tasks};};
export function validateImport(value:unknown): value is ExportFile { if(!value||typeof value!=='object')return false;const v=value as Partial<ExportFile>;if(v.schema!=='gantt-local'||v.version!==1||!Array.isArray(v.projects))return false;return v.projects.every(p=>typeof p?.id==='string'&&typeof p.name==='string'&&Array.isArray(p.tasks)&&p.tasks.every(t=>typeof t?.id==='string'&&typeof t.name==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(t.start)&&/^\d{4}-\d{2}-\d{2}$/.test(t.end)&&typeof t.progress==='number'&&t.progress>=0&&t.progress<=100&&Array.isArray(t.dependencies)));}
export const daysBetween=(a:string,b:string)=>Math.round((new Date(`${b}T00:00:00Z`).getTime()-new Date(`${a}T00:00:00Z`).getTime())/86400000);
export const addDays=(date:string,n:number)=>{const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
export type TaskDragMode='move'|'start'|'end';
export const applyTaskDrag=(task:Task,mode:TaskDragMode,delta:number)=>{
 if(mode==='move')return {...task,start:addDays(task.start,delta),end:addDays(task.end,delta)};
 if(mode==='start')return {...task,start:delta<=daysBetween(task.start,task.end)?addDays(task.start,delta):task.end};
 return {...task,end:delta>=-daysBetween(task.start,task.end)?addDays(task.end,delta):task.start};
};
