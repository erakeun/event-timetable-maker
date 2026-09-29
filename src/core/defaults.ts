import { APP_VERSION, type EventData, type Person } from './types';
import { toMinute } from './time';
export function id(): string { return globalThis.crypto?.randomUUID?.() ?? `etm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
export function createPerson(name = ''): Person {
  return { id: id(), name, team: '', alias: '', tags: [], color: '#4679b7', availability: [], allowedRoleIds: [], blockedDates: [], minMode: 'soft' };
}
export function createEvent(name = '새 행사', mode: EventData['mode'] = 'staffing'): EventData {
  const now = new Date().toISOString();
  // Only defaults use today's Seoul date; all subsequent calculations are explicit calendar minutes.
  const date = new Date(Date.now() + 9 * 3600000).toISOString().slice(0,10);
  return { schemaVersion: 1, appVersion: APP_VERSION, id: id(), name, organization: '', description: '', timezone: 'Asia/Seoul', days: [{ id: id(), date, start: '09:00', end: '17:00', nextDay: false }], locations: [], roles: [], demands: [], people: [], assignments: [], programs: [], policy: { gridMinutes: 30, minimumAssignment: 30, preferredShift: 120, travelMinutes: 0, allowOverstaff: false, preset: 'balanced', seed: 1, timeLimitMs: 5000 }, mode, status: 'draft', revision: 0, edition: 1, createdAt: now, updatedAt: now, snapshots: [] };
}
export function createSampleEvent(): EventData {
  const event = createEvent('가상 가을 축제 · 체험용');
  event.description = '실제 인물이 없는 2일 행사 예시입니다. 자유롭게 수정해 보세요.';
  event.days = [{ id: id(), date: '2026-10-10', start: '09:00', end: '17:00', nextDay: false }, { id: id(), date: '2026-10-11', start: '10:00', end: '16:00', nextDay: false }];
  event.locations = [{ id: 'sample-central', name: '중앙부스' }, { id: 'sample-gate', name: '입구' }, { id: 'sample-stage', name: '행사장' }];
  event.roles = [{ id: 'sample-reception', name: '접수', requiredTags: ['접수'] }, { id: 'sample-guide', name: '안내', requiredTags: [] }, { id: 'sample-stage-role', name: '진행', requiredTags: ['진행'] }];
  for (let i = 0; i < 12; i++) {
    const p = createPerson(`가상 참여자 ${String(i+1).padStart(2,'0')}`); p.team = i < 6 ? '푸른팀' : '초록팀'; p.color = i < 6 ? '#4679b7' : '#20816a'; p.tags = ['접수', '진행', ...(i % 3 === 0 ? ['책임자'] : [])]; p.maxDaily = 360; p.maxTotal = 600; p.maxContinuous = 180; p.minBreak = 30;
    p.availability = event.days.flatMap(d => [{ id: id(), start: toMinute(d.date,d.start), end: toMinute(d.date,d.end), state: 'available' as const }, { id: id(), start: toMinute(d.date, i % 2 ? '12:00':'13:00'), end: toMinute(d.date,i % 2 ? '13:00':'14:00'), state: 'unavailable' as const }]); event.people.push(p);
  }
  for (const d of event.days) {
    const start = toMinute(d.date,d.start), end = toMinute(d.date,d.end);
    event.demands.push({ id: id(), locationId:'sample-central', roleId:'sample-reception',start,end,count:2,leaderTag:'책임자',leaderMin:1,phase:'본행사' },{ id:id(),locationId:'sample-gate',roleId:'sample-guide',start,end,count:1,leaderTag:'',leaderMin:0,phase:'본행사' },{ id:id(),locationId:'sample-stage',roleId:'sample-stage-role',start:start+60,end:end-60,count:1,leaderTag:'',leaderMin:0,phase:'본행사' });
    event.programs.push({ id:id(),title:'개회 안내',start:start+60,end:start+90,locationId:'sample-stage',personId:event.people[0].id,dedicated:false,publicNote:'환영 인사 및 안전 안내',internalNote:'운영자 확인 메모 (기본 출력 제외)',allowSharedLocation:false });
  }
  return event;
}
