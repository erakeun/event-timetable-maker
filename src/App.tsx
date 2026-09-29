import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import type { EventData, UpdateEvent } from './core/types';
import { createEvent, createSampleEvent, id } from './core/defaults';
import { newRevision } from './core/revisions';
import { listEvents, loadEvent, saveEvent, deleteEvent, clearEvents, RevisionConflictError, getStorageWarnings } from './io/storage';
import { parseBackup, serializeBackup } from './io/backups';
import { downloadBlob } from './io/exports';
import Setup from './components/Setup';
import Conditions from './components/Conditions';
import People from './components/People';
import Program from './components/Program';
import Board from './components/Board';
import Review from './components/Review';
import ImportPanel from './components/ImportPanel';

const statusLabel={draft:'초안',confirmed:'확정',archived:'보관'};
const steps=['행사 설정','장소·인원 조건','참여자·가능시간','배치표','확인·출력'];
class ErrorBoundary extends Component<{children:ReactNode},{error:string}>{state={error:''};static getDerivedStateFromError(err:Error){return{error:err.message}}render(){return this.state.error?<main className="app"><h1>화면을 표시하지 못했습니다.</h1><p>저장된 행사는 삭제되지 않았습니다. 페이지를 새로 열어 주세요.</p><p role="alert">{this.state.error}</p><button className="button" onClick={()=>window.location.reload()}>새로 열기</button></main>:this.props.children}}
export default function App(){return <ErrorBoundary><Workspace/></ErrorBoundary>}
function Workspace(){
 const [event,setEvent]=useState<EventData|null>(null),[library,setLibrary]=useState<EventData[]>([]),[step,setStep]=useState(0);
 const [saveStatus,setSaveStatus]=useState('저장 완료'),[message,setMessage]=useState(''),[blocked,setBlocked]=useState(false),[loading,setLoading]=useState(true),[archived,setArchived]=useState(false);
 const [undoCount,setUndoCount]=useState(0),[redoCount,setRedoCount]=useState(0);
 const current=useRef<EventData|null>(null),revisions=useRef(new Map<string,number>()),pending=useRef<EventData|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null),queue=useRef<Promise<void>>(Promise.resolve()),conflict=useRef(false),generation=useRef(0);
 const past=useRef<EventData[]>([]),future=useRef<EventData[]>([]),backupInput=useRef<HTMLInputElement>(null);
 const refresh=async()=>{try{setLibrary(await listEvents());const warnings=getStorageWarnings();if(warnings.length)setMessage(warnings.join(" / "))}catch(err){setMessage('저장소를 열지 못했습니다: '+String(err))}finally{setLoading(false)}};
 useEffect(()=>{void refresh();const unload=(ev:BeforeUnloadEvent)=>{if(pending.current||saveStatus==='저장 중…'){ev.preventDefault();ev.returnValue='';}};window.addEventListener('beforeunload',unload);return()=>window.removeEventListener('beforeunload',unload)},[saveStatus]);
 const flush=async()=>{
  if(timer.current)clearTimeout(timer.current);timer.current=null;
  const data=pending.current;if(!data){await queue.current;return;}pending.current=null;
  const gen=generation.current;
  queue.current=queue.current.then(async()=>{
   if(conflict.current){pending.current=data;return;}
   try{const saved=await saveEvent(data,revisions.current.get(data.id)??null);revisions.current.set(data.id,saved.revision);if(current.current?.id===data.id&&gen===generation.current)setSaveStatus('저장 완료');}
   catch(err){if(current.current?.id===data.id){setSaveStatus('저장 실패');setMessage(err instanceof RevisionConflictError?'다른 탭에서 이 행사가 변경되었습니다. 이 화면의 편집 내용은 유지했습니다. JSON 백업이나 사본으로 보관한 뒤 최신 자료를 불러오세요.':'브라우저 저장에 실패했습니다. 현재 내용을 JSON으로 백업하세요. '+String(err));if(err instanceof RevisionConflictError){conflict.current=true;setBlocked(true);}pending.current=current.current;}}
  });await queue.current;
 };
 const scheduleSave=(data:EventData)=>{pending.current=data;generation.current++;setSaveStatus('저장 중…');if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>void flush(),300);};
 const display=(data:EventData|null)=>{current.current=data;setEvent(data);};
 const open=(data:EventData)=>{revisions.current.set(data.id,data.revision);past.current=[];future.current=[];setUndoCount(0);setRedoCount(0);conflict.current=false;setBlocked(false);pending.current=null;display(data);setStep(data.status==='confirmed'?4:0);setSaveStatus('저장 완료');setMessage('');};
 const change:UpdateEvent=(next,label)=>{
  if(conflict.current||current.current?.status==='archived'){setMessage('읽기 전용입니다. 최신 자료를 열거나 사본을 만드세요.');return;}
  const before=current.current;
  if(before?.status==='confirmed'){setMessage('확정본은 수정할 수 없습니다. 새 개정 초안을 만드세요.');return;}
  if(before){past.current=[...past.current.slice(-29),structuredClone(before)];future.current=[];setUndoCount(past.current.length);setRedoCount(0);}
  const data={...next,updatedAt:new Date().toISOString()};display(data);scheduleSave(data);if(label)setMessage(label);
 };
 const create=async(sample=false,program=false)=>{await flush();const data=sample?createSampleEvent():createEvent('새 행사',program?'program':'staffing');try{const saved=await saveEvent(data,null);open(saved);if(sample)setStep(3);void refresh()}catch(err){open(data);revisions.current.delete(data.id);setSaveStatus('저장 실패');setMessage('저장소에 저장하지 못했습니다. 작업 후 반드시 파일로 백업하세요. '+String(err))}};
 const backup=(data=event)=>{if(!data)return;try{downloadBlob(new Blob([serializeBackup(data)],{type:'application/json'}),`${data.name}-v${data.edition}.backup.json`);}catch(err){setMessage('백업 생성 실패: '+String(err));}};
 const duplicate=async(data:EventData,keepCurrent=false)=>{const copy=structuredClone(data);copy.id=id();copy.name+=' · 사본';copy.status='draft';if(copy.snapshots.length)copy.edition=Math.max(copy.edition,...copy.snapshots.map(s=>s.version))+1;copy.revision=0;copy.createdAt=copy.updatedAt=new Date().toISOString();copy.snapshots=copy.snapshots.map(s=>({...s,data:{...s.data,id:copy.id}}));try{const saved=await saveEvent(copy,null);if(keepCurrent){pending.current=null;conflict.current=false;setBlocked(false)}open(saved);void refresh()}catch(err){setMessage('사본 저장 실패: '+String(err))}};
 const restore=async(file:File)=>{try{if(file.size>10*1024*1024)throw new Error('백업 파일은 10MB 이하여야 합니다.');const data=parseBackup(await file.text());await flush();const exists=await loadEvent(data.id);if(exists){data.id=id();data.snapshots=data.snapshots.map(s=>({...s,data:{...s.data,id:data.id}}));data.name+=' · 복원 사본';if(data.snapshots.length){data.status='draft';data.edition=Math.max(data.edition,...data.snapshots.map(s=>s.version))+1;}}data.revision=0;const saved=await saveEvent(data,null);open(saved);setMessage(exists?'같은 ID의 행사가 있어 별도 사본으로 복원했습니다.':'백업을 복원했습니다. 시간표 검사 결과를 확인하세요.');void refresh()}catch(err){setMessage('백업을 적용하지 않았습니다. 기존 자료는 유지됩니다. '+String(err))}};
 const travelHistory=(redo=false)=>{if(!event||event.status!=='draft'||blocked)return;const from=redo?future:past,to=redo?past:future;const data=from.current.pop();if(!data)return;to.current.push(structuredClone(event));display(data);scheduleSave(data);setUndoCount(past.current.length);setRedoCount(future.current.length);setMessage(redo?'다시 실행했습니다.':'되돌렸습니다.');};
 const archive=async(data:EventData)=>{if(!window.confirm(`${data.name} 행사를 ${data.status==='archived'?'보관함에서 꺼낼':'보관할'}까요?`))return;try{await saveEvent({...data,status:data.status==='archived'?(data.snapshots.at(-1)?.version===data.edition?'confirmed':'draft'):'archived'},data.revision);void refresh()}catch(err){setMessage(String(err))}};
 const readonly=event?.status!=='draft'||blocked;
 return <div className="app-shell"><header className="app-header"><div className="header-inner"><button className="brand" onClick={async()=>{await flush();if(pending.current){setMessage('저장하지 못한 내용이 있습니다. 백업이나 사본 보관 후 이동하세요.');return;}display(null);void refresh()}}><span className="brand-icon" aria-hidden="true">▤</span><span>행사 시간표 제작기<small>EVENT TIMETABLE MAKER</small></span></button><span className="local-badge">기기 내 저장 · 로그인 없음</span>{event&&<span className={'save-state '+(saveStatus==='저장 실패'?'error-text':'')} role="status">{saveStatus}</span>}</div></header>
 <input ref={backupInput} className="sr-only" type="file" accept=".json" aria-label="JSON 백업 파일" onChange={x=>{const f=x.target.files?.[0];if(f)void restore(f);x.target.value=''}}/>
 <main className="app">
 {message&&<div className="message" role="status"><span>{message}</span><button aria-label="알림 닫기" onClick={()=>setMessage('')}>×</button></div>}
 {!event?<>
  <section className="welcome"><div className="eyebrow">행사 운영의 시작을 가볍게</div><h1>누가, 언제, 어디에서.<br/><span>한눈에 정리하는 행사 배치표</span></h1><p>행사 시간과 필요한 인원만 정하면,<br className="mobile-only"/> 배치 초안부터 개인별 일정표까지.</p><div className="start-actions"><button className="button primary large" onClick={()=>void create()}>＋ 새 행사 만들기</button><button className="button secondary large" onClick={()=>void create(true)}>예시로 체험하기</button><button className="button text" onClick={()=>backupInput.current?.click()}>백업 불러오기 ↗</button></div><button className="button text program-entry" onClick={()=>void create(false,true)}>인원 배치 없이 진행 시간표만 만들기 →</button></section>
  <div className="workflow-strip"><span>01 행사·인원 입력</span><b>→</b><span>02 자동배정·조정</span><b>→</b><span>03 확정·출력·백업</span></div>
  <section className="library"><div className="section-head"><div><p className="eyebrow">MY EVENTS</p><h2>내 행사 보관함</h2></div><label className="check"><input type="checkbox" checked={archived} onChange={x=>setArchived(x.target.checked)}/>보관한 행사 표시</label></div>{loading?<p>저장한 행사를 불러오는 중…</p>:library.filter(e=>archived||e.status!=='archived').length===0?<div className="library-empty"><span aria-hidden="true">▦</span><div><h3>첫 행사를 만들어 보세요.</h3><p>만든 행사는 이 브라우저에 자동으로 저장됩니다.</p></div></div>:<div className="event-list">{library.filter(e=>archived||e.status!=='archived').map(e=><article key={e.id} className="event-row"><button className="event-open" onClick={()=>open(e)}><span className="pill">{statusLabel[e.status]} · v{e.edition}</span><h3>{e.name}</h3><p>{e.days.map(d=>d.date).join(' · ')} · 참여자 {e.people.length}명</p><small>수정 {new Date(e.updatedAt).toLocaleString('ko-KR')}</small></button><div className="toolbar"><button className="button secondary" onClick={()=>void duplicate(e)}>복제</button><button className="button secondary" onClick={()=>void archive(e)}>{e.status==='archived'?'보관 해제':'보관'}</button><button className="button danger" onClick={async()=>{if(window.confirm(`${e.name}의 이 브라우저 저장본을 삭제합니다. 백업 파일이 있는지 확인하세요.`)){try{await deleteEvent(e.id);void refresh()}catch(err){setMessage(String(err))}}}}>삭제</button></div></article>)}</div>}</section>
  <section className="privacy-note"><h3>자료는 지금 사용하는 브라우저에 있습니다.</h3><p>현재 기기·브라우저에 저장됩니다. 다른 기기에서 사용하려면 백업 파일을 옮기세요. 브라우저 데이터 삭제·비공개 모드·저장공간 오류로 자료가 사라질 수 있습니다.</p><details><summary>공용 PC 이용과 저장자료 삭제</summary><p>다음 이용자가 같은 브라우저의 행사 자료를 볼 수 있습니다. 이 앱은 사용자 인증이나 자료 암호화를 제공하지 않습니다. 필요한 행사를 먼저 JSON으로 백업하세요. 백업에는 명단·가능시간·내부메모가 포함됩니다.</p><button className="button danger" onClick={async()=>{if(window.confirm('필요한 행사를 모두 백업했나요? 이 앱의 행사 저장자료만 전부 삭제합니다.')){try{await clearEvents();void refresh();setMessage('이 앱의 저장자료를 삭제했습니다. 다른 앱의 자료는 삭제하지 않았습니다.')}catch(err){setMessage(String(err))}}}}>백업 후 이 앱 저장자료 모두 삭제</button></details></section>
 </>:<>
  <div className="editor-title"><div><p className="eyebrow">내 행사 / {event.mode==='program'?'진행 시간표':'인력 배치표'}</p><h1>{event.name||'이름 없는 행사'} <span className="pill">{statusLabel[event.status]} · v{event.edition}</span></h1></div><div className="toolbar"><button className="button secondary" disabled={!undoCount||readonly} onClick={()=>travelHistory()}>↶ 되돌리기</button><button className="button secondary" disabled={!redoCount||readonly} onClick={()=>travelHistory(true)}>↷ 다시 실행</button><button className="button secondary" onClick={()=>backup()}>JSON 백업</button></div></div>
  {blocked&&<div className="notice error-text"><h3>다른 탭과 저장 버전이 다릅니다. 읽기 전용으로 전환했습니다.</h3><p>현재 입력을 JSON 백업 또는 사본으로 보관할 수 있습니다.</p><div className="toolbar"><button className="button secondary" onClick={()=>void duplicate(event,true)}>현재 내용 사본으로 보관</button><button className="button secondary" onClick={async()=>{if(window.confirm('현재 화면의 저장되지 않은 변경을 버리고 최신 저장본을 불러올까요?')){try{const latest=await loadEvent(event.id);if(latest)open(latest);else setMessage('다른 탭에서 삭제되었습니다. 현재 내용을 사본으로 보관하세요.')}catch(err){setMessage('최신 저장본 불러오기 실패: '+String(err))}}}}>최신 저장본 불러오기</button></div></div>}
  {saveStatus==='저장 실패'&&!blocked&&<div className="notice error-text"><p>편집 내용은 화면에 남아 있습니다. JSON 백업 후 저장을 다시 시도하세요.</p><button className="button secondary" onClick={()=>{pending.current=event;void flush()}}>저장 다시 시도</button></div>}
  {event.status==='confirmed'&&<div className="confirmed-bar"><span>확정본 v{event.edition} · 과거 기록은 변경되지 않습니다.</span><button className="button secondary" onClick={()=>{const draft=newRevision(event);past.current=[];future.current=[];setUndoCount(0);setRedoCount(0);display(draft);scheduleSave(draft);setMessage('새 개정 초안을 만들었습니다.');setStep(3)}}>새 개정 초안 만들기</button></div>}
  {event.status==='archived'&&<div className="notice">보관한 행사는 읽기 전용입니다. 보관함에서 보관 해제하거나 사본을 만들어 편집하세요.</div>}
  <nav className="steps" aria-label="행사 편집 단계">{steps.map((label,i)=><button key={label} aria-current={step===i?'step':undefined} onClick={()=>setStep(i)}><span>{String(i+1).padStart(2,'0')}</span>{label}</button>)}<button aria-current={step===5?'step':undefined} onClick={()=>setStep(5)}><span>＋</span>진행 시간표</button></nav>
  {step===0&&<Setup event={event} onChange={change} readOnly={readonly}/>}
  {step===1&&<><Conditions event={event} onChange={change} readOnly={readonly}/><ImportPanel event={event} onChange={change} readOnly={readonly}/></>}
  {step===2&&<><People event={event} onChange={change} readOnly={readonly}/><ImportPanel event={event} onChange={change} readOnly={readonly}/></>}
  {step===3&&<Board key={event.id} event={event} onChange={change} readOnly={readonly}/>}
  {step===4&&<Review event={event} onChange={change} onBackup={()=>backup()} readOnly={readonly}/>}
  {step===5&&<Program event={event} onChange={change} readOnly={readonly}/>}
  <div className="step-footer"><button className="button secondary" disabled={step===0} onClick={()=>setStep(Math.max(0,step-1))}>← 이전 단계</button><p>현재 기기·브라우저에 저장됩니다. 중요한 변경 뒤에는 백업하세요.</p><button className="button primary" disabled={step>=4} onClick={()=>setStep(Math.min(4,step+1))}>다음 단계 →</button></div>
 </>}
 </main><footer className="app-footer"><span>행사 시간표 제작기 · V1</span><span>Asia/Seoul · 자료를 서버로 전송하지 않습니다.</span></footer></div>;
}
