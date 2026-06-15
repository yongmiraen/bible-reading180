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

  return { mergeReadDays };
});
