import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import ExcelJS from 'exceljs';
import { mkdir,writeFile } from 'node:fs/promises';
import { createEvent,createPerson } from '../src/core/defaults';
import { toMinute } from '../src/core/time';
import type { EventData } from '../src/core/types';
import { validateEvent } from '../src/core/validate';
import { assertEventStructure,parseBackup,serializeBackup,MAX_FILE_BYTES } from '../src/io/backups';
import { clearEvents,DB_NAME,deleteEvent,getStorageWarnings,listEvents,loadEvent,RevisionConflictError,saveEvent } from '../src/io/storage';
import { analyzeImportImpact,applyImport,createCsvTemplate,createTemplate,parseDelimited,previewImport,readImportFile } from '../src/io/imports';
import { buildReport,changedPeople,createWorkbook,safeCsvCell,toCsv } from '../src/io/exports';

function fixture():EventData {
  const e=createEvent('가상 출력 검증 행사');e.days=[{id:'day',date:'2026-10-10',start:'09:00',end:'17:00',nextDay:false}];
  e.locations=[{id:'loc',name:'중앙부스'}];e.roles=[{id:'role',name:'접수',requiredTags:[]}];
  const p=createPerson('가상 김하늘');p.id='0001';p.team='가상팀';p.color='#20816a';p.availability=[{id:'avail',start:toMinute('2026-10-10','09:00'),end:toMinute('2026-10-10','17:00'),state:'available'}];
  e.people=[p];e.demands=[{id:'d',locationId:'loc',roleId:'role',start:toMinute('2026-10-10','09:00'),end:toMinute('2026-10-10','10:00'),count:1,leaderTag:'',leaderMin:0,phase:'본행사'}];
  e.assignments=[{id:'a',personId:'0001',locationId:'loc',roleId:'role',start:e.demands[0].start,end:e.demands[0].end,locked:true,source:'manual'}];
  e.programs=[{id:'program',title:'가상 개회',locationId:'loc',personId:'0001',start:toMinute('2026-10-10','10:00'),end:toMinute('2026-10-10','10:30'),dedicated:false,publicNote:'공개용 안내',internalNote:'비공개 내부메모 유출 금지',allowSharedLocation:false}];
  return e;
}
function snapshot(e:EventData) {const {snapshots:_,...data}=structuredClone(e);data.status='confirmed';e.snapshots.push({id:'snapshot',version:1,confirmedAt:new Date().toISOString(),data});}
async function wbFrom(blob:Blob){const wb=new ExcelJS.Workbook();await wb.xlsx.load(await blob.arrayBuffer());return wb;}

