import { useState } from 'react';
import type { EventData, Shortage, ValidationResult } from '../core/types';
import { canAssign } from '../core/validate';
import { dateOf, formatRange } from '../core/time';
function Candidates({event,s}:{event:EventData;s:Shortage}) {
 const [open,setOpen]=useState(false);
 return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>참여자별 배정 가능 여부 확인</summary>{open&&<><p>현재 배정을 유지한 채 이 구간 전체에 추가할 때의 검사입니다. 다른 배정의 이동·교환 가능성을 모두 탐색한 결과는 아닙니다.</p><ul>{event.people.map(p=>{
 const issues=canAssign(event,{id:'ux-candidate',personId:p.id,locationId:s.locationId,roleId:s.roleId,start:s.start,end:s.end,locked:false,source:'manual'}).filter(i=>i.severity==='error');
 return <li key={p.id}>{p.alias||p.name}: {issues.length?[...new Set(issues.map(i=>i.message))].join(' / '):'이 구간에 추가 가능 (책임자 조건은 별도 확인)'}</li>;
 })}</ul></>}</details>;
}
export default function Issues({event,validation,onSlot,onNavigate}:{event:EventData;validation:ValidationResult;onSlot:(s:Shortage)=>void;onNavigate:(step:number,personId?:string)=>void}) {
 const [all,setAll]=useState(false);
 // Supervisor errors are presented once through the richer shortage entries.
 const errors=validation.errors.filter(v=>v.code!=='LEADER_SHORTAGE');
 const shortages=validation.shortages.filter(s=>s.missing||s.leaderMissing);
 return <section className="panel"><h3>수정 필요 · 부족 원인</h3><p>날짜와 위치를 확인하고 해당 시간 또는 설정으로 이동하세요.</p><ul className="issue-list">{(all?errors:errors.slice(0,30)).map((v,i)=>{
 const a=event.assignments.find(a=>v.assignmentIds?.includes(a.id));
 const target=v.code.includes('PROGRAM')?5:v.personId?2:v.code.includes('DEMAND')||v.code.includes('ROLE')||v.code.includes('LOCATION')?1:0;
 return <li key={'e'+i} className="error-text"><strong>오류 · {a?`${dateOf(a.start)} ${formatRange(a.start,a.end)} · ${event.locations.find(l=>l.id===a.locationId)?.name||'장소 확인'} / ${event.roles.find(r=>r.id===a.roleId)?.name||'역할 확인'} · `:v.start!==undefined?`${dateOf(v.start)} · `:''}</strong>{v.message} {a?<button className="button secondary" onClick={()=>onSlot({start:a.start,end:a.end,locationId:a.locationId,roleId:a.roleId,needed:0,assigned:0,missing:0,leaderMissing:0,reason:''})}>해당 시간 보기</button>:null}<button className="button secondary" onClick={()=>onNavigate(target,v.personId)}>관련 설정 수정</button></li>;
 })}{(all?shortages:shortages.slice(0,40)).map((s,i)=><li key={'s'+i}><strong>{dateOf(s.start)} · {formatRange(s.start,s.end)}</strong><p>{event.locations.find(l=>l.id===s.locationId)?.name} / {event.roles.find(r=>r.id===s.roleId)?.name} · 필요 {s.needed}명 · 배정 {s.assigned}명 · {s.missing}명 부족{s.leaderMissing?` · 책임자 ${s.leaderMissing}명 부족`:''}</p><p>{s.reason}</p><button className="button secondary" onClick={()=>onSlot(s)}>해당 시간 보기</button><Candidates event={event} s={s}/></li>)}</ul>{!all&&(errors.length>30||shortages.length>40)&&<button className="button secondary" onClick={()=>setAll(true)}>문제 전체 보기 ({errors.length+shortages.length}건)</button>}<p className="muted">현재 조건과 배정의 검사입니다. 후보가 있어도 다른 배정·휴게·상한·잠금과 함께 확인해야 합니다. 전체 편성의 불가능 여부를 단정하지 않습니다.</p></section>;
}
