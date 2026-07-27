import {describe,expect,it} from 'vitest';
import {
 adjustManualAllocationDay,
 capacityAvailableHours,
 getDailyAllocatedHours,
 getProjectEstimatedHours,
 getTaskPendingHours,
 getRemainingCapacity,
 recalculateAutomaticAllocations,
 trimManualAllocationsToEstimate,
 validateTaskDateRange,
} from './capacity';
import {addDays,applyTaskDrag,datesBetween,emptyTask,validateImport} from './data';
import type {Allocation,DailyCapacity,Project,Task} from './types';

const capacity=(date:string,total=8,unavailable=0):DailyCapacity=>({
 date,
 totalCapacityHours:total,
 unavailableHours:unavailable,
 availableHours:total-unavailable,
});

const task=(overrides:Partial<Task>={}):Task=>({
 ...emptyTask(),
 ...overrides,
});

describe('容量 domain',()=>{
 it('計算每日可用與剩餘容量',()=>{
  const capacities=[capacity('2026-01-01',8,2)];
  const allocations:Allocation[]=[{id:'a',taskId:'other',date:'2026-01-01',allocatedHours:3,source:'manual',locked:true}];
  expect(capacityAvailableHours(8,2)).toBe(6);
  expect(getDailyAllocatedHours('2026-01-01',allocations)).toBe(3);
  expect(getRemainingCapacity('2026-01-01',capacities,allocations)).toBe(3);
 });

 it('計算 Project 下所有 Task 的預估總工時',()=>{
  const project={tasks:[task({estimatedHours:3}),task({estimatedHours:7})]} as Project;
  expect(getProjectEstimatedHours(project)).toBe(10);
 });

 it('自動分配會從起始日開始優先填滿可用容量',()=>{
  const value=recalculateAutomaticAllocations(
   task({id:'task',start:'2026-01-01',end:'2026-01-03',estimatedHours:6}),
   [],
   [capacity('2026-01-01'),capacity('2026-01-02'),capacity('2026-01-03')],
  );
  expect(value.allocations.map(item=>item.allocatedHours)).toEqual([6]);
  expect(value.allocations.every(item=>item.source==='automatic')).toBe(true);
 });

 it('平均分配會在明確日期範圍內盡量平均使用每日容量',()=>{
  const value=recalculateAutomaticAllocations(
   task({id:'balanced',start:'2026-01-01',end:'2026-01-03',estimatedHours:6,allocationStrategy:'balanced'}),
   [],
   [capacity('2026-01-01'),capacity('2026-01-02'),capacity('2026-01-03')],
  );
  expect(value.allocations.map(item=>item.allocatedHours)).toEqual([2,2,2]);
  expect(value).toMatchObject({start:'2026-01-01',end:'2026-01-03'});
 });

 it('Manual Allocation 會保留，且仍有剩餘容量的日期可再自動分配',()=>{
  const manual:Allocation={id:'manual',taskId:'task',date:'2026-01-01',allocatedHours:2,source:'manual',locked:true};
  const value=recalculateAutomaticAllocations(
   task({id:'task',start:'2026-01-01',end:'2026-01-03',estimatedHours:8}),
   [manual],
   [capacity('2026-01-01'),capacity('2026-01-02'),capacity('2026-01-03')],
  );
  expect(value.allocations.find(item=>item.source==='manual')).toBe(manual);
  expect(value.allocations.reduce((sum,item)=>sum+item.allocatedHours,0)).toBe(8);
 });

 it('沒有完整日期時從指定的今天逐日分配並推導日期',()=>{
  const value=recalculateAutomaticAllocations(
   task({id:'task',estimatedHours:10}),
   [],
   [capacity('2026-01-01',8),capacity('2026-01-02',4)],
   '2026-01-01',
  );
  expect(value.start).toBe('2026-01-01');
  expect(value.end).toBe('2026-01-02');
  expect(value.allocations.map(item=>item.allocatedHours)).toEqual([8,2]);
 });

 it('無日期 Task 的自動分配會把同日 Manual Allocation 算入負載',()=>{
  const manual:Allocation={id:'manual',taskId:'task',date:'2026-01-01',allocatedHours:3,source:'manual',locked:true};
  const value=recalculateAutomaticAllocations(
   task({id:'task',start:'2026-01-01',estimatedHours:8}),
   [manual],
   [capacity('2026-01-01',8),capacity('2026-01-02',8)],
   '2026-01-01',
  );
  expect(value.allocations.filter(item=>item.source==='automatic').map(item=>item.allocatedHours)).toEqual([5]);
  expect(value.end).toBe('2026-01-02');
 });

 it('規劃範圍內沒有容量時，將剩餘工時放在最後一天並保留超載結果',()=>{
  const value=recalculateAutomaticAllocations(
   task({id:'task',start:'2026-01-01',end:'2026-01-02',estimatedHours:10}),
   [],
   [capacity('2026-01-01',8,8),capacity('2026-01-02',8,8)],
   '2026-01-01',
   {horizonDays:2},
  );
  expect(value.allocations).toMatchObject([{date:'2026-01-02',allocatedHours:10,source:'automatic'}]);
 });

 it('Pending Hours 會反映估算工時與實際分配的差額',()=>{
  const value=task({id:'pending',estimatedHours:8});
  const allocations:Allocation[]=[{id:'auto',taskId:'pending',date:'2026-01-01',allocatedHours:10,source:'automatic',locked:false}];
  expect(getTaskPendingHours(value,allocations)).toBe(-2);
 });

 it('日層級增加工時會先消耗 Pending，再從自動分配尾端挪出工時',()=>{
  const value=task({id:'task',start:'2026-01-01',end:'2026-01-02',estimatedHours:8});
  const allocations:Allocation[]=[
   {id:'auto-1',taskId:'task',date:'2026-01-01',allocatedHours:6,source:'automatic',locked:false},
   {id:'auto-2',taskId:'task',date:'2026-01-02',allocatedHours:2,source:'automatic',locked:false},
  ];
  const result=adjustManualAllocationDay(value,allocations,[capacity('2026-01-01'),capacity('2026-01-02'),capacity('2026-01-03')],'2026-01-03',1,'2026-01-01');
  expect(result.allocations.find(item=>item.date==='2026-01-03')).toMatchObject({source:'manual',allocatedHours:1,locked:true});
  expect(result.allocations.filter(item=>item.source==='automatic').reduce((sum,item)=>sum+item.allocatedHours,0)).toBe(7);
  expect(getTaskPendingHours(value,result.allocations)).toBe(0);
 });

 it('日層級減少工時會保留手動零值，並把工時補回自動尾端',()=>{
  const value=task({id:'task',start:'2026-01-01',end:'2026-01-02',estimatedHours:8});
  const allocations:Allocation[]=[
   {id:'auto-1',taskId:'task',date:'2026-01-01',allocatedHours:6,source:'automatic',locked:false},
   {id:'manual-2',taskId:'task',date:'2026-01-02',allocatedHours:2,source:'manual',locked:true},
  ];
  const result=adjustManualAllocationDay(value,allocations,[capacity('2026-01-01'),capacity('2026-01-02'),capacity('2026-01-03')],'2026-01-02',-1,'2026-01-01');
  expect(result.allocations.find(item=>item.date==='2026-01-02')).toMatchObject({source:'manual',allocatedHours:1,locked:true});
  expect(result.allocations.find(item=>item.date==='2026-01-01')).toMatchObject({source:'automatic',allocatedHours:7});
  expect(getTaskPendingHours(value,result.allocations)).toBe(0);
 });

 it('點擊沒有工時的日期也會建立手動零值鎖定',()=>{
  const value=task({id:'task',estimatedHours:8});
  const result=adjustManualAllocationDay(value,[],[capacity('2026-01-01')],'2026-01-01',-1,'2026-01-01');
  expect(result.allocations).toMatchObject([{date:'2026-01-01',allocatedHours:0,source:'manual',locked:true}]);
 });

 it('估算工時降低時，從最尾端減少手動分配',()=>{
  const allocations:Allocation[]=[
   {id:'manual-1',taskId:'task',date:'2026-01-01',allocatedHours:5,source:'manual',locked:true},
   {id:'manual-2',taskId:'task',date:'2026-01-02',allocatedHours:5,source:'manual',locked:true},
  ];
  const result=trimManualAllocationsToEstimate('task',allocations,7);
  expect(result).toMatchObject([
   {id:'manual-1',allocatedHours:5},
   {id:'manual-2',allocatedHours:2},
  ]);
 });

 it('日期範圍不能排除 Manual Allocation',()=>{
  const manual:Allocation={id:'manual',taskId:'task',date:'2026-01-01',allocatedHours:2,source:'manual',locked:true};
  const value=task({id:'task',start:'2026-01-02',end:'2026-01-03'});
  expect(validateTaskDateRange(value,[manual])).toMatchObject({valid:false});
  expect(()=>recalculateAutomaticAllocations(value,[manual],[])).toThrow('日期範圍不可排除人工分配日期');
 });
});

