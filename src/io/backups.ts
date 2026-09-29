import { APP_VERSION, SCHEMA_VERSION, type EventData } from '../core/types';
import { validateEvent } from '../core/validate';

export const BACKUP_APP = 'event-timetable-maker';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 10_000;
export class ImportError extends Error { constructor(message: string) { super(message); this.name = 'ImportError'; } }
function fail(path: string, reason: string): never { throw new ImportError(`${path}: ${reason}`); }
function obj(value: unknown, path: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '객체 형식이 아닙니다.');
  return value as Record<string, any>;
}
function str(value: unknown, path: string, required = false) {
  if (typeof value !== 'string' || value.length > 20_000 || (required && !value.trim())) fail(path, '문자열이 없거나 길이 제한을 초과합니다.');
}
function num(value: unknown, path: string, min = 0, max = 1e12) {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) fail(path, '허용된 정수 범위를 벗어났습니다.');
}
function bool(value: unknown, path: string) { if (typeof value !== 'boolean') fail(path, '참/거짓 값이 필요합니다.'); }
function one(value: unknown, values: unknown[], path: string) { if (!values.includes(value)) fail(path, '지원하지 않는 값입니다.'); }
function arr(value: unknown, path: string, max = MAX_ROWS): any[] {
  if (!Array.isArray(value) || value.length > max) fail(path, `배열이 아니거나 ${max.toLocaleString()}개 제한을 초과합니다.`);
  return value as any[];
}
function strings(value: unknown, path: string) { arr(value, path, 1000).forEach((v, i) => str(v, `${path}[${i}]`, true)); }
function ids(value: unknown, path: string, max = MAX_ROWS): Set<string> {
  const found = new Set<string>();
  arr(value, path, max).forEach((v, i) => { const row = obj(v, `${path}[${i}]`); str(row.id, `${path}[${i}].id`, true); if (found.has(row.id)) fail(path, `중복 ID: ${row.id}`); found.add(row.id); });
  return found;
}
function interval(row: any, path: string) { const min=Date.UTC(1900,0,1)/60000,max=Date.UTC(2201,0,1)/60000;num(row.start, `${path}.start`,min,max); num(row.end, `${path}.end`,min,max); if (row.end <= row.start || row.end - row.start > 60 * 24 * 366) fail(path, '종료가 시작 이후여야 하며 구간은 366일 이하여야 합니다.'); }
function ref(value: unknown, known: Set<string>, path: string, empty = false, strict = false) { str(value, path, !empty); if (strict && !(empty && value === '') && !known.has(value as string)) fail(path, `참조 ID가 없습니다: ${String(value)}`); }
function isoDate(value: unknown, path: string) {
  str(value, path, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value as string) || Number((value as string).slice(0,4))<1900 || Number((value as string).slice(0,4))>2200 || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) !== value) fail(path, '잘못된 날짜입니다. 1900~2200년 범위를 지원합니다.');
}
function hhmm(value: unknown, path: string) { if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail(path, 'HH:MM 형식의 시각이 필요합니다.'); }

