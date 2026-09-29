import type { Assignment, Demand, EventData, Person, ScheduleOptions, ScheduleResult } from './types';
import { availabilityState, canAssign, validateEvent } from './validate';
import { dayIntervals, overlap, splitByDay } from './time';

function random(seed: number) { let state=seed>>>0; return () => { state+=0x6D2B79F5; let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296; }; }
function mergeCreated(assignments: Assignment[], fixedIds: Set<string>): Assignment[] {
  const result: Assignment[]=[];
  for(const a of [...assignments].sort((a,b)=>a.personId.localeCompare(b.personId)||a.locationId.localeCompare(b.locationId)||a.roleId.localeCompare(b.roleId)||a.start-b.start)) {
    const previous=result[result.length-1];
    if(previous && !fixedIds.has(previous.id) && !fixedIds.has(a.id) && previous.personId===a.personId && previous.locationId===a.locationId && previous.roleId===a.roleId && previous.end===a.start && !previous.locked && !a.locked) previous.end=a.end;
    else result.push({...a});
  }
  return result.sort((a,b)=>a.start-b.start || a.locationId.localeCompare(b.locationId) || a.roleId.localeCompare(b.roleId) || a.personId.localeCompare(b.personId));
}
/** Seeded greedy construction: exact calendar boundaries, incremental constraint checks, independent final validation. No optimality or impossibility claim. */
export function schedule(event: EventData, options: ScheduleOptions): ScheduleResult {
  const started=performance.now(),seed=options.seed??event.policy.seed,limit=Math.max(0,options.timeLimitMs??event.policy.timeLimitMs);let attempts=0,serial=0;
  const originals=event.assignments.map(a=>({...a})); let preservedCrossing=0; let assignments: Assignment[]=[]; const fragments=new Set<string>();
  for(const a of originals) {
    if(options.mode==='fill' || a.locked) {assignments.push(a);continue;}
    if(options.mode==='all')continue;
    if(!options.range || (options.locationId && a.locationId!==options.locationId) || !overlap(a,options.range)) {assignments.push(a);continue;}
    // A clipped outside fragment must remain independently valid. Preserve the entire crossing
    // assignment if clipping would create a below-minimum shift outside the authorized range.
    if((a.start<options.range.start && options.range.start-a.start<event.policy.minimumAssignment) || (a.end>options.range.end && a.end-options.range.end<event.policy.minimumAssignment)) {assignments.push(a);preservedCrossing++;continue;}
    if(a.start<options.range.start) {assignments.push({...a,end:options.range.start});fragments.add(a.id);}
    if(a.end>options.range.end) {const fragment={...a,id:a.start<options.range.start?`${a.id}-after-${options.range.end}`:a.id,start:options.range.end};assignments.push(fragment);fragments.add(fragment.id);}
  }
  const fixedIds=new Set(assignments.map(a=>a.id));
  const existingIds=new Set(originals.map(a=>a.id));
  const nextId=()=>{while(existingIds.has(`auto-${seed}-${serial}`))serial++;return `auto-${seed}-${serial}`;};
  const finish=(status: ScheduleResult['status'], explanation: string): ScheduleResult=>{
    const output=status==='cancelled'||status==='invalid-fixed'?originals:mergeCreated(assignments,fixedIds);
    const validation=validateEvent(event,output);
    if(status==='complete' && (validation.errors.length || validation.shortages.length)) status='partial';
    return {assignments:output,validation,elapsedMs:performance.now()-started,status,seed,attempts,explanation:explanation+(preservedCrossing?` 선택 경계에서 최소 배정 길이보다 짧아질 기존 근무 ${preservedCrossing}건은 전체를 보존했습니다. 범위를 근무 전체로 넓혀 다시 시도할 수 있습니다.`:'')};
  };
  if(!Number.isSafeInteger(seed) || seed<0 || seed>4294967295 || !Number.isFinite(limit))return finish('invalid-fixed','초안 번호는 0~4294967295 정수이고 탐색 제한은 유효한 숫자여야 합니다.');
  if(options.mode==='selected' && (!options.range || !Number.isSafeInteger(options.range.start) || !Number.isSafeInteger(options.range.end) || options.range.end<=options.range.start))return finish('invalid-fixed','재배정 범위는 유효한 정수 분이며 종료가 시작보다 늦어야 합니다.');
  if(options.shouldCancel?.())return finish('cancelled','계산을 취소했습니다. 기존 배치가 유지됩니다.');
  const initial=validateEvent(event,assignments);
  const fixedErrors=initial.errors.filter(i=>!['LEADER_SHORTAGE','HARD_MIN'].includes(i.code) && !(i.code==='MIN_ASSIGNMENT' && i.assignmentIds?.every(id=>fragments.has(id))));
  if(fixedErrors.length)return finish('invalid-fixed','보존할 배정 또는 입력 조건에 오류가 있습니다. 먼저 오류를 수정하세요. 잠금은 해제되지 않았습니다.');
  if(options.mode==='selected' && (!options.range || options.range.end<=options.range.start))return finish('invalid-fixed','재배정할 시작·종료 범위를 선택하세요.');
  const demands=event.demands.filter(d=>d.count>0 && (options.mode!=='selected' || (overlap(d,options.range!) && (!options.locationId || options.locationId===d.locationId))));
  const activeStart=(d:Demand)=>options.mode==='selected'?Math.max(d.start,options.range!.start):d.start;
  const activeEnd=(d:Demand)=>options.mode==='selected'?Math.min(d.end,options.range!.end):d.end;
  const points=new Set<number>();
  for(const d of demands) {points.add(activeStart(d));points.add(activeEnd(d));for(const date of splitByDay(d.start,d.end))points.add(date.end);}
  for(const p of event.people)for(const a of p.availability){points.add(a.start);points.add(a.end);}
  for(const a of [...assignments,...event.programs.filter(p=>p.dedicated)]) {points.add(a.start);points.add(a.end);const p=event.people.find(p=>p.id===('personId' in a?a.personId:''));points.add(a.end+(p?.minBreak??0));points.add(a.end+event.policy.travelMinutes);}
  let timeline=[...points].sort((a,b)=>a-b);const addPoint=(n:number,after:number)=>{if(n>after && !points.has(n)){points.add(n);timeline.push(n);timeline.sort((a,b)=>a-b);}};
  const rng=random(seed); const tie=new Map(event.people.map(p=>[p.id,rng()]));
  const totals=new Map(event.people.map(p=>[p.id,initial.personMinutes[p.id]??0]));
  const capacity=new Map(event.people.map(p=>{
    let possible=0;
    for(const day of dayIntervals(event)) {
      const boundaries=[...new Set([day.start,day.end,...p.availability.flatMap(a=>[a.start,a.end])])].filter(n=>n>=day.start&&n<=day.end).sort((a,b)=>a-b);
      let daily=0;for(let i=0;i<boundaries.length-1;i++)if(availabilityState(p,boundaries[i],boundaries[i+1])==='available')daily+=boundaries[i+1]-boundaries[i];
      possible+=Math.min(daily,p.maxDaily??Infinity);
    }
    return [p.id,Math.max(1,Math.min(possible,p.maxTotal??Infinity))];
  }));
  const roleEligible=(p:Person,d:Demand)=>{const r=event.roles.find(r=>r.id===d.roleId);return (!p.allowedRoleIds.length||p.allowedRoleIds.includes(d.roleId)) && (r?.requiredTags??[]).every(t=>p.tags.includes(t));};
  const sameSlot=(a:Assignment,d:Demand)=>a.locationId===d.locationId&&a.roleId===d.roleId;
  function availableEnd(person:Person,d:Demand,start:number):number {
    // Look beyond the display atom. A person can remain across demand / availability boundaries.
    let end=Math.min(start+Math.max(event.policy.minimumAssignment,event.policy.preferredShift,1), options.mode==='selected'?options.range!.end:Infinity);
    const matching=event.demands.filter(x=>x.locationId===d.locationId&&x.roleId===d.roleId);
    const slot=assignments.filter(a=>sameSlot(a,d));
    const edges=[...new Set([start,end,...matching.flatMap(x=>[x.start,x.end]),...slot.flatMap(a=>[a.start,a.end])])].filter(t=>t>=start&&t<=end).sort((a,b)=>a-b);
    for(let j=0;j<edges.length-1;j++) {
      const s=edges[j],e=edges[j+1],demand=matching.find(x=>x.start<=s&&x.end>=e&&x.count>0);
      if(!demand) {end=s;break;}
      const present=slot.filter(a=>a.start<=s&&a.end>=e),leaders=present.filter(a=>event.people.find(p=>p.id===a.personId)?.tags.includes(demand.leaderTag)).length;
      const reserved=person.tags.includes(demand.leaderTag)?0:Math.max(0,demand.leaderMin-leaders);
      if(present.length>=demand.count-reserved){end=s;break;}
    }
    // Availability interruptions are exact; broad available intervals never override unavailable/unknown.
    const edgesAvail=[...new Set([start,end,...person.availability.flatMap(a=>[a.start,a.end])])].filter(n=>n>=start&&n<=end).sort((a,b)=>a-b);
    for(let j=0;j<edgesAvail.length-1;j++)if(availabilityState(person,edgesAvail[j],edgesAvail[j+1])!=='available'){end=edgesAvail[j];break;}
    return end;
  }
  for(let index=0;index<timeline.length-1;index++) {
    const at=timeline[index];
    if(options.shouldCancel?.())return finish('cancelled','계산을 취소했습니다. 기존 배치가 유지됩니다.');
    if(performance.now()-started>=limit)return finish('timeout','설정한 탐색 시간이 끝났습니다. 현재 후보를 검토하세요. 조건상 불가능하다는 뜻은 아닙니다.');
    const active=demands.filter(d=>activeStart(d)<=at&&activeEnd(d)>at);
    active.sort((a,b)=>{
      const ca=event.people.filter(p=>roleEligible(p,a)&&availabilityState(p,at,at+1)==='available'&&(!a.leaderMin||p.tags.includes(a.leaderTag))).length;
      const cb=event.people.filter(p=>roleEligible(p,b)&&availabilityState(p,at,at+1)==='available'&&(!b.leaderMin||p.tags.includes(b.leaderTag))).length;
      return ca-cb||b.leaderMin-a.leaderMin||a.id.localeCompare(b.id);
    });
    for(const demand of active) {
      let present=assignments.filter(a=>sameSlot(a,demand)&&a.start<=at&&a.end>at);let iterations=0;
      while(present.length<demand.count && iterations++<demand.count) {
        if(options.shouldCancel?.())return finish('cancelled','계산을 취소했습니다. 기존 배치가 유지됩니다.');
        if(performance.now()-started>=limit)return finish('timeout','설정한 탐색 시간이 끝났습니다. 현재 후보를 검토하세요. 조건상 불가능하다는 뜻은 아닙니다.');
        const leaders=present.filter(a=>event.people.find(p=>p.id===a.personId)?.tags.includes(demand.leaderTag)).length;
        const leaderNeeded=leaders<demand.leaderMin;
        let candidates=event.people.filter(p=>roleEligible(p,demand)&&availabilityState(p,at,at+1)==='available'&&!present.some(a=>a.personId===p.id));
        function score(p:Person):number {
          const previous=assignments.find(a=>a.personId===p.id&&a.end===at&&sameSlot(a,demand));
          const total=totals.get(p.id)??0;const hardDeficit=p.minMode==='hard'?Math.max(0,(p.minMinutes??0)-total):0;
          const preferred=p.availability.some(a=>a.state==='preferred'&&a.start<=at&&a.end>at);
          const fairness=total/(capacity.get(p.id)??1)*1000;
          const need=(p.desiredMinutes??p.minMinutes??0)>total?-20:0;
          return fairness-hardDeficit*10+need-(previous?(event.policy.preset==='continuous'?600:25):0)-(preferred?(event.policy.preset==='preferred'?500:15):0)+(tie.get(p.id)??0);
        }
        candidates=candidates.sort((a,b)=>(leaderNeeded?Number(b.tags.includes(demand.leaderTag))-Number(a.tags.includes(demand.leaderTag)):0)||score(a)-score(b));
        let selected:Assignment|undefined;
        for(const person of candidates) {
          if(leaderNeeded && !person.tags.includes(demand.leaderTag) && present.length>=demand.count-(demand.leaderMin-leaders))continue;
          let maximum=availableEnd(person,demand,at);if(maximum<=at)continue;
          const relevant=assignments.filter(a=>a.personId===person.id||sameSlot(a,demand));
          const candidate:Assignment={id:nextId(),personId:person.id,locationId:demand.locationId,roleId:demand.roleId,start:at,end:maximum,locked:false,source:'auto'};
          const check=(end:number)=>{attempts++;return canAssign(event,{...candidate,end},relevant).filter(i=>i.severity==='error'&&i.code!=='MIN_ASSIGNMENT').length===0;};
          if(!check(maximum)) {
            let low=at,high=maximum;
            while(high-low>1){const middle=Math.floor((low+high)/2);if(check(middle))low=middle;else high=middle;}
            maximum=low;
          }
          if(maximum<=at)continue;candidate.end=maximum;
          const issues=canAssign(event,candidate,relevant);attempts++;
          if(issues.some(i=>i.severity==='error'))continue;
          selected=candidate;serial++;break;
        }
        if(!selected)break;
        assignments.push(selected);totals.set(selected.personId,(totals.get(selected.personId)??0)+selected.end-selected.start);
        addPoint(selected.end,at);const person=event.people.find(p=>p.id===selected!.personId)!;addPoint(selected.end+(person.minBreak??0),at);addPoint(selected.end+event.policy.travelMinutes,at);
        present=assignments.filter(a=>sameSlot(a,demand)&&a.start<=at&&a.end>at);
      }
    }
  }
  return finish('complete','정수 분 경계의 휴리스틱 초안입니다. 독립 검증 결과와 부족 구간을 확인하세요. 전역 최적해를 보장하지 않습니다.');
}
