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

  function mergeProfile(localSolo, cloud) {
    localSolo = localSolo || { plan: '180', startDate: null, groupName: '', readDays: {} };
    if (!cloud) {
      return {
        activeMode: 'solo',
        solo: {
          plan: localSolo.plan || '180',
          startDate: localSolo.startDate || null,
          groupName: localSolo.groupName || '',
          readDays: localSolo.readDays || {}
        },
        groupRef: null
      };
    }
    const cs = cloud.solo || {};
    return {
      activeMode: cloud.activeMode || 'solo',
      solo: {
        plan: cs.plan || localSolo.plan || '180',
        startDate: cs.startDate || localSolo.startDate || null,
        groupName: cs.groupName || localSolo.groupName || '',
        readDays: mergeReadDays(localSolo.readDays, cs.readDays)
      },
      groupRef: cloud.groupRef || null
    };
  }

  function isProfileSetUp(p) {
    if (!p) return false;
    if (p.activeMode === 'group' && p.groupRef && p.groupRef.groupId) return true;
    if (p.solo && p.solo.startDate) return true;
    return false;
  }

  return { mergeReadDays, migrateState, mergeProfile, isProfileSetUp };
});
