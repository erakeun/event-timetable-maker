import type { Assignment, EventData, Interval, Issue, Person, ValidationResult } from './types';
import { covers, dayIntervals, formatRange, overlap, splitByDay } from './time';

const validInterval = (i: Interval) => Number.isSafeInteger(i.start) && Number.isSafeInteger(i.end) && i.end > i.start && i.end-i.start <= 366*1440;
const issue = (code: string, message: string, extra: Partial<Issue> = {}): Issue => ({ code, message, severity: 'error', ...extra });
export function availabilityState(person: Person, start: number, end: number): 'available' | 'unavailable' | 'unknown' {
  if (end <= start) return 'unknown';
  if (splitByDay(start,end).some(d => person.blockedDates.includes(d.date))) return 'unavailable';
  if (person.availability.some(a => a.state === 'unavailable' && overlap(a,{start,end}))) return 'unavailable';
  if (person.availability.some(a => a.state === 'unknown' && overlap(a,{start,end}))) return 'unknown';
  return covers(person.availability.filter(a=>a.state==='available'),start,end) ? 'available' : 'unknown';
}

interface Occupancy extends Interval { id: string; locationId: string; }
function occupancies(event: EventData, personId: string, assignments: Assignment[]): Occupancy[] {
  return [...assignments.filter(a=>a.personId===personId), ...event.programs.filter(p=>p.dedicated && p.personId===personId)].filter(validInterval).sort((a,b)=>a.start-b.start || a.end-b.end);
}
function personIssues(event: EventData, person: Person, assignments: Assignment[]): Issue[] {
  const result: Issue[] = []; const jobs = occupancies(event,person.id,assignments); const daily: Record<string,number> = Object.create(null); let total = 0;
  const add = (code: string, message: string, ids: string[] = []) => result.push(issue(code, `${person.alias || person.name}: ${message}`, { personId: person.id, assignmentIds: ids }));
  for (const a of jobs) {
    total += a.end-a.start;
    for (const d of splitByDay(a.start,a.end)) daily[d.date]=(daily[d.date]??0)+d.minutes;
    const state = availabilityState(person,a.start,a.end);
    if (state !== 'available') add(state==='unavailable'?'UNAVAILABLE':'UNKNOWN',`${formatRange(a.start,a.end)} ${state==='unavailable'?'불가시간':'미확인 시간'}입니다. 가능시간을 명시적으로 확인하세요.`,[a.id]);
  }
  if (person.maxTotal !== undefined && total > person.maxTotal) add('MAX_TOTAL',`전체 최대 ${person.maxTotal}분을 초과했습니다.`);
  for (const [date, minutes] of Object.entries(daily)) if (person.maxDaily !== undefined && minutes > person.maxDaily) add('MAX_DAILY',`${date} 일일 최대 ${person.maxDaily}분을 초과했습니다.`);
  let runStart = jobs[0]?.start ?? 0; let runEnd = jobs[0]?.end ?? 0;
  for (let i=0;i<jobs.length;i++) {
    const a=jobs[i];
    // Scan all earlier overlapping entries (not just the previous entry, which could be nested).
    for (let j=i-1;j>=0;j--) { const b=jobs[j]; if (overlap(a,b)) add('OVERLAP',`${formatRange(a.start,Math.min(a.end,b.end))} 동시 배정입니다.`,[b.id,a.id]); }
    if (i) {
      const b=jobs[i-1]; const gap=a.start-b.end;
      if (gap > 0 && person.minBreak !== undefined && gap < person.minBreak) add('MIN_BREAK',`최소 휴게 ${person.minBreak}분에 비해 간격이 ${gap}분입니다.`,[b.id,a.id]);
      if (gap >= 0 && a.locationId !== b.locationId && gap < event.policy.travelMinutes) add('TRAVEL',`다른 장소까지 이동시간 ${event.policy.travelMinutes}분이 필요합니다.`,[b.id,a.id]);
      if (a.start <= runEnd) runEnd=Math.max(runEnd,a.end); else { runStart=a.start; runEnd=a.end; }
    }
    if (person.maxContinuous !== undefined && runEnd-runStart > person.maxContinuous) add('MAX_CONTINUOUS',`역할 변경을 포함한 연속 배정이 최대 ${person.maxContinuous}분을 초과했습니다.`,[a.id]);
  }
  return result;
}
function assignmentIssues(event: EventData, a: Assignment, assignments: Assignment[], operating: Interval[]): Issue[] {
  const result: Issue[]=[]; const add=(code:string,message:string)=>result.push(issue(code,message,{personId:a.personId,assignmentIds:[a.id],start:a.start,end:a.end}));
  if (!validInterval(a)) { add('INVALID_TIME','배정 시간은 유효한 정수 분이며 종료가 시작보다 늦어야 합니다.'); return result; }
  const p=event.people.find(p=>p.id===a.personId), role=event.roles.find(r=>r.id===a.roleId);
  if (!p) add('MISSING_PERSON','삭제되었거나 존재하지 않는 참여자가 배정에 연결되어 있습니다.');
  if (!role) add('MISSING_ROLE','존재하지 않는 역할입니다.');
  if (!event.locations.some(l=>l.id===a.locationId)) add('MISSING_LOCATION','존재하지 않는 장소입니다.');
  if (p && role && ((p.allowedRoleIds.length && !p.allowedRoleIds.includes(role.id)) || role.requiredTags.some(t=>!p.tags.includes(t)))) add('QUALIFICATION',`${p.name}: ${role.name} 역할의 자격 조건을 만족하지 않습니다.`);
  if (!covers(operating,a.start,a.end)) add('OUTSIDE_EVENT','행사 운영시간 밖의 배정입니다.');
  const matching=event.demands.filter(d=>d.locationId===a.locationId && d.roleId===a.roleId && d.count>0);
  if (!covers(matching,a.start,a.end)) add('OUTSIDE_DEMAND','운영하지 않거나 필요 인원이 0명인 구간의 배정입니다.');
  const same=assignments.filter(b=>b.personId===a.personId && b.locationId===a.locationId && b.roleId===a.roleId && validInterval(b)).sort((a,b)=>a.start-b.start);
  let start=a.start,end=a.end; let changed=true;
  while(changed) { changed=false; for(const b of same) if(b.start<=end && b.end>=start) { const s=Math.min(start,b.start),e=Math.max(end,b.end); if(s!==start || e!==end){start=s;end=e;changed=true;} } }
  if (end-start<event.policy.minimumAssignment) add('MIN_ASSIGNMENT',`같은 역할의 연속 배정은 최소 ${event.policy.minimumAssignment}분이어야 합니다.`);
  const bounds=[...new Set([a.start,a.end,...matching.flatMap(d=>[d.start,d.end]),...assignments.filter(b=>b.locationId===a.locationId && b.roleId===a.roleId && overlap(a,b)).flatMap(b=>[b.start,b.end])])].filter(t=>t>=a.start && t<=a.end).sort((a,b)=>a-b);
  for(let i=0;i<bounds.length-1;i++) {
    const s=bounds[i],e=bounds[i+1]; const demand=matching.find(d=>d.start<=s && d.end>=e); if(!demand) continue;
    const active=assignments.filter(b=>b.locationId===a.locationId && b.roleId===a.roleId && b.start<=s && b.end>=e);
    if(active.length>demand.count) { result.push(issue('OVERSTAFF',`${formatRange(s,e)} 필요 ${demand.count}명보다 ${active.length-demand.count}명 초과했습니다.`,{severity:event.policy.allowOverstaff && active.filter(a=>a.source==='auto').length<=demand.count?'warning':'error',assignmentIds:active.map(a=>a.id),start:s,end:e})); break; }
  }
  return result;
}

