import { useState, type FormEvent } from 'react';
import ProgramPaste from './ProgramPaste';
import { id } from '../core/defaults';
import { dateOf, formatRange } from '../core/time';
import type { ProgramItem } from '../core/types';
import { displayPerson, Field, RangeFields, rangeDraft, readRange, type EditorProps } from './Inputs';

export default function Program({ event, onChange, readOnly = false }: EditorProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [range, setRange] = useState(() => rangeDraft(event));
  const [locationId, setLocationId] = useState(event.locations[0]?.id ?? '');
  const [personId, setPersonId] = useState('');
  const [dedicated, setDedicated] = useState(false);
  const [publicNote, setPublicNote] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [shared, setShared] = useState(false);
  const [moveFollowing, setMoveFollowing] = useState(false);
  const [error, setError] = useState('');
  const [locationName, setLocationName] = useState('');
  function edit(item: ProgramItem) {
    setEditing(item.id); setTitle(item.title); setRange(rangeDraft(event, item)); setLocationId(item.locationId); setPersonId(item.personId); setDedicated(item.dedicated); setPublicNote(item.publicNote); setInternalNote(item.internalNote); setShared(item.allowSharedLocation); setMoveFollowing(false); setError('');
  }
  function save(e: FormEvent) {
    e.preventDefault();
    try {
      if (!title.trim()) throw new Error('진행 항목 제목을 입력하세요.');
      if (dedicated && !personId) throw new Error('해당 시간 전담으로 지정하려면 담당자를 선택하세요.');
      const item: ProgramItem = { id: editing ?? id(), title: title.trim(), ...readRange(range), locationId, personId, dedicated, publicNote, internalNote, allowSharedLocation: shared };
      const before = event.programs.find(p => p.id === editing);
      const delta = before ? item.start - before.start : 0;
      const following = before ? event.programs.filter(p => p.id !== before.id && p.start > before.start) : [];
      if (moveFollowing && delta && following.length && !confirm(`이 항목 이후에 시작하는 진행 항목 ${following.length}개를 ${delta > 0 ? '+' : ''}${delta}분 이동할까요? 인력 배정은 유지됩니다. 이동한 전담자의 충돌과 장소 중복은 다시 검사합니다.`)) return;
      const programs = editing ? event.programs.map(p => {
        if (p.id === editing) return item;
        if (moveFollowing && before && p.start > before.start) return { ...p, start: p.start + delta, end: p.end + delta };
        return p;
      }) : [...event.programs, item];
      onChange({ ...event, programs }, editing ? '진행 항목 수정' : '진행 항목 추가');
      setEditing(null); setTitle(''); setPublicNote(''); setInternalNote(''); setMoveFollowing(false); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : '입력값을 확인하세요.'); }
  }
  function reorder(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= event.programs.length) return;
    const programs = [...event.programs];
    [programs[index], programs[target]] = [programs[target], programs[index]];
    onChange({ ...event, programs }, '진행 항목 표시 순서 변경');
  }
  const conflicts = event.programs.flatMap((item, index) => event.programs.slice(index + 1).filter(other => item.locationId && item.locationId === other.locationId && item.start < other.end && other.start < item.end && !(item.allowSharedLocation && other.allowSharedLocation)).map(other => `${item.title} / ${other.title}`));
  return <div className="stack"><section className="panel"><div className="section-head"><div><h2>행사 진행 시간표</h2><p className="muted">준비부터 철수까지, 행사 흐름을 한눈에 정리하세요.</p></div><span className="pill">{event.programs.length}개 항목</span></div>
    {event.mode === 'program' && <p className="notice">진행표 전용 모드입니다. 참여자 명단 없이 저장·복원·출력을 사용할 수 있습니다.</p>}
    <details><summary>진행 장소 추가</summary><form className="row" onSubmit={e => { e.preventDefault(); if (!locationName.trim()) return; const location = { id: id(), name: locationName.trim() }; onChange({ ...event, locations: [...event.locations, location] }, '진행 장소 추가'); setLocationId(location.id); setLocationName(''); }}><Field label="진행 장소 이름"><input value={locationName} onChange={e => setLocationName(e.target.value)} disabled={readOnly} required placeholder="예: 메인홀" maxLength={100} /></Field><button className="button secondary" disabled={readOnly}>+ 장소 추가</button></form></details>
    <form onSubmit={save}><fieldset disabled={readOnly}><legend>{editing ? '진행 항목 수정' : '진행 항목 추가'}</legend><Field label="진행 항목 제목"><input value={title} onChange={e => setTitle(e.target.value)} required maxLength={200} placeholder="예: 개회 및 행사 안내" /></Field><RangeFields value={range} onChange={setRange} prefix="진행 " />
      <div className="form-grid"><Field label="진행 장소"><select value={locationId} onChange={e => setLocationId(e.target.value)}><option value="">장소 미지정</option>{event.locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field><Field label="진행 담당자"><select value={personId} onChange={e => { setPersonId(e.target.value); if (!e.target.value) setDedicated(false); }}><option value="">담당자 미지정</option>{event.people.map(person => <option key={person.id} value={person.id}>{displayPerson(person)} · {person.id.slice(-6)}</option>)}</select></Field><Field label="담당 방식" help="전담은 인력 배정과 같은 점유시간으로 검사합니다."><select value={dedicated ? 'dedicated' : 'contact'} onChange={e => setDedicated(e.target.value === 'dedicated')} disabled={!personId}><option value="contact">단순 연락 담당 · 시간 점유 없음</option><option value="dedicated">해당 시간 전담</option></select></Field></div>
      <div className="form-grid"><Field label="공개 메모"><textarea value={publicNote} onChange={e => setPublicNote(e.target.value)} maxLength={5000} rows={3} placeholder="출력물에 함께 표시할 안내" /></Field><Field label="운영자 내부메모" help="기본 출력에는 포함되지 않습니다."><textarea value={internalNote} onChange={e => setInternalNote(e.target.value)} maxLength={5000} rows={3} placeholder="담당자가 확인할 준비 사항" /></Field></div>
      <label className="row"><input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} />동일 시간 장소 공유 허용</label><p className="small muted">겹치는 두 항목 모두 공유를 허용해야 동일 장소 중복 경고가 해제됩니다.</p>
      {editing && <Field label="시작시간 변경 적용 대상"><select value={moveFollowing ? 'following' : 'one'} onChange={e => setMoveFollowing(e.target.value === 'following')}><option value="one">이 항목만 이동</option><option value="following">이후 시작하는 진행 항목도 함께 이동</option></select></Field>}
      {error && <p className="notice" role="alert">{error}</p>}<div className="toolbar"><button className="button primary">{editing ? '진행 항목 수정 적용' : '+ 진행 항목 추가'}</button>{editing && <button className="button secondary" type="button" onClick={() => { setEditing(null); setTitle(''); setPublicNote(''); setInternalNote(''); setError(''); }}>수정 취소</button>}</div>
    </fieldset></form>
  </section><ProgramPaste key={event.id} event={event} onChange={onChange} readOnly={readOnly}/><section className="panel"><div className="section-head"><h2>진행 순서</h2><p className="small muted">순서 버튼은 표시 순서만 바꿉니다. 실제 시각은 항목 수정에서 변경하세요.</p></div>
    {conflicts.length > 0 && <div className="notice" role="status"><strong>동일 장소 중복 주의</strong><ul>{conflicts.map((message, index) => <li key={index}>{message}</li>)}</ul><p className="small">시간·장소를 수정하거나 두 항목의 장소 공유 허용을 명시하세요.</p></div>}
    {!event.programs.length ? <p className="empty">첫 진행 항목을 추가해 주세요. 서로 다른 장소의 병렬 일정도 만들 수 있습니다.</p> : <div className="table-wrap"><table><thead><tr><th>순서</th><th>시간·항목</th><th>장소</th><th>담당자</th><th>공개 메모</th><th>작업</th></tr></thead><tbody>{event.programs.map((item, index) => {
      const person = event.people.find(p => p.id === item.personId);
      return <tr key={item.id}><td><div className="row"><span>{index + 1}</span><button className="button secondary" aria-label={`${item.title} 위로`} disabled={readOnly || index === 0} onClick={() => reorder(index, -1)}>↑</button><button className="button secondary" aria-label={`${item.title} 아래로`} disabled={readOnly || index === event.programs.length - 1} onClick={() => reorder(index, 1)}>↓</button></div></td><td><strong>{item.title}</strong><br /><span className="small">{dateOf(item.start)} · {formatRange(item.start, item.end)}</span></td><td>{event.locations.find(l => l.id === item.locationId)?.name ?? (item.locationId ? '삭제된 장소' : '미지정')}{item.allowSharedLocation && <div className="small">공유 허용</div>}</td><td>{person ? displayPerson(person) : item.personId ? '삭제된 담당자' : '미지정'}{person && <div className="small">{item.dedicated ? '시간 전담' : '연락 담당'}</div>}</td><td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.publicNote || '—'}{item.internalNote && <div className="small muted">내부메모 있음</div>}</td><td><div className="row"><button className="button secondary" disabled={readOnly} onClick={() => edit(item)}>수정</button><button className="button secondary" disabled={readOnly} onClick={() => {
        const programs = [...event.programs];
        programs.splice(index + 1, 0, { ...item, id: id(), title: `${item.title} (복사)` });
        onChange({ ...event, programs }, '진행 항목 복제');
      }}>복제</button><button className="button danger" disabled={readOnly} onClick={() => {
        if (!confirm(`‘${item.title}’ 진행 항목을 삭제할까요?${item.dedicated ? ' 전담자의 해당 시간 점유도 해제됩니다.' : ''} 인력 배치표는 유지됩니다.`)) return;
        onChange({ ...event, programs: event.programs.filter(p => p.id !== item.id) }, '진행 항목 삭제'); if (editing === item.id) setEditing(null);
      }}>삭제</button></div></td></tr>;
    })}</tbody></table></div>}
  </section></div>;
}
