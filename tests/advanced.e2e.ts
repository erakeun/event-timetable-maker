import { test,expect,type Page } from '@playwright/test';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import path from 'node:path';
import { createEvent,createPerson } from '../src/core/defaults';
import { toMinute } from '../src/core/time';
import { schedule } from '../src/core/scheduler';
import { validateEvent } from '../src/core/validate';
import { serializeBackup } from '../src/io/backups';
import type { EventData } from '../src/core/types';

const artifacts=path.resolve('docs/qa');
const scratch=path.resolve('work/advanced-e2e');
function scaleFixture():EventData {
  const e=createEvent('가상 대규모 취소 검증 · 7일 100명 10장소');e.id='advanced-worker-cancel';e.policy={...e.policy,minimumAssignment:30,preferredShift:120,travelMinutes:10,timeLimitMs:30000};
  e.days=Array.from({length:7},(_,i)=>({id:`day${i}`,date:`2026-10-${10+i}`,start:'09:00',end:'17:00',nextDay:false}));
  e.locations=Array.from({length:10},(_,i)=>({id:`L${i}`,name:`가상 장소 ${i+1}`}));e.roles=[{id:'R',name:'안내',requiredTags:[]}];
  e.demands=e.days.flatMap(d=>e.locations.map(l=>({id:`D-${d.id}-${l.id}`,start:toMinute(d.date,d.start),end:toMinute(d.date,d.end),locationId:l.id,roleId:'R',count:2,leaderTag:'',leaderMin:0,phase:'본행사'})));
  e.people=Array.from({length:100},(_,i)=>{const p=createPerson(`가상 검증 참여자 ${i+1}`);p.id=`P${i}`;p.maxDaily=240;p.maxTotal=1680;p.maxContinuous=120;p.minBreak=30;p.availability=e.days.map(d=>({id:`A-${i}-${d.id}`,start:toMinute(d.date,d.start),end:toMinute(d.date,d.end),state:'available'}));return p;});
  const initial=schedule(e,{mode:'all',seed:2409,timeLimitMs:30000});
  expect(initial.status).toBe('complete');expect(initial.validation.errors).toEqual([]);
  e.assignments=initial.assignments;e.assignments[0].locked=true;return e;
}
function printFixture():EventData {
  const e=createEvent('가상 대형 인쇄 검수 · 긴 이름과 줄바꿈');e.id='advanced-large-print';e.organization='가상 시민행사 운영팀';e.days=[{id:'day',date:'2026-10-20',start:'09:00',end:'16:00',nextDay:false}];
  e.locations=[{id:'L',name:'가상 중앙행사장 접수 및 안내 운영 구역'}];e.roles=[{id:'R',name:'참여자 안내와 운영지원',requiredTags:[]}];
  e.demands=[{id:'D',start:toMinute('2026-10-20','09:00'),end:toMinute('2026-10-20','16:00'),locationId:'L',roleId:'R',count:6,leaderTag:'',leaderMin:0,phase:'본행사'}];
  e.policy={...e.policy,minimumAssignment:60,preferredShift:60,timeLimitMs:30000};
  e.people=Array.from({length:42},(_,i)=>{const marker=`검증행${String(i).padStart(2,'0')}`;const p=createPerson(i===0?`${marker} <img src=x onerror="window.__etmXss=1">`:`${marker} 가상 공동운영 참여자 긴이름 조정담당`);p.id=`print-person-${i}`;p.team='가상 공공행사 운영지원팀';p.maxDaily=60;p.maxTotal=60;p.availability=[{id:`available-${i}`,start:e.demands[0].start,end:e.demands[0].end,state:'available'}];return p;});
  const initial=schedule(e,{mode:'all',seed:42,timeLimitMs:30000});expect(initial.status).toBe('complete');expect(initial.validation.errors).toEqual([]);expect(initial.assignments).toHaveLength(42);
  e.assignments=initial.assignments;e.assignments[0].locked=true;
  e.programs=[{id:'contact',title:'가상 운영 확인',start:e.demands[0].start,end:e.demands[0].start+30,personId:'',locationId:'L',dedicated:false,allowSharedLocation:false,publicNote:'공개 안내',internalNote:'비공개검증문구_INTERNAL_SHOULD_NOT_PRINT'}];return e;
}
async function stored(page:Page):Promise<EventData[]> {
  return page.evaluate(dbName=>new Promise<EventData[]>((resolve,reject)=>{const open=indexedDB.open(dbName,1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result;const transaction=db.transaction('events','readonly');const request=transaction.objectStore('events').getAll();request.onsuccess=()=>{resolve(request.result);db.close();};request.onerror=()=>reject(request.error);};}),'project-mach-event-timetable-maker-v1');
}
async function importFixture(page:Page,event:EventData) {
  const file=path.join(scratch,event.id+'.backup.json');await writeFile(file,serializeBackup(event));
  await page.goto('./');await page.getByLabel('JSON 백업 파일').setInputFiles(file);await expect(page.getByText('백업을 복원했습니다. 시간표 검사 결과를 확인하세요.')).toBeVisible();await expect(page.locator('.save-state')).toHaveText('저장 완료');
  const rows=await stored(page);expect(rows.find(e=>e.id===event.id)?.assignments).toEqual(event.assignments);
}
async function step(page:Page,name:string){await page.getByRole('navigation',{name:'행사 편집 단계'}).getByRole('button',{name,exact:false}).click();}
function errors(page:Page){const list:string[]=[];page.on('pageerror',e=>list.push(e.message));page.on('console',m=>{if(m.type()==='error')list.push(m.text());});return list;}
test.beforeAll(async()=>{await mkdir(artifacts,{recursive:true});await mkdir(scratch,{recursive:true});});

