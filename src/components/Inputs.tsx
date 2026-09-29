import { Children, cloneElement, isValidElement, useId, type ReactNode } from 'react';
import type { EventData, Interval, UpdateEvent } from '../core/types';
import { clockOf, dateOf, toMinute } from '../core/time';

export interface EditorProps { event: EventData; onChange: UpdateEvent; readOnly?: boolean }
export interface RangeDraft { date: string; start: string; end: string; nextDay: boolean }
export function rangeDraft(event: EventData, range?: Interval): RangeDraft {
  if (range) return { date: dateOf(range.start), start: clockOf(range.start), end: clockOf(range.end), nextDay: dateOf(range.start) !== dateOf(range.end) };
  const day = event.days[0];
  return { date: day?.date ?? new Date().toISOString().slice(0, 10), start: day?.start ?? '09:00', end: day?.end ?? '17:00', nextDay: day?.nextDay ?? false };
}
export function readRange(value: RangeDraft): Interval {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !/^\d{2}:\d{2}$/.test(value.start) || !/^\d{2}:\d{2}$/.test(value.end)) throw new Error('날짜와 시작·종료 시각을 모두 입력하세요.');
  const start = toMinute(value.date, value.start);
  const end = toMinute(value.date, value.end, value.nextDay);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('종료는 시작보다 늦어야 합니다. 자정을 넘기면 ‘다음 날 종료’를 선택하세요.');
  return { start, end };
}
export function Field({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  const inputId = useId();
  return <div className="field"><label htmlFor={inputId}>{label}</label>{Children.map(children, child => isValidElement<{ id?: string; 'aria-describedby'?: string }>(child) && typeof child.type === 'string' && ['input', 'select', 'textarea'].includes(child.type) ? cloneElement(child, { id: inputId, 'aria-describedby': help ? `${inputId}-help` : undefined }) : child)}{help && <small id={`${inputId}-help`} className="muted">{help}</small>}</div>;
}
export function RangeFields({ value, onChange, prefix = '', disabled = false }: { value: RangeDraft; onChange: (value: RangeDraft) => void; prefix?: string; disabled?: boolean }) {
  return <div className="form-grid">
    <Field label={`${prefix}날짜`}><input type="date" value={value.date} disabled={disabled} required onChange={e => onChange({ ...value, date: e.target.value })} /></Field>
    <Field label={`${prefix}시작`}><input type="time" step="60" value={value.start} disabled={disabled} required onChange={e => onChange({ ...value, start: e.target.value })} /></Field>
    <Field label={`${prefix}종료`}><input type="time" step="60" value={value.end} disabled={disabled} required onChange={e => onChange({ ...value, end: e.target.value })} /></Field>
    <label className="row"><input type="checkbox" checked={value.nextDay} disabled={disabled} onChange={e => onChange({ ...value, nextDay: e.target.checked })} />다음 날 종료 (+1일)</label>
  </div>;
}
export function tagsFrom(value: string) { return value.split(',').map(s => s.trim()).filter(Boolean); }
export function minuteValue(value: string): number | undefined { return value === '' ? undefined : Math.max(0, Math.round(Number(value))); }
export function displayPerson(person: { name: string; alias: string; team: string; id: string }) { return `${person.alias || person.name}${person.team ? ` · ${person.team}` : ''}`; }
export function nextDate(date: string) { return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10); }
