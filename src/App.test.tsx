import {cleanup,createEvent,fireEvent,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
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
  {id:'project-a',name:'Alpha Project',description:'第一個 Project',createdAt:'2026-01-01',updatedAt:'2026-01-01',tasks:[{id:'task-a',name:'跨週 Task',start:'2026-01-05',end:'2026-01-18',estimatedHours:40,status:'scheduled',notes:'',owner:'',color:'#2f75bb',createdAt:'2026-01-01',updatedAt:'2026-01-01'}]},
  {id:'project-b',name:'Beta Project',description:'第二個 Project',createdAt:'2026-01-01',updatedAt:'2026-01-01',tasks:[]},
 ],
 dailyCapacities:[],
 allocations:[],
};

const denseWorkspace:WorkspaceData=structuredClone(aggregationWorkspace);
denseWorkspace.projects[0].tasks[0].name='這是一個很長的任務標題需要在窄欄位省略';

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
});
