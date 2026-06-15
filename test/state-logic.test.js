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
