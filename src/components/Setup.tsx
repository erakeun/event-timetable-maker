import { id } from '../core/defaults';
import { toMinute } from '../core/time';
import { Field, nextDate, type EditorProps } from './Inputs';

export default function Setup({ event, onChange, readOnly = false }: EditorProps) {
  const patch = (value: Partial<typeof event>, label = '행사 설정 변경') => onChange({ ...event, ...value }, label);
  const policy = (value: Partial<typeof event.policy>) => patch({ policy: { ...event.policy, ...value } }, '배정 정책 변경');
  return <div className="stack">
    <section className="panel">
      <div className="section-head"><div><h2>어떤 행사를 준비하나요?</h2><p className="muted">행사 정보와 날짜를 정하면 편성을 시작할 수 있어요.</p></div><span className="pill">Asia/Seoul</span></div>
      <fieldset disabled={readOnly}><div className="form-grid">
        <Field label="행사명"><input value={event.name} placeholder="예: 가을 커뮤니티 페어" maxLength={200} onChange={e => patch({ name: e.target.value })} /></Field>
        <Field label="기관·단체명 (선택)"><input value={event.organization} placeholder="출력물에 표시할 이름" maxLength={200} onChange={e => patch({ organization: e.target.value })} /></Field>
        <Field label="제작 방식"><select value={event.mode} onChange={e => patch({ mode: e.target.value as typeof event.mode })}><option value="staffing">인력 배치표와 진행 시간표</option><option value="program">진행 시간표만 만들기</option></select></Field>
      </div>
      <Field label="행사 설명 (선택)"><textarea rows={3} value={event.description} maxLength={5000} placeholder="행사 목적이나 공통 안내를 적어 주세요." onChange={e => patch({ description: e.target.value })} /></Field></fieldset>
      <details><summary>기관 로고 (선택)</summary><p className="muted">PNG 또는 JPEG, 1MB 이하. 이 기기에 저장되며 출력물에만 작게 표시합니다.</p><label>로고 이미지<input type="file" accept="image/png,image/jpeg" disabled={readOnly} onChange={async ev=>{const file=ev.target.files?.[0];if(!file)return;try{if(file.size>1024*1024)throw new Error('1MB 이하의 로고를 선택하세요.');const bytes=new Uint8Array(await file.arrayBuffer());const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71,jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;if(!png&&!jpeg)throw new Error('검증 가능한 PNG 또는 JPEG 파일만 사용할 수 있습니다.');const reader=new FileReader();reader.onload=()=>{const value=String(reader.result).replace(/^data:[^;]+;/,`data:image/${png?'png':'jpeg'};`);const img=new Image();img.onload=()=>{if(img.width>4096||img.height>4096){window.alert('가로·세로 4096px 이하의 이미지를 사용하세요.');return;}patch({logoDataUrl:value},'로고 변경');};img.onerror=()=>window.alert('손상된 이미지를 사용할 수 없습니다.');img.src=value;};reader.readAsDataURL(file);}catch(err){window.alert(String(err))}finally{ev.target.value=''}}}/></label>{event.logoDataUrl&&<div className="toolbar"><img src={event.logoDataUrl} alt="기관 로고" style={{maxWidth:180,maxHeight:80,objectFit:'contain'}}/><button className="button secondary" disabled={readOnly} onClick={()=>patch({logoDataUrl:undefined},'로고 삭제')}>로고 삭제</button></div>}</details>
    </section>
    <section className="panel">
      <div className="section-head"><div><h2>날짜별 운영시간</h2><p className="muted">날짜마다 다른 운영시간을 설정할 수 있습니다. 시간은 분 단위로 보존됩니다.</p></div><button className="button secondary" disabled={readOnly} onClick={() => {
        const last = event.days.at(-1);
        const date = last?.date ? nextDate(last.date) : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
        patch({ days: [...event.days, { id: id(), date, start: last?.start ?? '09:00', end: last?.end ?? '17:00', nextDay: last?.nextDay ?? false }] }, '운영 날짜 추가');
      }}>+ 날짜 추가</button></div>
      {!event.days.length && <p className="empty">운영 날짜를 추가해 주세요.</p>}
      <div className="stack">{event.days.map((day, index) => {
        const change = (value: Partial<typeof day>) => patch({ days: event.days.map(d => d.id === day.id ? { ...d, ...value } : d) }, '운영시간 변경');
        let invalid = false;
        try { invalid = toMinute(day.date, day.end, day.nextDay) <= toMinute(day.date, day.start); } catch { invalid = true; }
        return <fieldset key={day.id} disabled={readOnly}><legend>{index + 1}일차</legend><div className="form-grid">
          <Field label={`${index + 1}일차 날짜`}><input type="date" value={day.date} onChange={e => change({ date: e.target.value })} /></Field>
          <Field label={`${index + 1}일차 운영 시작`}><input type="time" step="60" value={day.start} onChange={e => change({ start: e.target.value })} /></Field>
          <Field label={`${index + 1}일차 운영 종료`}><input type="time" step="60" value={day.end} onChange={e => change({ end: e.target.value })} /></Field>
          <label className="row"><input type="checkbox" checked={day.nextDay} onChange={e => change({ nextDay: e.target.checked })} />다음 날 종료 (+1일)</label>
          <button className="button danger" onClick={() => {
            if (confirm(`${day.date} 운영일을 삭제할까요? 기존 수요·가능시간·배정·진행 항목은 보존되며 범위를 벗어난 항목은 수정이 필요합니다. 과거 확정본은 유지됩니다.`)) patch({ days: event.days.filter(d => d.id !== day.id) }, '운영 날짜 삭제');
          }}>날짜 삭제</button>
        </div>{invalid && <p className="notice" role="alert">종료를 시작보다 늦게 지정하거나 다음 날 종료를 선택하세요.</p>}</fieldset>;
      })}</div>
      <p className="small muted">운영시간을 바꾸어도 기존 배정은 자동으로 잘라내지 않습니다. 배치표에서 수정 필요 항목을 확인하세요.</p>
    </section>
    <section className="panel"><h2>시간표 기본 설정</h2><fieldset disabled={readOnly}><div className="form-grid">
      <Field label="화면 눈금 간격" help="표시 간격이며 실제 교대 길이와는 다릅니다."><select value={event.policy.gridMinutes} onChange={e => policy({ gridMinutes: Number(e.target.value) })}>{[5, 10, 15, 20, 30, 60].map(n => <option key={n} value={n}>{n}분</option>)}</select></Field>
      <Field label="자동배정 우선순위"><select value={event.policy.preset} onChange={e => policy({ preset: e.target.value as typeof event.policy.preset })}><option value="balanced">균등 배정 우선</option><option value="continuous">연속 근무 우선</option><option value="preferred">선호시간 우선</option></select></Field>
    </div></fieldset>
      <details><summary>고급 설정 · 교대·이동·탐색</summary><fieldset disabled={readOnly}><div className="form-grid">
        <Field label="최소 배정 길이 (분)"><input type="number" min={1} max={1440} value={event.policy.minimumAssignment} onChange={e => policy({ minimumAssignment: Math.max(1, Number(e.target.value)) })} /></Field>
        <Field label="권장 교대 길이 (분)"><input type="number" min={1} max={1440} value={event.policy.preferredShift} onChange={e => policy({ preferredShift: Math.max(1, Number(e.target.value)) })} /></Field>
        <Field label="장소 간 최소 이동시간 (분)"><input type="number" min={0} max={240} value={event.policy.travelMinutes} onChange={e => policy({ travelMinutes: Math.max(0, Number(e.target.value)) })} /></Field>
        <Field label="초안 재현 번호 (seed)"><input type="number" step={1} value={event.policy.seed} onChange={e => policy({ seed: Math.max(0,Math.min(4294967295,Math.round(Number(e.target.value)))) })} /></Field>
        <Field label="자동배정 탐색 제한 (초)"><input type="number" min={0.1} max={30} step={0.1} value={event.policy.timeLimitMs / 1000} onChange={e => policy({ timeLimitMs: Math.max(100, Math.min(30000, Math.round(Number(e.target.value) * 1000))) })} /></Field>
        <label className="row"><input type="checkbox" checked={event.policy.allowOverstaff} onChange={e => policy({ allowOverstaff: e.target.checked })} />수동 초과 인원 허용 (주의 표시)</label>
      </div><p className="small muted">우선순위는 필수 조건을 완화하지 않습니다. 개인별 시간 상한·휴게는 참여자 화면에서 설정합니다.</p></fieldset></details>
    </section>
  </div>;
}
