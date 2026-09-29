import type { EventData, Assignment, Snapshot } from './types';
import { validateEvent } from './validate';
import { id } from './defaults';
export function confirmEvent(event:EventData):EventData {
 const result=validateEvent(event);
 if(result.errors.length || result.shortages.some(s=>s.missing>0 || s.leaderMissing>0)) throw new Error('오류와 인원 부족을 모두 해결해야 확정할 수 있습니다.');
 if(event.status!=='draft') throw new Error('초안만 확정할 수 있습니다.');
 const data=structuredClone(event); data.status='confirmed'; const {snapshots,...frozen}=data;
 const snapshot:Snapshot={id:id(),version:event.edition,confirmedAt:new Date().toISOString(),data:structuredClone(frozen)};
 return {...data,snapshots:[...snapshots,snapshot]};
}
export function newRevision(event:EventData):EventData {
 return {...structuredClone(event),status:'draft',edition:Math.max(event.edition,...event.snapshots.map(s=>s.version))+1};
}
function key(a:Assignment){return [a.personId,a.locationId,a.roleId,a.start,a.end].join('|');}
export function assignmentChanges(before:Assignment[],after:Assignment[]){
 const old=new Set(before.map(key)), next=new Set(after.map(key));
 return {removed:before.filter(a=>!next.has(key(a))),added:after.filter(a=>!old.has(key(a)))};
}
export function changedPersonIds(event:EventData):string[]{
 const currentSnapshot=event.snapshots.at(-1);
 const previous=event.status==='confirmed'?event.snapshots.at(-2):currentSnapshot;
 if(!previous)return event.people.map(p=>p.id);
 const changes=assignmentChanges(previous.data.assignments,event.assignments);
 const changed=new Set([...changes.added,...changes.removed].map(a=>a.personId));
 const programSignature=(programs:EventData['programs'],personId:string)=>JSON.stringify(programs.filter(p=>p.dedicated&&p.personId===personId).map(p=>[p.title,p.start,p.end,p.locationId]).sort());
 for(const personId of new Set([...previous.data.people,...event.people].map(p=>p.id)))if(programSignature(previous.data.programs,personId)!==programSignature(event.programs,personId))changed.add(personId);
 for(const p of event.people){const old=previous.data.people.find(v=>v.id===p.id);if(!old||old.name!==p.name||old.alias!==p.alias||old.team!==p.team)changed.add(p.id);}
 return [...changed];
}
