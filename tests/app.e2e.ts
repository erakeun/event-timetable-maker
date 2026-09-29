import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import type { EventData } from '../src/core/types';

const artifacts = path.resolve('docs/qa');
const dbName = 'project-mach-event-timetable-maker-v1';
async function saved(page: Page) { await expect(page.locator('.save-state')).toHaveText('저장 완료'); }
async function events(page: Page): Promise<EventData[]> {
  return page.evaluate(name => new Promise<any[]>((resolve, reject) => {
    const open = indexedDB.open(name, 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('events', 'readonly');
      const req = tx.objectStore('events').getAll();
      req.onsuccess = () => { resolve(req.result); db.close(); };
      req.onerror = () => reject(req.error);
    };
  }), dbName);
}
async function current(page: Page) { await saved(page); return (await events(page)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]; }
const date = (minute: number) => new Date(minute * 60000).toISOString().slice(0, 10);
const clock = (minute: number) => new Date(minute * 60000).toISOString().slice(11, 16);
async function step(page: Page, name: string) { await page.getByRole('navigation', { name: '행사 편집 단계' }).getByRole('button', { name, exact: false }).click(); }
function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:4173/').origin) errors.push(`Unexpected external request: ${request.url()}`);
  });
  return errors;
}
async function importRoster(page: Page, count = 12) {
  await page.getByText('CSV / Excel 가져오기 · 입력 서식', { exact: true }).click();
  await page.getByLabel('엑셀 표 붙여넣기 (첫 행은 열 제목)').fill('id\tname\tteam\n' + Array.from({ length: count }, (_, i) => `${String(i + 1).padStart(4, '0')}\t가상 참여자 ${String(i + 1).padStart(2, '0')}\t가상 운영팀`).join('\n'));
  await page.getByRole('button', { name: '붙여넣기 미리보기', exact: true }).click();
  await expect(page.getByText(`입력 오류 없음 · ${count}개 항목`)).toBeVisible();
  await page.getByRole('button', { name: '미리보기 내용 적용', exact: true }).click();
}
async function auto(page: Page) {
  await page.getByRole('button', { name: '자동배정 초안 만들기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '배정 변경 미리보기' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/검사 오류 0건 · 부족 0인분/)).toBeVisible();
  await page.getByRole('button', { name: '이 초안 적용', exact: true }).click();
  await saved(page);
}
async function download(page: Page, button: string, file: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const result = await pending;
  const destination = path.join(artifacts, file);
  await result.saveAs(destination);
  expect((await readFile(destination)).length).toBeGreaterThan(100);
  return destination;
}
async function verifyPngCoverage(page: Page, file: string) {
  const png = await readFile(file);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  const content = await page.locator('.print-preview').evaluate(node => ({ width: node.scrollWidth, height: node.scrollHeight }));
  // Output uses 1.5 physical pixels per CSS pixel. Include the entire existing layout, including its right edge.
  expect(width / 1.5).toBeGreaterThanOrEqual(content.width);
  expect(height / 1.5).toBeGreaterThanOrEqual(content.height);
  await test.info().attach(path.basename(file) + '-dimensions', { body: JSON.stringify({ width, height, content }), contentType: 'application/json' });
}
async function freshRestore(context: BrowserContext, backup: string, before: EventData) {
  const restored = await context.newPage();
  await restored.goto('./');
  await restored.getByLabel('JSON 백업 파일').setInputFiles(backup);
  await expect(restored.getByText(/백업을 복원했습니다/)).toBeVisible();
  const after = await current(restored);
  expect(after.id).toBe(before.id);
  expect(after.people).toEqual(before.people);
  expect(after.assignments).toEqual(before.assignments);
  expect(after.snapshots).toEqual(before.snapshots);
  expect(after.policy).toEqual(before.policy);
  return restored;
}

test.beforeAll(async () => { await mkdir(artifacts, { recursive: true }); });

test('two-day staffing: explicit availability, preview, lock, absence, partial allocation, confirm, export, restore', async ({ page, browser }) => {
  const errors = collectErrors(page);
  page.on('dialog', dialog => void dialog.accept());
  await page.goto('./');
  await page.getByRole('button', { name: /새 행사 만들기/ }).click();
  await page.getByLabel('행사명', { exact: true }).fill('가상 이틀 행사 · E2E');
  await page.getByLabel('1일차 날짜', { exact: true }).fill('2026-10-20');
  await page.getByLabel('1일차 운영 시작', { exact: true }).fill('09:00');
  await page.getByLabel('1일차 운영 종료', { exact: true }).fill('11:00');
  await page.getByRole('button', { name: '+ 날짜 추가', exact: true }).click();
  await expect(page.getByLabel('2일차 날짜', { exact: true })).toHaveValue('2026-10-21');
  await step(page, '장소·인원 조건');
  await page.getByLabel('새 장소', { exact: true }).fill('중앙 안내소');
  await page.getByRole('button', { name: '+ 장소 추가', exact: true }).click();
  await page.getByLabel('새 역할', { exact: true }).fill('안내');
  await page.getByRole('button', { name: '+ 역할 추가', exact: true }).click();
  await page.getByRole('button', { name: '+ 필요 인원 추가', exact: true }).click();
  await page.getByLabel('수요 날짜', { exact: true }).fill('2026-10-21');
  await page.getByRole('button', { name: '+ 필요 인원 추가', exact: true }).click();
  await step(page, '참여자·가능시간');
  await importRoster(page);
  const unconfirmed = await current(page);
  expect(unconfirmed.people).toHaveLength(12);
  expect(unconfirmed.people[0].id).toBe('0001');
  expect(unconfirmed.people.every(p => p.availability.length === 0)).toBe(true);
  await page.getByLabel('현재 검색 결과 모두 선택').check();
  await page.getByRole('button', { name: '선택한 12명 전체 운영시간 가능', exact: true }).click();
  await step(page, '배치표');
  await auto(page);
  await page.locator('.assignment').first().click();
  await page.getByRole('button', { name: '배정 잠금', exact: true }).click();
  const first = await current(page);
  const locked = first.assignments.find(a => a.locked)!;
  expect(locked).toBeTruthy();
  const absent = first.assignments.find(a => !a.locked)!;
  expect(absent).toBeTruthy();
  await step(page, '참여자·가능시간');
  await page.getByRole('button', { name: first.people.find(p => p.id === absent.personId)!.name, exact: true }).click();
  await page.getByLabel('가능시간 날짜', { exact: true }).fill(date(absent.start));
  await page.getByLabel('가능시간 시작', { exact: true }).fill(clock(absent.start));
  await page.getByLabel('가능시간 종료', { exact: true }).fill(clock(absent.end));
  await page.getByLabel('가능시간 상태', { exact: true }).selectOption('unavailable');
  await expect(page.getByText(/영향받는 인력 배정/)).toBeVisible();
  await page.getByLabel('인력 배정의 겹치는 시간도 해제 (잠금 포함)').check();
  await page.getByRole('button', { name: '불가·불참 시간 반영', exact: true }).click();
  const afterAbsence = await current(page);
  expect(afterAbsence.assignments.some(a => a.id === absent.id)).toBe(false);
  expect(afterAbsence.assignments.find(a => a.id === locked.id)).toEqual(locked);
  await step(page, '배치표');
  await page.getByLabel('배치표 날짜').selectOption(date(absent.start));
  await page.getByLabel('시작', { exact: true }).fill(clock(absent.start));
  await page.getByLabel('종료', { exact: true }).fill(clock(absent.end));
  await page.getByLabel('자동배정 범위').selectOption('selected');
  await auto(page);
  const replaced = await current(page);
  expect(replaced.assignments.find(a => a.id === locked.id)).toEqual(locked);
  for (const outside of afterAbsence.assignments.filter(a => a.end <= absent.start || a.start >= absent.end)) expect(replaced.assignments.find(a => a.id === outside.id)).toEqual(outside);
  expect(replaced.assignments.some(a => a.personId === absent.personId && a.start < absent.end && a.end > absent.start)).toBe(false);
  await page.getByRole('button', { name: /되돌리기/ }).click();
  expect((await current(page)).assignments).toEqual(afterAbsence.assignments);
  await page.getByRole('button', { name: /다시 실행/ }).click();
  expect((await current(page)).assignments).toEqual(replaced.assignments);
  await step(page, '확인·출력');
  await page.getByRole('button', { name: '확정본 저장', exact: true }).click();
  await expect(page.getByText(/확정본 v1 · 과거 기록은/)).toBeVisible();
  const confirmed = await current(page);
  expect(confirmed.status).toBe('confirmed');
  expect(confirmed.snapshots).toHaveLength(1);
  const backup = await download(page, 'JSON 백업', 'staffing.backup.json');
  const workbookPath = await download(page, 'XLSX 내려받기', 'staffing.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(expect.arrayContaining(['행사정보', '전체 배치', '개인별 배치', '시간 합계', '부족·주의']));
  let exportedMinutes = 0;
  workbook.getWorksheet('전체 배치')!.eachRow((row, index) => { if (index > 1) exportedMinutes += Number(row.getCell(10).value); });
  expect(exportedMinutes).toBe(confirmed.assignments.reduce((total, assignment) => total + assignment.end - assignment.start, 0));
  await page.getByLabel('출력 날짜').selectOption('2026-10-20');
  const staffingPng = await download(page, 'PNG 이미지 저장', 'staffing.png');
  await verifyPngCoverage(page, staffingPng);
  await page.getByLabel('출력 날짜').selectOption('');
  await page.evaluate(() => { window.print = () => { (window as any).__printRequested = true; }; });
  await page.getByRole('button', { name: '인쇄 / PDF로 저장', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__printRequested))).toBe(true);
  await page.pdf({ path: path.join(artifacts, 'staffing-a4.pdf'), printBackground: true, preferCSSPageSize: true });
  await page.screenshot({ path: path.join(artifacts, 'confirmed-desktop.png'), fullPage: true });
  const cleanContext = await browser.newContext({ baseURL: process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:4173/', viewport: { width: 1440, height: 1000 } });
  const restored = await freshRestore(cleanContext, backup, confirmed);
  await restored.screenshot({ path: path.join(artifacts, 'restored-desktop.png'), fullPage: true });
  await cleanContext.close();
  expect(errors).toEqual([]);
});

test('program-only parallel locations, dedicated conflict correction, immutable revision, and output', async ({ page }) => {
  const errors = collectErrors(page);
  page.on('dialog', dialog => void dialog.accept());
  await page.goto('./');
  await page.getByRole('button', { name: /인원 배치 없이 진행 시간표만 만들기/ }).click();
  await page.getByLabel('행사명', { exact: true }).fill('가상 병렬 프로그램');
  await step(page, '참여자·가능시간');
  await page.getByLabel('추가할 참여자 이름').fill('가상 진행자');
  await page.getByRole('button', { name: '+ 참여자 추가', exact: true }).click();
  await page.getByRole('button', { name: '이 사람 전체 운영시간 가능', exact: true }).click();
  await step(page, '진행 시간표');
  await page.getByText('진행 장소 추가', { exact: true }).click();
  for (const venue of ['가상 A홀', '가상 B홀']) {
    await page.getByLabel('진행 장소 이름', { exact: true }).fill(venue);
    await page.getByRole('button', { name: '+ 장소 추가', exact: true }).click();
  }
  for (const [title, venue, dedicated] of [['가상 환영 행사', '가상 A홀', true], ['가상 병렬 안내', '가상 B홀', false]] as const) {
    await page.getByLabel('진행 항목 제목', { exact: true }).fill(title);
    await page.getByLabel('진행 시작', { exact: true }).fill('10:00');
    await page.getByLabel('진행 종료', { exact: true }).fill('11:00');
    await page.getByLabel('진행 장소', { exact: true }).selectOption({ label: venue });
    await page.getByLabel('진행 담당자', { exact: true }).selectOption({ index: 1 });
    await page.getByLabel('담당 방식').selectOption(dedicated ? 'dedicated' : 'contact');
    await page.getByLabel('공개 메모', { exact: true }).fill('가상 공개 안내');
    await page.getByLabel('운영자 내부메모').fill('QA_INTERNAL_SECRET_NOTE');
    await page.getByRole('button', { name: '+ 진행 항목 추가', exact: true }).click();
  }
  await step(page, '확인·출력');
  await expect(page.getByRole('button', { name: '확정본 저장', exact: true })).toBeEnabled();
  await step(page, '진행 시간표');
  await page.getByRole('row').filter({ hasText: '가상 병렬 안내' }).getByRole('button', { name: '수정', exact: true }).click();
  await page.getByLabel('담당 방식').selectOption('dedicated');
  await page.getByRole('button', { name: '진행 항목 수정 적용', exact: true }).click();
  await step(page, '확인·출력');
  await expect(page.getByRole('button', { name: '확정본 저장', exact: true })).toBeDisabled();
  await step(page, '진행 시간표');
  await page.getByRole('row').filter({ hasText: '가상 병렬 안내' }).getByRole('button', { name: '수정', exact: true }).click();
  await page.getByLabel('담당 방식').selectOption('contact');
  await page.getByRole('button', { name: '진행 항목 수정 적용', exact: true }).click();
  await step(page, '확인·출력');
  await page.getByRole('button', { name: '확정본 저장', exact: true }).click();
  const before = await current(page);
  expect(before.snapshots).toHaveLength(1);
  const workbookPath = await download(page, 'XLSX 내려받기', 'program.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  expect(JSON.stringify(workbook.model)).not.toContain('QA_INTERNAL_SECRET_NOTE');
  expect(workbook.getWorksheet('행사 진행표')!.rowCount).toBe(3);
  await expect(page.locator('.print-preview')).not.toContainText('QA_INTERNAL_SECRET_NOTE');
  await expect(page.locator('.print-preview')).toContainText('출력 전체 합계 60분');
  await page.getByLabel('출력 날짜').selectOption(before.days[0].date);
  const programPng = await download(page, 'PNG 이미지 저장', 'program.png');
  await verifyPngCoverage(page, programPng);
  await page.pdf({ path: path.join(artifacts, 'program-a4.pdf'), printBackground: true, preferCSSPageSize: true });
  await page.getByRole('button', { name: '새 개정 초안 만들기', exact: true }).click();
  await step(page, '행사 설정');
  await page.getByLabel('행사명', { exact: true }).fill('가상 병렬 프로그램 개정');
  expect((await current(page)).snapshots).toEqual(before.snapshots);
  expect(errors).toEqual([]);
});

test('program-only without roster or roles can be saved, confirmed and printed', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await page.getByRole('button', { name: /인원 배치 없이 진행 시간표만 만들기/ }).click();
  await step(page, '진행 시간표');
  await page.getByLabel('진행 항목 제목', { exact: true }).fill('명단 없는 가상 개회');
  await page.getByLabel('진행 시작', { exact: true }).fill('10:00');
  await page.getByLabel('진행 종료', { exact: true }).fill('10:30');
  await page.getByRole('button', { name: '+ 진행 항목 추가', exact: true }).click();
  const event = await current(page);
  expect(event.people).toHaveLength(0);
  expect(event.roles).toHaveLength(0);
  await step(page, '확인·출력');
  await page.getByRole('button', { name: '확정본 저장', exact: true }).click();
  await expect(page.locator('.print-preview')).toContainText('명단 없는 가상 개회');
  await page.pdf({ path: path.join(artifacts, 'program-no-roster.pdf'), printBackground: true, preferCSSPageSize: true });
  expect(errors).toEqual([]);
});

for (const width of [1440, 768, 390, 412]) {
  test(`responsive ${width}px: homepage, board and forms stay inside viewport without runtime errors`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('./');
    await page.screenshot({ path: path.join(artifacts, `home-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.getByRole('button', { name: '예시로 체험하기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '빈자리를 채우고, 한 번 더 확인하세요.' })).toBeVisible();
    await page.screenshot({ path: path.join(artifacts, `board-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    for (const name of ['행사 설정', '장소·인원 조건', '참여자·가능시간', '진행 시간표']) {
      await step(page, name);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }
    await page.screenshot({ path: path.join(artifacts, `program-form-${width}.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}

test('multiple tabs detect a revision conflict and preserve both saved and unsaved work', async ({ page, context }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await page.getByRole('button', { name: /새 행사 만들기/ }).click();
  await page.getByLabel('행사명', { exact: true }).fill('가상 다중 탭');
  const initial = await current(page);
  const other = await context.newPage();
  await other.goto('./');
  await other.getByRole('button', { name: /가상 다중 탭/ }).click();
  await page.getByLabel('행사명', { exact: true }).fill('가상 첫 탭 저장');
  await saved(page);
  await other.getByLabel('행사명', { exact: true }).fill('가상 둘째 탭 미저장');
  await expect(other.getByText('다른 탭과 저장 버전이 다릅니다. 읽기 전용으로 전환했습니다.', { exact: true })).toBeVisible();
  await expect(other.locator('.save-state')).toHaveText('저장 실패');
  expect((await events(page)).find(event => event.id === initial.id)?.name).toBe('가상 첫 탭 저장');
  const file = await download(other, 'JSON 백업', 'conflict-unsaved.backup.json');
  expect(await readFile(file, 'utf8')).toContain('가상 둘째 탭 미저장');
  await expect(other.getByLabel('행사명', { exact: true })).toBeDisabled();
  await other.close();
  expect(errors).toEqual([]);
});

test('storage write failure keeps editing data and permits a JSON backup', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await page.getByRole('button', { name: /새 행사 만들기/ }).click();
  await page.getByLabel('행사명', { exact: true }).fill('가상 저장 장애 전');
  const initial = await current(page);
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (this: IDBDatabase, storeNames: any, mode?: IDBTransactionMode, options?: IDBTransactionOptions) {
      if (mode === 'readwrite') throw new DOMException('E2E simulated quota failure', 'QuotaExceededError');
      return original.call(this, storeNames, mode, options);
    } as typeof original;
  });
  await page.getByLabel('행사명', { exact: true }).fill('가상 저장 실패 후 유지');
  await expect(page.locator('.save-state')).toHaveText('저장 실패');
  await expect(page.getByLabel('행사명', { exact: true })).toHaveValue('가상 저장 실패 후 유지');
  expect((await events(page)).find(event => event.id === initial.id)?.name).toBe('가상 저장 장애 전');
  const file = await download(page, 'JSON 백업', 'save-failure.backup.json');
  expect(await readFile(file, 'utf8')).toContain('가상 저장 실패 후 유지');
  expect(errors).toEqual([]);
});
