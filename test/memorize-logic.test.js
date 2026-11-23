// 성경암송 순수 로직 (node --test)
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const L = require(path.join(__dirname, '..', 'lib/memorize-logic.js'));
const DATA = require(path.join(__dirname, '..', 'memorize-data.js'));

const IDS = new Set(L.listVerses(DATA).map(v => v.id));
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test('listVerses: 72개, 순서·묶음·소주제 번호', () => {
  const v = L.listVerses(DATA);
  assert.strictEqual(v.length, 72);
  assert.deepStrictEqual(
    { id: v[0].id, setId: v[0].setId, setTitle: v[0].setTitle, topicTitle: v[0].topicTitle, topicIndex: v[0].topicIndex },
    { id: '고후5:17', setId: 'A', setTitle: '새로운 삶', topicTitle: '중심되신 그리스도', topicIndex: 0 });
  assert.strictEqual(v[1].topicIndex, 0);
  assert.strictEqual(v[2].topicIndex, 1);
  assert.strictEqual(v[71].topicIndex, 35);
  assert.strictEqual(v[71].setId, 'F');
  assert.ok(Array.isArray(v[0].keys) && 'chunks' in v[0] && 'label' in v[0]);
});

test('weekState: 미설정', () => {
  assert.deepStrictEqual(L.weekState(null, '2026-11-23'), { status: 'unset', week: null, topicIndex: null });
});

test('weekState: 미래 시작일', () => {
  const s = L.weekState('2026-11-30', '2026-11-23');
  assert.strictEqual(s.status, 'future');
  assert.strictEqual(s.startsInDays, 7);
  assert.strictEqual(s.week, null);
});

test('weekState: 시작 당일부터 7일이 1주차', () => {
  assert.deepStrictEqual(L.weekState('2026-11-23', '2026-11-23'), { status: 'active', week: 1, topicIndex: 0 });
  assert.strictEqual(L.weekState('2026-11-23', '2026-11-29').week, 1);
  assert.deepStrictEqual(L.weekState('2026-11-23', '2026-11-30'), { status: 'active', week: 2, topicIndex: 1 });
});

test('weekState: 252일째는 36주, 253일째는 완료', () => {
  assert.deepStrictEqual(L.weekState('2026-01-01', addDays('2026-01-01', 251)), { status: 'active', week: 36, topicIndex: 35 });
  assert.deepStrictEqual(L.weekState('2026-01-01', addDays('2026-01-01', 252)), { status: 'done', week: null, topicIndex: null });
});

test('weekState: 서머타임과 무관하게 달력 날짜 차이', () => {
  assert.strictEqual(L.weekState('2026-03-01', '2026-03-15').week, 3);
});

test('normalizeMemorized: 등록 id + 날짜 형식만', () => {
  assert.deepStrictEqual(
    L.normalizeMemorized({ '고후5:17': '2026-11-23', '가짜:1': '2026-11-23', '갈2:20': 'bad' }, IDS),
    { '고후5:17': '2026-11-23' });
  assert.deepStrictEqual(L.normalizeMemorized(null, IDS), {});
});

test('sameMemorized', () => {
  assert.strictEqual(L.sameMemorized({}, null), true);
  assert.strictEqual(L.sameMemorized({ '고후5:17': '2026-11-23', '갈2:20': '2026-11-24' }, { '갈2:20': '2026-11-24', '고후5:17': '2026-11-23' }), true);
  assert.strictEqual(L.sameMemorized({ '고후5:17': '2026-11-23' }, { '고후5:17': '2026-11-24' }), false);
  assert.strictEqual(L.sameMemorized({ '고후5:17': '2026-11-23' }, {}), false);
});

test('words / chunkTexts', () => {
  assert.deepStrictEqual(L.words('  가  나 다 '), ['가', '나', '다']);
  assert.deepStrictEqual(L.chunkTexts('가 나 다 라 마', [2, 4]), ['가 나', '다 라', '마']);
  assert.deepStrictEqual(L.chunkTexts('가 나 다', null), ['가 나 다']);
});

test('hintText: 한 어절씩 공개', () => {
  assert.strictEqual(L.hintText('가 나 다', 0), '…');
  assert.strictEqual(L.hintText('가 나 다', 1), '가 …');
  assert.strictEqual(L.hintText('가 나 다', 3), '가 나 다');
  assert.strictEqual(L.hintText('가 나 다', 9), '가 나 다');
});

test('reviewNext: 마치기는 1→3→7→14→30, 이후 30 유지', () => {
  let e = L.reviewNext(null, 'done', '2026-11-23');
  assert.deepStrictEqual(e, { intervalStep: 1, nextReviewOn: '2026-11-26' });
  e = L.reviewNext(e, 'done', '2026-11-26');
  assert.deepStrictEqual(e, { intervalStep: 2, nextReviewOn: '2026-12-03' });
  e = L.reviewNext(e, 'done', '2026-12-03');
  assert.deepStrictEqual(e, { intervalStep: 3, nextReviewOn: '2026-12-17' });
  e = L.reviewNext(e, 'done', '2026-12-17');
  assert.deepStrictEqual(e, { intervalStep: 4, nextReviewOn: '2027-01-16' });
  e = L.reviewNext(e, 'done', '2027-01-16');
  assert.deepStrictEqual(e, { intervalStep: 4, nextReviewOn: '2027-02-15' });
});

test('reviewNext: 내일 다시는 다음 날·처음 간격', () => {
  assert.deepStrictEqual(L.reviewNext({ intervalStep: 3 }, 'again', '2026-11-23'), { intervalStep: 0, nextReviewOn: '2026-11-24' });
});

test('firstReviewOn: 외운 다음 날', () => {
  assert.strictEqual(L.firstReviewOn('2026-11-23'), '2026-11-24');
});

test('dueReviews: 기록 없으면 외운 다음 날, 오늘까지 도래한 것만, 오래 기다린 순', () => {
  const memorized = { '고후5:17': '2026-11-20', '갈2:20': '2026-11-22', '롬12:1': '2026-11-23', '요14:21': '2026-11-10' };
  const reviews = { '요14:21': { intervalStep: 2, nextReviewOn: '2026-11-30' }, '고후5:17': { intervalStep: 1, nextReviewOn: '2026-11-22' } };
  // 고후5:17: 11-22 도래 / 갈2:20: 첫 복습 11-23 도래 / 롬12:1: 첫 복습 11-24 미도래 / 요14:21: 11-30 미도래
  assert.deepStrictEqual(L.dueReviews(memorized, reviews, '2026-11-23'), ['고후5:17', '갈2:20']);
});

test('progressCount: 등록 id + 날짜 형식만 셈', () => {
  assert.strictEqual(L.progressCount({ '고후5:17': '2026-11-23', '가짜:1': '2026-11-23', '갈2:20': 'x' }, IDS), 1);
  assert.strictEqual(L.progressCount(null, IDS), 0);
});
