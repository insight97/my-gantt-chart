import type { Project } from './types';
const DB='gantt-local-db', STORE='projects';
function open(){return new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>req.result.createObjectStore(STORE,{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
export async function loadProjects(){const db=await open();return new Promise<Project[]>((resolve,reject)=>{const r=db.transaction(STORE).objectStore(STORE).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function saveProjects(items:Project[]){const db=await open();await new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');const s=tx.objectStore(STORE);s.clear();items.forEach(x=>s.put(x));tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
