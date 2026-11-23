// Firestore 보안 규칙 테스트 — 에뮬레이터에서 실행:
//   firebase emulators:exec --only firestore,auth "node --test test/rules/*.test.js"
const { test, before, after, beforeEach } = require('node:test');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, deleteField } = require('firebase/firestore');

let env;
const G = 'TEST01';
const OWNER = 'owner', MEMBER = 'member', STRANGER = 'stranger';
const ids72 = Array.from({ length: 72 }, (_, i) => `창${i + 1}:1`);
const mapOf = n => Object.fromEntries(ids72.slice(0, n).map(id => [id, '2026-11-23']));

before(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-memorize',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8'), host, port: +port },
  });
});
after(async () => { if (env) await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', G), { name: '테스트조', startDate: '2026-11-01', owner: OWNER, createdAt: new Date() });
    for (const uid of [OWNER, MEMBER]) {
      await setDoc(doc(db, 'groups', G, 'members', uid), { displayName: uid, plan: '180', readDays: {}, joinedAt: new Date(), updatedAt: new Date() });
    }
  });
});
const as = uid => env.authenticatedContext(uid).firestore();
const memberRef = (db, uid) => doc(db, 'groups', G, 'members', uid);

// ── 기존 기능 호환 ──
test('기존: 조원 본인 readDays 갱신 허용', async () => {
  await assertSucceeds(updateDoc(memberRef(as(MEMBER), MEMBER), { readDays: { 1: true }, updatedAt: serverTimestamp() }));
});
test('기존: 조원 이름 변경 허용', async () => {
  await assertSucceeds(updateDoc(memberRef(as(MEMBER), MEMBER), { displayName: '새이름', updatedAt: serverTimestamp() }));
});
test('기존: memoStart 없는 조에서 조장 이름·시작일 변경 허용', async () => {
  await assertSucceeds(updateDoc(doc(as(OWNER), 'groups', G), { name: '새조', startDate: '2026-12-01' }));
});
test('기존: 새 조원 참가(create) 허용', async () => {
  await assertSucceeds(setDoc(memberRef(as(STRANGER), STRANGER),
    { displayName: '새조원', plan: '180', readDays: {}, joinedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
});

// ── memorized ──
test('memorized 포함 조원 create 허용', async () => {
  await assertSucceeds(setDoc(memberRef(as(STRANGER), STRANGER),
    { displayName: '새조원', plan: '180', readDays: {}, memorized: mapOf(3), joinedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
});
test('memorized 본인 update 허용 (72키)', async () => {
  await assertSucceeds(updateDoc(memberRef(as(MEMBER), MEMBER), { memorized: mapOf(72), updatedAt: serverTimestamp() }));
});
test('memorized 73키 거부', async () => {
  const m = mapOf(72); m['출1:1'] = '2026-11-23';
  await assertFails(updateDoc(memberRef(as(MEMBER), MEMBER), { memorized: m, updatedAt: serverTimestamp() }));
});
test('memorized가 문자열이면 거부', async () => {
  await assertFails(updateDoc(memberRef(as(MEMBER), MEMBER), { memorized: 'x', updatedAt: serverTimestamp() }));
});
test('memorized 키 삭제(FieldPath) 허용', async () => {
  const db = as(MEMBER);
  await assertSucceeds(updateDoc(memberRef(db, MEMBER), { memorized: mapOf(2), updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(memberRef(db, MEMBER), { 'memorized.창1:1': deleteField(), updatedAt: serverTimestamp() }));
});
test('타인 조원 문서 memorized update 거부', async () => {
  await assertFails(updateDoc(memberRef(as(MEMBER), OWNER), { memorized: mapOf(1), updatedAt: serverTimestamp() }));
});
test('updatedAt 없이 memorized update 거부', async () => {
  await assertFails(updateDoc(memberRef(as(MEMBER), MEMBER), { memorized: mapOf(1) }));
});

// ── memoStart ──
test('조장 memoStart 설정 허용', async () => {
  await assertSucceeds(updateDoc(doc(as(OWNER), 'groups', G), { memoStart: '2026-11-23' }));
});
test('memoStart 형식 오류 거부', async () => {
  await assertFails(updateDoc(doc(as(OWNER), 'groups', G), { memoStart: '2026/11/23' }));
});
test('일반 조원 memoStart 갱신 거부', async () => {
  await assertFails(updateDoc(doc(as(MEMBER), 'groups', G), { memoStart: '2026-11-23' }));
});
test('그룹 create에 memoStart 포함 시 거부', async () => {
  await assertFails(setDoc(doc(as(STRANGER), 'groups', 'NEW001'),
    { name: '새조', startDate: '2026-11-23', owner: STRANGER, createdAt: serverTimestamp(), memoStart: '2026-11-23' }));
});
test('memoStart 있는 조에서도 조장 이름 변경 허용', async () => {
  const db = as(OWNER);
  await assertSucceeds(updateDoc(doc(db, 'groups', G), { memoStart: '2026-11-23' }));
  await assertSucceeds(updateDoc(doc(db, 'groups', G), { name: '바뀐조' }));
});

// ── 나간 조원 ──
test('나간(삭제된) 조원 문서를 update로 재생성 불가', async () => {
  const db = as(MEMBER);
  await assertSucceeds(deleteDoc(memberRef(db, MEMBER)));
  await assertFails(updateDoc(memberRef(db, MEMBER), { memorized: mapOf(1), updatedAt: serverTimestamp() }));
});

// ── users ──
test('users 본인 memorized 쓰기 허용, 타인 읽기 거부', async () => {
  await assertSucceeds(setDoc(doc(as(MEMBER), 'users', MEMBER), { memorized: mapOf(2), memoStart: '2026-11-23' }, { merge: true }));
  await assertFails(getDoc(doc(as(OWNER), 'users', MEMBER)));
});