describe('JSON backup trust boundary',()=>{
  it('round trips IDs, exact times, colors, locks, internal notes, snapshots and totals',()=>{
    const e=fixture();snapshot(e);const restored=parseBackup(serializeBackup(e));expect(restored).toEqual(e);expect(validateEvent(restored)).toEqual(validateEvent(e));
    restored.people[0].name='변경 이름';expect(restored.snapshots[0].data.people[0].name).toBe('가상 김하늘');
  });
  it.each(['{oops','{}','[]','null'])('rejects malformed or foreign backup %s',source=>expect(()=>parseBackup(source)).toThrow());
  it('rejects unknown schemas, duplicate IDs and unsafe times without touching live event',()=>{
    const e=fixture(), original=structuredClone(e),doc=JSON.parse(serializeBackup(e));
    doc.schemaVersion=900;expect(()=>parseBackup(JSON.stringify(doc))).toThrow('schemaVersion');doc.schemaVersion=1;
    doc.event.people.push(doc.event.people[0]);expect(()=>parseBackup(JSON.stringify(doc))).toThrow('중복 ID');doc.event.people.pop();
    doc.event.assignments[0].start=0.5;expect(()=>parseBackup(JSON.stringify(doc))).toThrow('정수');expect(e).toEqual(original);
  });
  it('rejects oversized text before parsing',()=>expect(()=>parseBackup(' '.repeat(MAX_FILE_BYTES+1))).toThrow('10MB'));
  it('retains scheduling conflicts so the shared validator reports them instead of silently deleting data',()=>{
    const e=fixture();e.people[0].availability=[];const restored=parseBackup(serializeBackup(e));expect(restored.assignments).toHaveLength(1);expect(validateEvent(restored).errors.length).toBeGreaterThan(0);
  });
  it('preserves repairable missing references in draft saves and backups without silently deleting schedules',async()=>{
    const e=fixture();e.locations=[];const restored=parseBackup(serializeBackup(e));expect(restored.assignments).toEqual(e.assignments);expect(validateEvent(restored).errors.some(i=>i.code==='DEMAND_REFERENCE')).toBe(true);const saved=await saveEvent(restored,null);expect(saved.assignments).toHaveLength(1);await deleteEvent(saved.id);
  });
  it('rejects forged confirmed state, edited snapshots, mismatching versions and invalid confirmed constraints',()=>{
    const e=fixture();e.status='confirmed';expect(()=>serializeBackup(e)).toThrow('스냅샷');snapshot(e);expect(()=>serializeBackup(e)).not.toThrow();
    e.name='몰래 수정';expect(()=>serializeBackup(e)).toThrow('스냅샷');e.name='가상 출력 검증 행사';e.snapshots[0].data.people[0].availability=[];expect(()=>serializeBackup(e)).toThrow('필수 제약');
    const other=fixture();snapshot(other);other.snapshots[0].data.edition=2;expect(()=>serializeBackup(other)).toThrow('버전');
  });
  it('accepts small PNG data URLs and rejects SVG, remote images, malformed base64 and large logo data',()=>{
    const e=fixture();(e as any).logoDataUrl='data:image/png;base64,iVBORw0KGgo=';expect(parseBackup(serializeBackup(e))).toEqual(e);
    for(const bad of ['data:image/svg+xml;base64,PHN2Zz4=','https://example.invalid/logo.png','data:image/png;base64,a','data:image/png;base64,ZGF0YQ==','data:image/png;base64,'+'A'.repeat(1400000)]){(e as any).logoDataUrl=bad;expect(()=>serializeBackup(e)).toThrow('로고');}
  });
  it('caps unsupported people and total workload before running scheduling validation',()=>{
    const e=fixture();e.people=Array.from({length:501},(_,i)=>({...createPerson(`가상 ${i}`),id:`p-${i}`}));expect(()=>serializeBackup(e)).toThrow('500');
  });
  it('rejects invalid date, missing arrays and nested snapshots',()=>{
    const e=fixture();e.days[0].date='2026-02-30';expect(()=>assertEventStructure(e)).toThrow('날짜');e.days[0].date='2026-10-10';snapshot(e);
    (e.snapshots[0].data as any).snapshots=[];expect(()=>assertEventStructure(e)).toThrow('중첩');
  });
});

