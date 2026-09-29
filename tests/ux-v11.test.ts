import { describe,it,expect } from 'vitest';
import { createEvent,createPerson,createSampleEvent } from '../src/core/defaults';
import { normalizeTags } from '../src/core/tags';
import { parseDelimited,previewImport,reviewImport,applyImport } from '../src/io/imports';
import { applyConditions,planConditions } from '../src/core/bulkConditions';
import { parseBackup,serializeBackup } from '../src/io/backups';
import { reportFilename,safeFilename } from '../src/io/exports';
import { validateEvent } from '../src/core/validate';

describe('P1 qualification import normalization',()=>{
 it.each(['진행,안내,촬영',' 진행 ; 안내 ;촬영 ','진행\n안내\r\n촬영','진행|안내,촬영','진행,진행;안내\n촬영'])('normalizes %s',value=>expect(normalizeTags(value)).toEqual(['진행','안내','촬영']));
 it('preserves a single qualification',()=>expect(normalizeTags(' 안전 교육 ')).toEqual(['안전 교육']));
 it('uses raw multiline quoted cells and shows the stored tags',()=>{
  const e=createEvent(),p=previewImport(e,'roster',parseDelimited('번호,이름,소속,자격\n001,가상01,운영,"진행,안내;\n촬영"'));
  expect(p.errors).toEqual([]);const result=applyImport(e,p,'append');expect(result.event.people[0].tags).toEqual(['진행','안내','촬영']);expect(result.event.people[0].id).toBe('001');expect(reviewImport(p).normalizedRows).toBe(1);
 });
});
describe('P1 import review',()=>{
 it('recognizes common headers and exposes unconsumed columns',()=>{
  const p=previewImport(createEvent(),'roster',parseDelimited('번호\t이름\t소속\t자격\t연락처\n001\t가상01\t팀\t진행;안내\t예시'));
  expect(p.mapping).toMatchObject({id:'번호',name:'이름',team:'소속',tags:'자격'});expect(reviewImport(p).ignored).toEqual(['연락처']);expect(reviewImport(p).validRows).toBe(1);
 });
 it('distinguishes invalid rows and duplicate column mapping',()=>{
  const p=previewImport(createEvent(),'roster',parseDelimited('이름,소속\n,예시\n가상,예시'),{name:'이름',team:'이름'});
  expect(reviewImport(p)).toMatchObject({errorRows:1,validRows:1,duplicate:['이름'],ignored:['소속']});
 });
});
describe('P1 bulk conditions safe application',()=>{
 const roster=()=>{const e=createEvent();e.people=Array.from({length:32},(_,i)=>({...createPerson(`가상${i+1}`),id:String(i)}));e.people[0].maxDaily=180;return e;};
 it('defaults to preserving existing values and all other personal data',()=>{
  const e=roster(),before=structuredClone(e),ids=e.people.map(p=>p.id);
  const next=applyConditions(e,ids,{maxDaily:360,maxContinuous:120,minBreak:30});
  expect(next.people[0].maxDaily).toBe(180);expect(next.people.slice(1).every(p=>p.maxDaily===360)).toBe(true);expect(next.people.every(p=>p.maxContinuous===120&&p.minBreak===30)).toBe(true);expect(e).toEqual(before);expect(next.policy).toEqual(e.policy);
 });
 it('previews exact overwrites and leaves unselected people and blank fields unchanged',()=>{
  const e=roster();e.people[0].maxTotal=480;
  expect(planConditions(e,['0'],{maxDaily:360},true).changes).toEqual([{id:'0',name:'가상1',key:'maxDaily',before:180,after:360}]);
  const next=applyConditions(e,['0'],{maxDaily:360},true);expect(next.people[0].maxTotal).toBe(480);expect(next.people[1]).toEqual(e.people[1]);
 });
 it('rejects invalid limits without altering assignments or snapshots',()=>{
  const e=createSampleEvent(),before=structuredClone(e);expect(()=>applyConditions(e,e.people.map(p=>p.id),{minBreak:-1})).toThrow();const next=applyConditions(e,e.people.map(p=>p.id),{maxDaily:0});expect(next.assignments).toEqual(before.assignments);expect(next.snapshots).toEqual(before.snapshots);
 });
});
describe('V1 compatibility and output identity',()=>{
 it('keeps V1 schema and exact data on old backup restore',()=>{
  const e=createSampleEvent();e.appVersion='1.0.0';const copy=parseBackup(serializeBackup(e));expect(copy).toEqual(e);expect(copy.schemaVersion).toBe(1);expect(validateEvent(copy)).toEqual(validateEvent(e));
 });
 it('distinguishes type, person, date and version in filenames',()=>{
  const e=createSampleEvent();e.name='가상/행사';const options={kind:'person' as const,personIds:[e.people[0].id],date:e.days[0].date};const name=reportFilename(e,options,'png');expect(name).toContain('개인별시간표');expect(name).toContain(e.people[0].name);expect(name).toContain(e.days[0].date);expect(name).not.toMatch(/[\\/:*?"<>|\u0000-\u001f]/);expect(name).not.toBe(reportFilename(e,{kind:'full'},'png'));expect(safeFilename('CON')).toBe('_CON');
 });
});
it('XLSX qualifications use the same delimiter normalization as pasted text',async()=>{
 const {default:ExcelJS}=await import('exceljs');const {readImportFile}=await import('../src/io/imports');
 const wb=new ExcelJS.Workbook();wb.addWorksheet('명단').addRows([['이름','자격'],['가상 XLSX',' 진행,안내;촬영\n책임자 ']]);
 const file=new File([await wb.xlsx.writeBuffer() as ArrayBuffer],'가상명단.xlsx');const preview=previewImport(createEvent(),'roster',await readImportFile(file));
 expect(applyImport(createEvent(),preview,'append').event.people[0].tags).toEqual(['진행','안내','촬영','책임자']);
});
