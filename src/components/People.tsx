import { useState, type FormEvent } from 'react';
import BulkConditions from './BulkConditions';
import { createPerson, id } from '../core/defaults';
import { dayIntervals, dateOf, formatRange, toMinute } from '../core/time';
import type { Availability, Person } from '../core/types';
import { displayPerson, Field, minuteValue, RangeFields, rangeDraft, readRange, tagsFrom, type EditorProps } from './Inputs';

const stateNames: Record<Availability['state'], string> = { available: '가능', unavailable: '불가', unknown: '미확인', preferred: '선호' };
function preferredIsAvailable(person: Person, start: number, end: number) {
  const cuts = [...new Set([start, end, ...person.availability.flatMap(a => [a.start, a.end]).filter(n => n > start && n < end)])].sort((a, b) => a - b);
  return cuts.slice(0, -1).every((a, i) => {
    const b = cuts[i + 1];
    const rows = person.availability.filter(r => r.start <= a && r.end >= b);
    return rows.some(r => r.state === 'available') && !rows.some(r => r.state === 'unavailable' || r.state === 'unknown');
  });
}

export default function People({ event, onChange, readOnly = false, initialPersonId = '' }: EditorProps & {initialPersonId?:string}) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [activeId, setActiveId] = useState(initialPersonId || event.people[0]?.id || '');
  const [filter, setFilter] = useState('');
  const [range, setRange] = useState(() => rangeDraft(event));
  const [state, setState] = useState<Availability['state']>('available');
  const [removeOverlap, setRemoveOverlap] = useState(false);
  const [editingRange, setEditingRange] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [copyFrom, setCopyFrom] = useState(event.days[0]?.date ?? '');
  const [copyTargets, setCopyTargets] = useState<string[]>([]);
  const active = event.people.find(p => p.id === activeId) ?? event.people[0];
  const selectedIds = selected.filter(value => event.people.some(p => p.id === value));
  const people = event.people.filter(p => `${p.name} ${p.alias} ${p.team} ${p.id}`.toLowerCase().includes(filter.toLowerCase()));
  const patch = (person: Person, changes: Partial<Person>, label = '참여자 정보 변경') => onChange({ ...event, people: event.people.map(p => p.id === person.id ? { ...p, ...changes } : p) }, label);
  let currentRange: { start: number; end: number } | undefined;
  try { currentRange = readRange(range); } catch { /* incomplete input remains local until apply */ }
  const affected = active && currentRange ? event.assignments.filter(a => a.personId === active.id && a.start < currentRange.end && a.end > currentRange.start) : [];
  const dedicatedAffected = active && currentRange ? event.programs.filter(p => p.personId === active.id && p.dedicated && p.start < currentRange.end && p.end > currentRange.start) : [];
  function setAllAvailable(ids: string[]) {
    if (!ids.length || !event.days.length) return;
    const count = event.people.filter(p => ids.includes(p.id)).length;
    if (!confirm(`선택한 ${count}명의 기존 가능·불가·미확인·선호 범위를 모두 교체하고, ${event.days.map(d => d.date).join(', ')} 전체 운영시간을 ‘가능’으로 확인할까요? 개인별 배정 불가 날짜는 별도로 유지됩니다.`)) return;
    try {
      const days = dayIntervals(event);
      if (days.some(day => day.end <= day.start)) throw new Error('행사 설정의 운영 시작·종료를 먼저 수정하세요.');
      onChange({ ...event, people: event.people.map(p => ids.includes(p.id) ? { ...p, availability: days.map(day => ({ id: id(), start: day.start, end: day.end, state: 'available' as const })) } : p) }, '선택 참여자 전체 운영시간 가능');
      setError('');
    } catch (err) { setError(err instanceof Error ? err.message : '운영 날짜와 시간을 확인하세요.'); }
  }
  function addRange(e: FormEvent) {
    e.preventDefault();
    if (!active) return;
    try {
      const interval = readRange(range);
      const others = active.availability.filter(a => a.id !== editingRange);
      if (state === 'preferred' && !preferredIsAvailable({ ...active, availability: others }, interval.start, interval.end)) throw new Error('선호시간은 이미 확인된 가능시간 안에만 추가할 수 있습니다. 먼저 가능 범위를 입력하고 불가·미확인과 겹치는지 확인하세요.');
      const nextRange: Availability = { id: editingRange ?? id(), ...interval, state };
      let assignments = event.assignments;
      if (state === 'unavailable' && removeOverlap && affected.length) {
        const locked = affected.filter(a => a.locked).length;
        if (!confirm(`겹치는 배정 ${affected.length}건의 불참 시간만 해제합니다.${locked ? ` 이 중 잠긴 배정 ${locked}건도 포함됩니다.` : ''} 나머지 배정 시간은 유지하며 최소 길이·휴게 등은 다시 검사합니다. 적용할까요?`)) return;
        assignments = event.assignments.flatMap(a => {
          if (a.personId !== active.id || a.start >= interval.end || a.end <= interval.start) return [a];
          return [a.start < interval.start ? { ...a, end: interval.start } : null, a.end > interval.end ? { ...a, id: a.start < interval.start ? id() : a.id, start: interval.end } : null].filter((a): a is typeof event.assignments[number] => a !== null);
        });
      }
      onChange({ ...event, assignments, people: event.people.map(p => p.id === active.id ? { ...p, availability: editingRange ? p.availability.map(a => a.id === editingRange ? nextRange : a) : [...p.availability, nextRange] } : p) }, state === 'unavailable' ? '불참·불가시간 반영' : '가능시간 입력');
      setEditingRange(null); setRemoveOverlap(false); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : '시간을 확인하세요.'); }
  }
  function deletePerson(person: Person) {
    const assigned = event.assignments.filter(a => a.personId === person.id);
    const programs = event.programs.filter(p => p.personId === person.id);
    const affectedText = assigned.slice(0, 5).map(a => `${dateOf(a.start)} · ${formatRange(a.start, a.end)} ${event.locations.find(l => l.id === a.locationId)?.name ?? ''}`).join('\n');
    if (!confirm(`${displayPerson(person)} 참여자를 삭제할까요?\n현재 배정 ${assigned.length}건을 해제하고 진행 항목 ${programs.length}건의 담당자 지정을 해제합니다.\n${affectedText}${assigned.length > 5 ? '\n…' : ''}\n과거 확정본의 이름·배정은 유지됩니다.`)) return;
    onChange({ ...event, people: event.people.filter(p => p.id !== person.id), assignments: event.assignments.filter(a => a.personId !== person.id), programs: event.programs.map(p => p.personId === person.id ? { ...p, personId: '', dedicated: false } : p) }, '참여자 삭제·배정 해제');
    setSelected(ids => ids.filter(id => id !== person.id)); setEditingRange(null);
  }
  function copyAvailability() {
    if (!active || !copyFrom || !copyTargets.length) return;
    const from = toMinute(copyFrom, '00:00');
    const source = active.availability.filter(a => a.start >= from && a.start < from + 1440);
    if (!source.length) { setError('원본 날짜에 시작하는 시간 범위가 없습니다.'); return; }
    if (!confirm(`${displayPerson(active)}의 ${copyFrom} 시간 범위 ${source.length}개를 ${copyTargets.join(', ')}에 추가할까요? 대상 날짜의 기존 불가·미확인 범위가 우선하며 배정은 복사하지 않습니다.`)) return;
    const added = copyTargets.filter(date => date !== copyFrom).flatMap(date => {
      const offset = toMinute(date, '00:00') - from;
      return source.map(a => ({ ...a, id: id(), start: a.start + offset, end: a.end + offset }));
    });
    patch(active, { availability: [...active.availability, ...added] }, '선택 날짜로 가능시간 복사'); setCopyTargets([]); setError('');
  }
  return <div className="stack">
    <section className="panel"><div className="section-head"><div><h2>참여자 명단</h2><p className="muted">입력하지 않은 시간은 미확인입니다. 자동배정에는 확인된 가능시간만 사용합니다.</p></div><span className="pill">{event.people.length}명</span></div>
      <form className="row" onSubmit={e => { e.preventDefault(); if (!name.trim()) return; const person = createPerson(name.trim()); onChange({ ...event, people: [...event.people, person] }, '참여자 추가'); setName(''); setActiveId(person.id); setEditingRange(null); }}><Field label="추가할 참여자 이름"><input value={name} onChange={e => setName(e.target.value)} required maxLength={100} disabled={readOnly} placeholder="이름을 입력하세요" /></Field><button className="button primary" disabled={readOnly}>+ 참여자 추가</button></form>
      <div className="toolbar"><Field label="명단 검색"><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="이름, 팀, 별칭 또는 ID" /></Field><button className="button secondary" disabled={readOnly || !selectedIds.length || !event.days.length} onClick={() => setAllAvailable(selectedIds)}>선택한 {selectedIds.length}명 전체 운영시간 가능</button></div>
      <BulkConditions event={event} ids={selectedIds} onChange={onChange} readOnly={readOnly}/>
      {!event.people.length ? <p className="empty">아직 참여자가 없습니다. 이름을 직접 추가하거나 아래 가져오기에서 명단을 입력하세요.</p> : <div className="table-wrap"><table><thead><tr><th><input aria-label="현재 검색 결과 모두 선택" type="checkbox" checked={people.length > 0 && people.every(p => selectedIds.includes(p.id))} onChange={e => setSelected(e.target.checked ? [...new Set([...selectedIds, ...people.map(p => p.id)])] : selectedIds.filter(id => !people.some(p => p.id === id)))} /></th><th>이름 / 별칭</th><th>소속·팀</th><th>시간 입력</th><th>작업</th></tr></thead><tbody>{people.map(person => <tr key={person.id} aria-selected={active?.id === person.id}><td><input type="checkbox" aria-label={`${displayPerson(person)} 선택`} checked={selectedIds.includes(person.id)} onChange={e => setSelected(e.target.checked ? [...selectedIds, person.id] : selectedIds.filter(id => id !== person.id))} /></td><td><button className="button secondary" onClick={() => { setActiveId(person.id); setEditingRange(null); setError(''); }}><span aria-hidden="true" style={{ color: person.color }}>● </span>{person.name}{person.alias ? ` (${person.alias})` : ''}</button><div className="small muted">ID {person.id}</div></td><td>{person.team || '—'}</td><td>{person.availability.length ? `${person.availability.filter(a => a.state === 'available').length}개 가능 범위` : '미확인'}</td><td><button className="button secondary" onClick={() => { setActiveId(person.id); setEditingRange(null); setError(''); }}>편집</button></td></tr>)}</tbody></table></div>}
    </section>
    {active && !people.some(p=>p.id===active.id)&&<p className="notice">현재 편집 대상은 {displayPerson(active)}입니다. 검색 결과에서 이름을 눌러 편집 대상을 바꾸세요.</p>}
    {active && <section className="panel"><div className="section-head"><div><h2>{displayPerson(active)} · 정보와 가능시간</h2><p className="small muted">이름을 바꾸어도 ID로 연결된 배정은 유지됩니다.</p></div><button className="button danger" disabled={readOnly} onClick={() => deletePerson(active)}>참여자 삭제</button></div>
      <fieldset disabled={readOnly}><div className="form-grid">
        <Field label="참여자 이름"><input value={active.name} maxLength={100} onChange={e => patch(active, { name: e.target.value })} /></Field>
        <Field label="표시 별칭 (선택)"><input value={active.alias} placeholder="예: 민지 A" maxLength={100} onChange={e => patch(active, { alias: e.target.value })} /></Field>
        <Field label="소속·팀 (선택)"><input value={active.team} maxLength={100} onChange={e => patch(active, { team: e.target.value })} /></Field>
        <Field label="표시 색상"><input type="color" value={active.color || '#456858'} onChange={e => patch(active, { color: e.target.value })} /></Field>
        <Field label="참여자 역할 태그 (쉼표 구분)"><input key={`${active.id}:${active.tags.join(',')}`} defaultValue={active.tags.join(', ')} placeholder="예: 책임자, 접수교육" onBlur={e => { const tags = tagsFrom(e.target.value); if (JSON.stringify(tags) !== JSON.stringify(active.tags)) patch(active, { tags }); }} /></Field>
      </div></fieldset>
      <div className="section-head"><h3>가능시간 입력</h3><button className="button secondary" disabled={readOnly || !event.days.length} onClick={() => setAllAvailable([active.id])}>이 사람 전체 운영시간 가능</button></div>
      <p className="small muted">겹칠 때는 불가 → 명시적 미확인 → 가능 순으로 적용합니다. 선호는 가능 범위 안에서만 사용합니다.</p>
      <form onSubmit={addRange}><fieldset disabled={readOnly}><legend>{editingRange ? '선택 시간 범위 수정' : '시간 범위 추가'}</legend><RangeFields value={range} onChange={setRange} prefix="가능시간 " /><div className="form-grid"><Field label="가능시간 상태"><select value={state} onChange={e => { setState(e.target.value as Availability['state']); setRemoveOverlap(false); }}>{Object.entries(stateNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></Field></div>
        {state === 'unavailable' && (affected.length > 0 || dedicatedAffected.length > 0) && <div className="notice"><strong>영향받는 인력 배정 {affected.length}건 · 전담 진행 {dedicatedAffected.length}건</strong><ul>{affected.slice(0, 5).map(a => <li key={a.id}>{dateOf(a.start)} · {formatRange(a.start, a.end)} · {event.locations.find(l => l.id === a.locationId)?.name ?? '삭제된 장소'}{a.locked ? ' · 잠김' : ''}</li>)}</ul><label className="row"><input type="checkbox" checked={removeOverlap} onChange={e => setRemoveOverlap(e.target.checked)} />인력 배정의 겹치는 시간도 해제 (잠금 포함)</label><p className="small">선택하지 않으면 배정을 유지하고 수정 필요 오류로 표시합니다. 전담 진행 항목은 진행 시간표에서 담당자를 수정하세요.</p></div>}
        {error && <p className="notice" role="alert">{error}</p>}<div className="toolbar"><button className="button primary">{editingRange ? '시간 수정 적용' : state === 'unavailable' ? '불가·불참 시간 반영' : '+ 시간 범위 추가'}</button>{editingRange && <button className="button secondary" type="button" onClick={() => { setEditingRange(null); setError(''); }}>수정 취소</button>}</div>
      </fieldset></form>
      {!active.availability.length ? <p className="empty">아직 확인된 가능시간이 없습니다. 이 상태에서는 자동배정하지 않습니다.</p> : <div className="table-wrap"><table><thead><tr><th>날짜·시간</th><th>상태</th><th>작업</th></tr></thead><tbody>{[...active.availability].sort((a, b) => a.start - b.start).map(row => <tr key={row.id}><td>{dateOf(row.start)} · {formatRange(row.start, row.end)}</td><td><span className="pill">{stateNames[row.state]}</span></td><td><div className="row"><button className="button secondary" disabled={readOnly} onClick={() => { setEditingRange(row.id); setRange(rangeDraft(event, row)); setState(row.state); setError(''); setRemoveOverlap(false); }}>수정</button><button className="button danger" disabled={readOnly} onClick={() => { patch(active, { availability: active.availability.filter(a => a.id !== row.id) }, '가능시간 범위 삭제'); if (editingRange === row.id) setEditingRange(null); }}>삭제</button></div></td></tr>)}</tbody></table></div>}
      <details><summary>다른 날짜로 가능시간 복사</summary><fieldset disabled={readOnly}><p className="small muted">복사할 날짜를 직접 선택합니다. 기존 범위는 유지하며, 복사 후 해당 날짜의 조건으로 다시 검사합니다.</p><Field label="복사 원본 날짜"><select value={copyFrom} onChange={e => { setCopyFrom(e.target.value); setCopyTargets([]); }}>{event.days.map(day => <option value={day.date} key={day.id}>{day.date}</option>)}</select></Field><div className="toolbar">{event.days.filter(day => day.date !== copyFrom).map(day => <label key={day.id} className="row"><input type="checkbox" checked={copyTargets.includes(day.date)} onChange={e => setCopyTargets(e.target.checked ? [...copyTargets, day.date] : copyTargets.filter(d => d !== day.date))} />{day.date}</label>)}</div><button className="button secondary" disabled={!copyTargets.length} onClick={copyAvailability}>선택 날짜에 복사</button></fieldset></details>
      <details><summary>개인별 배정 조건</summary><fieldset disabled={readOnly}><p className="small muted">시간은 분 단위입니다. 비어 있으면 시간 상한과 휴게 제한은 없습니다. 역할을 선택하지 않으면 자격 태그를 충족하는 모든 역할이 가능하며, 희망·최소 배정은 기본 0분입니다.</p><div className="form-grid">
        {([
          ['maxDaily', '하루 최대 배정 (분)'], ['maxTotal', '행사 전체 최대 배정 (분)'], ['maxContinuous', '최대 연속 배정 (분)'], ['minBreak', '최소 휴게 (분)'], ['desiredMinutes', '희망 배정 (분)'], ['minMinutes', '최소 배정 (분)'],
        ] as const).map(([key, label]) => <Field label={label} key={key}><input type="number" min={0} step={1} value={active[key] ?? ''} placeholder={key === 'desiredMinutes' || key === 'minMinutes' ? '기본 0분' : '제한 없음'} onChange={e => patch(active, { [key]: minuteValue(e.target.value) })} /></Field>)}
        <Field label="최소 배정 조건의 성격"><select value={active.minMode} onChange={e => patch(active, { minMode: e.target.value as Person['minMode'] })}><option value="soft">가능하면 맞추는 희망</option><option value="hard">반드시 만족하는 필수 조건</option></select></Field>
      </div><h4>배정 가능한 역할</h4><div className="toolbar">{event.roles.length ? event.roles.map(role => <label className="row" key={role.id}><input type="checkbox" checked={active.allowedRoleIds.includes(role.id)} onChange={e => patch(active, { allowedRoleIds: e.target.checked ? [...active.allowedRoleIds, role.id] : active.allowedRoleIds.filter(id => id !== role.id) })} />{role.name}</label>) : <span className="muted">장소·인원 조건에서 역할을 먼저 추가하세요.</span>}</div>
        <h4>배정 불가 날짜</h4><div className="toolbar">{event.days.map(day => <label className="row" key={day.id}><input type="checkbox" checked={active.blockedDates.includes(day.date)} onChange={e => patch(active, { blockedDates: e.target.checked ? [...active.blockedDates, day.date] : active.blockedDates.filter(date => date !== day.date) })} />{day.date}</label>)}</div><p className="small muted">이 조건은 행사의 편성 기준입니다.</p>
      </fieldset></details>
    </section>}
  </div>;
}
