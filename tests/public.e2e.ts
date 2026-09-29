import { test, expect } from '@playwright/test';

test('public entry, shortages, manual change, fill-only preservation, refresh and direct URL', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', e => problems.push(e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on('requestfailed', r => problems.push(`Failed ${r.url()}`));
  page.on('dialog', d => void d.accept());
  const response = await page.goto('./');
  expect(response?.status()).toBe(200);
  await expect(page.locator('.privacy-note')).toContainText('브라우저 데이터 삭제');
  await page.getByRole('button', {name:'예시로 체험하기',exact:true}).click();
  const saved = async () => expect(page.locator('.save-state')).toHaveText('저장 완료');
  const state = async () => {
    await saved();
    return page.evaluate(() => new Promise<any>((resolve, reject) => {
      const request = indexedDB.open('project-mach-event-timetable-maker-v1', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result; const read = db.transaction('events').objectStore('events').getAll(); read.onsuccess = () => { db.close(); resolve(read.result[0]); }; };
    }));
  };
  const shortage = page.locator('.metrics > div').nth(1).locator('strong');
  expect(Number((await shortage.innerText()).replaceAll(',',''))).toBeGreaterThan(0);
  await expect(page.locator('.issue-list')).toContainText('명 부족');
  const auto = async () => {
    await page.getByRole('button',{name:'자동배정 초안 만들기',exact:true}).click();
    await expect(page.getByRole('heading',{name:'배정 변경 미리보기'})).toBeVisible();
    await expect(page.getByText(/검사 오류 0건 · 부족 0인분/)).toBeVisible();
    await page.getByRole('button',{name:'이 초안 적용',exact:true}).click();
    await saved();
  };
  await auto();
  await page.locator('.assignment').first().click();
  await page.getByRole('button',{name:'배정 잠금',exact:true}).click();
  const locked = (await state()).assignments.find((a:any)=>a.locked);
  // Select an unlocked assignment and choose a different eligible participant.
  await page.locator('.assignment').filter({hasNotText:'🔒'}).first().click();
  const selector = page.locator('label').filter({hasText:/^배정 참여자/}).locator('select');
  const previous = await selector.inputValue();
  const replacement = await selector.locator('option').evaluateAll((options, old) => options.find(o => (o as HTMLOptionElement).value && !(o as HTMLOptionElement).disabled && (o as HTMLOptionElement).value !== old)?.getAttribute('value'), previous);
  expect(replacement).toBeTruthy();
  await selector.selectOption(replacement!);
  await page.getByRole('button',{name:'수동 배정 적용',exact:true}).click();
  const edited = await state();
  expect(edited.assignments.some((a:any)=>a.source==='manual' && a.personId===replacement)).toBe(true);
  await page.locator('.assignment').filter({hasNotText:'🔒'}).first().click();
  await page.getByRole('button',{name:'배정 해제',exact:true}).click();
  const before = await state();
  expect(Number((await shortage.innerText()).replaceAll(',',''))).toBeGreaterThan(0);
  await expect(page.getByLabel('자동배정 범위')).toHaveValue('fill');
  await auto();
  const after = await state();
  for (const a of before.assignments) expect(after.assignments.find((b:any)=>a.id===b.id)).toEqual(a);
  expect(after.assignments.find((a:any)=>a.id===locked.id)).toEqual(locked);
  await page.reload();
  await page.getByRole('button',{name:new RegExp(after.name)}).click();
  expect((await state()).assignments).toEqual(after.assignments);
  const direct = new URL('index.html', process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:4173/');
  expect((await page.goto(direct.href))?.status()).toBe(200);
  await expect(page.getByRole('button',{name:new RegExp(after.name)})).toBeVisible();
  expect(problems).toEqual([]);
});
