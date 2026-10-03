import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { id } from '../core/defaults';
import { FIELDS, parseTSV, suggestedMapping, previewAppend, applyAppend } from '../io/programPaste';
import type { PasteField, PasteMapping, PastePreview, PasteTable } from '../io/programPaste';
import type { EditorProps } from './Inputs';

/** This panel never saves directly: App owns history, persistence and revision checks. */
export default function ProgramPaste({ event, onChange, readOnly = false }: EditorProps) {
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState('');
  const [table, setTable] = useState<PasteTable | null>(null);
  const [mapping, setMapping] = useState<PasteMapping>({});
  const [preview, setPreview] = useState<PastePreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [duplicatesConfirmed, setDuplicatesConfirmed] = useState(false);
  const [error, setError] = useState('');
  const consumed = useRef<PastePreview | null>(null);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { if (preview) previewRef.current?.focus(); }, [preview]);
  useEffect(() => { setConfirmed(false); setDuplicatesConfirmed(false); }, [event]);
  const disabled = readOnly || event.status !== 'draft';
  const stale = !!preview && preview.baseFingerprint !== JSON.stringify(event);
  const ready = !!preview && !disabled && !stale && !preview.hasErrors && confirmed && (!preview.hasDuplicates || duplicatesConfirmed);
  const invalidate = () => { setPreview(null); setConfirmed(false); setDuplicatesConfirmed(false); setError(''); };
  const clear = () => { setPaste(''); setTable(null); setMapping({}); invalidate(); };
  const close = () => { clear(); setOpen(false); (disabled ? headingRef.current : toggleRef.current)?.focus(); };
  const read = () => {
    if (disabled) return;
    invalidate();
    setTable(null);
    try { const next = parseTSV(paste); setTable(next); setMapping(suggestedMapping(next.headers)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '표 입력을 확인하세요.'); }
  };
  const review = () => {
    if (disabled || !table) return;
    invalidate();
    try { setPreview(previewAppend(event, table, mapping)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '열 연결을 확인하세요.'); }
  };
  const apply = () => {
    if (!ready || !preview || consumed.current === preview) return;
    try {
      const next = applyAppend(event, preview, { confirmed, duplicatesConfirmed, idFactory: id });
      // Synchronous guard covers repeated activation before React has rendered the new event.
      consumed.current = preview;
      onChange(next, `진행 표 ${preview.recordCount}개 항목 추가 · 되돌리기로 한 번에 취소할 수 있습니다.`);
      close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '추가하지 못했습니다. 기존 자료를 확인하세요.'); }
  };
  const toggle = () => { if (open) close(); else { clear(); setOpen(true); } };
  return <section className="panel program-paste">
    <div className="section-head"><div><h2 ref={headingRef} tabIndex={-1}>엑셀 식순 표 붙여넣기</h2><p className="muted">여러 진행 항목을 검토한 뒤 현재 순서의 끝에 추가합니다.</p></div><button ref={toggleRef} type="button" className="button secondary" disabled={disabled && !open} aria-expanded={open} aria-controls={panelId} onClick={toggle}>{open ? '붙여넣기 취소' : '표 붙여넣기 열기'}</button></div>
    {open && <fieldset id={panelId} disabled={disabled} className="stack">
      <legend className="sr-only">진행 표 붙여넣기</legend>
      <p className="notice">첫 행은 열 제목입니다. 날짜는 YYYY-MM-DD, 시간은 HH:MM으로 입력하세요. 자정을 넘으면 ‘다음 날 종료’ 열에 ‘예’를 명시하세요. 최대 300행, 500KB입니다.</p>
      <p className="small">입력은 이 브라우저에서만 처리합니다. 담당자·연락처·내부메모는 가져오지 않습니다. ‘공개 메모’에 연결한 내용은 출력물에 포함됩니다. 필요한 열만 붙여넣으세요.</p>
      <label>진행 표 (첫 행은 열 제목)<textarea ref={inputRef} rows={5} value={paste} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => { setPaste(e.target.value); setTable(null); invalidate(); }} placeholder={'날짜\t시작\t종료\t제목\t장소\t다음 날 종료\t공개 메모\n2026-10-20\t10:00\t10:20\t개회\t\t아니오\t'} /></label>
      <div className="toolbar"><button type="button" className="button secondary" disabled={!paste || disabled} onClick={read}>열 읽기</button><button type="button" className="button text" onClick={close}>취소 · 입력 지우기</button></div>
      {error && <p role="alert" className="notice error-text">{error}</p>}
      {table && <>
        <h3>열 연결 · {table.rows.length}행</h3>
        <p className="small">날짜·시작·종료·제목은 필수입니다. 같은 이름의 장소가 여럿이면 장소 ID를 입력하세요. 빈 장소는 미지정으로 추가됩니다.</p>
        {event.locations.length > 0 && <details><summary>등록된 장소 이름·ID 확인</summary><ul>{event.locations.map(location => <li key={location.id}>{location.name} · ID: {location.id}</li>)}</ul></details>}
        <div className="form-grid">{(Object.keys(FIELDS) as PasteField[]).map(field => <label key={field}>{FIELDS[field]} 열<select value={mapping[field] || ''} onChange={e => { setMapping({ ...mapping, [field]: e.target.value }); invalidate(); }}><option value="">연결 안 함</option>{table.headers.map(header => <option key={header} value={header}>{header}</option>)}</select></label>)}</div>
        <button type="button" className="button secondary" onClick={review}>추가 내용 미리보기</button>
      </>}
      {preview && <>
        <h3 ref={previewRef} tabIndex={-1}>추가 미리보기 · {preview.recordCount}개 항목</h3>
        <p>기존 {event.programs.length}개 항목 뒤에 표의 행 순서대로 추가됩니다. 기존 시각·순서·배정·확정 기록은 유지됩니다.</p>
        <p className="notice">미반영 열: {preview.ignoredColumns.join(', ') || '없음'}{preview.ignoredColumns.length > 0 && ' · 이 열의 값은 저장하지 않습니다.'}</p>
        {stale && <p role="alert" className="notice error-text">미리보기 뒤 기존 행사가 바뀌었습니다. 다시 미리보기 하세요.</p>}
        <div className="table-wrap"><table aria-label="진행 표 추가 미리보기"><thead><tr><th>원본 행</th><th>날짜·시각</th><th>제목</th><th>장소</th><th>공개 메모</th><th>검사 결과</th></tr></thead><tbody>{preview.rows.map(row => <tr key={row.sourceRow}><td>{row.sourceRow}</td><td>{row.date}<br />{row.start}–{row.end}{row.nextDay ? ' (+1일)' : ''}</td><td>{row.title}</td><td>{row.location || '미지정'}</td><td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.record.publicNote || '—'}</td><td>{row.errors.map((value, i) => <p className="error-text" key={`e${i}`}>{value}</p>)}{row.warnings.map((value, i) => <p key={`w${i}`}>{value}</p>)}{!row.errors.length && !row.warnings.length && '정상'}</td></tr>)}</tbody></table></div>
        {(preview.validation.errors.length > 0 || preview.validation.warnings.length > 0) && <div className="notice"><h4>행사 전체 검사</h4><ul>{preview.validation.errors.map((issue, i) => <li className="error-text" key={`e${i}`}>수정 필요: {issue.message}</li>)}{preview.validation.warnings.map((issue, i) => <li key={`w${i}`}>주의: {issue.message}</li>)}</ul></div>}
        {preview.hasErrors && <p role="alert" className="error-text">오류가 있어 전체 추가를 차단했습니다. 입력 또는 기존 행사 오류를 수정한 뒤 다시 미리보기 하세요.</p>}
        <label className="check"><input type="checkbox" disabled={disabled || stale || preview.hasErrors} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />추가 내용·경고·미반영 열을 확인했고 현재 순서 끝에 추가합니다</label>
        {preview.hasDuplicates && <label className="check"><input type="checkbox" disabled={disabled || stale || preview.hasErrors} checked={duplicatesConfirmed} onChange={e => setDuplicatesConfirmed(e.target.checked)} />같은 제목·시간·장소의 중복 항목도 삭제하지 않고 추가합니다</label>}
        <button type="button" className="button primary" disabled={!ready} onClick={apply}>확인한 {preview.recordCount}개 항목 추가</button>
        <p className="small muted">추가 후 상단 ‘되돌리기’로 전체 추가를 한 번에 취소할 수 있습니다. 저장 상태와 배치표의 검사 결과도 확인하세요.</p>
      </>}
    </fieldset>}
  </section>;
}