test('7d100p10loc real Worker cancel preserves existing assignments, locks and totals',async({page})=>{
  const e=scaleFixture(),problems=errors(page);await importFixture(page,e);await step(page,'배치표');
  const before=(await stored(page)).find(row=>row.id===e.id)!;expect(before.assignments).toHaveLength(560);
  let workerStarted=false,workerClosed=false;page.on('worker',worker=>{workerStarted=true;worker.on('close',()=>{workerClosed=true;});});
  await page.getByLabel('자동배정 범위').selectOption('all');
  const start=performance.now();await page.getByRole('button',{name:'자동배정 초안 만들기',exact:true}).click();await page.getByRole('button',{name:'계산 취소',exact:true}).click();
  await expect(page.getByText('계산을 취소했습니다. 기존 배치표는 변경되지 않았습니다.')).toBeVisible();
  await expect.poll(()=>workerStarted).toBe(true);await expect.poll(()=>workerClosed).toBe(true);
  await expect(page.getByRole('heading',{name:'배정 변경 미리보기'})).toHaveCount(0);await expect(page.getByRole('button',{name:'이 초안 적용',exact:true})).toHaveCount(0);
  const after=(await stored(page)).find(row=>row.id===e.id)!;
  expect(after.assignments).toEqual(before.assignments);expect(after.assignments.filter(a=>a.locked)).toEqual(before.assignments.filter(a=>a.locked));
  expect(validateEvent(after).personMinutes).toEqual(validateEvent(before).personMinutes);expect(after.revision).toBe(before.revision);expect(problems).toEqual([]);
  await writeFile(path.join(artifacts,'worker-cancellation.json'),JSON.stringify({recordedAt:new Date().toISOString(),scenario:{days:7,people:100,locations:10,existingAssignments:560},workerStarted,workerClosed,uiCancelElapsedMs:performance.now()-start,measurement:'Start click through cancel acknowledgement, Worker close and persistence verification; not raw Worker termination latency.',assignmentsPreserved:true,locksPreserved:true,personTotalsPreserved:true,revisionUnchanged:true,pageErrors:problems},null,2));
  await page.setViewportSize({width:390,height:844});
  const size=await page.evaluate(()=>({body:document.documentElement.scrollWidth,viewport:innerWidth,table:document.querySelector('.schedule-wrap')?.scrollWidth,tableClient:document.querySelector('.schedule-wrap')?.clientWidth}));
  expect(size.body).toBeLessThanOrEqual(size.viewport+1);expect(size.table!).toBeGreaterThan(size.tableClient!);
  await page.screenshot({path:path.join(artifacts,'large-board-mobile-390.png'),fullPage:true});
});

test('42 assignments: A3 and A4 portrait PDF pagination, long-name text and safe HTML rendering',async({page})=>{
  const e=printFixture(),problems=errors(page);await importFixture(page,e);await step(page,'확인·출력');
  await expect(page.locator('.print-preview .print-table tbody tr')).toHaveCount(42);
  await expect(page.locator('.print-preview')).toContainText(e.people[0].name);
  expect(await page.locator('.print-preview img[src="x"]').count()).toBe(0);expect(await page.evaluate(()=>(window as unknown as {__etmXss?:number}).__etmXss)).toBeUndefined();
  expect(await page.locator('.print-preview').textContent()).not.toContain('INTERNAL_SHOULD_NOT_PRINT');
  const total=Object.values(validateEvent(e).personMinutes).reduce((n,v)=>n+v,0);expect(total).toBe(2520);
  await expect(page.locator('.print-preview .print-foot')).toContainText('2,520분');
  await page.getByLabel('용지 방향').selectOption('portrait');
  const evidence:{paper:string;logicalPages:number;fileBytes:number;rows:number}[]=[];
  for(const [paper,file] of [['A3','large-a3.pdf'],['A4','large-a4-portrait.pdf']]) {
    await page.locator('label').filter({hasText:/^용지\s*A4/}).locator('select').selectOption(paper);
    const logicalPages=await page.locator('.print-root .print-page').count();expect(logicalPages).toBeGreaterThan(0);
    expect(await page.locator('.print-root .print-table tbody tr').count()).toBe(42);
    await page.emulateMedia({media:'print'});
    const clipped=await page.locator('.print-root .print-table td').evaluateAll(cells=>cells.filter(cell=>cell.scrollWidth>cell.clientWidth+1).map(cell=>cell.textContent));expect(clipped).toEqual([]);
    const target=path.join(artifacts,file);await page.pdf({path:target,printBackground:true,preferCSSPageSize:true});const bytes=await readFile(target);expect(bytes.subarray(0,5).toString()).toBe('%PDF-');expect(bytes.length).toBeGreaterThan(15000);
    evidence.push({paper,logicalPages,fileBytes:bytes.length,rows:42});await page.emulateMedia({media:'screen'});
  }
  expect(problems).toEqual([]);await writeFile(path.join(artifacts,'large-print-browser.json'),JSON.stringify({recordedAt:new Date().toISOString(),assignmentCount:42,totalMinutes:total,htmlPayloadRenderedAsText:true,internalNoteExcluded:true,pageErrors:problems,pdfs:evidence,expectedRowMarkers:e.people.map(p=>p.name.slice(0,5)),expectedNames:e.people.map(p=>p.name),physicalPageInspection:'See large-print-inspection.json generated by independent PDF parser/render inspection.'},null,2));
  await page.screenshot({path:path.join(artifacts,'large-print-preview.png'),fullPage:true});
});
