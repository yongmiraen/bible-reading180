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

test('mergeProfile: cloud solo readDays union with local, scalars prefer cloud', () => {
  const localSolo = { plan: '180', startDate: '2026-01-01', groupName: 'L', readDays: { 1: true } };
  const cloud = { activeMode: 'group', solo: { plan: '365', startDate: '2026-02-02', groupName: 'C', readDays: { 3: true } }, groupRef: { groupId: 'XY', displayName: '용환' } };
  const m = SL.mergeProfile(localSolo, cloud);
  assert.strictEqual(m.activeMode, 'group');
  assert.strictEqual(m.solo.plan, '365');
  assert.deepStrictEqual(m.solo.readDays, { 1: true, 3: true });
  assert.deepStrictEqual(m.groupRef, { groupId: 'XY', displayName: '용환' });
});

test('mergeProfile: no cloud -> derive from local solo, activeMode solo', () => {
  const localSolo = { plan: '180', startDate: '2026-01-01', groupName: 'L', readDays: { 1: true } };
  const m = SL.mergeProfile(localSolo, null);
  assert.strictEqual(m.activeMode, 'solo');
  assert.deepStrictEqual(m.solo.readDays, { 1: true });
  assert.strictEqual(m.groupRef, null);
});

test('isProfileSetUp: group with groupRef is set up; empty is not', () => {
  assert.strictEqual(SL.isProfileSetUp({ activeMode: 'group', groupRef: { groupId: 'X' }, solo: {} }), true);
  assert.strictEqual(SL.isProfileSetUp({ activeMode: 'solo', groupRef: null, solo: { startDate: '2026-01-01' } }), true);
  assert.strictEqual(SL.isProfileSetUp({ activeMode: 'solo', groupRef: null, solo: { startDate: null } }), false);
});