/** Incremental assignment validation. Aggregate supervisor coverage and hard minimum totals are final-state checks. */
export function canAssign(event: EventData, candidate: Assignment, assignments: Assignment[] = event.assignments): Issue[] {
  const next=[...assignments.filter(a=>a.id!==candidate.id),candidate];
  let operating: Interval[]=[]; try { operating=dayIntervals(event); } catch { return [issue('INVALID_DAY','행사 날짜·시간이 유효하지 않습니다.')]; }
  const p=event.people.find(p=>p.id===candidate.personId);
  return [...assignmentIssues(event,candidate,next,operating),...(p?personIssues(event,p,next):[])].map(i=>i.code==='OVERSTAFF' && candidate.source==='auto'?{...i,severity:'error' as const}:i);
}

export function validateEvent(event: EventData, assignments: Assignment[] = event.assignments): ValidationResult {
  const all: Issue[]=[]; const result: ValidationResult={errors:[],warnings:[],shortages:[],requiredMinutes:0,coveredMinutes:0,shortageMinutes:0,personMinutes:Object.create(null),dailyMinutes:Object.create(null),locationStats:Object.create(null)};
  if(!event.name.trim()) all.push(issue('EMPTY_EVENT_NAME','행사명을 입력하세요.'));
  if(event.timezone!=='Asia/Seoul' || event.schemaVersion!==1) all.push(issue('EVENT_METADATA','지원하지 않는 시간대 또는 데이터 버전입니다.'));
  for(const l of event.locations)if(!l.name.trim())all.push(issue('EMPTY_LOCATION_NAME','장소 이름을 입력하세요.'));
  for(const r of event.roles)if(!r.name.trim())all.push(issue('EMPTY_ROLE_NAME','역할 이름을 입력하세요.'));
  if(new Set(event.days.map(d=>d.date)).size!==event.days.length)all.push(issue('DUPLICATE_DATE','같은 운영 날짜는 하나의 날짜 설정으로 입력하세요.'));
  for(const key of ['minimumAssignment','preferredShift','travelMinutes','timeLimitMs','seed'] as const) if(!Number.isSafeInteger(event.policy[key]) || event.policy[key]<0 || (key==='preferredShift' && event.policy[key]===0)) all.push(issue('INVALID_POLICY','편성 정책은 유효한 정수 분이어야 합니다.'));
  if(![5,10,15,20,30,60].includes(event.policy.gridMinutes)) all.push(issue('INVALID_POLICY','화면 눈금은 5/10/15/20/30/60분 중 선택하세요.'));
  let operating: Interval[]=[];
  try { operating=dayIntervals(event); if(operating.some(i=>!validInterval(i))) all.push(issue('INVALID_DAY','운영 종료는 시작보다 늦어야 합니다. 자정 넘김은 다음 날 종료를 선택하세요.')); }
  catch { all.push(issue('INVALID_DAY','행사 날짜·시간이 유효하지 않습니다.')); }
  for(let i=0;i<operating.length;i++) for(let j=i+1;j<operating.length;j++) if(overlap(operating[i],operating[j])) all.push(issue('DAY_OVERLAP','날짜별 운영시간이 서로 중복됩니다.'));
  const groups=[event.people,event.locations,event.roles,event.demands,assignments,event.programs,event.days];
  for(const list of groups) { const seen=new Set<string>(); for(const item of list) { if(!item.id || seen.has(item.id)) all.push(issue('DUPLICATE_ID','비어 있거나 중복된 내부 ID가 있습니다.')); seen.add(item.id); } }
  for(const p of event.people) {
    if(!p.name.trim()) all.push(issue('EMPTY_NAME','참여자 이름을 입력하세요.',{personId:p.id}));
    if(p.availability.some(a=>!validInterval(a))) all.push(issue('INVALID_AVAILABILITY',`${p.name}: 가능시간 형식이 올바르지 않습니다.`,{personId:p.id}));
    for(const a of p.availability.filter(a=>a.state==='preferred')) if(availabilityState(p,a.start,a.end)!=='available') all.push(issue('PREFERENCE_NOT_AVAILABLE',`${p.name}: 선호시간은 확인된 가능시간의 부분집합이어야 합니다.`,{personId:p.id}));
    for(const key of ['maxDaily','maxTotal','maxContinuous','minBreak','desiredMinutes','minMinutes'] as const) if(p[key]!==undefined && (!Number.isSafeInteger(p[key]) || p[key]!<0)) all.push(issue('INVALID_LIMIT',`${p.name}: 시간 조건은 0 이상의 정수 분이어야 합니다.`,{personId:p.id}));
    all.push(...personIssues(event,p,assignments));
    const jobs=occupancies(event,p.id,assignments); result.personMinutes[p.id]=jobs.reduce((n,a)=>n+a.end-a.start,0); result.dailyMinutes[p.id]=Object.create(null);
    for(const a of jobs) for(const d of splitByDay(a.start,a.end)) result.dailyMinutes[p.id][d.date]=(result.dailyMinutes[p.id][d.date]??0)+d.minutes;
    if(p.minMinutes && result.personMinutes[p.id]<p.minMinutes) all.push(issue(p.minMode==='hard'?'HARD_MIN':'SOFT_MIN',`${p.name}: ${p.minMode==='hard'?'필수':'희망'} 최소 ${p.minMinutes}분 중 ${result.personMinutes[p.id]}분 배정되었습니다.`,{severity:p.minMode==='hard'?'error':'warning',personId:p.id}));
  }
  for(const a of assignments) all.push(...assignmentIssues(event,a,assignments,operating));
  const contextBoundaries=[...new Set([...event.people.flatMap(p=>p.availability.filter(validInterval).flatMap(a=>[a.start,a.end])),...event.programs.filter(validInterval).flatMap(p=>[p.start,p.end])])];
  for(const d of event.demands) {
    if(!validInterval(d) || !Number.isSafeInteger(d.count) || d.count<0 || !Number.isSafeInteger(d.leaderMin) || d.leaderMin<0 || d.leaderMin>d.count || (d.leaderMin>0 && !d.leaderTag.trim())) {all.push(issue('INVALID_DEMAND','필요 인원·책임자 수와 수요 시간이 유효하지 않습니다.'));continue;}
    if(!event.roles.some(r=>r.id===d.roleId) || !event.locations.some(l=>l.id===d.locationId)) all.push(issue('DEMAND_REFERENCE','수요의 장소 또는 역할이 없습니다.'));
    if(!covers(operating,d.start,d.end)) all.push(issue('DEMAND_OUTSIDE_EVENT','수요가 행사 운영시간을 벗어납니다.'));
    const bounds=[...new Set([d.start,d.end,...splitByDay(d.start,d.end).map(day=>day.end),...contextBoundaries.filter(t=>t>d.start&&t<d.end),...assignments.filter(a=>a.locationId===d.locationId && a.roleId===d.roleId && overlap(a,d)).flatMap(a=>[Math.max(a.start,d.start),Math.min(a.end,d.end)])])].sort((a,b)=>a-b);
    const loc=result.locationStats[d.locationId]??={requiredMinutes:0,coveredMinutes:0,shortageMinutes:0};
    for(let i=0;i<bounds.length-1;i++) {
      const start=bounds[i],end=bounds[i+1],duration=end-start; const active=assignments.filter(a=>a.locationId===d.locationId && a.roleId===d.roleId && a.start<=start && a.end>=end);
      const assigned=new Set(active.map(a=>a.personId)).size; const missing=Math.max(0,d.count-assigned); const leaders=new Set(active.filter(a=>event.people.find(p=>p.id===a.personId)?.tags.includes(d.leaderTag)).map(a=>a.personId)).size; const leaderMissing=Math.max(0,d.leaderMin-leaders);
      result.requiredMinutes+=d.count*duration;result.coveredMinutes+=Math.min(d.count,assigned)*duration;result.shortageMinutes+=missing*duration;
      loc.requiredMinutes+=d.count*duration;loc.coveredMinutes+=Math.min(d.count,assigned)*duration;loc.shortageMinutes+=missing*duration;
      if(leaderMissing) all.push(issue('LEADER_SHORTAGE',`${formatRange(start,end)} 총 ${d.count}명 안에 필요한 책임자 ${d.leaderMin}명 중 ${leaderMissing}명이 부족합니다.`,{start,end}));
      if(missing || leaderMissing) {
        const role=event.roles.find(r=>r.id===d.roleId);
        const eligible=event.people.filter(p=>availabilityState(p,start,end)==='available' && (!p.allowedRoleIds.length || p.allowedRoleIds.includes(d.roleId)) && (role?.requiredTags??[]).every(t=>p.tags.includes(t)));
        const leaderEligible=eligible.filter(p=>p.tags.includes(d.leaderTag)).length;
        const reason=leaderMissing && leaderEligible===0 ? '이 구간에 역할 자격·가능시간을 만족하는 책임자가 없습니다. 인원 또는 조건을 확인하세요.' : `역할 자격·가능시간 기준 후보 ${eligible.length}명, 현재 ${assigned}명 배정. 휴게·상한·다른 배정도 영향을 줍니다. 현재 초안의 부족이며 전체 문제의 불가능 증명은 아닙니다.`;
        result.shortages.push({locationId:d.locationId,roleId:d.roleId,start,end,needed:d.count,assigned,missing,leaderMissing,reason});
      }
    }
  }
  for(let i=0;i<event.demands.length;i++) for(let j=i+1;j<event.demands.length;j++) { const a=event.demands[i],b=event.demands[j]; if(a.locationId===b.locationId && a.roleId===b.roleId && overlap(a,b)) all.push(issue('DEMAND_OVERLAP','같은 장소·역할의 필요 인원 구간이 중복됩니다. 구간을 나누어 입력하세요.')); }
  for(const p of event.programs) {
    if(!validInterval(p)) {all.push(issue('INVALID_PROGRAM','진행 항목의 시간이 유효하지 않습니다.'));continue;}
    if(!covers(operating,p.start,p.end)) all.push(issue('PROGRAM_OUTSIDE_EVENT',`${p.title}: 행사 운영시간을 벗어납니다.`));
    if(p.locationId && !event.locations.some(l=>l.id===p.locationId)) all.push(issue('PROGRAM_LOCATION',`${p.title}: 연결된 장소가 없습니다.`));
    if(p.personId && !event.people.some(person=>person.id===p.personId)) all.push(issue('PROGRAM_PERSON',`${p.title}: 연결된 담당자가 없습니다.`));
    if(p.dedicated && !p.personId) all.push(issue('PROGRAM_PERSON',`${p.title}: 전담자를 선택하세요.`));
  }
  for(let i=0;i<event.programs.length;i++) for(let j=i+1;j<event.programs.length;j++) { const a=event.programs[i],b=event.programs[j]; if(a.locationId && a.locationId===b.locationId && overlap(a,b) && !(a.allowSharedLocation && b.allowSharedLocation)) all.push(issue('PROGRAM_LOCATION_OVERLAP',`${a.title} / ${b.title}: 같은 장소의 진행 시간이 겹칩니다. 장소 공유 여부를 명시하세요.`,{severity:'warning',start:Math.max(a.start,b.start),end:Math.min(a.end,b.end)})); }
  const seen=new Set<string>(); for(const i of all) { const key=JSON.stringify(i);if(seen.has(key))continue;seen.add(key);(i.severity==='error'?result.errors:result.warnings).push(i); }
  return result;
}
