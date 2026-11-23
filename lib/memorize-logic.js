// 성경암송 72구절 — 화면과 무관한 순수 로직 (브라우저 전역 MemorizeLogic + node 모듈)
(function (factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.MemorizeLogic = api;
})(function () {
  const TOTAL_WEEKS = 36;
  const INTERVALS = [1, 3, 7, 14, 30]; // 복습 간격(일). intervalStep = 다음 복습에 쓴 간격의 번호
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // 'YYYY-MM-DD' → UTC 자정 기준 일수 (서머타임 영향 없음)
  function dayNum(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
  }
  function addDays(iso, n) {
    return new Date((dayNum(iso) + n) * 86400000).toISOString().slice(0, 10);
  }

  function listVerses(data) {
    const out = [];
    let topicIndex = 0;
    for (const set of data.sets) {
      for (const topic of set.topics) {
        for (const v of topic.verses) {
          out.push({ id: v.id, label: v.label, keys: v.keys, chunks: v.chunks,
            setId: set.id, setTitle: set.title, topicTitle: topic.title, topicIndex });
        }
        topicIndex++;
      }
    }
    return out;
  }

  function weekState(startISO, todayISO) {
    if (!startISO || !DATE_RE.test(startISO)) return { status: 'unset', week: null, topicIndex: null };
    const days = dayNum(todayISO) - dayNum(startISO);
    if (days < 0) return { status: 'future', week: null, topicIndex: null, startsInDays: -days };
    const week = Math.floor(days / 7) + 1;
    if (week > TOTAL_WEEKS) return { status: 'done', week: null, topicIndex: null };
    return { status: 'active', week, topicIndex: week - 1 };
  }

  function normalizeMemorized(map, validIds) {
    const out = {};
    if (!map) return out;
    for (const id of Object.keys(map)) {
      if (validIds.has(id) && typeof map[id] === 'string' && DATE_RE.test(map[id])) out[id] = map[id];
    }
    return out;
  }

  function sameMemorized(a, b) {
    const x = a || {}, y = b || {};
    const kx = Object.keys(x), ky = Object.keys(y);
    return kx.length === ky.length && kx.every(k => y[k] === x[k]);
  }

  function words(text) {
    const t = String(text || '').trim();
    return t ? t.split(/\s+/) : [];
  }

  function chunkTexts(text, chunks) {
    const w = words(text);
    if (!chunks || !chunks.length) return [w.join(' ')];
    const cuts = [0, ...chunks, w.length];
    const parts = [];
    for (let i = 0; i < cuts.length - 1; i++) parts.push(w.slice(cuts[i], cuts[i + 1]).join(' '));
    return parts;
  }

  function hintText(chunkText, revealed) {
    const w = words(chunkText);
    if (revealed >= w.length) return w.join(' ');
    return [...w.slice(0, Math.max(0, revealed)), '…'].join(' ');
  }

  function firstReviewOn(memorizedISO) {
    return addDays(memorizedISO, INTERVALS[0]);
  }

  function reviewNext(entry, action, todayISO) {
    if (action === 'again') return { intervalStep: 0, nextReviewOn: addDays(todayISO, INTERVALS[0]) };
    const step = Math.min((entry ? entry.intervalStep : 0) + 1, INTERVALS.length - 1);
    return { intervalStep: step, nextReviewOn: addDays(todayISO, INTERVALS[step]) };
  }

  function dueReviews(memorized, reviewMap, todayISO) {
    const today = dayNum(todayISO);
    const due = [];
    for (const id of Object.keys(memorized || {})) {
      const r = reviewMap && reviewMap[id];
      const on = r && r.nextReviewOn ? r.nextReviewOn : firstReviewOn(memorized[id]);
      if (dayNum(on) <= today) due.push({ id, on: dayNum(on) });
    }
    return due.sort((a, b) => a.on - b.on).map(x => x.id);
  }

  function progressCount(memorized, validIds) {
    return Object.keys(normalizeMemorized(memorized, validIds)).length;
  }

  return { TOTAL_WEEKS, INTERVALS, listVerses, weekState, normalizeMemorized, sameMemorized,
    words, chunkTexts, hintText, reviewNext, firstReviewOn, dueReviews, progressCount, addDays };
});
