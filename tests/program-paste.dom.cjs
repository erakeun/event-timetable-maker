// Actual React + App + original storage in jsdom. No browser/real IndexedDB/network.
// Uses the existing environment's jsdom via JSDOM_MODULE; no project dependency added.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require(process.env.JSDOM_MODULE || 'jsdom');
const { buildSync } = require('esbuild');
const { IDBFactory } = require('fake-indexeddb');
const rootDir = path.resolve(__dirname, '..');
const out = path.join(rootDir, '.qa-dom');
fs.mkdirSync(out, { recursive: true });
buildSync({ stdin: { contents: `export { default as App } from './src/App'; export * from './src/io/storage'; export * from './src/core/defaults'; export * from './src/core/time'; export * from './src/core/revisions';`, resolveDir: rootDir, loader: 'ts' }, outfile: path.join(out, 'app.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://synthetic.invalid' });
const networkCalls = [];
Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
for (const name of ['fetch', 'WebSocket', 'XMLHttpRequest']) { global[name] = dom.window[name] = () => { networkCalls.push(name); throw Error('Network is prohibited'); }; }
dom.window.scrollTo = () => {};
dom.window.confirm = global.confirm = () => { throw Error('Unexpected confirm'); };
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const api = require(path.join(out, 'app.cjs'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const headers = '날짜\t시작\t종료\t제목\t장소\t다음 날 종료\t공개 메모';
const row = (title = '추가 A', start = '10:00', end = '10:20', note = '') => `2026-10-20\t${start}\t${end}\t${title}\t\t아니오\t${note}`;
function base() {
  const e = api.createEvent('합성 행사', 'program');
  e.id = 'synthetic-event';
  e.days = [{ id: 'd', date: '2026-10-20', start: '09:00', end: '18:00', nextDay: false }];
  e.programs = [ { id: 'old-later', title: '기존 뒤시각', start: api.toMinute('2026-10-20', '16:00'), end: api.toMinute('2026-10-20', '16:10'), locationId: '', personId: '', dedicated: false, publicNote: '기존 공개', internalNote: '합성 내부 유지', allowSharedLocation: false }, { id: 'old-earlier', title: '기존 앞시각', start: api.toMinute('2026-10-20', '09:00'), end: api.toMinute('2026-10-20', '09:10'), locationId: '', personId: '', dedicated: false, publicNote: '', internalNote: '', allowSharedLocation: false } ];
  const { snapshots, ...data } = structuredClone(e);
  e.snapshots = [{ id: 'snapshot-old', version: 1, confirmedAt: '2026-10-01T00:00:00Z', data: { ...data, status: 'confirmed' } }];
  e.edition = 2;
  return e;
}
async function boot(event = base()) {
  global.indexedDB = dom.window.indexedDB = new IDBFactory();
  const original = await api.saveEvent(event, null);
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(api.App)); });
  await act(async () => { await delay(30); });
  const buttons = () => [...container.querySelectorAll('button')];
  const button = text => { const found = buttons().find(node => node.textContent.trim() === text); assert(found, `Button missing: ${text}`); return found; };
  const click = async (target) => { const node = typeof target === 'string' ? button(target) : target; await act(async () => { node.click(); await delay(0); }); };
  const control = text => { const label = [...container.querySelectorAll('label')].find(node => [...node.childNodes].filter(child => child.nodeType === 3).map(child => child.textContent).join('').trim() === text); assert(label, `Label missing: ${text}`); const element = label.querySelector('input,textarea,select'); assert(element); return element; };
  const change = async (element, value) => {
    await act(async () => {
      if (element.type === 'checkbox') { element.click(); }
      else { const proto = element.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value); element.dispatchEvent(new dom.window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }
      await delay(0);
    });
  };
  await click(container.querySelector('.event-open'));
  if (event.status === 'confirmed') { await click([...container.querySelectorAll('nav button')].find(node => node.textContent.includes('진행 시간표'))); }
  else await click('다음 단계 →');
  const panel = () => container.querySelector('.program-paste');
  const prepare = async (text = headers + '\n' + row()) => { await click('표 붙여넣기 열기'); await change(control('진행 표 (첫 행은 열 제목)'), text); await click('열 읽기'); await click('추가 내용 미리보기'); };
  const confirm = () => change(control('추가 내용·경고·미반영 열을 확인했고 현재 순서 끝에 추가합니다'), true);
  const stored = async () => { let result; await act(async () => { await delay(360); result = await api.loadEvent(event.id); await delay(20); }); return result; };
  const close = async () => { await act(async () => { await delay(380); }); await act(async () => { await delay(20); root.unmount(); }); container.remove(); assert.deepEqual(networkCalls, []); };
  return { container, original, button, click, control, change, panel, prepare, confirm, stored, close };
}
test('actual App: append once, preserve display order and snapshot, original save path, one-step Undo/Redo', async () => {
  const x = await boot();
  try {
    await x.prepare(headers + '\n' + row('추가 A', '10:00', '10:20') + '\n' + row('추가 B', '10:20', '10:40'));
    assert(x.button('확인한 2개 항목 추가').disabled);
    await x.confirm();
    const apply = x.button('확인한 2개 항목 추가');
    await act(async () => { apply.click(); apply.click(); await delay(0); });
    const saved = await x.stored();
    assert.deepEqual(saved.programs.map(p => p.title), ['기존 뒤시각', '기존 앞시각', '추가 A', '추가 B']);
    assert.deepEqual(saved.programs.slice(0, 2), x.original.programs);
    assert.deepEqual(saved.assignments, x.original.assignments);
    assert.deepEqual(saved.snapshots, x.original.snapshots);
    assert.equal(saved.revision, x.original.revision + 1);
    assert.equal(x.panel().querySelector('textarea'), null);
    await x.click('↶ 되돌리기');
    assert.deepEqual((await x.stored()).programs, x.original.programs);
    assert(x.button('↶ 되돌리기').disabled);
    await x.click('↷ 다시 실행');
    assert.deepEqual((await x.stored()).programs, saved.programs);
  } finally { await x.close(); }
});
test('actual App: one bad row blocks all rows; mapping edits and paste edits revoke approval', async () => {
  const x = await boot();
  try {
    await x.prepare(headers + '\n' + row() + '\n' + row('오류', '12:00', '11:00'));
    assert(x.button('확인한 2개 항목 추가').disabled);
    assert.match(x.panel().textContent, /전체 추가를 차단/);
    assert.deepEqual((await x.stored()).programs, x.original.programs);
    await x.change(x.control('진행 표 (첫 행은 열 제목)'), headers + '\n' + row());
    assert.equal(x.panel().querySelector('table'), null);
    await x.click('열 읽기'); await x.click('추가 내용 미리보기'); await x.confirm();
    await x.change(x.control('날짜 열'), '');
    assert.equal(x.panel().querySelector('table'), null);
    await x.click('추가 내용 미리보기'); assert.match(x.panel().textContent, /날짜 열을 지정/);
    await x.change(x.control('날짜 열'), '날짜'); await x.click('추가 내용 미리보기');
    assert(x.button('확인한 1개 항목 추가').disabled);
  } finally { await x.close(); }
});
test('actual App: duplicate confirmation is separate and preserves duplicate rows', async () => {
  const x = await boot();
  try {
    await x.prepare(headers + '\n' + row() + '\n' + row()); await x.confirm();
    assert(x.button('확인한 2개 항목 추가').disabled);
    await x.change(x.control('같은 제목·시간·장소의 중복 항목도 삭제하지 않고 추가합니다'), true);
    await x.click('확인한 2개 항목 추가');
    const saved = await x.stored(); assert.equal(saved.programs.length, 4); assert.equal(saved.programs[2].title, saved.programs[3].title); assert.notEqual(saved.programs[2].id, saved.programs[3].id);
  } finally { await x.close(); }
});
test('actual App: cancel clears input, reopening is empty, no save or undo entry', async () => {
  const x = await boot();
  try {
    await x.prepare(); await x.confirm(); await x.click('취소 · 입력 지우기');
    assert.equal(x.panel().querySelector('textarea'), null);
    await x.click('표 붙여넣기 열기'); assert.equal(x.control('진행 표 (첫 행은 열 제목)').value, '');
    assert.equal(x.panel().querySelector('table'), null);
    assert.deepEqual(await x.stored(), x.original); assert(x.button('↶ 되돌리기').disabled);
  } finally { await x.close(); }
});
test('actual App: modifying existing order after preview blocks stale append; rereview resets approval', async () => {
  const x = await boot();
  try {
    await x.prepare(); await x.confirm();
    await x.click(x.container.querySelector('[aria-label="기존 뒤시각 아래로"]'));
    assert(x.button('확인한 1개 항목 추가').disabled); assert.match(x.panel().textContent, /기존 행사가 바뀌/);
    await x.click('↶ 되돌리기'); assert(x.button('확인한 1개 항목 추가').disabled);
    await x.click(x.container.querySelector('[aria-label="기존 뒤시각 아래로"]'));
    await x.click('추가 내용 미리보기'); assert(x.button('확인한 1개 항목 추가').disabled); await x.confirm(); await x.click('확인한 1개 항목 추가');
    assert.deepEqual((await x.stored()).programs.map(p => p.title), ['기존 앞시각', '기존 뒤시각', '추가 A']);
  } finally { await x.close(); }
});
test('actual App: ignored contact values are not saved; HTML title is text; public memo preview is visible', async () => {
  const x = await boot();
  try {
    await x.prepare(headers + '\t연락처\n' + row('<img src=x onerror=alert(1)>', '10:00', '10:20', '합성 공개 메모') + '\tSYNTHETIC-CONTACT-OMIT');
    assert.equal(x.panel().querySelectorAll('img').length, 0); assert.match(x.panel().textContent, /미반영 열: 연락처/); assert.match(x.panel().textContent, /합성 공개 메모/);
    await x.confirm(); await x.click('확인한 1개 항목 추가');
    const saved = await x.stored(); assert(!JSON.stringify(saved).includes('SYNTHETIC-CONTACT-OMIT')); assert.equal(saved.programs[2].personId, ''); assert.equal(saved.programs[2].internalNote, ''); assert.equal(saved.programs[2].dedicated, false); assert.equal(saved.programs[2].allowSharedLocation, false); assert.equal(x.container.querySelectorAll('img').length, 0);
  } finally { await x.close(); }
});
test('actual App + fake IndexedDB: second-tab revision wins; stale tab becomes read-only without overwrite', async () => {
  const x = await boot();
  try {
    await x.prepare(); await x.confirm();
    const other = await api.saveEvent({ ...x.original, name: '합성 다른 탭 수정' }, x.original.revision);
    await x.click('확인한 1개 항목 추가'); const saved = await x.stored();
    assert.deepEqual(saved, other); assert.match(x.container.textContent, /다른 탭과 저장 버전이 다릅니다/);
    assert(x.button('표 붙여넣기 열기').disabled); assert.match(x.container.textContent, /추가 A/);
  } finally { await x.close(); }
});
test('actual App: confirmed snapshot view is read-only and cannot open paste panel', async () => {
  const e = base(); e.status = 'confirmed'; e.edition = 1;
  const x = await boot(e);
  try { assert(x.button('표 붙여넣기 열기').disabled); await x.click('표 붙여넣기 열기'); assert.equal(x.panel().querySelector('textarea'), null); assert.deepEqual(await x.stored(), x.original); }
  finally { await x.close(); }
});
test('actual App: revision conflict during open preview still permits cancel and clears pasted input', async () => {
  const x = await boot();
  try {
    await x.prepare(); await x.confirm();
    await api.saveEvent({ ...x.original, name: '합성 다른 탭 수정' }, x.original.revision);
    await x.click(x.container.querySelector('[aria-label="기존 뒤시각 아래로"]'));
    await x.stored();
    assert.match(x.container.textContent, /다른 탭과 저장 버전이 다릅니다/);
    assert(!x.button('붙여넣기 취소').disabled);
    await x.click('붙여넣기 취소');
    assert.equal(x.panel().querySelector('textarea'), null);
    assert(x.button('표 붙여넣기 열기').disabled);
    assert(document.activeElement === x.panel().querySelector('h2'), 'Read-only cancel must focus a persistent heading, not a disabled button');
  } finally { await x.close(); }
});
test('actual App: moving to another step discards uncommitted preview without saving', async () => {
  const x = await boot();
  try {
    await x.prepare(); await x.confirm();
    await x.click('← 이전 단계');
    assert.equal(x.panel(), null);
    await x.click('다음 단계 →');
    assert.equal(x.panel().querySelector('textarea'), null);
    assert.deepEqual(await x.stored(), x.original);
    assert(x.button('↶ 되돌리기').disabled);
  } finally { await x.close(); }
});
test('actual App: paste disclosure, preview, cancel and apply keep a keyboard focus target', async () => {
  const x = await boot();
  try {
    const opener = x.button('표 붙여넣기 열기'); opener.focus();
    await x.click(opener);
    const textarea = x.control('진행 표 (첫 행은 열 제목)');
    assert(document.activeElement === textarea, 'Opening must focus the paste textarea');
    assert.equal(opener.getAttribute('aria-expanded'), 'true');
    assert.equal(x.panel().querySelector('fieldset').id, opener.getAttribute('aria-controls'));
    await x.change(textarea, headers + '\n' + row());
    await x.click('열 읽기'); await x.click('추가 내용 미리보기');
    assert(document.activeElement === [...x.panel().querySelectorAll('h3')].find(h => h.textContent.includes('추가 미리보기')), 'Preview must focus its heading');
    await x.click('취소 · 입력 지우기');
    assert(document.activeElement === x.button('표 붙여넣기 열기'), 'Closing must return focus to the disclosure button');
    await x.prepare(); await x.confirm(); await x.click('확인한 1개 항목 추가');
    assert(document.activeElement === x.button('표 붙여넣기 열기'), 'Closing must return focus to the disclosure button');
    assert.equal((await x.stored()).programs.length, 3);
  } finally { await x.close(); }
});
test('actual App: review rendering preserves paste order and public notes, excludes internal and ignored values', async () => {
  const x = await boot();
  try {
    await x.prepare(headers + '\t무시열\n' + row('추가 B', '14:00', '14:20', '첫 공개 메모') + '\tSYNTHETIC-OMIT-B\n' + row('추가 A', '10:00', '10:20', '다음 공개 메모') + '\tSYNTHETIC-OMIT-A');
    await x.confirm(); await x.click('확인한 2개 항목 추가'); await x.stored();
    await x.click('다음 단계 →');
    const preview = x.container.querySelector('.print-preview'); assert(preview);
    const rows = [...preview.querySelectorAll('.program-table tbody tr')];
    assert.deepEqual(rows.map(tr => tr.children[1].textContent), ['기존 뒤시각', '기존 앞시각', '추가 B', '추가 A']);
    assert.match(preview.textContent, /첫 공개 메모/); assert.match(preview.textContent, /다음 공개 메모/);
    assert(!preview.textContent.includes('합성 내부 유지')); assert(!preview.textContent.includes('SYNTHETIC-OMIT'));
    await x.change(x.control('표 버전'), 'snapshot-old');
    assert.deepEqual([...x.container.querySelectorAll('.print-preview .program-table tbody tr')].map(tr => tr.children[1].textContent), ['기존 뒤시각', '기존 앞시각']);
    assert(!x.container.querySelector('.print-preview').textContent.includes('첫 공개 메모'));
  } finally { await x.close(); }
});
test('actual App: parser failure can be corrected and reread without a partial save', async () => {
  const x = await boot();
  try {
    await x.click('표 붙여넣기 열기');
    await x.change(x.control('진행 표 (첫 행은 열 제목)'), '날짜\t제목\n"닫히지 않음');
    await x.click('열 읽기'); assert.match(x.panel().querySelector('[role="alert"]').textContent, /닫히지 않은/);
    assert.deepEqual(await x.stored(), x.original); assert(x.button('↶ 되돌리기').disabled);
    await x.change(x.control('진행 표 (첫 행은 열 제목)'), headers + '\n' + row());
    assert.equal(x.panel().querySelector('[role="alert"]'), null);
    await x.click('열 읽기'); await x.click('추가 내용 미리보기'); await x.confirm(); await x.click('확인한 1개 항목 추가');
    assert.equal((await x.stored()).programs.length, 3);
  } finally { await x.close(); }
});
test.after(() => { dom.window.close(); });
