import ExcelJS from 'exceljs';
import { normalizeTags } from '../core/tags';
import type { Availability, Demand, EventData, Person, ValidationResult } from '../core/types';
import { toMinute } from '../core/time';
import { validateEvent } from '../core/validate';
import { assertEventStructure, ImportError, MAX_FILE_BYTES, MAX_ROWS } from './backups';

export type ImportKind = 'roster' | 'availability' | 'demand';
export type ImportMode = 'append' | 'update' | 'replace';
export type ImportCell = string | number | boolean | Date | null;
export interface ImportTable { headers: string[]; rows: ImportCell[][]; sheetName?: string; date1904?: boolean; }
export type ColumnMapping = Record<string, string | number>;
export interface RowError { row: number; message: string; }
export interface AvailabilityRow extends Availability { personId: string; }
export interface ImportPreview { kind: ImportKind; table: ImportTable; mapping: ColumnMapping; records: (Person | Demand | AvailabilityRow)[]; errors: RowError[]; }
export interface ImportImpact { messages: string[]; removedPersonIds: string[]; affectedAssignmentIds: string[]; }
export const IMPORT_FIELDS: Record<ImportKind,string[]> = {
  roster: ['id','name','team','alias','tags','color','allowedRoleIds'],
  availability: ['id','personId','date','start','end','nextDay','state'],
  demand: ['id','locationId','roleId','date','start','end','nextDay','count','leaderTag','leaderMin','phase'],
};
export const FIELD_LABELS: Record<string,string> = {id:'ID',name:'이름',team:'소속/팀',alias:'표시 별칭',tags:'역할 태그',color:'색상',allowedRoleIds:'허용 역할 ID',personId:'참여자 ID',date:'날짜',start:'시작',end:'종료',nextDay:'다음 날 종료',state:'가능 상태',locationId:'장소 ID',roleId:'역할 ID',count:'필요 인원',leaderTag:'책임자 태그',leaderMin:'책임자 최소',phase:'운영 구간'};
const newId = () => crypto.randomUUID();
const text = (v: ImportCell | undefined) => v === undefined || v === null ? '' : String(v).trim().replace(/\r?\n/g,' ');

/** RFC4180 quoting with comma/tab separator; cells remain strings so leading zero IDs survive. */
export function parseDelimited(input: string): ImportTable {
  if (new TextEncoder().encode(input).byteLength > MAX_FILE_BYTES) throw new ImportError('입력은 10MB 이하여야 합니다.');
  const source = input.replace(/^\uFEFF/,'');
  const firstLine = source.split(/\r?\n/,1)[0] || '';
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  const all: string[][] = []; let row: string[] = [], cell = '', quoted = false, closed = false;
  for (let i=0;i<source.length;i++) {
    const c=source[i];
    if (quoted) { if (c==='"') { if (source[i+1]==='"') { cell+='"'; i++; } else { quoted=false; closed=true; } } else cell+=c; continue; }
    if (c==='"' && !cell && !closed) { quoted=true; continue; }
    if (c===delimiter || c==='\n' || c==='\r') {
      row.push(cell); cell=''; closed=false;
      if (c!==delimiter) { if (row.some(v => v.trim())) all.push(row); row=[]; if (c==='\r' && source[i+1]==='\n') i++; }
      if (all.length>MAX_ROWS+1) throw new ImportError('입력은 10,000행 이하여야 합니다.');
    } else { if (closed && c.trim()) throw new ImportError('닫는 따옴표 뒤에 잘못된 문자가 있습니다.'); cell+=c; }
  }
  if (quoted) throw new ImportError('닫히지 않은 따옴표가 있습니다.');
  row.push(cell); if (row.some(v => v.trim())) all.push(row);
  if (all.length>MAX_ROWS+1) throw new ImportError('입력은 10,000행 이하여야 합니다.');
  if (!all.length) throw new ImportError('비어 있는 표입니다. 첫 행에는 열 제목이 필요합니다.');
  const headers=all.shift()!.map(v => v.trim());
  if (headers.length>100 || new Set(headers).size!==headers.length || headers.some(h => !h)) throw new ImportError('열 제목은 비어 있거나 중복될 수 없으며 최대 100개입니다.');
  if (all.some(r => r.length>headers.length)) throw new ImportError('열 제목보다 많은 셀이 있는 행이 있습니다. 쉼표가 포함된 값은 따옴표로 감싸세요.');
  return {headers,rows:all};
}

