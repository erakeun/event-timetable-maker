import type { EventData, Interval } from './types';

/** Calendar minutes, interpreted as Asia/Seoul wall time. Never depends on the host timezone. */
export function toMinute(date: string, hhmm: string, nextDay = false): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(hhmm)) throw new Error('날짜와 시간 형식이 올바르지 않습니다.');
  const [y, m, d] = date.split('-').map(Number); const [h, minute] = hhmm.split(':').map(Number);
  const stamp = Date.UTC(y, m - 1, d);
  if (y < 1900 || y > 2200 || h > 23 || minute > 59 || new Date(stamp).toISOString().slice(0, 10) !== date) throw new Error('날짜 또는 시간이 유효하지 않습니다.');
  return stamp / 60000 + h * 60 + minute + (nextDay ? 1440 : 0);
}
export function dateOf(minute: number): string { return new Date(minute * 60000).toISOString().slice(0, 10); }
export function clockOf(minute: number): string { return new Date(minute * 60000).toISOString().slice(11, 16); }
export function formatRange(start: number, end: number): string {
  return `${clockOf(start)}–${clockOf(end)}${dateOf(start) !== dateOf(end) ? ` (+${Math.floor(end / 1440) - Math.floor(start / 1440)}일)` : ''}`;
}
export function dayIntervals(event: Pick<EventData, 'days'>): (Interval & { date: string; id: string })[] {
  return event.days.map(d => ({ id: d.id, date: d.date, start: toMinute(d.date, d.start), end: toMinute(d.date, d.end, d.nextDay) }));
}
export function splitByDay(start: number, end: number): (Interval & { date: string; minutes: number })[] {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) return [];
  const result = []; let at = start;
  while (at < end) { const stop = Math.min(end, (Math.floor(at / 1440) + 1) * 1440); result.push({ date: dateOf(at), start: at, end: stop, minutes: stop - at }); at = stop; }
  return result;
}
export function overlap(a: Interval, b: Interval): boolean { return a.start < b.end && b.start < a.end; }
export function covers(intervals: Interval[], start: number, end: number): boolean {
  let cursor = start;
  for (const item of [...intervals].sort((a,b) => a.start - b.start)) {
    if (item.start > cursor) break;
    if (item.end > cursor) cursor = item.end;
    if (cursor >= end) return true;
  }
  return false;
}
