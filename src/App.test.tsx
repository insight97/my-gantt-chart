import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {beforeEach,describe,expect,it,vi} from 'vitest';
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

describe('Project arrangement',()=>{
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
});
