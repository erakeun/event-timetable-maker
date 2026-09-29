import { mkdirSync,writeFileSync } from 'node:fs';
import { cpus,platform,arch } from 'node:os';
import { it,expect } from 'vitest';
import { createEvent,createPerson } from '../src/core/defaults';
import { toMinute } from '../src/core/time';
import { schedule } from '../src/core/scheduler';
import type { EventData } from '../src/core/types';
export function performanceEvent():EventData {
  const e=createEvent('가상 규모 검증: 7일 100명 10장소');e.policy={...e.policy,minimumAssignment:30,preferredShift:120,travelMinutes:10,timeLimitMs:30000};
  e.days=Array.from({length:7},(_,i)=>({id:`day${i}`,date:`2026-10-${String(10+i)}`,start:'09:00',end:'17:00',nextDay:false}));
  e.locations=Array.from({length:10},(_,i)=>({id:`L${i}`,name:`가상 장소 ${i+1}`}));e.roles=[{id:'R',name:'안내',requiredTags:[]}];
  e.demands=e.days.flatMap(d=>e.locations.map(l=>({id:`D-${d.id}-${l.id}`,start:toMinute(d.date,d.start),end:toMinute(d.date,d.end),locationId:l.id,roleId:'R',count:2,leaderTag:'',leaderMin:0,phase:'본행사'})));
  e.people=Array.from({length:100},(_,i)=>{const p=createPerson(`가상 ${i+1}`);p.id=`P${i}`;p.maxDaily=240;p.maxTotal=1680;p.maxContinuous=120;p.minBreak=30;p.availability=e.days.map(d=>({id:`A-${i}-${d.id}`,start:toMinute(d.date,d.start),end:toMinute(d.date,d.end),state:'available'}));return p;});return e;
}
it('24 7일·100명·10장소·30분 눈금의 실제 실행과 취소 보존',()=>{
  const e=performanceEvent(),original=structuredClone(e);const r=schedule(e,{mode:'all',seed:2409,timeLimitMs:30000});
  console.log(JSON.stringify({scenario:'7 days / 100 people / 10 locations / 70 demand intervals / 30 min grid',elapsedMs:Math.round(r.elapsedMs*100)/100,status:r.status,assignments:r.assignments.length,attempts:r.attempts,requiredMinutes:r.validation.requiredMinutes,coveredMinutes:r.validation.coveredMinutes,shortageMinutes:r.validation.shortageMinutes,errors:r.validation.errors.length}));
  expect(r.status).toBe('complete');expect(r.validation.errors).toEqual([]);expect(r.validation.shortageMinutes).toBe(0);expect(r.validation.requiredMinutes).toBe(67200);expect(e).toEqual(original);
  let checks=0;const cancelled=schedule(e,{mode:'all',seed:2409,timeLimitMs:30000,shouldCancel:()=>++checks>=20});
  console.log(JSON.stringify({scenario:'cooperative cancellation',elapsedMs:Math.round(cancelled.elapsedMs*100)/100,status:cancelled.status,attempts:cancelled.attempts}));
  expect(cancelled.status).toBe('cancelled');expect(cancelled.assignments).toEqual(original.assignments);expect(e).toEqual(original);
  mkdirSync('docs/qa',{recursive:true});
  writeFileSync('docs/qa/core-performance.json',JSON.stringify({recordedAt:new Date().toISOString(),reproduceCommand:'npx vitest run tests/performance-engine.test.ts --silent=false',runtime:{node:process.version,platform:platform(),architecture:arch(),cpu:cpus()[0]?.model},scenario:{days:7,people:100,locations:10,demandIntervals:70,gridMinutes:30,minutesPerDay:480,peoplePerLocation:2,maxDaily:240,maxTotal:1680,maxContinuous:120,minBreak:30,travelMinutes:10,seed:2409,timeLimitMs:30000},result:{elapsedMs:r.elapsedMs,status:r.status,assignments:r.assignments.length,attempts:r.attempts,requiredMinutes:r.validation.requiredMinutes,coveredMinutes:r.validation.coveredMinutes,shortageMinutes:r.validation.shortageMinutes,errors:r.validation.errors.length},cooperativeCancellation:{elapsedMs:cancelled.elapsedMs,status:cancelled.status,attempts:cancelled.attempts,originalPreserved:true},limitations:['Node unit-test runtime, not browser rendering time','Cooperative cancellation callback only; Worker termination requires separate browser E2E evidence','Performance is this measured scenario, not a guarantee for file-size limits']},null,2)+'\n');
},40000);
