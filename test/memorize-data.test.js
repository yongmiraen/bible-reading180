// 성경암송 72구절 데이터 검증 (node --test)
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
global.window = global.window || {};
require(path.join(ROOT, 'bible/GAE.js'));
const GAE = global.window.BIBLES.GAE;
const DATA = require(path.join(ROOT, 'memorize-data.js'));
const SOURCE = require(path.join(ROOT, 'scripts/amsong72-source.json')).items;

const verses = DATA.sets.flatMap(s => s.topics.flatMap(t => t.verses.map(v => ({ ...v, set: s.id, topic: t.title }))));
const textOf = v => v.keys.map(k => GAE[k].trim()).join(' ');
const words = s => s.trim().split(/\s+/);
const norm = s => s.replace(/[\s.,;:'"“”‘’·!?()]/g, '');

test('72구절, 6묶음×6소주제×2', () => {
  assert.strictEqual(DATA.sets.length, 6);
  assert.deepStrictEqual(DATA.sets.map(s => s.id), ['A', 'B', 'C', 'D', 'E', 'F']);
  for (const s of DATA.sets) {
    assert.strictEqual(s.topics.length, 6, s.id);
    for (const t of s.topics) assert.strictEqual(t.verses.length, 2, `${s.id} ${t.title}`);
  }
  assert.strictEqual(verses.length, 72);
});

test('id 72개 고유', () => {
  assert.strictEqual(new Set(verses.map(v => v.id)).size, 72);
});

test('모든 keys가 bible/GAE.js에 존재하고 id는 첫 절 키', () => {
  for (const v of verses) {
    assert.ok(v.keys.length >= 1, v.id);
    assert.strictEqual(v.id, v.keys[0]);
    for (const k of v.keys) assert.ok(GAE[k] && GAE[k].trim(), `${v.label}: ${k} 없음`);
  }
});

test('사이트 본문 = 앱 본문(공백·문장부호 제외), 순서도 사이트와 동일', () => {
  assert.strictEqual(SOURCE.length, 72);
  verses.forEach((v, i) => {
    assert.strictEqual(v.label, SOURCE[i].ref, `순서 ${i}`);
    assert.strictEqual(norm(textOf(v)), norm(SOURCE[i].text), v.label);
  });
});

test('D묶음 고후9:6 소주제 = 후히 드릴 것, 금주의 말씀 문자열 없음', () => {
  const v = verses.find(x => x.id === '고후9:6');
  assert.ok(v);
  assert.strictEqual(v.set, 'D');
  assert.strictEqual(v.topic, '후히 드릴 것');
  assert.ok(!JSON.stringify(DATA).includes('금주의 말씀'));
});

test('출처 문구', () => {
  assert.strictEqual(DATA.source, '사랑의교회 성경암송 72구절 (네비게이토)');
});

// 사이트 본문 기준으론 45개였으나, 앱 개역개정 띄어쓰기 기준(눅 9:23 = 15어절)으로 44개
test('chunks: 15어절 이하 null, 초과는 배열 (앱 본문 기준 초과 44개)', () => {
  let over = 0;
  for (const v of verses) {
    const n = words(textOf(v)).length;
    if (n <= 15) assert.strictEqual(v.chunks, null, `${v.label} ${n}어절`);
    else { over++; assert.ok(Array.isArray(v.chunks) && v.chunks.length >= 1, `${v.label} ${n}어절`); }
  }
  assert.strictEqual(over, 44);
});

test('chunks 재결합 = 원문 (공백까지 동일)', () => {
  for (const v of verses.filter(x => x.chunks)) {
    const w = words(textOf(v));
    const cuts = [0, ...v.chunks, w.length];
    const parts = [];
    for (let i = 0; i < cuts.length - 1; i++) parts.push(w.slice(cuts[i], cuts[i + 1]).join(' '));
    assert.strictEqual(parts.join(' '), textOf(v).trim().replace(/\s+/g, ' '), v.label);
  }
});

test('chunks는 오름차순, 0<i<어절수, 각 부분 4어절 이상', () => {
  for (const v of verses.filter(x => x.chunks)) {
    const n = words(textOf(v)).length;
    const cuts = [0, ...v.chunks, n];
    for (let i = 1; i < cuts.length; i++) {
      assert.ok(cuts[i] > cuts[i - 1], `${v.label} 오름차순`);
      assert.ok(cuts[i] - cuts[i - 1] >= 4, `${v.label} 부분 ${i} 길이 ${cuts[i] - cuts[i - 1]}`);
    }
    assert.ok(v.chunks[0] > 0 && v.chunks[v.chunks.length - 1] < n, v.label);
  }
});