describe('IndexedDB revision transactions',()=>{
  beforeEach(async()=>{await clearEvents();});
  it('creates, loads, lists, updates and deletes independently copied event data',async()=>{
    const e=fixture(),first=await saveEvent(e,null);expect(first.revision).toBe(0);const second=await saveEvent({...first,name:'개정 이름'},0);expect(second.revision).toBe(1);
    e.name='외부 수정';expect((await loadEvent(e.id))?.name).toBe('개정 이름');expect(await listEvents()).toHaveLength(1);await deleteEvent(e.id);expect(await loadEvent(e.id)).toBeUndefined();
  });
  it('only one of simultaneous tab saves with the same revision commits',async()=>{
    const e=await saveEvent(fixture(),null);const results=await Promise.allSettled([saveEvent({...e,name:'탭 A'},e.revision),saveEvent({...e,name:'탭 B'},e.revision)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);const rejected=results.find(r=>r.status==='rejected') as PromiseRejectedResult;expect(rejected.reason).toBeInstanceOf(RevisionConflictError);expect((await loadEvent(e.id))?.revision).toBe(1);
  });
  it('does not recreate a stale tab event deleted by another tab',async()=>{const e=await saveEvent(fixture(),null);await deleteEvent(e.id);await expect(saveEvent(e,0)).rejects.toBeInstanceOf(RevisionConflictError);});
  it('storage unavailability rejects and retains the caller data',async()=>{
    const e=fixture(),original=structuredClone(e);vi.stubGlobal('indexedDB',undefined);await expect(saveEvent(e,null)).rejects.toThrow('저장소');expect(e).toEqual(original);vi.unstubAllGlobals();
  });
  it('namespaced cleanup preserves other applications storage',async()=>{
    const memory:Record<string,string>={'other-app:key':'keep','event-timetable-maker:setting':'delete'};
    const local=new Proxy(memory,{get(target,key){if(key==='removeItem')return (key:string)=>{delete target[key];};return target[key as string];}});vi.stubGlobal('localStorage',local);await clearEvents();expect(memory['other-app:key']).toBe('keep');expect(memory['event-timetable-maker:setting']).toBeUndefined();vi.unstubAllGlobals();
  });
  it('lists valid stored records and reports corrupted records without deleting them',async()=>{
    const e=await saveEvent(fixture(),null);
    await new Promise<void>((resolve,reject)=>{const request=indexedDB.open(DB_NAME,1);request.onsuccess=()=>{const db=request.result,tx=db.transaction('events','readwrite');tx.objectStore('events').put({id:'broken',schemaVersion:99});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};request.onerror=()=>reject(request.error);});
    expect((await listEvents()).map(e=>e.id)).toEqual([e.id]);expect(getStorageWarnings()).toHaveLength(1);expect(getStorageWarnings()[0]).toContain('broken');await expect(loadEvent('broken')).rejects.toThrow('schemaVersion');await deleteEvent('broken');await listEvents();expect(getStorageWarnings()).toEqual([]);
  });
});

describe('CSV and XLSX import workflow',()=>{
  it('supports copied TSV, quoted CSV, whitespace, embedded line breaks, and leading zero IDs',()=>{
    const e=fixture(),csv='id,name,team\r\n0002,"  가상\n이름  ","가상, 팀"\r\n';
    const preview=previewImport(e,'roster',parseDelimited(csv));expect(preview.errors).toEqual([]);expect(preview.records[0]).toMatchObject({id:'0002',name:'가상 이름',team:'가상, 팀'});
    expect(parseDelimited('id\tname\n0003\t가상 이름').rows[0][0]).toBe('0003');
  });
  it('maps arbitrary column labels, never merges same names, and keeps existing references on ID updates',()=>{
    const e=fixture(),table=parseDelimited('코드,표시\n0002,가상 김하늘');const preview=previewImport(e,'roster',table,{id:'코드',name:'표시'});const added=applyImport(e,preview,'append').event;expect(added.people).toHaveLength(2);expect(added.people[0].id).not.toBe(added.people[1].id);
    const updated=applyImport(e,previewImport(e,'roster',parseDelimited('id,name\n0001,개명')),'update').event;expect(updated.assignments[0].personId).toBe('0001');expect(updated.people[0].availability).toEqual(e.people[0].availability);expect(updated.people[0].team).toBe(e.people[0].team);expect(updated.people[0].color).toBe(e.people[0].color);
  });
  it('previews replace impact before explicitly removing people and preserves historical snapshots',()=>{
    const e=fixture();snapshot(e);const preview=previewImport(e,'roster',parseDelimited('id,name\n0002,새 가상인'));const impact=analyzeImportImpact(e,preview,'replace');expect(impact.removedPersonIds).toEqual(['0001']);expect(impact.affectedAssignmentIds).toEqual(['a']);
    const result=applyImport(e,preview,'replace');expect(e.assignments).toHaveLength(1);expect(result.event.assignments).toHaveLength(0);expect(result.event.snapshots[0].data.people[0].id).toBe('0001');expect(result.event.programs[0].personId).toBe('');
  });
  it.each([
    ['id,name\n0002,\n','이름'],['id,name\n0002,가상A\n0002,가상B','중복'],
  ])('rejects roster errors without mutating valid event', (csv,reason)=>{const e=fixture(),copy=structuredClone(e),preview=previewImport(e,'roster',parseDelimited(csv));expect(preview.errors[0].message).toContain(reason);expect(()=>applyImport(e,preview,'replace')).toThrow();expect(e).toEqual(copy);});
  it('availability accepts explicit states but rejects unknown people, bad time, invalid day and no overnight flag',()=>{
    const e=fixture();for(const row of ['x,missing,2026-10-10,09:00,10:00,,가능','x,0001,2026-10-10,25:00,10:00,,가능','x,0001,2026-10-11,09:00,10:00,,가능','x,0001,2026-10-10,16:00,09:00,,가능'])expect(previewImport(e,'availability',parseDelimited('id,personId,date,start,end,nextDay,state\n'+row)).errors).toHaveLength(1);
    const preview=previewImport(e,'availability',parseDelimited('id,personId,date,start,end,state\nx,0001,2026-10-10,09:00,10:00,미확인'));const result=applyImport(e,preview,'replace');expect(result.validation.errors.length).toBeGreaterThan(0);expect(result.event.people[0].availability[0].state).toBe('unknown');
    expect(previewImport(e,'availability',parseDelimited('id,personId,date,start,end,state\nx,0001,2026-10-10,09:00,10:00,__proto__')).errors[0].message).toContain('가능 상태');
  });
  it('rejects numeric IDs that may have lost zeros and ambiguous numeric time',()=>{
    const e=fixture();expect(previewImport(e,'roster',{headers:['id','name'],rows:[[1,'가상']]}).errors[0].message).toContain('텍스트');
    const headers=['id','personId','date','start','end','state'];expect(previewImport(e,'availability',{headers,rows:[['x','0001','2026-10-10',0.5+1/86400,0.6,'가능']]}).errors[0].message).toContain('정수 분');
  });
  it('accepts Excel serial dates and time fractions exactly',()=>{
    const e=fixture(),serial=(Date.UTC(2026,9,10)-Date.UTC(1899,11,30))/86400000;
    const preview=previewImport(e,'availability',{headers:['id','personId','date','start','end','state'],rows:[['x','0001',serial,9/24,10/24,'가능']]});expect(preview.errors).toEqual([]);expect(preview.records[0]).toMatchObject({start:toMinute('2026-10-10','09:00'),end:toMinute('2026-10-10','10:00')});
    const oldSystem=previewImport(e,'availability',{date1904:true,headers:['id','personId','date','start','end','state'],rows:[['x','0001',serial-1462,9/24,10/24,'가능']]});expect(oldSystem.errors).toEqual([]);expect(oldSystem.records).toEqual(preview.records);
  });
  it('all three real XLSX templates roundtrip through the actual importer',async()=>{
    const e=fixture();for(const kind of ['roster','availability','demand'] as const){
      const template=await createTemplate(kind,e),wb=await wbFrom(template),sheet=wb.worksheets[0];expect(sheet.getRow(1).getCell(1).value).toBe('id');
      const row=kind==='roster'?['0002','가상 추가','가상팀','','접수','#20816a','role']:kind==='availability'?['newav','0001','2026-10-10','09:00','10:00','아니오','가능']:['newd','loc','role','2026-10-10','10:00','11:00','아니오',1,'',0,'본행사'];
      sheet.addRow(row);const file=new File([await wb.xlsx.writeBuffer() as ArrayBuffer],`${kind}.xlsx`);const table=await readImportFile(file),preview=previewImport(e,kind,table);expect(preview.errors).toEqual([]);const result=applyImport(e,preview,'append');expect(result.event.id).toBe(e.id);
    }
  });
  it('provides three downloadable CSV templates with matching field maps',async()=>{for(const kind of ['roster','availability','demand'] as const){const table=parseDelimited(await createCsvTemplate(kind).text());expect(table.headers[0]).toBe('id');expect(table.rows).toEqual([]);expect(previewImport(fixture(),kind,table).errors).toEqual([]);}});
  it('rejects formulas, corrupt XLSX, excessive rows, unmatched quotes and unsupported files',async()=>{
    const wb=new ExcelJS.Workbook(),s=wb.addWorksheet('명단');s.addRow(['id','name']);s.addRow(['0002',{formula:'HYPERLINK("http://example.invalid")'}]);await expect(readImportFile(new File([await wb.xlsx.writeBuffer() as ArrayBuffer],'bad.xlsx'))).rejects.toThrow('수식');
    await expect(readImportFile(new File(['bad'],'bad.xlsx'))).rejects.toThrow();await expect(readImportFile(new File(['bad'],'bad.exe'))).rejects.toThrow();expect(()=>parseDelimited('id,name\n"oops')).toThrow();expect(()=>parseDelimited('id,name\n'+Array(10001).fill('x,y').join('\n'))).toThrow('10,000');
  });
  it('restores entered formula-like names as text and defends exported CSV formula injection',()=>{
    for(const name of ['=1+1','+SUM(A1)','-2+3','@evil','\t=evil','<script>alert(1)</script>']){
      const preview=previewImport(fixture(),'roster',parseDelimited(`id,name\n0002,"${name}"`));expect(preview.errors).toEqual([]);expect(typeof (preview.records[0] as any).name).toBe('string');if(!name.startsWith('<'))expect(safeCsvCell(name)).toMatch(/^"'/);
    }
    expect(toCsv([['=1+1','normal']])).toContain('"\'=1+1"');
  });
});

describe('public report and actual XLSX output',()=>{
  it('uses shared time totals, excludes internal notes and supports every report kind',()=>{
    const e=fixture();for(const kind of ['full','person','location','program','changed'] as const){const report=buildReport(e,{kind});expect(JSON.stringify(report.rows)).not.toContain('비공개');if(kind!=='program')expect(report.totalMinutes).toBe(60);}
    expect(JSON.stringify(buildReport(e,{kind:'program',internal:true}).rows)).toContain('비공개');
  });
  it('clips selected dates precisely and totals dedicated programs with the same validator',()=>{
    const e=fixture();e.programs[0].dedicated=true;expect(buildReport(e).totalMinutes).toBe(90);expect(buildReport(e,{kind:'program'}).totalMinutes).toBe(30);
    expect(buildReport(e,{date:'2026-10-11'}).totalMinutes).toBe(0);
    const report=buildReport(e,{range:{start:toMinute('2026-10-10','09:30'),end:toMinute('2026-10-10','10:00')}});expect(report.totalMinutes).toBe(30);expect(report.rows[0][4]).toBe('09:30');
  });
  it('splits midnight report rows for day-by-day printing and keeps explicit empty person filters empty',()=>{
    const e=fixture();e.assignments[0].start=toMinute('2026-10-10','23:30');e.assignments[0].end=toMinute('2026-10-10','00:30',true);const report=buildReport(e);expect(report.rows).toHaveLength(2);expect(report.rows.map(row=>row[9])).toEqual([30,30]);expect(report.rows.map(row=>row[3])).toEqual(['2026-10-10','2026-10-11']);expect(report.totalMinutes).toBe(60);expect(buildReport(e,{personIds:[]}).rows).toEqual([]);expect(buildReport(e,{personIds:[],kind:'person'}).totalMinutes).toBe(0);
  });
  it('changed person output detects removals, display changes and dedicated program changes',()=>{
    const e=fixture();snapshot(e);expect(changedPeople(e)).toEqual([]);expect(buildReport(e,{kind:'changed'}).rows).toEqual([]);
    e.assignments=[];expect(changedPeople(e)).toEqual(['0001']);expect(buildReport(e,{kind:'changed'}).rows[0][8]).toBe('배정 없음');
    e.people=[];e.programs=[];expect(buildReport(e,{kind:'changed'}).rows[0][1]).toContain('가상 김하늘');expect(buildReport(e,{kind:'changed'}).rows[0][2]).toBe('가상팀');
    const e2=fixture();snapshot(e2);e2.programs[0].dedicated=true;expect(changedPeople(e2)).toEqual(['0001']);
  });
  it('uses previous confirmed edition after confirmation and keeps changed-only secondary sheets scoped',async()=>{
    const e=fixture();snapshot(e);e.people[0].name='가상 개명';e.edition=2;const {snapshots:_,...data}=structuredClone(e);data.status='confirmed';e.snapshots.push({id:'snapshot2',version:2,confirmedAt:new Date().toISOString(),data});e.status='confirmed';expect(changedPeople(e)).toEqual(['0001']);
    e.status='draft';expect(changedPeople(e)).toEqual([]);const wb=await wbFrom(await createWorkbook(e,{kind:'changed'}));expect(wb.getWorksheet('전체 배치')!.rowCount).toBe(1);expect(wb.getWorksheet('장소별 운영')!.rowCount).toBe(1);expect(wb.getWorksheet('행사 진행표')!.rowCount).toBe(1);
  });
  it('produces a real ZIP XLSX with seven structured sheets, Korean text, exact IDs, strings and matching totals',async()=>{
    const e=fixture();e.people[0].name='=1+1';e.programs[0].publicNote='@공개 텍스트';snapshot(e);
    const blob=await createWorkbook(e),bytes=new Uint8Array(await blob.arrayBuffer());expect([...bytes.slice(0,2)]).toEqual([80,75]);const wb=await wbFrom(blob);expect(wb.worksheets).toHaveLength(7);
    expect(wb.getWorksheet('전체 배치')!.getCell('A2').value).toBe('0001');expect(wb.getWorksheet('전체 배치')!.getCell('B2').value).toBe('=1+1');expect(wb.getWorksheet('시간 합계')!.getCell('D2').value).toBe(60);
    const all:string[]=[];for(const s of wb.worksheets)s.eachRow(row=>row.eachCell(c=>{expect(c.formula).toBeUndefined();all.push(String(c.value));}));expect(all.join('|')).not.toContain('비공개 내부메모');expect(all).toContain('@공개 텍스트');
    if(process.env.RECORD_IO_FIXTURES==='1'){await mkdir('docs/qa',{recursive:true});await writeFile('docs/qa/verified-public-export.xlsx',bytes);await writeFile('docs/qa/verified-editing-backup.json',serializeBackup(e));for(const kind of ['roster','availability','demand'] as const)await writeFile(`docs/qa/verified-${kind}-template.xlsx`,new Uint8Array(await (await createTemplate(kind,e)).arrayBuffer()));}
  });
});
