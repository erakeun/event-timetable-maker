import { test, expect, type Page } from '@playwright/test';
import { createEvent } from '../src/core/defaults';
import { toMinute } from '../src/core/time';
import type { EventData } from '../src/core/types';

// Synthetic-only tests for a local preview. Listing/type-checking is not execution evidence.
test.skip(Boolean(process.env.PUBLIC_BASE_URL), 'Paste regression fixtures are local-preview only.');
const database = 'project-mach-event-timetable-maker-v1';
const headers = '날짜\t시작\t종료\t제목\t장소\t다음 날 종료\t공개 메모';
const row = (title = '합성 추가', note = '') => `2026-10-20\t10:00\t10:20\t${title}\t\t아니오\t${note}`;
const generalApproval = '추가 내용·경고·미반영 열을 확인했고 현재 순서 끝에 추가합니다';
function fixture(): EventData {
  const event = createEvent('붙여넣기 합성 검사', 'program');
  event.id = 'paste-synthetic-fixture';
  event.days = [{ id: 'day', date: '2026-10-20', start: '09:00', end: '18:00', nextDay: false }];
  event.programs = [
    { id: 'old-later', title: '기존 뒤시각', start: toMinute('2026-10-20', '16:00'), end: toMinute('2026-10-20', '16:20'), locationId: '', personId: '', dedicated: false, publicNote: '기존 공개', internalNote: '합성 내부 제외', allowSharedLocation: false },
    { id: 'old-earlier', title: '기존 앞시각', start: toMinute('2026-10-20', '09:00'), end: toMinute('2026-10-20', '09:20'), locationId: '', personId: '', dedicated: false, publicNote: '', internalNote: '', allowSharedLocation: false },
  ];
  const { snapshots: _snapshots, ...data } = structuredClone(event);
  event.snapshots = [{ id: 'past-snapshot', version: 1, confirmedAt: '2026-10-01T00:00:00Z', data: { ...data, status: 'confirmed' } }];
  event.edition = 2;
  return event;
}
async function readSaved(page: Page): Promise<EventData> {
  return page.evaluate(({ database, id }) => new Promise<EventData>((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('events', 'readonly');
      const read = tx.objectStore('events').get(id);
      tx.oncomplete = () => { db.close(); resolve(read.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), { database, id: 'paste-synthetic-fixture' });
}
async function expectUnchanged(page: Page, original: EventData) {
  // App schedules persistence 300 ms after changes. An immediate read could miss a bugged queued save.
  await page.waitForTimeout(500);
  await expect(page.locator('.save-state')).toHaveText('저장 완료');
  expect(await readSaved(page)).toEqual(original);
}
async function openFixture(page: Page) {
  await page.goto('./');
  await page.locator('.event-open').filter({ hasText: '붙여넣기 합성 검사' }).click();
  await page.getByRole('button', { name: '다음 단계 →', exact: true }).click();
}
async function setup(page: Page) {
  await page.goto('./');
  const event = fixture();
  await page.evaluate(({ database, event }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('events')) request.result.createObjectStore('events', { keyPath: 'id' }); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('events', 'readwrite');
      tx.objectStore('events').put(event);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), { database, event });
  await openFixture(page);
  return event;
}
async function preview(page: Page, input = headers + '\n' + row()) {
  await page.getByRole('button', { name: '표 붙여넣기 열기', exact: true }).click();
  await page.getByLabel('진행 표 (첫 행은 열 제목)', { exact: true }).fill(input);
  await page.getByRole('button', { name: '열 읽기', exact: true }).click();
  await page.getByRole('button', { name: '추가 내용 미리보기', exact: true }).click();
}

test('paste: append once, save/reload, Undo/Redo and public report retain source order', async ({ page }) => {
  const original = await setup(page);
  await preview(page, headers + '\t무시열\n' + row('추가 B', '공개 내용') + '\tSYNTHETIC-OMIT\n' + row('추가 A') + '\tSYNTHETIC-OMIT');
  await page.getByLabel(generalApproval, { exact: true }).check();
  await page.getByRole('button', { name: '확인한 2개 항목 추가', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(async () => (await readSaved(page)).programs.length).toBe(4);
  const saved = await readSaved(page);
  expect(saved.programs.map(p => p.title)).toEqual(['기존 뒤시각', '기존 앞시각', '추가 B', '추가 A']);
  expect(saved.programs.slice(0, 2)).toEqual(original.programs);
  expect(saved.snapshots).toEqual(original.snapshots);
  expect(JSON.stringify(saved)).not.toContain('SYNTHETIC-OMIT');
  await page.getByRole('button', { name: '↶ 되돌리기', exact: true }).click();
  await expect.poll(async () => (await readSaved(page)).programs.length).toBe(2);
  await page.getByRole('button', { name: '↷ 다시 실행', exact: true }).click();
  await expect.poll(async () => (await readSaved(page)).programs.length).toBe(4);
  await openFixture(page);
  await page.getByRole('button', { name: '다음 단계 →', exact: true }).click();
  const report = page.locator('.print-preview');
  await expect(report.locator('.program-table tbody tr td:nth-child(2)')).toHaveText(['기존 뒤시각', '기존 앞시각', '추가 B', '추가 A']);
  await expect(report).toContainText('공개 내용');
  await expect(report).not.toContainText('합성 내부 제외');
  await page.getByLabel('표 버전', { exact: true }).selectOption('past-snapshot');
  await expect(report.locator('.program-table tbody tr td:nth-child(2)')).toHaveText(['기존 뒤시각', '기존 앞시각']);
});

test('paste: keyboard focus, invalid row, cancellation and navigation do not save partial rows', async ({ page }) => {
  const original = await setup(page);
  const open = page.getByRole('button', { name: '표 붙여넣기 열기', exact: true });
  await open.focus(); await page.keyboard.press('Enter');
  const input = page.getByLabel('진행 표 (첫 행은 열 제목)', { exact: true });
  await expect(input).toBeFocused();
  await input.fill(headers + '\n' + row() + '\n' + row('오류').replace('10:20', '08:00'));
  await page.getByRole('button', { name: '열 읽기', exact: true }).click();
  await page.getByRole('button', { name: '추가 내용 미리보기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '추가 미리보기 · 2개 항목', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: '확인한 2개 항목 추가', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '취소 · 입력 지우기', exact: true }).click();
  await expect(open).toBeFocused();
  await expectUnchanged(page, original);
  await preview(page); await page.getByLabel(generalApproval, { exact: true }).check();
  await page.getByRole('button', { name: '← 이전 단계', exact: true }).click();
  await page.getByRole('button', { name: '다음 단계 →', exact: true }).click();
  await expect(page.locator('.program-paste textarea')).toHaveCount(0);
  await expectUnchanged(page, original);
});

test('paste: another real tab saves first and stale append cannot overwrite it', async ({ page, context }) => {
  const original = await setup(page);
  await preview(page); await page.getByLabel(generalApproval, { exact: true }).check();
  const other = await context.newPage();
  await other.goto('./');
  await other.locator('.event-open').filter({ hasText: original.name }).click();
  await other.getByLabel('행사명', { exact: true }).fill('다른 탭의 합성 변경');
  await expect.poll(async () => (await readSaved(other)).name).toBe('다른 탭의 합성 변경');
  const winner = await readSaved(other);
  await page.getByRole('button', { name: '확인한 1개 항목 추가', exact: true }).click();
  await expect(page.getByRole('heading', { name: '다른 탭과 저장 버전이 다릅니다. 읽기 전용으로 전환했습니다.', exact: true })).toBeVisible();
  expect(await readSaved(page)).toEqual(winner);
  await expect(page.getByRole('button', { name: '표 붙여넣기 열기', exact: true })).toBeDisabled();
  await other.close();
});

test('paste: 300-row mobile preview stays within page width and cancels without writes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const original = await setup(page);
  await preview(page, headers + '\n' + Array.from({ length: 300 }, (_, i) => row(`합성-${i}-` + '긴제목'.repeat(40), '긴공개메모'.repeat(40))).join('\n'));
  await expect(page.locator('.program-paste tbody tr')).toHaveCount(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('paste-mobile.png'), fullPage: false });
  await page.getByRole('button', { name: '붙여넣기 취소', exact: true }).click();
  await expectUnchanged(page, original);
});
