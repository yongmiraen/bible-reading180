// groups.js 암송 저장·동기화 — 실제 Firebase compat SDK + 인증·Firestore 에뮬레이터
//   firebase emulators:exec --project demo-memorize --only firestore,auth "node --test test/e2e/groups-emulator.test.js"
// 같은 브라우저 컨텍스트의 두 페이지 = 같은 사용자의 두 기기, 다른 컨텍스트 = 다른 사용자.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const PORT = 8766;
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

const HARNESS = `<!doctype html><meta charset="utf-8"><body>
<script src="/node_modules/firebase/firebase-app-compat.js"></script>
<script src="/node_modules/firebase/firebase-auth-compat.js"></script>
<script src="/node_modules/firebase/firebase-firestore-compat.js"></script>
<script>
  window.FIREBASE_CONFIG = { apiKey: 'demo-key', authDomain: 'demo-memorize.firebaseapp.com', projectId: 'demo-memorize', appId: 'demo-app' };
  window.FIREBASE_EMULATOR = { auth: 'http://${AUTH_HOST}', firestore: '${FS_HOST}' };
</script>
<script src="/memorize-data.js"></script>
<script src="/lib/memorize-logic.js"></script>
<script src="/groups.js"></script>
</body>`;

let server, browser;
before(async () => {
  server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/__harness') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(HARNESS); }
    const file = path.join(ROOT, url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    fs.createReadStream(file).pipe(res);
  }).listen(PORT);
  browser = await chromium.launch();
});
after(async () => { if (browser) await browser.close(); if (server) server.close(); });

async function device(ctx) {
  const page = await (ctx || await browser.newContext()).newPage();
  page.on('pageerror', e => console.error('pageerror', e.message));
  await page.goto(`http://127.0.0.1:${PORT}/__harness`);
  const uid = await page.evaluate(async () => (await Groups.authReady).uid);
  return { page, uid, ctx: page.context() };
}
const IDS = "new Set(MemorizeLogic.listVerses(window.MEMORIZE72).map(v => v.id))";
const run = (d, fn, arg) => d.page.evaluate(fn, arg);
const profile = d => run(d, async uid => { const s = await firebase.firestore().collection('users').doc(uid).get({ source: 'server' }); return s.exists ? s.data() : null; }, d.uid);
const member = (d, code) => run(d, async ([uid, code]) => { const s = await firebase.firestore().collection('groups').doc(code).collection('members').doc(uid).get({ source: 'server' }); return s.exists ? s.data() : null; }, [d.uid, code]);
const newGroup = (d, extra) => run(d, async extra => Groups.createGroup({ name: '테스트조', startDate: '2026-11-01', displayName: '홍길동', plan: '180', ...extra }), extra || {});
const reconcile = (d, code) => run(d, async ([code, uid, ids]) => Groups.reconcileMemorized(code, uid, eval(ids)), [code, d.uid, IDS]);

test('setMemorized: 추가는 다른 키 보존, 해제는 해당 키만 삭제', async () => {
  const d = await device();
  assert.deepStrictEqual(await run(d, uid => Groups.setMemorized(uid, '고후5:17', '2026-11-23'), d.uid), { ok: true });
  await run(d, uid => Groups.setMemorized(uid, '갈2:20', '2026-11-24'), d.uid);
  assert.deepStrictEqual((await profile(d)).memorized, { '고후5:17': '2026-11-23', '갈2:20': '2026-11-24' });
  assert.deepStrictEqual(await run(d, uid => Groups.setMemorized(uid, '고후5:17', null), d.uid), { ok: true });
  assert.deepStrictEqual((await profile(d)).memorized, { '갈2:20': '2026-11-24' });
});

test('setMemorized: 문서가 없을 때 해제는 ok:true', async () => {
  const d = await device();
  assert.deepStrictEqual(await run(d, uid => Groups.setMemorized(uid, '고후5:17', null), d.uid), { ok: true });
  assert.strictEqual(await profile(d), null);
});

test('reconcile: 원본≠사본이면 updated, 사본 = 원본', async () => {
  const d = await device();
  const code = await newGroup(d);
  await run(d, uid => Groups.setMemorized(uid, '고후5:17', '2026-11-23'), d.uid);
  assert.strictEqual(await reconcile(d, code), 'updated');
  assert.deepStrictEqual((await member(d, code)).memorized, { '고후5:17': '2026-11-23' });
});

test('reconcile: 같으면 same, 쓰기 없음', async () => {
  const d = await device();
  const code = await newGroup(d);
  await run(d, uid => Groups.setMemorized(uid, '고후5:17', '2026-11-23'), d.uid);
  await reconcile(d, code);
  const before = (await member(d, code)).updatedAt;
  assert.strictEqual(await reconcile(d, code), 'same');
  assert.deepStrictEqual((await member(d, code)).updatedAt, before);
});

test('reconcile: 조원 문서 없으면 no-member, 문서 생성 안 됨', async () => {
  const d = await device();
  const code = await newGroup(d);
  await run(d, code => Groups.leaveGroup(code), code);
  await run(d, uid => Groups.setMemorized(uid, '고후5:17', '2026-11-23'), d.uid);
  assert.strictEqual(await reconcile(d, code), 'no-member');
  assert.strictEqual(await member(d, code), null);
});

