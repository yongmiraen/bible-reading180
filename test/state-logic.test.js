const { test } = require('node:test');
const assert = require('node:assert');
const SL = require('../lib/state-logic.js');

test('mergeReadDays unions truthy days', () => {
  const a = { 1: true, 2: true };
  const b = { 2: true, 5: true };
  assert.deepStrictEqual(SL.mergeReadDays(a, b), { 1: true, 2: true, 5: true });
});

test('mergeReadDays ignores falsy and handles null', () => {
  assert.deepStrictEqual(SL.mergeReadDays(null, { 3: true, 4: false }), { 3: true });
  assert.deepStrictEqual(SL.mergeReadDays({ 7: true }, undefined), { 7: true });
});

test('migrateState: solo flat state -> soloStash filled, groupRef null', () => {
  const old = { mode: 'solo', plan: '365', startDate: '2026-01-01', groupName: '나의통독', readDays: { 1: true } };
  const s = SL.migrateState(old);
  assert.strictEqual(s.mode, 'solo');
  assert.deepStrictEqual(s.soloStash, { plan: '365', startDate: '2026-01-01', groupName: '나의통독', readDays: { 1: true } });
  assert.strictEqual(s.groupRef, null);
});

test('migrateState: group flat state -> groupRef filled', () => {
  const old = { mode: 'group', plan: '180', groupId: 'ABC123', displayName: '용환', readDays: { 2: true } };
  const s = SL.migrateState(old);
  assert.deepStrictEqual(s.groupRef, { groupId: 'ABC123', displayName: '용환' });
  assert.deepStrictEqual(s.soloStash, { plan: '180', startDate: null, groupName: '', readDays: {} });
});

test('migrateState: already-migrated state passes through (idempotent)', () => {
  const cur = { mode: 'solo', soloStash: { plan: '180', startDate: null, groupName: '', readDays: {} }, groupRef: null };
  const s = SL.migrateState(cur);
  assert.deepStrictEqual(s.soloStash, cur.soloStash);
  assert.strictEqual(s.groupRef, null);
});