export async function readImportFile(file: File): Promise<ImportTable> {
  if (file.size>MAX_FILE_BYTES) throw new ImportError('파일은 10MB 이하여야 합니다.');
  if (/\.(csv|tsv|txt)$/i.test(file.name)) return parseDelimited(await file.text());
  if (!/\.xlsx$/i.test(file.name)) throw new ImportError('CSV, TSV 또는 XLSX 파일만 지원합니다.');
  const buffer=await file.arrayBuffer();
  inspectZipLimits(buffer);
  const wb=new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new ImportError('XLSX 파일을 열 수 없습니다. 손상되었거나 지원하지 않는 파일입니다.'); }
  if (wb.worksheets.length>10) throw new ImportError('워크북은 최대 10개 시트까지 허용합니다.');
  const sheet=wb.worksheets.find(s => s.name!=='작성안내' && s.rowCount>0);
  if (!sheet) throw new ImportError('읽을 데이터 시트가 없습니다.');
  if (sheet.rowCount>MAX_ROWS+1 || sheet.columnCount>100) throw new ImportError('시트는 최대 10,000행, 100열까지 허용합니다.');
  const rows: ImportCell[][]=[];
  sheet.eachRow({includeEmpty:true},r => {
    const values: ImportCell[]=[];
    for(let col=1;col<=sheet.columnCount;col++) {
      const cell=r.getCell(col), v=cell.value;
      if(v && typeof v==='object' && !(v instanceof Date)) {
        if ('formula' in v || 'sharedFormula' in v) throw new ImportError(`${r.number}행 ${col}열: 수식 셀은 가져올 수 없습니다. 값으로 붙여넣어 주세요.`);
        if ('richText' in v) values.push(v.richText.map(t=>t.text).join(''));
        else if ('text' in v) values.push(v.text);
        else throw new ImportError(`${r.number}행 ${col}열: 지원하지 않는 셀 값입니다.`);
      } else values.push((v ?? '') as ImportCell);
    }
    rows.push(values);
  });
  const headers=(rows.shift()||[]).map(text);
  if (headers.some(h=>!h) || new Set(headers).size!==headers.length) throw new ImportError('열 제목은 비어 있거나 중복될 수 없습니다.');
  return {headers,rows:rows.filter(r=>r.some(v=>text(v))),sheetName:sheet.name,date1904:!!wb.properties.date1904};
}
/** Inspect declared expansion before decompression to bound compressed upload bombs. */
function inspectZipLimits(buffer:ArrayBuffer):void {
  const view=new DataView(buffer);let end=-1;
  for(let at=view.byteLength-22;at>=Math.max(0,view.byteLength-65557);at--)if(view.getUint32(at,true)===0x06054b50){end=at;break;}
  if(end<0)throw new ImportError('손상된 XLSX 압축 구조입니다.');
  const entries=view.getUint16(end+10,true);let at=view.getUint32(end+16,true),total=0;
  if(entries>1000||entries===65535)throw new ImportError('XLSX 내부 파일 수 한도를 초과했습니다.');
  for(let i=0;i<entries;i++){
    if(at+46>view.byteLength||view.getUint32(at,true)!==0x02014b50)throw new ImportError('손상된 XLSX 압축 목록입니다.');
    const size=view.getUint32(at+24,true);total+=size;
    if(size===0xffffffff||total>50*1024*1024)throw new ImportError('XLSX 압축 해제 크기는 50MB 이하여야 합니다.');
    at+=46+view.getUint16(at+28,true)+view.getUint16(at+30,true)+view.getUint16(at+32,true);
  }
}
export function guessMapping(kind: ImportKind, headers: string[]): ColumnMapping {
  const aliases:Record<string,string[]>={id:['번호','참여자번호'],name:['성명','참여자명'],team:['소속','팀','소속·팀'],tags:['자격','자격 태그','자격증'],alias:['별칭']};
  const mapping: ColumnMapping={};
  IMPORT_FIELDS[kind].forEach(field=>{const h=headers.find(h=>h.toLowerCase()===field.toLowerCase()||h===FIELD_LABELS[field]||aliases[field]?.includes(h.trim()));if(h!==undefined)mapping[field]=h;});
  return mapping;
}
function parseDate(v: ImportCell | undefined,date1904=false): string {
  if(v instanceof Date) { if (!Number.isFinite(v.getTime())) throw new Error('날짜 셀이 올바르지 않습니다.'); return v.toISOString().slice(0,10); }
  if(typeof v==='number') { if(!Number.isInteger(v)||v<(date1904?0:1)||v>109574||(!date1904&&v===60)) throw new Error('Excel 날짜는 유효한 정수 일련번호여야 합니다.'); if(date1904)return new Date(Date.UTC(1904,0,1)+v*86400000).toISOString().slice(0,10); const offset=v<60 ? 1 : 0;return new Date(Date.UTC(1899,11,30)+(v+offset)*86400000).toISOString().slice(0,10); }
  const date=text(v);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new Error('날짜는 YYYY-MM-DD 형식이어야 합니다.');return date;
}
function parseClock(v: ImportCell | undefined): string {
  if(v instanceof Date) { if(v.getUTCSeconds()||v.getUTCMilliseconds()) throw new Error('시각은 정수 분이어야 합니다.');return `${String(v.getUTCHours()).padStart(2,'0')}:${String(v.getUTCMinutes()).padStart(2,'0')}`; }
  if(typeof v==='number') { const mins=v*1440;if(v<0||v>=1||Math.abs(mins-Math.round(mins))>0.000001)throw new Error('Excel 시간은 0 이상 1 미만의 정수 분 값이어야 합니다.');const m=Math.round(mins);return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`; }
  const clock=text(v);if(!/^([01]?\d|2[0-3]):[0-5]\d$/.test(clock))throw new Error('시각은 HH:MM 형식이어야 합니다.');return clock.padStart(5,'0');
}
function integer(v: ImportCell | undefined, label: string, fallback?: number) { if(text(v)===''&&fallback!==undefined)return fallback;const n=Number(v);if(typeof v==='boolean'||v instanceof Date||text(v)===''||!Number.isInteger(n)||n<0||n>5000)throw new Error(`${label}: 0~5000의 정수가 필요합니다.`);return n; }
function boolean(v: ImportCell | undefined) {const s=text(v).toLowerCase();if(['','false','0','아니오','아니요'].includes(s))return false;if(['true','1','예','네'].includes(s))return true;throw new Error('다음 날 종료는 예/아니오로 입력하세요.');}
export function previewImport(event: EventData, kind: ImportKind, table: ImportTable, mapping=guessMapping(kind,table.headers)): ImportPreview {
  if(table.rows.length>MAX_ROWS)throw new ImportError('10,000행 한도를 초과했습니다.');
  const records: ImportPreview['records']=[], errors: RowError[]=[], seen=new Set<string>();
  if(kind==='roster'&&table.rows.length>500)return {kind,table,mapping,records,errors:[{row:1,message:'V1 명단은 최대 500명까지 허용합니다.'}]};
  if(kind==='demand'&&table.rows.length>2000)return {kind,table,mapping,records,errors:[{row:1,message:'V1 수요는 최대 2,000개 구간까지 허용합니다.'}]};
  table.rows.forEach((row,index)=>{
    const value=(key:string):ImportCell|undefined=>{const map=mapping[key];return row[typeof map==='number'?map:table.headers.indexOf(map)];};
    const idValue=value('id'); const id=text(idValue)||newId();
    try {
      if(typeof idValue==='number')throw new Error('ID 열은 텍스트 형식으로 입력하세요. 숫자 ID의 선행 0은 확인할 수 없습니다.');
      if(seen.has(id))throw new Error(`중복 ID: ${id}`);seen.add(id);
      if(kind==='roster') {
        const name=text(value('name'));if(!name)throw new Error('이름은 필수입니다.');
        const allowedRoleIds=text(value('allowedRoleIds')).split(/[;|]/).map(s=>s.trim()).filter(Boolean);
        if(allowedRoleIds.some(id=>!event.roles.some(r=>r.id===id)))throw new Error('허용 역할 ID가 행사에 없습니다.');
        const color=text(value('color'))||'#386e62';if(!/^#[0-9a-f]{6}$/i.test(color))throw new Error('색상은 #386e62 같은 6자리 HEX 형식이어야 합니다.');
        records.push({id,name,team:text(value('team')),alias:text(value('alias')),tags:normalizeTags(value('tags')),color,allowedRoleIds,blockedDates:[],availability:[],minMode:'soft'});
      } else {
        const date=parseDate(value('date'),table.date1904);if(!event.days.some(d=>d.date===date))throw new Error('행사 운영 날짜에 없는 날짜입니다.');
        const start=toMinute(date,parseClock(value('start'))), end=toMinute(date,parseClock(value('end')),boolean(value('nextDay')));
        if(end<=start)throw new Error('종료는 시작보다 늦어야 합니다. 자정 넘김은 다음 날 종료를 지정하세요.');
        const day=event.days.find(d=>d.date===date)!;
        if(start<toMinute(day.date,day.start)||end>toMinute(day.date,day.end,day.nextDay))throw new Error('행사 운영시간 밖의 구간입니다.');
        if(kind==='availability') {
          const personId=text(value('personId'));if(!event.people.some(p=>p.id===personId))throw new Error(`참여자 ID가 없습니다: ${personId}`);
          const states:Record<string,Availability['state']>={'가능':'available','불가':'unavailable','미확인':'unknown','선호':'preferred',available:'available',unavailable:'unavailable',unknown:'unknown',preferred:'preferred'};
          const stateKey=text(value('state'));const state=Object.hasOwn(states,stateKey)?states[stateKey]:undefined;if(!state)throw new Error('가능 상태는 가능/불가/미확인/선호 중 하나여야 합니다.');
          records.push({id,personId,start,end,state});
        } else {
          const locationId=text(value('locationId')),roleId=text(value('roleId'));
          if(!event.locations.some(l=>l.id===locationId))throw new Error(`장소 ID가 없습니다: ${locationId}`);
          if(!event.roles.some(r=>r.id===roleId))throw new Error(`역할 ID가 없습니다: ${roleId}`);
          const count=integer(value('count'),'필요 인원'),leaderMin=integer(value('leaderMin'),'책임자 최소',0),leaderTag=text(value('leaderTag'));
          if(leaderMin>count)throw new Error('책임자 최소는 총 필요 인원보다 클 수 없습니다.');if(leaderMin&&!leaderTag)throw new Error('책임자 태그가 필요합니다.');
          records.push({id,locationId,roleId,start,end,count,leaderMin,leaderTag,phase:text(value('phase'))});
        }
      }
    } catch(error) {errors.push({row:index+2,message:error instanceof Error?error.message:String(error)});}
  });
  return {kind,table,mapping,records,errors};
}
export function analyzeImportImpact(event:EventData,preview:ImportPreview,mode:ImportMode):ImportImpact {
  const incoming=new Set(preview.records.map(r=>r.id));
  const removedPersonIds=preview.kind==='roster'&&mode==='replace'?event.people.filter(p=>!incoming.has(p.id)).map(p=>p.id):[];
  const affectedAssignmentIds=event.assignments.filter(a=>preview.kind==='demand'||(preview.kind==='availability'&&(mode==='replace'||preview.records.some(r=>(r as AvailabilityRow).personId===a.personId)))||removedPersonIds.includes(a.personId)||(preview.kind==='roster'&&mode!=='append'&&incoming.has(a.personId))).map(a=>a.id);
  const messages:string[]=[];
  if(removedPersonIds.length)messages.push(`참여자 ${removedPersonIds.length}명 삭제, 연결된 배정 ${event.assignments.filter(a=>removedPersonIds.includes(a.personId)).length}건 삭제 및 진행표 담당자 해제. 과거 확정본은 보존됩니다.`);
  if(preview.kind==='roster'&&mode!=='append'&&affectedAssignmentIds.length)messages.push('기존 참여자 정보가 바뀌면 연결된 배정의 역할 자격도 다시 검사합니다.');
  if(preview.kind==='availability'&&mode==='replace')messages.push('전체 참여자의 기존 가능시간을 교체합니다. 파일에 없는 사람은 미확인 상태가 됩니다.');
  if(affectedAssignmentIds.length&&preview.kind!=='roster')messages.push(`기존 배정 ${affectedAssignmentIds.length}건에 영향이 있을 수 있습니다. 적용 뒤 같은 제약 검증기로 재검사합니다.`);
  return {messages,removedPersonIds,affectedAssignmentIds};
}
export function applyImport(event:EventData,preview:ImportPreview,mode:ImportMode):{event:EventData;validation:ValidationResult;impact:ImportImpact} {
  if(preview.errors.length)throw new ImportError('오류 행을 수정한 뒤 적용하세요. 기존 데이터는 변경되지 않았습니다.');
  const next=structuredClone(event),impact=analyzeImportImpact(event,preview,mode);
  const merge=<T extends {id:string}>(existing:T[],incoming:T[])=>{
    const ids=new Set(existing.map(r=>r.id));
    if(mode==='append'&&incoming.some(r=>ids.has(r.id)))throw new ImportError('이미 존재하는 ID입니다. ID 기준 업데이트를 선택하세요.');
    if(mode==='update'&&incoming.some(r=>!ids.has(r.id)))throw new ImportError('업데이트 대상 ID가 없습니다. 새 항목은 추가 모드를 사용하세요.');
    if(mode==='replace')return incoming;
    if(mode==='append')return [...existing,...incoming];
    return existing.map(old=>{const fresh=incoming.find(r=>r.id===old.id);return fresh?{...old,...fresh}:old;});
  };
  if(preview.kind==='roster') {
    const people=preview.records as Person[];
    next.people=merge(next.people,people.map(p=>{const old=event.people.find(old=>old.id===p.id);if(!old)return p;const changed:Partial<Person>={};for(const field of ['name','team','alias','tags','color','allowedRoleIds'] as const){const column=preview.mapping[field];if(typeof column==='number'||(typeof column==='string'&&preview.table.headers.includes(column)))(changed as Record<string,unknown>)[field]=p[field];}return {...old,...changed};}));
    const ids=new Set(next.people.map(p=>p.id));next.assignments=next.assignments.filter(a=>ids.has(a.personId));next.programs=next.programs.map(p=>ids.has(p.personId)?p:{...p,personId:'',dedicated:false});
  } else if(preview.kind==='demand')next.demands=merge(next.demands,preview.records as Demand[]);
  else {
    const rows=preview.records as AvailabilityRow[];
    if(mode==='update')for(const row of rows)if(!next.people.find(p=>p.id===row.personId)?.availability.some(a=>a.id===row.id))throw new ImportError(`가능시간 업데이트 ID가 없습니다: ${row.id}`);
    next.people=next.people.map(p=>({...p,availability:merge(p.availability,rows.filter(r=>r.personId===p.id).map(({personId:_,...a})=>a))}));
  }
  assertEventStructure(next);
  return {event:next,validation:validateEvent(next),impact};
}
export async function createTemplate(kind:ImportKind,event?:EventData):Promise<Blob> {
  const wb=new ExcelJS.Workbook(),sheet=wb.addWorksheet(kind==='roster'?'명단':kind==='availability'?'가능시간':'필요 인원');
  const fields=IMPORT_FIELDS[kind];sheet.addRow(fields);sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF205548'}};
  fields.forEach((field,i)=>{sheet.getColumn(i+1).width=Math.max(18,field.length+3);sheet.getColumn(i+1).numFmt='@';});
  sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:'A1',to:{row:1,column:fields.length}};
  const guide=wb.addWorksheet('작성안내');guide.columns=[{width:26},{width:100}];
  guide.addRows([['서식','데이터는 첫 시트 2행부터 작성합니다. 첫 행 제목을 유지하세요.'],['ID','ID는 텍스트 형식입니다. 명단의 선행 0을 보존합니다. 이름으로 합치지 않습니다.'],['날짜와 시각','YYYY-MM-DD / HH:MM. 다음 날 종료는 예/아니오.'],['목록','자격 태그는 쉼표·세미콜론·줄바꿈으로 구분합니다. 허용 역할 ID는 ; 로 구분합니다.'],['가능 상태','가능 / 불가 / 미확인 / 선호. 미입력은 미확인입니다.'],['업데이트','기존 ID 기준 업데이트만 연결을 보존합니다. 전체 교체는 적용 전 영향을 확인하세요.'],['범위','최대 10MB, 10,000행, 10시트. 수식 셀은 값으로 변환하세요.']]);
  if(event){guide.addRow(['행사 날짜',event.days.map(d=>d.date).join(', ')]);for(const p of event.people)guide.addRow(['참여자 ID',`${p.id} · ${p.name}`]);for(const l of event.locations)guide.addRow(['장소 ID',`${l.id} · ${l.name}`]);for(const r of event.roles)guide.addRow(['역할 ID',`${r.id} · ${r.name}`]);}
  return new Blob([await wb.xlsx.writeBuffer() as ArrayBuffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export function createCsvTemplate(kind:ImportKind):Blob {return new Blob(['\uFEFF'+IMPORT_FIELDS[kind].join(',')+'\r\n'],{type:'text/csv;charset=utf-8'});}

/** Review what will actually be stored, separately from syntax validation. */
export function reviewImport(preview: ImportPreview) {
  const {table,mapping}=preview;
  const columns=table.headers.map((header,index)=>({header,fields:IMPORT_FIELDS[preview.kind].filter(field=>mapping[field]===header||mapping[field]===index)}));
  const ignored=columns.filter(column=>!column.fields.length).map(column=>column.header);
  const duplicate=columns.filter(column=>column.fields.length>1).map(column=>column.header);
  const normalizedRows=preview.kind==='roster'?table.rows.filter(row=>{
    const column=mapping.tags;
    const raw=row[typeof column==='number'?column:table.headers.indexOf(column)];
    return raw!=null && String(raw)!==normalizeTags(raw).join(';');
  }).length:0;
  return {columns,ignored,duplicate,normalizedRows,validRows:preview.records.length,errorRows:preview.errors.length};
}