test('reconcile: 등록 안 된 id·잘못된 값은 사본에서 빠짐', async () => {
  const d = await device();
  const code = await newGroup(d);
  await run(d, uid => firebase.firestore().collection('users').doc(uid).set({ memorized: { '고후5:17': '2026-11-23', '가짜:1': '2026-11-23', '갈2:20': 'x' } }), d.uid);
  await reconcile(d, code);
  assert.deepStrictEqual((await member(d, code)).memorized, { '고후5:17': '2026-11-23' });
});

test('두 기기 엇갈림: A 체크·B 해제 후 양쪽 reconcile → 사본 = 최신 원본', async () => {
  const A = await device();
  const B = await device(A.ctx); // 같은 사용자
  assert.strictEqual(A.uid, B.uid);
  const code = await newGroup(A);
  await run(A, uid => Groups.setMemorized(uid, '갈2:20', '2026-11-20'), A.uid);
  await run(A, uid => Groups.setMemorized(uid, '고후5:17', '2026-11-23'), A.uid);
  await run(B, uid => Groups.setMemorized(uid, '갈2:20', null), B.uid);
  await Promise.all([reconcile(A, code), reconcile(B, code)]);
  const orig = (await profile(A)).memorized;
  assert.deepStrictEqual(orig, { '고후5:17': '2026-11-23' });
  assert.deepStrictEqual((await member(A, code)).memorized, orig);
});

test('오프라인 체크 후 재접속 시 사본 복구', async () => {
  const d = await device();
  const code = await newGroup(d);
  await run(d, async uid => {
    const db = firebase.firestore();
    await db.disableNetwork();
    window.__pending = Groups.setMemorized(uid, '롬12:1', '2026-11-23'); // 오프라인: 대기열
    await new Promise(r => setTimeout(r, 300));
    await db.enableNetwork();
    await window.__pending;
  }, d.uid);
  assert.strictEqual(await reconcile(d, code), 'updated');
  assert.deepStrictEqual((await member(d, code)).memorized, { '롬12:1': '2026-11-23' });
});

test('watchProfile: meta(fromCache, hasPendingWrites)를 넘기고 서버 확인 스냅샷이 온다', async () => {
  const d = await device();
  await run(d, uid => Groups.setMemorized(uid, '고후5:17', '2026-11-23'), d.uid);
  const metas = await run(d, uid => new Promise(resolve => {
    const seen = [];
    const unsub = Groups.watchProfile(uid, (data, meta) => {
      seen.push({ has: !!(data && data.memorized), fromCache: meta.fromCache, pending: meta.hasPendingWrites });
      if (meta && meta.fromCache === false && !meta.hasPendingWrites) { unsub(); resolve(seen); }
    });
  }), d.uid);
  const last = metas[metas.length - 1];
  assert.deepStrictEqual(last, { has: true, fromCache: false, pending: false });
  assert.ok(metas.every(m => typeof m.fromCache === 'boolean' && typeof m.pending === 'boolean'));
});

test('createGroup·joinGroup: memorized를 넘기면 새 조원 문서에 포함', async () => {
  const owner = await device();
  const code = await newGroup(owner, { memorized: { '고후5:17': '2026-11-23' } });
  assert.deepStrictEqual((await member(owner, code)).memorized, { '고후5:17': '2026-11-23' });
  const other = await device();
  await run(other, code => Groups.joinGroup({ code, displayName: '김조원', plan: '180', memorized: { '갈2:20': '2026-11-22' } }), code);
  assert.deepStrictEqual((await member(other, code)).memorized, { '갈2:20': '2026-11-22' });
});

test('joinGroup: 기존 조원 재참가는 이름·plan만 갱신하고 기록 보존', async () => {
  const d = await device();
  const code = await newGroup(d, { memorized: { '고후5:17': '2026-11-23' } });
  await run(d, code => Groups.setReadDays(code, { 1: true }), code);
  await run(d, code => Groups.joinGroup({ code, displayName: '새이름', plan: '365' }), code);
  const m = await member(d, code);
  assert.strictEqual(m.displayName, '새이름');
  assert.strictEqual(m.plan, '365');
  assert.deepStrictEqual(m.readDays, { 1: true });
  assert.deepStrictEqual(m.memorized, { '고후5:17': '2026-11-23' });
});

test('setMemoStart: 조장 설정 가능, 조원은 거부', async () => {
  const owner = await device();
  const code = await newGroup(owner);
  await run(owner, code => Groups.setMemoStart(code, '2026-11-23'), code);
  const g = await run(owner, async code => (await firebase.firestore().collection('groups').doc(code).get({ source: 'server' })).data(), code);
  assert.strictEqual(g.memoStart, '2026-11-23');
  const other = await device();
  await run(other, code => Groups.joinGroup({ code, displayName: '김조원', plan: '180' }), code);
  const err = await run(other, code => Groups.setMemoStart(code, '2026-12-01').then(() => null, e => e.code), code);
  assert.strictEqual(err, 'permission-denied');
});