/** Structural validation never mutates input. Scheduling conflicts remain visible to the shared validator. */
export function assertEventStructure(value: unknown, path = '행사', snapshot = false): asserts value is EventData {
  const e = obj(value, path);
  const strictReferences=snapshot||e.status==='confirmed';
  if (e.schemaVersion !== SCHEMA_VERSION) fail(path, '지원하지 않는 schemaVersion입니다. 원본 파일은 그대로 유지됩니다.');
  ['id','name','appVersion','createdAt','updatedAt'].forEach(k => str(e[k], `${path}.${k}`, true));
  ['organization','description'].forEach(k => str(e[k], `${path}.${k}`));
  if(e.logoDataUrl!==undefined){
    if(typeof e.logoDataUrl!=='string'||e.logoDataUrl.length>1_400_000||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(e.logoDataUrl))fail(path,'로고는 1MB 이하 PNG/JPEG 데이터 이미지여야 합니다.');
    const base64=e.logoDataUrl.split(',')[1];if(base64.length%4!==0||base64.length*3/4-(base64.endsWith('==')?2:base64.endsWith('=')?1:0)>1024*1024)fail(path,'로고는 1MB 이하여야 합니다.');
    let bytes:string;try{bytes=atob(base64);}catch{fail(path,'로고 base64가 올바르지 않습니다.');}
    const expected=e.logoDataUrl.startsWith('data:image/png;')?[137,80,78,71,13,10,26,10]:[255,216,255];
    if(expected.some((byte,i)=>bytes.charCodeAt(i)!==byte))fail(path,'로고 파일 내용이 PNG/JPEG 형식과 일치하지 않습니다.');
  }
  ['createdAt','updatedAt'].forEach(k => { if (!Number.isFinite(Date.parse(e[k]))) fail(path, `${k} 시각이 올바르지 않습니다.`); });
  one(e.timezone, ['Asia/Seoul'], `${path}.timezone`); one(e.mode, ['staffing','program'], `${path}.mode`); one(e.status, ['draft','confirmed','archived'], `${path}.status`);
  num(e.revision, `${path}.revision`); num(e.edition, `${path}.edition`);
  ids(e.days, `${path}.days`, 366); const dayDates = new Set<string>();
  e.days.forEach((d: any) => { isoDate(d.date, '행사 날짜'); if (dayDates.has(d.date)) fail(path, '중복 행사 날짜입니다.'); dayDates.add(d.date); hhmm(d.start, '시작'); hhmm(d.end, '종료'); bool(d.nextDay, '다음 날 종료'); if (!d.nextDay && d.start >= d.end) fail(path, '행사 종료는 시작 이후여야 합니다. 자정 넘김은 다음 날 종료로 표시하세요.'); });
  const locations = ids(e.locations, `${path}.locations`, 100), roles = ids(e.roles, `${path}.roles`, 100), people = ids(e.people, `${path}.people`, 500);
  e.locations.forEach((l: any) => str(l.name,'장소 이름',true));
  e.roles.forEach((r: any) => { str(r.name,'역할 이름',true); strings(r.requiredTags,'역할 태그'); });
  e.people.forEach((p: any) => {
    ['name','team','alias','color'].forEach(k => str(p[k], `참여자.${k}`, k === 'name'));
    if(!/^#[0-9a-f]{6}$/i.test(p.color))fail('참여자 색상','6자리 HEX 색상이 필요합니다.');
    strings(p.tags,'참여자 태그'); strings(p.allowedRoleIds,'허용 역할'); p.allowedRoleIds.forEach((id: string) => ref(id,roles,'허용 역할',false,strictReferences));
    strings(p.blockedDates,'불가 날짜'); p.blockedDates.forEach((d: string) => isoDate(d,'불가 날짜'));
    ['maxDaily','maxTotal','maxContinuous','minBreak','desiredMinutes','minMinutes'].forEach(k => { if (p[k] !== undefined) num(p[k], `참여자.${k}`,0,527040); });
    one(p.minMode,['soft','hard'],'최소시간 정책'); ids(p.availability,'가능시간',10000);
    p.availability.forEach((a: any) => { interval(a,'가능시간'); one(a.state,['available','unavailable','preferred','unknown'],'가능시간 상태'); });
  });
  ids(e.demands,'수요',2000); e.demands.forEach((d: any) => { interval(d,'수요'); ref(d.locationId,locations,'수요 장소',false,strictReferences); ref(d.roleId,roles,'수요 역할',false,strictReferences); num(d.count,'필요 인원',0,500); num(d.leaderMin,'책임자 수',0,500); str(d.leaderTag,'책임자 태그'); str(d.phase,'운영 구간'); });
  ids(e.assignments,'배정',20000); e.assignments.forEach((a: any) => { interval(a,'배정'); ref(a.personId,people,'배정 참여자',false,strictReferences); ref(a.locationId,locations,'배정 장소',false,strictReferences); ref(a.roleId,roles,'배정 역할',false,strictReferences); bool(a.locked,'잠금'); one(a.source,['manual','auto'],'배정 출처'); });
  ids(e.programs,'진행표',2000); e.programs.forEach((p: any) => { interval(p,'진행표'); str(p.title,'항목 제목',true); ref(p.locationId,locations,'진행 장소',true,strictReferences); ref(p.personId,people,'담당자',true,strictReferences); bool(p.dedicated,'전담'); bool(p.allowSharedLocation,'장소 공유'); str(p.publicNote,'공개 메모'); str(p.internalNote,'운영자 메모'); });
  const p = obj(e.policy,'편성 정책'); one(p.gridMinutes,[5,10,15,20,30,60],'화면 눈금');
  ['minimumAssignment','preferredShift','travelMinutes','seed','timeLimitMs'].forEach(k => num(p[k], `편성 정책.${k}`,0,k === 'seed' ? 4294967295 : 527040));
  bool(p.allowOverstaff,'초과 인원 허용'); one(p.preset,['balanced','continuous','preferred'],'편성 우선순위');
  if (!snapshot) {
    ids(e.snapshots,'확정본',25);let lastVersion=0;
    const workload=(data:any)=>['days','locations','roles','people','demands','assignments','programs'].reduce((n,k)=>n+(Array.isArray(data?.[k])?data[k].length:0),0)+(Array.isArray(data?.people)?data.people.reduce((n:number,p:any)=>n+(Array.isArray(p?.availability)?p.availability.length:0),0):0);
    if(workload(e)+e.snapshots.reduce((n:number,s:any)=>n+workload(s.data),0)>50000)fail(path,'확정본을 포함한 전체 데이터는 50,000항목 이하여야 합니다.');
    e.snapshots.forEach((s: any) => { num(s.version,'확정본 버전',1); if(s.version<=lastVersion)fail('확정본','버전은 중복 없이 증가해야 합니다.');lastVersion=s.version;str(s.confirmedAt,'확정 시각',true); if (!Number.isFinite(Date.parse(s.confirmedAt))) fail('확정본','잘못된 확정 시각'); if (s.data?.snapshots !== undefined) fail('확정본','중첩 확정본은 허용하지 않습니다.'); assertEventStructure(s.data,'확정본 데이터',true); if (s.data.id !== e.id || s.data.edition!==s.version) fail('확정본','행사 ID 또는 버전이 일치하지 않습니다.'); });
    if(e.edition<lastVersion)fail(path,'현재 버전이 과거 확정본보다 낮습니다.');
    if(e.status==='confirmed'){
      const latest=e.snapshots.at(-1);if(!latest||latest.version!==e.edition)fail(path,'확정 상태에 대응하는 불변 스냅샷이 없습니다.');
      const {snapshots:_,revision:__,updatedAt:___,...current}=e;const {revision:____,updatedAt:_____,...frozen}=latest.data;
      if(canonical(current)!==canonical(frozen))fail(path,'확정 상태의 내용이 불변 스냅샷과 다릅니다. 새 개정 초안을 사용하세요.');
    }
  }
  if(snapshot||e.status==='confirmed'){
    if(e.status!=='confirmed')fail(path,'확정본은 확정 상태여야 합니다.');
    const check=validateEvent({...e,snapshots:[]} as unknown as EventData);if(check.errors.length||check.shortages.some(s=>s.missing>0||s.leaderMissing>0))fail(path,'확정본에 필수 제약 오류 또는 인원 부족이 있습니다.');
  }
}
function canonical(value:unknown):string {if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';return JSON.stringify(value);}

export function serializeBackup(event: EventData): string {
  assertEventStructure(event);
  const text=JSON.stringify({ app: BACKUP_APP, schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, eventId: event.id, savedAt: new Date().toISOString(), timezone: event.timezone, event }, null, 2);
  if(new TextEncoder().encode(text).byteLength>MAX_FILE_BYTES)throw new ImportError('전체 백업이 10MB를 초과합니다. 출력 파일로도 보관하고 행사 자료 크기를 줄여 주세요.');
  return text;
}
export function parseBackup(text: string): EventData {
  if (new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES) throw new ImportError('백업 파일은 10MB 이하여야 합니다.');
  let data: any; try { data = JSON.parse(text); } catch { throw new ImportError('JSON 파일이 손상되었거나 올바른 백업이 아닙니다.'); }
  const backup = obj(data,'백업');
  if (backup.app !== BACKUP_APP) throw new ImportError('다른 앱의 파일입니다. 행사 시간표 제작기 전체 백업을 선택하세요.');
  if (backup.schemaVersion !== SCHEMA_VERSION) throw new ImportError('지원하지 않는 schemaVersion입니다.');
  if (backup.timezone !== 'Asia/Seoul' || backup.eventId !== backup.event?.id) throw new ImportError('백업 메타데이터와 행사 정보가 일치하지 않습니다.');
  str(backup.appVersion,'백업 앱 버전',true); str(backup.savedAt,'백업 시각',true);
  if (!Number.isFinite(Date.parse(backup.savedAt))) throw new ImportError('백업 저장 시각이 올바르지 않습니다.');
  assertEventStructure(backup.event);
  return backup.event;
}
