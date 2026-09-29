import type { EventData } from '../core/types';
import { assertEventStructure } from './backups';

export const DB_NAME = 'project-mach-event-timetable-maker-v1';
export const STORAGE_PREFIX = 'event-timetable-maker:';
export class RevisionConflictError extends Error {
  constructor(public currentRevision: number | null) { super('다른 탭에서 수정되었거나 삭제된 행사입니다. 새로 불러오거나 사본으로 보관하세요.'); this.name = 'RevisionConflictError'; }
}
function db(): Promise<IDBDatabase> {
  return new Promise((resolve,reject) => {
    if (!globalThis.indexedDB) { reject(new Error('이 브라우저에서 저장소를 사용할 수 없습니다. JSON 백업으로 편집 내용을 보관하세요.')); return; }
    const request = indexedDB.open(DB_NAME,1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('events')) request.result.createObjectStore('events',{ keyPath:'id' }); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('다른 탭이 저장소 업그레이드를 막고 있습니다. 다른 탭을 닫고 다시 시도하세요.'));
  });
}
async function read<T>(fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await db();
  return new Promise((resolve,reject) => { const tx = database.transaction('events','readonly'); const request = fn(tx.objectStore('events')); let result: T; request.onsuccess = () => { result = request.result; }; tx.oncomplete = () => { database.close(); resolve(result); }; tx.onerror = () => { database.close(); reject(tx.error || request.error); }; tx.onabort = () => { database.close(); reject(tx.error || new Error('저장소 읽기가 취소되었습니다.')); }; });
}
let storageWarnings:string[]=[];
export function getStorageWarnings():string[]{return [...storageWarnings];}
export async function listEvents(): Promise<EventData[]> {
  const result=await read(s=>s.getAll());storageWarnings=[];const valid:EventData[]=[];
  for(const item of result){try{assertEventStructure(item);valid.push(item);}catch(error){storageWarnings.push(`저장 항목 ${String(item?.id??'ID 없음').slice(0,120)}을 열지 않았습니다: ${error instanceof Error?error.message:String(error)} 원본 저장자료는 삭제하지 않았습니다.`);}}
  return valid.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
export async function loadEvent(id: string): Promise<EventData | undefined> { const event = await read(s => s.get(id)); if (event) assertEventStructure(event); return event; }
/** Compare-and-swap occurs in one readwrite transaction, including across tabs. null means create only. */
export async function saveEvent(event: EventData, expectedRevision: number | null): Promise<EventData> {
  assertEventStructure(event);
  const database = await db();
  return new Promise((resolve,reject) => {
    const tx = database.transaction('events','readwrite'), store = tx.objectStore('events'); const request = store.get(event.id);
    let failure: Error | null = null, saved: EventData;
    request.onsuccess = () => {
      const current = request.result as EventData | undefined;
      if ((current?.revision ?? null) !== expectedRevision) { failure = new RevisionConflictError(current?.revision ?? null); tx.abort(); return; }
      saved = structuredClone({ ...event, revision: (current?.revision ?? -1) + 1, updatedAt: new Date().toISOString() }); store.put(saved);
    };
    tx.oncomplete = () => { database.close(); resolve(saved); };
    tx.onabort = tx.onerror = () => { database.close(); reject(failure || tx.error || new Error('저장에 실패했습니다. 편집 내용을 JSON 백업으로 보관하세요.')); };
  });
}
async function mutate(fn: (store: IDBObjectStore) => void): Promise<void> {
  const database = await db();
  return new Promise((resolve,reject) => { const tx = database.transaction('events','readwrite'); fn(tx.objectStore('events')); tx.oncomplete = () => { database.close(); resolve(); }; tx.onerror = tx.onabort = () => { database.close(); reject(tx.error || new Error('저장자료 삭제에 실패했습니다.')); }; });
}
export function deleteEvent(id: string): Promise<void> { return mutate(s => { s.delete(id); }); }
/** Clears this app only, never deletes another app's database or localStorage. */
export async function clearEvents(): Promise<void> {
  await mutate(s => { s.clear(); });
  if (typeof localStorage !== 'undefined') for (const key of Object.keys(localStorage)) if (key.startsWith(STORAGE_PREFIX)) localStorage.removeItem(key);
}
