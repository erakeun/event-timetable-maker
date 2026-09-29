import { useState, type FormEvent } from 'react';
import { id } from '../core/defaults';
import { dateOf, formatRange } from '../core/time';
import type { Demand } from '../core/types';
import { Field, RangeFields, rangeDraft, readRange, tagsFrom, type EditorProps } from './Inputs';

export default function Conditions({ event, onChange, readOnly = false }: EditorProps) {
  const [locationName, setLocationName] = useState('');
  const [roleName, setRoleName] = useState('');
  const [roleTags, setRoleTags] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [range, setRange] = useState(() => rangeDraft(event));
  const [locationId, setLocationId] = useState(event.locations[0]?.id ?? '');
  const [roleId, setRoleId] = useState(event.roles[0]?.id ?? '');
  const [count, setCount] = useState(1);
  const [leaderTag, setLeaderTag] = useState('책임자');
  const [leaderMin, setLeaderMin] = useState(0);
  const [phase, setPhase] = useState('본행사');
  const [error, setError] = useState('');
  const selectedLocation = event.locations.some(l => l.id === locationId) ? locationId : editing ? '' : event.locations[0]?.id ?? '';
  const selectedRole = event.roles.some(r => r.id === roleId) ? roleId : editing ? '' : event.roles[0]?.id ?? '';
  function edit(demand: Demand) {
    setEditing(demand.id); setRange(rangeDraft(event, demand)); setLocationId(demand.locationId); setRoleId(demand.roleId); setCount(demand.count); setLeaderTag(demand.leaderTag); setLeaderMin(demand.leaderMin); setPhase(demand.phase); setError('');
  }
  function save(e: FormEvent) {
    e.preventDefault();
    try {
      if (!selectedLocation || !selectedRole) throw new Error('장소와 역할을 먼저 추가하세요.');
      if (!Number.isInteger(count) || count < 0 || count > 1000) throw new Error('필요 인원은 0~1000 사이 정수로 입력하세요.');
      if (!Number.isInteger(leaderMin) || leaderMin < 0 || leaderMin > count) throw new Error('책임자 최소 인원은 총 필요 인원 이하여야 합니다.');
      if (leaderMin > 0 && !leaderTag.trim()) throw new Error('책임자 조건에 사용할 태그를 입력하세요.');
      const demand: Demand = { id: editing ?? id(), ...readRange(range), locationId: selectedLocation, roleId: selectedRole, count, leaderTag: leaderTag.trim(), leaderMin, phase: phase.trim() };
      onChange({ ...event, demands: editing ? event.demands.map(d => d.id === editing ? demand : d) : [...event.demands, demand] }, editing ? '필요 인원 수정' : '필요 인원 추가');
      setEditing(null); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : '입력값을 확인하세요.'); }
  }
  return <div className="stack">
    <section className="panel"><div className="section-head"><div><h2>장소와 역할</h2><p className="muted">어디에서 어떤 일을 하는지 각각 설정합니다.</p></div></div>
      <div className="form-grid"><div className="stack"><h3>운영 장소</h3>
        {event.locations.map(location => <div className="row" key={location.id}><Field label="장소 이름"><input aria-label={`장소 ${location.name} 이름`} value={location.name} disabled={readOnly} maxLength={100} onChange={e => onChange({ ...event, locations: event.locations.map(l => l.id === location.id ? { ...l, name: e.target.value } : l) }, '장소 이름 변경')} /></Field><button className="button danger" disabled={readOnly} aria-label={`${location.name} 장소 삭제`} onClick={() => {
          const count = event.assignments.filter(a => a.locationId === location.id).length;
          const demands = event.demands.filter(d => d.locationId === location.id).length;
          const programs = event.programs.filter(p => p.locationId === location.id).length;
          if (confirm(`${location.name} 장소를 삭제할까요? 연결된 배정 ${count}건, 수요 ${demands}건, 진행 항목 ${programs}건은 보존되며 다른 장소로 수정해야 합니다.`)) onChange({ ...event, locations: event.locations.filter(l => l.id !== location.id) }, '장소 삭제');
        }}>삭제</button></div>)}
        <form className="row" onSubmit={e => { e.preventDefault(); if (locationName.trim()) { const location = { id: id(), name: locationName.trim() }; onChange({ ...event, locations: [...event.locations, location] }, '장소 추가'); setLocationName(''); setLocationId(location.id); } }}><Field label="새 장소"><input value={locationName} onChange={e => setLocationName(e.target.value)} disabled={readOnly} placeholder="예: 중앙부스" required maxLength={100} /></Field><button className="button secondary" disabled={readOnly}>+ 장소 추가</button></form>
      </div><div className="stack"><h3>수행 역할</h3>
        {event.roles.map(role => <div className="stack" key={role.id}><div className="row"><Field label="역할 이름"><input aria-label={`역할 ${role.name} 이름`} value={role.name} disabled={readOnly} maxLength={100} onChange={e => onChange({ ...event, roles: event.roles.map(r => r.id === role.id ? { ...r, name: e.target.value } : r) }, '역할 이름 변경')} /></Field><button className="button danger" disabled={readOnly} aria-label={`${role.name} 역할 삭제`} onClick={() => {
          const count = event.assignments.filter(a => a.roleId === role.id).length;
          const demands = event.demands.filter(d => d.roleId === role.id).length;
          if (confirm(`${role.name} 역할을 삭제할까요? 연결된 배정 ${count}건과 수요 ${demands}건은 보존되며 역할 수정이 필요합니다.`)) onChange({ ...event, roles: event.roles.filter(r => r.id !== role.id) }, '역할 삭제');
        }}>삭제</button></div><Field label={`${role.name || '역할'} 필수 태그 (쉼표 구분)`} help="모든 필수 태그를 가진 참여자만 이 역할을 맡을 수 있습니다."><input defaultValue={role.requiredTags.join(', ')} key={`${role.id}:${role.requiredTags.join(',')}`} disabled={readOnly} onBlur={e => { const requiredTags = tagsFrom(e.target.value); if (JSON.stringify(requiredTags) !== JSON.stringify(role.requiredTags)) onChange({ ...event, roles: event.roles.map(r => r.id === role.id ? { ...r, requiredTags } : r) }, '역할 자격 변경'); }} /></Field></div>)}
        <form className="stack" onSubmit={e => { e.preventDefault(); if (roleName.trim()) { const role = { id: id(), name: roleName.trim(), requiredTags: tagsFrom(roleTags) }; onChange({ ...event, roles: [...event.roles, role] }, '역할 추가'); setRoleName(''); setRoleTags(''); setRoleId(role.id); } }}><Field label="새 역할"><input value={roleName} onChange={e => setRoleName(e.target.value)} disabled={readOnly} placeholder="예: 접수" required maxLength={100} /></Field><Field label="새 역할 필수 태그 (선택)"><input value={roleTags} onChange={e => setRoleTags(e.target.value)} disabled={readOnly} placeholder="예: 접수교육, 진행 가능" /></Field><button className="button secondary" disabled={readOnly}>+ 역할 추가</button></form>
      </div></div>
    </section>
    <section className="panel"><div className="section-head"><div><h2>시간대별 필요 인원</h2><p className="muted">준비·본행사·휴식·철수마다 인원을 다르게 정할 수 있습니다.</p></div><span className="pill">{event.demands.length}개 구간</span></div>
      <form onSubmit={save}><fieldset disabled={readOnly}><legend>{editing ? '선택 구간 수정' : '필요 인원 구간 추가'}</legend><RangeFields value={range} onChange={setRange} prefix="수요 " />
        <div className="form-grid"><Field label="수요 장소"><select value={selectedLocation} onChange={e => setLocationId(e.target.value)} required><option value="" disabled>장소 선택</option>{event.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
          <Field label="수요 역할"><select value={selectedRole} onChange={e => setRoleId(e.target.value)} required><option value="" disabled>역할 선택</option>{event.roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
          <Field label="필요 인원 (총원)" help="0명은 운영 중 인력이 필요 없는 구간입니다."><input type="number" min={0} max={1000} value={count} onChange={e => setCount(Number(e.target.value))} /></Field>
          <Field label="구간 이름"><input value={phase} onChange={e => setPhase(e.target.value)} list="phase-suggestions" placeholder="본행사" /><datalist id="phase-suggestions">{['준비', '본행사', '휴식', '철수'].map(p => <option key={p} value={p} />)}</datalist></Field>
        </div>
        <details><summary>책임자 최소 인원</summary><div className="form-grid"><Field label="책임자 태그"><input value={leaderTag} onChange={e => setLeaderTag(e.target.value)} /></Field><Field label="총원 중 책임자 최소 인원"><input type="number" min={0} max={count} value={leaderMin} onChange={e => setLeaderMin(Number(e.target.value))} /></Field></div><p className="small muted">예: 총 3명 중 책임자 1명. 책임자는 총원에 포함되며 추가 1명으로 계산하지 않습니다.</p></details>
        {error && <p role="alert" className="notice">{error}</p>}
        <div className="toolbar"><button className="button primary">{editing ? '구간 수정 적용' : '+ 필요 인원 추가'}</button>{editing && <button type="button" className="button secondary" onClick={() => { setEditing(null); setError(''); }}>수정 취소</button>}</div>
      </fieldset></form>
      {!event.demands.length ? <p className="empty">첫 구간을 추가해 주세요. 수요가 없는 시간은 운영 배정 대상이 아닙니다.</p> : <div className="table-wrap"><table><thead><tr><th>시간·구간</th><th>장소 / 역할</th><th>필요 인원</th><th>책임자</th><th>작업</th></tr></thead><tbody>{[...event.demands].sort((a, b) => a.start - b.start).map(demand => <tr key={demand.id}><td>{dateOf(demand.start)} · {formatRange(demand.start, demand.end)}<br /><span className="small muted">{demand.phase}</span></td><td>{event.locations.find(l => l.id === demand.locationId)?.name ?? '삭제된 장소'} / {event.roles.find(r => r.id === demand.roleId)?.name ?? '삭제된 역할'}</td><td>{demand.count === 0 ? '0명 · 인력 불필요' : `${demand.count}명`}</td><td>{demand.leaderMin ? `${demand.leaderTag} ${demand.leaderMin}명 포함` : '없음'}</td><td><div className="row"><button className="button secondary" disabled={readOnly} onClick={() => edit(demand)}>수정</button><button className="button danger" disabled={readOnly} onClick={() => {
        const count = event.assignments.filter(a => a.locationId === demand.locationId && a.roleId === demand.roleId && a.start < demand.end && a.end > demand.start).length;
        if (!count || confirm(`이 구간의 기존 배정 ${count}건은 보존됩니다. 수요 삭제 후 수정 필요 항목을 확인하세요. 삭제할까요?`)) { onChange({ ...event, demands: event.demands.filter(d => d.id !== demand.id) }, '필요 인원 구간 삭제'); if (editing === demand.id) setEditing(null); }
      }}>삭제</button></div></td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
