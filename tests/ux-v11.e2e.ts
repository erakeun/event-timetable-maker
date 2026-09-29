import {test,expect,type Page} from '@playwright/test';
import {createEvent,createSampleEvent} from '../src/core/defaults';
import {serializeBackup} from '../src/io/backups';
import {toMinute} from '../src/core/time';
const nav=(p:Page,name:string)=>p.getByRole('navigation').getByRole('button',{name:new RegExp(name)}).click();
async function paste(p:Page,text:string){
 await p.getByText('CSV / Excel 가져오기 · 입력 서식',{exact:true}).click();
 await p.getByLabel('엑셀 표 붙여넣기 (첫 행은 열 제목)').fill(text);
 await p.getByRole('button',{name:'붙여넣기 미리보기',exact:true}).click();
}
async function state(p:Page){await expect(p.locator('.save-state')).toHaveText('저장 완료');return p.evaluate(()=>new Promise<any>(resolve=>{const req=indexedDB.open('project-mach-event-timetable-maker-v1',1);req.onsuccess=()=>{const db=req.result;const read=db.transaction('events').objectStore('events').getAll();read.onsuccess=()=>{db.close();resolve(read.result[0])}}}));}
async function restore(p:Page,event:ReturnType<typeof createEvent>){await p.goto('./');await p.getByLabel('JSON 백업 파일').setInputFiles({name:'v1.backup.json',mimeType:'application/json',buffer:Buffer.from(serializeBackup(event))});}
test('P1-1 qualifications are normalized in preview and applied, P1-3 unmapped columns require review',async({page})=>{
 await page.goto('./');await page.getByRole('button',{name:/새 행사 만들기/}).click();await nav(page,'참여자');
 await paste(page,'번호\t이름\t소속\t자격\t비고\n001\t가상01\t운영\t"접수, 안내;\n촬영"\t예시');
 await expect(page.getByRole('table',{name:'실제 반영될 명단'})).toContainText('접수');
 await expect(page.getByText('확인 필요: 비고 열은 저장되지 않습니다.',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'미리보기 내용 적용'})).toBeDisabled();
 await page.getByLabel('미반영 열과 기존 자료에 미치는 영향을 확인했습니다').check();await page.getByRole('button',{name:'미리보기 내용 적용'}).click();
 expect((await state(page)).people[0]).toMatchObject({id:'001',team:'운영',tags:['접수','안내','촬영']});
});
test('P1-2 program-only next/previous route, output identity and safe staffing expansion',async({page})=>{
 await page.goto('./');await page.getByRole('button',{name:/인원 배치 없이/}).click();await page.getByLabel('행사명',{exact:true}).fill('가상 V11 진행표');
 await expect(page.getByRole('navigation').getByRole('button')).toHaveCount(3);await expect(page.getByLabel('자동배정 우선순위')).toHaveCount(0);
 await page.getByRole('button',{name:'다음 단계 →',exact:true}).click();
 for(const [title,start,end] of [['개회','10:00','10:10'],['환영사','10:10','10:20'],['기념촬영','10:20','10:30'],['발표','10:30','11:30'],['폐회','11:30','11:40']]){
 await page.getByLabel('진행 항목 제목').fill(title);await page.getByLabel('진행 시작',{exact:true}).fill(start);await page.getByLabel('진행 종료',{exact:true}).fill(end);await page.getByRole('button',{name:'+ 진행 항목 추가',exact:true}).click();}
 await page.getByRole('button',{name:'다음 단계 →',exact:true}).click();
 await expect(page.locator('.print-preview')).toContainText('진행 순서 5개');await expect(page.locator('.print-preview')).not.toContainText('합계 0분');
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'CSV 내려받기',exact:true}).click();expect((await pending).suggestedFilename()).toContain('진행시간표');
 await page.getByRole('button',{name:'← 이전 단계',exact:true}).click();await expect(page.getByRole('heading',{name:'행사 진행 시간표',exact:true})).toBeVisible();
 await page.getByText('인력 배정도 필요하신가요?',{exact:true}).click();await page.getByRole('button',{name:'인력 배정 추가',exact:true}).click();
 const expanded=await state(page);expect(expanded.programs).toHaveLength(5);expect(expanded.mode).toBe('staffing');await nav(page,'진행 시간표');await page.getByRole('button',{name:'다음 단계 →',exact:true}).click();await expect(page.getByRole('heading',{name:'출력 범위와 형식'})).toBeVisible();await page.getByRole('button',{name:'↶ 되돌리기',exact:true}).click();await expect(page.getByRole('navigation').getByRole('button')).toHaveCount(3);
});
test('P1-4 multi-day shortage opens precise target and errors link to person settings',async({page})=>{
 const e=createSampleEvent();const next='2026-11-02',old=e.days[0].date,shift=toMinute(next,'00:00')-toMinute(old,'00:00');e.days.push({...e.days[0],id:'day2',date:next});e.demands.push({...e.demands[0],id:'d2',start:e.demands[0].start+shift,end:e.demands[0].end+shift});
 await restore(page,e);await nav(page,'배치표');const row=page.locator('.issue-list > li').filter({hasText:next}).first();await expect(row).toContainText('필요');await row.getByRole('button',{name:'해당 시간 보기'}).click();
 await expect(page.getByLabel('배치표 날짜')).toHaveValue(next);await expect(page.locator('.focused-slot').first()).toBeVisible();await expect(page.getByLabel('선택 배정 편집')).toContainText(next);
});
test('P1-5 bulk 32-person review, preserve/overwrite policy, Undo and individual exception',async({page})=>{
 await page.goto('./');await page.getByRole('button',{name:/새 행사 만들기/}).click();await nav(page,'참여자');await paste(page,'id\tname\n'+Array.from({length:32},(_,i)=>`${i+1}\t가상${i+1}`).join('\n'));await page.getByRole('button',{name:'미리보기 내용 적용'}).click();
 await page.getByText('개인별 배정 조건',{exact:true}).click();await page.getByLabel('하루 최대 배정 (분)',{exact:true}).fill('180');
 await page.getByLabel('현재 검색 결과 모두 선택').check();await page.locator('.bulk-conditions summary').click();
 await page.getByLabel('공통 하루 최대 배정 (분)').fill('360');await page.getByLabel('공통 최대 연속 배정 (분)').fill('120');await page.getByLabel('공통 최소 휴게 (분)').fill('30');await page.getByRole('button',{name:'적용 전 변경 내용 확인'}).click();await expect(page.getByText('선택 32명 · 변경 95개 조건 · 유지 1개 조건')).toBeVisible();await page.getByRole('button',{name:'검토한 공통 조건 적용'}).click();
 let e=await state(page);expect(e.people[0].maxDaily).toBe(180);expect(e.people.slice(1).every((p:any)=>p.maxDaily===360)).toBe(true);
 await page.getByLabel('기존 개인별 조건 처리').selectOption('overwrite');await page.getByRole('button',{name:'적용 전 변경 내용 확인'}).click();await expect(page.locator('.bulk-preview')).toContainText('180분 → 360분');await page.getByRole('button',{name:'검토한 공통 조건 적용'}).click();expect((await state(page)).people[0].maxDaily).toBe(360);
 await page.getByRole('button',{name:'↶ 되돌리기',exact:true}).click();expect((await state(page)).people[0].maxDaily).toBe(180);await page.getByLabel('하루 최대 배정 (분)',{exact:true}).fill('240');expect((await state(page)).people[0].maxDaily).toBe(240);
});
test('mobile 390/412 editing, output filename and V1 backup preservation',async({page})=>{
 const e=createSampleEvent();e.appVersion='1.0.0';await restore(page,e);expect((await state(page)).policy).toEqual(e.policy);await nav(page,'배치표');await page.getByRole('button',{name:'자동배정 초안 만들기'}).click();await page.getByRole('button',{name:'이 초안 적용'}).click();const before=await state(page);
 for(const width of [390,412]){
 await page.setViewportSize({width,height:844});await page.locator('.assignment').first().click();await expect(page.locator('.assignment-editor')).toHaveClass(/editor-open/);const box=await page.locator('.assignment-editor').boundingBox();expect(box!.y+box!.height).toBeLessThanOrEqual(845);
 await page.getByRole('button',{name:'배정 해제',exact:true}).click();expect((await state(page)).assignments).toHaveLength(before.assignments.length-1);await page.getByRole('button',{name:'↶ 되돌리기',exact:true}).click();expect((await state(page)).assignments).toEqual(before.assignments);
 }
 await page.setViewportSize({width:1440,height:1000});await nav(page,'확인·출력');await page.getByLabel('출력 종류').selectOption('person');await page.getByLabel('출력 참여자').selectOption(e.people[0].id);const pending=page.waitForEvent('download');await page.getByRole('button',{name:'XLSX 내려받기'}).click();expect((await pending).suggestedFilename()).toContain('개인별시간표');
});
test('issue navigation from review keeps after-midnight date and related person settings',async({page})=>{
 const e=createSampleEvent();e.days=[{id:'overnight',date:'2026-11-01',start:'23:00',end:'02:00',nextDay:true}];e.demands=[{...e.demands[0],start:toMinute('2026-11-02','00:30'),end:toMinute('2026-11-02','01:30'),count:1,leaderMin:0}];e.assignments=[];e.people.forEach(p=>{p.availability=[]});
 await restore(page,e);await nav(page,'확인·출력');await page.getByRole('button',{name:'해당 시간 보기',exact:true}).first().click();await expect(page.getByLabel('배치표 날짜')).toHaveValue('2026-11-01');await expect(page.getByLabel('배정 날짜',{exact:true})).toHaveValue('2026-11-02');await expect(page.getByLabel('시작',{exact:true})).toHaveValue('00:30');
});
