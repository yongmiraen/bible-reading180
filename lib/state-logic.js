(function (factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.StateLogic = api;
})(function () {
  function mergeReadDays(a, b) {
    const out = {};
    for (const src of [a, b]) {
      if (!src) continue;
      for (const k in src) if (src[k]) out[k] = true;
    }
    return out;
  }

  function migrateState(s) {
    s = s || {};
    const out = Object.assign({}, s);
    if (!out.soloStash) {
      out.soloStash = {
        plan: s.plan || '180',
        startDate: s.mode === 'solo' ? (s.startDate || null) : null,
        groupName: s.mode === 'solo' ? (s.groupName || '') : '',
        readDays: s.mode === 'solo' ? (s.readDays || {}) : {}
      };
    }
    if (out.groupRef === undefined) {
      out.groupRef = (s.groupId)
        ? { groupId: s.groupId, displayName: s.displayName || '' }
        : null;
    }
    return out;
  }

  return { mergeReadDays, migrateState };
});