describe('資料工具',()=>{
 it('計算日期區間與日期位移',()=>{
  expect(datesBetween('2026-01-01','2026-01-03')).toEqual(['2026-01-01','2026-01-02','2026-01-03']);
  expect(addDays('2026-01-31',1)).toBe('2026-02-01');
 });

 it('新 Task 預設為沒有日期的 backlog',()=>{
  const value=emptyTask();
  expect(value).toMatchObject({start:null,end:null,estimatedHours:8,status:'backlog'});
 });

 it('週／月拖曳會依目前時間軸層級移動',()=>{
  const value=task({id:'drag',start:'2026-01-31',end:'2026-02-15'});
  expect(applyTaskDrag(value,'move',1,'week')).toMatchObject({start:'2026-02-07',end:'2026-02-22'});
  expect(applyTaskDrag(value,'move',1,'month')).toMatchObject({start:'2026-02-28',end:'2026-03-15'});
 });

 it('拒絕舊版格式並接受完整的新空備份',()=>{
  expect(validateImport({schema:'gantt-local',version:1,projects:[]})).toBe(false);
  expect(validateImport({schema:'gantt-capacity-local',version:2,exportedAt:'now',projects:[],dailyCapacities:[],allocations:[]})).toBe(true);
  expect(validateImport({schema:'gantt-capacity-local',version:2,exportedAt:'now',projects:[]})).toBe(false);
 });
});
