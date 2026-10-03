// Append-only program import. All persistence and Undo remain owned by App.onChange.
import { toMinute, covers } from '../core/time';
import { validateEvent } from '../core/validate';
import { assertEventStructure } from './backups';
import type { EventData, ProgramItem, ValidationResult } from '../core/types';

export const FIELDS = Object.freeze({date:'날짜',start:'시작',end:'종료',title:'제목',nextDay:'다음 날 종료',location:'장소',publicNote:'공개 메모'} as const);
export type PasteField = keyof typeof FIELDS;
export type PasteMapping = Partial<Record<PasteField, string>>;
export interface PasteTable { headers: string[]; rows: {sourceRow: number; cells: string[]}[]; }
export interface PasteRow { sourceRow: number; date: string; start: string; end: string; nextDay: boolean; location: string; title: string; errors: string[]; warnings: string[]; record: Omit<ProgramItem, 'id'>; duplicate?: boolean; }
export interface PastePreview { baseFingerprint: string; rows: PasteRow[]; validation: ValidationResult; hasErrors: boolean; hasDuplicates: boolean; ignoredColumns: string[]; recordCount: number; }
const REQUIRED: PasteField[] = ['date','start','end','title'];
const MAX_BYTES = 500_000, MAX_ROWS = 300;
const clone = <T>(value: T): T => structuredClone(value);
const frozen = <T>(value: T): T => { if(value && typeof value==='object'){Object.values(value).forEach(frozen);Object.freeze(value);} return value; };
const signature = (item: Pick<ProgramItem, 'title' | 'start' | 'end' | 'locationId'>) => JSON.stringify([item.title,item.start,item.end,item.locationId]);

export function calendarMinute(date: string, clock: string, nextDay=false) {
  return toMinute(date,clock,nextDay);
}

