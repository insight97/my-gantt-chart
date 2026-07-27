import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {WorkspaceData} from './types';

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

 it('changes the Gantt timeline scale for day, week, and month views',async()=>{
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

 it('aggregates capacity into non-editable week and month summaries',async()=>{
  loadWorkspaceMock.mockResolvedValue(structuredClone(aggregationWorkspace));
  render(<App/>);
  await waitFor(()=>expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button',{name:'週'}));
  await waitFor(()=>expect(document.querySelectorAll('.capacity-period').length).toBeGreaterThan(0));
  const weekPeriods=document.querySelectorAll('.capacity-period');
  expect(weekPeriods.length).toBeLessThan(10);
  expect(document.querySelectorAll('.capacity-period[role="button"]')).toHaveLength(0);
  expect(Array.from(weekPeriods).some(period=>period.textContent?.includes('56h'))).toBe(true);

  fireEvent.click(screen.getByRole('button',{name:'月'}));
  await waitFor(()=>expect(document.querySelectorAll('.capacity-period').length).toBeGreaterThan(0));
  expect(document.querySelectorAll('.capacity-period[role="button"]')).toHaveLength(0);
  expect(Array.from(document.querySelectorAll('.capacity-period')).some(period=>period.textContent?.includes('248h'))).toBe(true);
 });
});
