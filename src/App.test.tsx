import {cleanup,createEvent,fireEvent,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {emptyTask} from './data';
import type {WorkspaceData} from './types';
import './styles.css';
import './capacity-header.css';

const {loadWorkspaceMock,saveWorkspaceMock}=vi.hoisted(()=>({
 loadWorkspaceMock:vi.fn(),
 saveWorkspaceMock:vi.fn(async()=>undefined),
}));

vi.mock('./db',()=>({
 createEmptyWorkspace:()=>null,
 loadWorkspace:loadWorkspaceMock,
 saveWorkspace:saveWorkspaceMock,
}));

import App from './App';

const workspace:WorkspaceData={
 version:2,
 projects:[
  {id:'project-a',name:'Alpha Project',description:'第一個 Project',createdAt:'2026-01-01',updatedAt:'2026-01-01',tasks:[]},
  {id:'project-b',name:'Beta Project',description:'第二個 Project',createdAt:'2026-01-01',updatedAt:'2026-01-01',tasks:[]},
 ],
 dailyCapacities:[],
 allocations:[],
};

const aggregationWorkspace:WorkspaceData={
 version:2,
 projects:[
  {id:'project-a',name:'Alpha Project',description:'第一個 Project',createdAt:'2026-01-01',updatedAt:'2026-01-01',tasks:[{id:'task-a',name:'跨週 Task',start:'2026-01-05',end:'2026-01-18',deadline:null,estimatedHours:40,allocationStrategy:'fastest',priority:'medium',status:'scheduled',notes:'',owner:'',color:'#2f75bb',createdAt:'2026-01-01',updatedAt:'2026-01-01'}]},
  {id:'project-b',name:'Beta Project',description:'第二個 Project',createdAt:'2026-01-01',updatedAt:'2026-01-01',tasks:[]},
 ],
 dailyCapacities:[],
 allocations:[],
};

const denseWorkspace:WorkspaceData=structuredClone(aggregationWorkspace);
denseWorkspace.projects[0].tasks[0].name='這是一個很長的任務標題需要在窄欄位省略';
denseWorkspace.allocations=[{id:'allocation-a',taskId:'task-a',date:'2026-01-05',allocatedHours:8,source:'automatic',locked:false}];

const backlogWorkspace:WorkspaceData=structuredClone(workspace);
backlogWorkspace.projects[0].tasks=[{...emptyTask(),id:'backlog-task',name:'待排 Task',estimatedHours:16}];

const pendingWorkspace:WorkspaceData=structuredClone(workspace);
pendingWorkspace.projects[0].tasks=[{...emptyTask(),id:'pending-task',name:'待處理 Task',status:'scheduled'}];

const orderedWorkspace:WorkspaceData=structuredClone(backlogWorkspace);
orderedWorkspace.projects[0].tasks=[
 {...orderedWorkspace.projects[0].tasks[0],id:'backlog-task',name:'新加入 Task'},
 {...emptyTask(),id:'existing-task',name:'既有 Task',status:'scheduled',start:'2026-01-01',end:'2026-01-01'},
];

const reorderWorkspace:WorkspaceData=structuredClone(workspace);
reorderWorkspace.projects[0].tasks=[
 {...emptyTask(),id:'first-task',name:'第一個 Task',status:'scheduled',start:'2026-01-01',end:'2026-01-02'},
 {...emptyTask(),id:'middle-task',name:'中間 Task',status:'scheduled',start:'2026-01-03',end:'2026-01-04'},
 {...emptyTask(),id:'last-task',name:'最後 Task',status:'scheduled',start:'2026-01-05',end:'2026-01-06'},
];

const zeroHourWorkspace:WorkspaceData=structuredClone(workspace);
zeroHourWorkspace.projects[0].tasks=[{...emptyTask(),id:'zero-hour-task',name:'零工時 Task',estimatedHours:0,status:'scheduled'}];

const allocateWorkspace:WorkspaceData=structuredClone(aggregationWorkspace);
allocateWorkspace.projects[0].tasks[0].deadline='2026-01-10';
allocateWorkspace.projects[0].tasks[0].estimatedHours=16;
allocateWorkspace.allocations=[
 {id:'allocation-a',taskId:'task-a',date:'2026-01-05',allocatedHours:8,source:'automatic',locked:false},
 {id:'allocation-b',taskId:'task-a',date:'2026-01-06',allocatedHours:8,source:'automatic',locked:false},
];

const multiAllocateWorkspace:WorkspaceData=structuredClone(workspace);
multiAllocateWorkspace.projects[0].tasks=[
 {...emptyTask(),id:'allocate-a',name:'第一個 Allocate Task',estimatedHours:8,status:'scheduled',start:'2026-01-05',end:'2026-01-05'},
 {...emptyTask(),id:'allocate-b',name:'第二個 Allocate Task',estimatedHours:8,status:'scheduled',start:'2026-01-05',end:'2026-01-05'},
];
multiAllocateWorkspace.allocations=[
 {id:'allocation-a',taskId:'allocate-a',date:'2026-01-05',allocatedHours:8,source:'automatic',locked:false},
 {id:'allocation-b',taskId:'allocate-b',date:'2026-01-05',allocatedHours:8,source:'automatic',locked:false},
];

describe('Project arrangement',()=>{
 afterEach(()=>cleanup());

 beforeEach(()=>{
  localStorage.clear();
  loadWorkspaceMock.mockResolvedValue(structuredClone(workspace));
 });

 it('shows all Projects and toggles their details independently',async()=>{
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  expect(screen.getByDisplayValue('Beta Project')).toBeInTheDocument();
  expect(screen.getByText('Backlog')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'展開 Beta Project'})).toHaveAttribute('aria-expanded','false');

  fireEvent.click(screen.getByRole('button',{name:'展開 Beta Project'}));
  expect(screen.getByRole('button',{name:'收合 Beta Project'})).toHaveAttribute('aria-expanded','true');

  fireEvent.click(screen.getByRole('button',{name:'全部收合'}));
  expect(screen.getByRole('button',{name:'展開 Alpha Project'})).toHaveAttribute('aria-expanded','false');
  expect(screen.getByRole('button',{name:'展開 Beta Project'})).toHaveAttribute('aria-expanded','false');
 });

 it('uses day, week, and month as semantic zoom presets',async()=>{
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  const timeline=document.querySelector('.timeline-grid') as HTMLElement;
  expect(timeline.style.getPropertyValue('--scale')).toBe('64px');

  fireEvent.click(screen.getByRole('button',{name:'日'}));
  await waitFor(()=>expect(timeline.style.getPropertyValue('--scale')).toBe('96px'));
  const dayLabels=Array.from(document.querySelectorAll('.capacity-period b')).map(item=>item.textContent);

  fireEvent.click(screen.getByRole('button',{name:'週'}));
  await waitFor(()=>expect(timeline.style.getPropertyValue('--scale')).toBe('64px'));
  const weekLabels=Array.from(document.querySelectorAll('.capacity-period b')).map(item=>item.textContent);
  expect(weekLabels).not.toEqual(dayLabels);

  fireEvent.click(screen.getByRole('button',{name:'月'}));
  await waitFor(()=>expect(timeline.style.getPropertyValue('--scale')).toBe('40px'));
  const monthLabels=Array.from(document.querySelectorAll('.capacity-period b')).map(item=>item.textContent);
  expect(monthLabels).not.toEqual(weekLabels);
 });

 it('marks today on the timeline',async()=>{
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  expect(document.querySelector('.timeline-today-marker')).toBeInTheDocument();
 });

 it('opens the timeline at today by default',async()=>{
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  expect((document.querySelector('.timeline') as HTMLElement).scrollLeft).toBeGreaterThan(0);
 });

 it('opens the editor immediately when adding a Task and discards it on cancel',async()=>{
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  expect(document.querySelector('.backlog-list .add-task-row')).toBeInTheDocument();
  expect(document.querySelector('.gantt-sidebar .gantt-add-row')).toBeInTheDocument();
  fireEvent.click(document.querySelector('.backlog-list .add-task-row') as HTMLElement);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'取消'}));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(document.querySelector('.backlog .task-card')).not.toBeInTheDocument();
 });

 it('focuses the Task name field as soon as the editor opens',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(aggregationWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  fireEvent.click(document.querySelector('.gantt-sidebar .task-link') as HTMLElement);
  await waitFor(()=>expect(document.activeElement).toBe(screen.getByLabelText('Task 名稱')));
 });

 it('saves editor changes when clicking outside the dialog',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(aggregationWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  fireEvent.click(document.querySelector('.gantt-sidebar .task-link') as HTMLElement);
  fireEvent.change(screen.getByLabelText('Task 名稱'),{target:{value:'背景儲存 Task'}});
  fireEvent.mouseDown(document.querySelector('.modal') as HTMLElement);
  await waitFor(()=>expect(document.querySelector('.gantt-sidebar .task-link b')).toHaveTextContent('背景儲存 Task'));
 });

 it('does not save editor changes when clicking close or cancel',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(aggregationWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  fireEvent.click(document.querySelector('.gantt-sidebar .task-link') as HTMLElement);
  fireEvent.change(screen.getByLabelText('Task 名稱'),{target:{value:'不應儲存'}});
  fireEvent.click(screen.getByRole('button',{name:'關閉'}));
  expect(document.querySelector('.gantt-sidebar .task-link b')).toHaveTextContent('跨週 Task');

  fireEvent.click(document.querySelector('.gantt-sidebar .task-link') as HTMLElement);
  fireEvent.change(screen.getByLabelText('Task 名稱'),{target:{value:'也不應儲存'}});
  fireEvent.click(screen.getByRole('button',{name:'取消'}));
  expect(document.querySelector('.gantt-sidebar .task-link b')).toHaveTextContent('跨週 Task');
 });

 it('shows a compact year and month context row with subtle week markers',async()=>{
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  const timeline=document.querySelector('.timeline') as HTMLElement;
  fireEvent.click(screen.getByRole('button',{name:'日'}));
  await waitFor(()=>expect(timeline.querySelectorAll('.timeline-context-row')).toHaveLength(1));
  expect(timeline.querySelectorAll('.timeline-context-cell.year-start').length).toBeGreaterThan(0);
  expect(timeline.querySelectorAll('.timeline-context-cell.month-start').length).toBeGreaterThan(0);
  expect(timeline.querySelectorAll('.timeline-context-cell.week-start').length).toBeGreaterThan(0);
  expect(timeline.querySelectorAll('.timeline-weekend-column.weekend').length).toBeGreaterThan(0);
  expect(timeline.querySelectorAll('.capacity-period.weekend')).toHaveLength(0);
  expect(timeline.querySelector('.timeline-weekend-column.weekend')).toHaveStyle({borderRight:'1px solid #d4e0e7'});

  fireEvent.click(screen.getByRole('button',{name:'週'}));
  await waitFor(()=>expect(timeline.querySelectorAll('.timeline-context-row')).toHaveLength(1));
  expect(timeline.querySelectorAll('.timeline-context-cell.month-start').length).toBeGreaterThan(0);
  expect(timeline.querySelectorAll('.timeline-context-cell.year-start').length).toBeGreaterThan(0);
  expect(timeline.querySelectorAll('.timeline-context-cell.week-start')).toHaveLength(0);
  expect(timeline.querySelectorAll('.timeline-weekend-column')).toHaveLength(0);

  fireEvent.click(screen.getByRole('button',{name:'月'}));
  await waitFor(()=>expect(timeline.querySelectorAll('.timeline-context-row')).toHaveLength(1));
  expect(timeline.querySelectorAll('.timeline-context-cell.year-start').length).toBeGreaterThan(0);
  expect(timeline.querySelectorAll('.timeline-context-cell.month-start')).toHaveLength(0);
 });

 it('keeps task row separators above weekend backgrounds',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(aggregationWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button',{name:'日'}));
  const timeline=document.querySelector('.timeline') as HTMLElement;
  const weekend=timeline.querySelector('.timeline-weekend-column.weekend') as HTMLElement;
  const separators=timeline.querySelector('.timeline-row-separators') as HTMLElement;

  expect(separators).toBeInTheDocument();
  expect(getComputedStyle(separators).zIndex).toBe('3');
  expect(getComputedStyle(separators).pointerEvents).toBe('none');
  expect(weekend).toHaveClass('weekend');
 });

 it('zooms the timeline with the wheel and pans it by dragging',async()=>{
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  const timeline=document.querySelector('.timeline') as HTMLElement;
  const timelineGrid=document.querySelector('.timeline-grid') as HTMLElement;
  expect(timelineGrid.style.getPropertyValue('--scale')).toBe('64px');

  const wheelEvent=createEvent.wheel(timeline,{deltaY:-100,clientX:120,bubbles:true,cancelable:true});
  timeline.dispatchEvent(wheelEvent);
  expect(wheelEvent.defaultPrevented).toBe(true);
  await waitFor(()=>expect(Number.parseInt(timelineGrid.style.getPropertyValue('--scale'),10)).toBeGreaterThan(64));
  const weekZoomedScale=Number.parseInt(timelineGrid.style.getPropertyValue('--scale'),10);
  expect(timeline.getAttribute('data-view')).toBe('week');

  fireEvent.click(screen.getByRole('button',{name:'月'}));
  await waitFor(()=>expect(timelineGrid.style.getPropertyValue('--scale')).toBe('40px'));
  fireEvent.click(screen.getByRole('button',{name:'日'}));
  await waitFor(()=>expect(timelineGrid.style.getPropertyValue('--scale')).toBe('96px'));
  fireEvent.click(screen.getByRole('button',{name:'週'}));
  await waitFor(()=>expect(Number.parseInt(timelineGrid.style.getPropertyValue('--scale'),10)).toBe(64));
  expect(Number.parseInt(timelineGrid.style.getPropertyValue('--scale'),10)).not.toBe(weekZoomedScale);

  timeline.scrollLeft=0;
  fireEvent.pointerDown(timeline,{button:0,clientX:200,pointerId:1});
  fireEvent.pointerMove(timeline,{clientX:120,pointerId:1});
  expect(timeline.scrollLeft).toBe(80);
  fireEvent.pointerUp(timeline,{clientX:120,pointerId:1});
  expect(timeline).not.toHaveClass('panning');
 });

 it('uses compact labels when the timeline is narrowed',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(denseWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button',{name:'日'}));
  const timeline=document.querySelector('.timeline') as HTMLElement;
  const timelineGrid=document.querySelector('.timeline-grid') as HTMLElement;
  for(let index=0;index<20;index+=1){
   const currentView=timeline.getAttribute('data-view');
   const currentScale=Number.parseInt(timelineGrid.style.getPropertyValue('--scale'),10);
   if(currentView!=='day'||currentScale<24)break;
   const event=createEvent.wheel(timeline,{deltaY:100,clientX:120,bubbles:true,cancelable:true});
   timeline.dispatchEvent(event);
   await waitFor(()=>expect(event.defaultPrevented).toBe(true));
   await waitFor(()=>expect(Number.parseInt(timelineGrid.style.getPropertyValue('--scale'),10)).toBeLessThan(currentScale));
  }

  expect(timeline.getAttribute('data-view')).toBe('day');
  expect(Number.parseInt(timelineGrid.style.getPropertyValue('--scale'),10)).toBeLessThan(24);
  expect(Number.parseInt(timelineGrid.style.getPropertyValue('--scale'),10)).toBeGreaterThanOrEqual(18);
  expect(Array.from(document.querySelectorAll('.capacity-period b')).some(item=>item.textContent==='1/5')).toBe(true);
  expect(Array.from(document.querySelectorAll('.capacity-period strong')).some(item=>item.textContent==='0/8')).toBe(true);
  const taskLabel=document.querySelector('.range-label') as HTMLElement;
  expect(getComputedStyle(taskLabel).overflow).toBe('hidden');
  expect(getComputedStyle(taskLabel).textOverflow).toBe('ellipsis');
 });

 it('shares semantic zoom across expanded Projects',async()=>{
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button',{name:'展開 Beta Project'}));
  const timelines=Array.from(document.querySelectorAll('.timeline')) as HTMLElement[];
  expect(timelines).toHaveLength(2);

  fireEvent.click(screen.getAllByRole('button',{name:'日'})[0]);
  await waitFor(()=>expect(timelines.every(timeline=>timeline.dataset.view==='day')).toBe(true));
  const wheelEvent=createEvent.wheel(timelines[0],{deltaY:100,clientX:120,bubbles:true,cancelable:true});
  timelines[0].dispatchEvent(wheelEvent);
  await waitFor(()=>expect(timelines[0].dataset.pixelsPerDay).toBe(timelines[1].dataset.pixelsPerDay));

  timelines[0].scrollLeft=120;
  fireEvent.scroll(timelines[0]);
  await waitFor(()=>expect(timelines[1].scrollLeft).toBe(120));
 });

 it('aggregates capacity into non-editable week and month summaries',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(aggregationWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button',{name:'週'}));
  await waitFor(()=>expect(document.querySelectorAll('.capacity-period').length).toBeGreaterThan(0));
  const weekPeriods=document.querySelectorAll('.capacity-period');
  expect(weekPeriods.length).toBeGreaterThan(20);
  expect(document.querySelectorAll('.capacity-period[role="button"]')).toHaveLength(0);
  expect(Array.from(weekPeriods).some(period=>period.textContent?.includes('56h'))).toBe(true);

  fireEvent.click(screen.getByRole('button',{name:'月'}));
  await waitFor(()=>expect(document.querySelectorAll('.capacity-period').length).toBeGreaterThan(0));
  expect(document.querySelectorAll('.capacity-period[role="button"]')).toHaveLength(0);
  expect(Array.from(document.querySelectorAll('.capacity-period')).some(period=>period.textContent?.includes('0/248'))).toBe(true);
 });

 it('keeps a dated scheduled Task visible before it has allocations',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(aggregationWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  expect(document.querySelectorAll('.gantt-side-row')).toHaveLength(1);
  expect(document.querySelector('.task-range')).toBeInTheDocument();
 });

 it('does not render an extra empty Gantt row',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(aggregationWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  expect((document.querySelector('.timeline-grid') as HTMLElement).style.minHeight).toBe('70px');
 });

 it('keeps a zero-hour scheduled Task visible in Gantt',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(zeroHourWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  expect(document.querySelector('.gantt-side-row')).toHaveTextContent('零工時 Task');
 });

 it('shows pending tasks immediately and hides the tray when there are none',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(pendingWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  expect(document.querySelector('.pending-tray')).toBeInTheDocument();
  expect(document.querySelector('.pending-tray')).toHaveTextContent('待處理 Task');
 });

 it('puts a newly scheduled Task at the bottom of the Gantt order',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(orderedWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  const card=document.querySelector('.backlog .task-card') as HTMLElement;
  const timeline=document.querySelector('.timeline-grid') as HTMLElement;
  const dataTransfer={
   effectAllowed:'',
   dropEffect:'',
   setData:vi.fn(),
   getData:vi.fn((type:string)=>type==='application/x-gantt-task'?JSON.stringify({projectId:'project-a',taskId:'backlog-task'}):''),
  };
  fireEvent.dragStart(card,{dataTransfer});
  fireEvent.drop(timeline,{dataTransfer,clientX:20});
  await waitFor(()=>expect(Array.from(document.querySelectorAll('.gantt-sidebar .task-link b')).map(item=>item.textContent)).toEqual(['既有 Task','新加入 Task']));
 });

 it('shows start and end dates in Task details',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(aggregationWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  fireEvent.click(document.querySelector('.gantt-sidebar .task-link') as HTMLElement);
  expect(screen.getByLabelText('開始日期')).toHaveValue('2026-01-05');
  expect(screen.getByLabelText('結束日期')).toHaveValue('2026-01-18');
 });

 it('moves a Task to Backlog when its status is changed to backlog',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(allocateWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  fireEvent.click(document.querySelector('.gantt-sidebar .task-link') as HTMLElement);
  fireEvent.change(screen.getByLabelText('狀態'),{target:{value:'backlog'}});
  fireEvent.click(screen.getByRole('button',{name:'儲存'}));
  await waitFor(()=>expect(document.querySelector('.backlog .task-card')).toHaveTextContent('跨週 Task'));
  expect(document.querySelector('.gantt-sidebar .task-link')).not.toBeInTheDocument();
 });

 it('schedules a backlog Task when its status is changed to scheduled',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(backlogWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByText('待排 Task')).toBeInTheDocument());

  fireEvent.click(document.querySelector('.backlog .task-card') as HTMLElement);
  fireEvent.change(screen.getByLabelText('狀態'),{target:{value:'scheduled'}});
  fireEvent.click(screen.getByRole('button',{name:'儲存'}));
  await waitFor(()=>expect(document.querySelector('.gantt-sidebar .task-link')).toHaveTextContent('待排 Task'));
  expect(document.querySelector('.task-range')).toBeInTheDocument();
 });

 it('inserts a Gantt Task at the dropped row instead of swapping',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(reorderWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  const rows=document.querySelectorAll('.gantt-side-row');
  const last=rows[2].querySelector('.task-link') as HTMLElement;
  const first=rows[0] as HTMLElement;
  const dataTransfer={
   effectAllowed:'',
   dropEffect:'',
   setData:vi.fn(),
   setDragImage:vi.fn(),
   getData:vi.fn((type:string)=>type==='application/x-gantt-reorder'?JSON.stringify({projectId:'project-a',taskId:'last-task'}):''),
  };
  fireEvent.dragStart(last,{dataTransfer});
  expect(dataTransfer.setDragImage).toHaveBeenCalledWith(last,12,12);
  fireEvent.drop(first,{dataTransfer});
  await waitFor(()=>expect(Array.from(document.querySelectorAll('.gantt-sidebar .task-link b')).map(item=>item.textContent)).toEqual(['最後 Task','第一個 Task','中間 Task']));
 });

 it('uses Allocate Mode for daily edits and read-only period summaries',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(allocateWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  expect(document.querySelector('.allocation-summaries')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Allocate 模式'}));
  expect(document.querySelector('.allocation-summaries')).toBeInTheDocument();
  expect(document.querySelector('.deadline-marker')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button',{name:'日'}));
  const allocationCell=document.querySelector('.allocation-cell.has-hours') as HTMLElement;
  expect(allocationCell).toBeInTheDocument();
  fireEvent.click(allocationCell);
  await waitFor(()=>expect(document.querySelector('.hours b')).toHaveTextContent('16h'));
  fireEvent.contextMenu(document.querySelector('.allocation-cell.has-hours') as HTMLElement);
  await waitFor(()=>expect(document.querySelector('.allocation-cell.has-hours')).toHaveTextContent('8h'));

  fireEvent.click(screen.getByRole('button',{name:'週'}));
  expect(document.querySelectorAll('.allocation-summary.has-hours').length).toBeGreaterThan(0);
  expect(document.querySelectorAll('.allocation-cell')).toHaveLength(0);
 });

 it('allows timeline panning from an allocation cell in Allocate Mode',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(allocateWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button',{name:'Allocate 模式'}));
  fireEvent.click(screen.getByRole('button',{name:'日'}));
  const timeline=document.querySelector('.timeline') as HTMLElement;
  const cell=document.querySelector('.allocation-cell') as HTMLElement;
  timeline.scrollLeft=0;
  fireEvent.pointerDown(cell,{button:0,clientX:200,pointerId:1});
  fireEvent.pointerMove(cell,{clientX:120,pointerId:1});
  expect(timeline.scrollLeft).toBe(80);
  fireEvent.pointerUp(cell,{clientX:120,pointerId:1});
 });

 it('drops a Backlog Task into Gantt and schedules the same record',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(backlogWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByText('待排 Task')).toBeInTheDocument());

  const card=document.querySelector('.backlog .task-card') as HTMLElement;
  const timeline=document.querySelector('.timeline-grid') as HTMLElement;
  const dataTransfer={
   effectAllowed:'',
   dropEffect:'',
   setData:vi.fn(),
   getData:vi.fn((type:string)=>type==='application/x-gantt-task'?JSON.stringify({projectId:'project-a',taskId:'backlog-task'}):''),
  };
  fireEvent.dragStart(card,{dataTransfer});
  fireEvent.drop(timeline,{dataTransfer,clientX:20});
  await waitFor(()=>expect(document.querySelector('.backlog .task-card')).not.toBeInTheDocument());
  expect(document.querySelector('.gantt-side-row')).toBeInTheDocument();
 });

 it('drops a Backlog Task onto a Gantt row and appends it with a default interval',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(orderedWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByText('新加入 Task')).toBeInTheDocument());

  const card=document.querySelector('.backlog .task-card') as HTMLElement;
  const row=document.querySelector('.gantt-side-row') as HTMLElement;
  const dataTransfer={
   effectAllowed:'',
   dropEffect:'',
   setData:vi.fn(),
   getData:vi.fn((type:string)=>type==='application/x-gantt-task'?JSON.stringify({projectId:'project-a',taskId:'backlog-task'}):''),
  };
  fireEvent.dragStart(card,{dataTransfer});
  fireEvent.drop(row,{dataTransfer});
  await waitFor(()=>expect(document.querySelector('.backlog .task-card')).not.toBeInTheDocument());
  expect(Array.from(document.querySelectorAll('.gantt-sidebar .task-link b')).map(item=>item.textContent)).toEqual(['既有 Task','新加入 Task']);
 });

 it('changes allocation hours only for the clicked Task',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(multiAllocateWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button',{name:'Allocate 模式'}));
  fireEvent.click(screen.getByRole('button',{name:'日'}));
  const rows=document.querySelectorAll('.timeline-row');
  const firstCell=rows[0].querySelector('.allocation-cell.has-hours') as HTMLElement;
  expect(firstCell).toHaveTextContent('8h');
  expect(rows[1].querySelector('.allocation-cell.has-hours')).toHaveTextContent('8h');

  fireEvent.click(firstCell);
  await waitFor(()=>expect(rows[0].querySelector('.allocation-cell.has-hours')).toHaveTextContent('9h'));
  expect(rows[1].querySelector('.allocation-cell.has-hours')).toHaveTextContent('8h');
 });

 it('shows a ghost preview while dragging a Backlog Task over Gantt',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(backlogWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByText('待排 Task')).toBeInTheDocument());

  const card=document.querySelector('.backlog .task-card') as HTMLElement;
  const timeline=document.querySelector('.timeline-grid') as HTMLElement;
  const dataTransfer={
   effectAllowed:'',
   dropEffect:'',
   setData:vi.fn(),
   getData:vi.fn((type:string)=>type==='application/x-gantt-task'?JSON.stringify({projectId:'project-a',taskId:'backlog-task'}):''),
  };
  fireEvent.dragStart(card,{dataTransfer});
  fireEvent.dragOver(timeline,{dataTransfer,clientX:20});
  expect(document.querySelector('.drop-preview')).toBeInTheDocument();
  expect(document.querySelector('.drop-preview')).toHaveTextContent('待排 Task');
 });

 it('drops a scheduled Task back to Backlog and clears its allocations',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(denseWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  const taskLink=document.querySelector('.gantt-sidebar .task-link') as HTMLElement;
  const backlog=document.querySelector('.backlog') as HTMLElement;
  const dataTransfer={
   effectAllowed:'',
   dropEffect:'',
   setData:vi.fn(),
   getData:vi.fn((type:string)=>type==='application/x-gantt-task'?JSON.stringify({projectId:'project-a',taskId:'task-a'}):''),
  };
  fireEvent.dragStart(taskLink,{dataTransfer});
  fireEvent.drop(backlog,{dataTransfer});
  await waitFor(()=>expect(document.querySelector('.backlog .task-card')).toHaveTextContent('這是一個很長的任務標題需要在窄欄位省略'));
  expect(document.querySelector('.gantt-sidebar .task-link')).not.toBeInTheDocument();
 });

 it('drags a Gantt bar back to Backlog',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(denseWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  const taskRange=document.querySelector('.task-range') as HTMLElement;
  const backlog=document.querySelector('.backlog') as HTMLElement;
  const originalElementFromPoint=document.elementFromPoint;
  Object.defineProperty(document,'elementFromPoint',{configurable:true,value:()=>backlog});
  fireEvent.pointerDown(taskRange,{button:0,clientX:100,pointerId:1});
  fireEvent.pointerMove(taskRange,{clientX:90,pointerId:1});
  fireEvent.pointerUp(taskRange,{clientX:90,pointerId:1});
  await waitFor(()=>expect(document.querySelector('.backlog .task-card')).toHaveTextContent('這是一個很長的任務標題需要在窄欄位省略'));
  if(originalElementFromPoint)Object.defineProperty(document,'elementFromPoint',{configurable:true,value:originalElementFromPoint});
  else delete (document as {elementFromPoint?:typeof document.elementFromPoint}).elementFromPoint;
 });
});