export function parseTSV(input: string): PasteTable {
  if(typeof input!=='string'||new TextEncoder().encode(input).byteLength>MAX_BYTES)throw Error('붙여넣기는 500KB 이내여야 합니다.');
  const source=input.replace(/^\uFEFF/,''); const records: PasteTable['rows']=[];
  let cells: string[]=[]; let cell='',quoted=false,closed=false,line=1,rowStart=1;
  const finishCell=()=>{cells.push(cell);cell='';closed=false;};
  const finishRow=()=>{finishCell();if(cells.some(value=>value.trim()))records.push({sourceRow:rowStart,cells});cells=[];if(records.length>MAX_ROWS+1)throw Error('한 번에 최대 300개 항목을 붙여넣으세요.');};
  for(let i=0;i<source.length;i++){
    const c=source[i];
    if(quoted){if(c==='"'){if(source[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else{cell+=c;if(c==='\n')line++;}continue;}
    if(c==='"'&&!cell&&!closed){quoted=true;continue;}
    if(c==='\t'){finishCell();continue;}
    if(c==='\r'||c==='\n'){finishRow();if(c==='\r'&&source[i+1]==='\n')i++;line++;rowStart=line;continue;}
    if(closed)throw Error(`${line}행: 닫는 따옴표 뒤에는 탭 또는 줄바꿈만 허용합니다.`);
    if(c==='"')throw Error(`${line}행: 셀 중간 따옴표는 전체 셀을 따옴표로 감싸고 두 번 입력하세요.`);
    cell+=c;
  }
  if(quoted)throw Error(`${rowStart}행: 닫히지 않은 따옴표가 있습니다.`);
  finishRow();
  if(records.length<2)throw Error('첫 행은 열 제목, 다음 행부터는 진행 항목을 넣으세요.');
  const headers=records.shift()!.cells.map(x=>x.trim());
  if(headers.length>30||headers.some(x=>!x)||new Set(headers).size!==headers.length)throw Error('열 제목은 비어 있거나 중복될 수 없고 최대 30개입니다.');
  return {headers,rows:records};
}

export function suggestedMapping(headers: string[]): PasteMapping {
  return Object.fromEntries(Object.entries(FIELDS).map(([field,label])=>[field,headers.includes(label)?label:'']));
}

export function previewAppend(event: EventData, table: PasteTable, mapping: PasteMapping): PastePreview {
  if(event.status!=='draft')throw Error('초안에서만 추가할 수 있습니다. 확정본은 새 개정 초안을 먼저 만드세요.');
  if(!Array.isArray(event.programs)||!Array.isArray(event.locations)||!Array.isArray(event.days))throw Error('행사 구조가 올바르지 않습니다.');
  if(!table?.headers||!Array.isArray(table.rows)||!table.rows.length||table.rows.length>MAX_ROWS)throw Error('먼저 유효한 표를 읽어 주세요.');
  for(const field of REQUIRED)if(!mapping[field]||!table.headers.includes(mapping[field]!))throw Error(`${FIELDS[field]} 열을 지정하세요.`);
  const mapped=(Object.keys(FIELDS) as PasteField[]).map(key=>mapping[key]).filter((value): value is string => !!value);
  if(mapped.some(h=>!table.headers.includes(h))||new Set(mapped).size!==mapped.length)throw Error('서로 다른 필드는 서로 다른 존재하는 열에 연결하세요.');
  const windows=event.days.map(day=>({start:calendarMinute(day.date,day.start),end:calendarMinute(day.date,day.end,day.nextDay)}));
  const rows: PasteRow[]=table.rows.map(row=>{
    const errors: string[]=[],warnings: string[]=[];
    const read=(field: PasteField)=>{const at=table.headers.indexOf(mapping[field] ?? '');return at<0?'':String(row.cells[at]??'').trim();};
    if(row.cells.length!==table.headers.length)errors.push(`열 수가 ${row.cells.length}개입니다. 열 제목 ${table.headers.length}개와 맞춰 주세요.`);
    const date=read('date'),start=read('start'),end=read('end'),title=read('title'),location=read('location'),note=read('publicNote'),next=read('nextDay').toLowerCase();
    if(!title||title.length>200)errors.push('제목은 1–200자여야 합니다.');
    if(note.length>5000)errors.push('공개 메모는 5,000자 이내여야 합니다.');
    if(!['','아니오','false','0','예','true','1'].includes(next))errors.push('다음 날 종료는 예/아니오, true/false, 1/0만 입력하세요.');
    const nextDay=['예','true','1'].includes(next);let a=NaN,b=NaN;
    try{a=calendarMinute(date,start);b=calendarMinute(date,end,nextDay);if(b<=a)errors.push('종료는 시작보다 늦어야 합니다. 자정을 넘으면 다음 날 종료를 명시하세요.');else if(!covers(windows,a,b))errors.push('행사에 설정한 운영 날짜·시간을 벗어났습니다. 행사 설정 또는 입력을 확인하세요.');}catch(error){errors.push(error instanceof Error ? error.message : '날짜·시간 입력을 확인하세요.');}
    let locationId='';
    if(location){const byId=event.locations.filter(x=>x.id===location);const matches=byId.length?byId:event.locations.filter(x=>x.name===location);if(matches.length!==1)errors.push(matches.length?'같은 이름의 장소가 여럿입니다. 정확한 장소 ID를 넣으세요.':'등록된 장소와 일치하지 않습니다. 장소를 먼저 등록하세요.');else locationId=matches[0].id;}
    else warnings.push('장소 미지정');
    const record={title,start:a,end:b,locationId,personId:'',dedicated:false,publicNote:note,internalNote:'',allowSharedLocation:false};
    return {sourceRow:row.sourceRow,date,start,end,nextDay,location,title,errors,warnings,record};
  });
  const valid=rows.filter(x=>!x.errors.length),counts=new Map();
  valid.forEach(row=>counts.set(signature(row.record),(counts.get(signature(row.record))||0)+1));
  const old=new Set(event.programs.map(signature));
  valid.forEach(row=>{
    row.duplicate=old.has(signature(row.record))||counts.get(signature(row.record))>1;
    if(row.duplicate)row.warnings.push('기존 항목 또는 붙여넣기 안에 같은 제목·시간·장소가 있습니다. 자동 삭제하지 않습니다.');
    if(row.record.locationId&&[...event.programs,...valid.filter(x=>x!==row).map(x=>x.record)].some(x=>x.locationId===row.record.locationId&&row.record.start<x.end&&x.start<row.record.end))row.warnings.push('같은 장소의 기존/추가 항목과 시간이 겹칩니다. 적용 후 원앱 검증이 필요합니다.');
  });
  const usedIds=new Set(event.programs.map(x=>x.id));
  const previewItems=valid.map((row,index)=>{let id=`paste-preview-${index}`;while(usedIds.has(id))id+='x';usedIds.add(id);return {...row.record,id};});
  const candidate={...event,programs:[...event.programs,...previewItems]};
  const validation=validateEvent(candidate);
  try { assertEventStructure(candidate); } catch(error) { validation.errors.push({code:'PROGRAM_PASTE_STRUCTURE',severity:'error',message:error instanceof Error?error.message:'저장할 행사 구조를 확인하세요.'}); }
  return frozen({baseFingerprint:JSON.stringify(event),rows,validation,hasErrors:rows.some(x=>x.errors.length)||validation.errors.length>0,hasDuplicates:rows.some(x=>x.duplicate),ignoredColumns:table.headers.filter(h=>!mapped.includes(h)),recordCount:rows.length});
}

export function applyAppend(event: EventData, preview: PastePreview, {confirmed=false,duplicatesConfirmed=false,idFactory=()=>crypto.randomUUID()}: {confirmed?: boolean; duplicatesConfirmed?: boolean; idFactory?: () => string}={}): EventData {
  if(!confirmed)throw Error('미리보기를 확인한 뒤 명시적으로 추가를 승인하세요.');
  if(event.status!=='draft'||JSON.stringify(event)!==preview.baseFingerprint)throw Error('미리보기 뒤 기존 행사가 바뀌었습니다. 다시 미리보기 하세요.');
  if(preview.hasErrors||!preview.rows.length)throw Error('오류 행을 수정한 후 다시 미리보기 하세요. 일부 행을 몰래 건너뛰지 않습니다.');
  if(preview.hasDuplicates&&!duplicatesConfirmed)throw Error('중복 항목도 유지해 추가할지 명시적으로 확인하세요.');
  const next=clone(event),used=new Set(event.programs.map(x=>x.id)); const added: ProgramItem[]=[];
  for(const row of preview.rows){const id=idFactory();if(typeof id!=='string'||!id||used.has(id))throw Error('새 항목 ID가 중복되거나 올바르지 않습니다. 변경하지 않았습니다.');used.add(id);added.push({...clone(row.record),id});}
  next.programs.push(...added);
  assertEventStructure(next);
  const validation=validateEvent(next);
  if(validation.errors.length)throw Error('공유 검증기에서 오류를 확인했습니다. 기존 자료는 변경하지 않았습니다.');
  return next;
}
