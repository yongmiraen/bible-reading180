// 성경암송 72구절 화면 — 이번 주 · 전체 72 · 조원 현황 + 연습 카드 + 복습
// 설계: docs/superpowers/specs/2026-11-23-memorize-72-design.md (6장)
// 의존: MEMORIZE72, MemorizeLogic, app.js(state, volatile, MEMO_IDS, toggleMemorized, render, renderFromSync,
//       verseFontSize, bibleDict, escapeHtml, toast, todayLocalISO, isGroupOwner, isGoogleLinked, saveState, Groups)

const MEMO_SOURCE = '출처: 사랑의교회 성경암송 72구절 (네비게이토)';
const MEMO_VERSES = window.MemorizeLogic.listVerses(window.MEMORIZE72);
const MEMO_BY_ID = Object.fromEntries(MEMO_VERSES.map(v => [v.id, v]));
const MEMO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 화면 상태 — 동기화로 다시 그려도 유지 (volatile에 둠)
volatile.memo = volatile.memo || {
  tab: null,              // null이면 주차 상태로 기본 탭 결정
  cards: {},              // 카드별 연습 상태 { [key]: { mode, chunk, revealed, chunked } }, key = '<scope>:<id>'
  allOpen: null,          // 전체 72 탭에서 펼친 연습 카드 id
  expandedSets: new Set(), expandedMember: null,
  reviewing: null,        // 복습 중인 구절 id
  speakingKey: null,      // 듣기 재생 중인 카드
};

function memoState() { return volatile.memo; }
function memoCard(key) {
  const c = memoState().cards;
  return c[key] || (c[key] = { mode: 'read', chunk: 0, revealed: 0, chunked: false });
}
function memoText(v) {
  const g = bibleDict('GAE');
  return v.keys.map(k => (g[k] || '').trim()).join(' ');
}
function memoStartDate() {
  const d = state.mode === 'group' ? (volatile.groupData && volatile.groupData.memoStart) : state.memoStartSolo;
  return d && MEMO_DATE_RE.test(d) ? d : null;
}
function memoWeek() { return MemorizeLogic.weekState(memoStartDate(), todayLocalISO()); }
function memoTopicVerses(topicIndex) { return MEMO_VERSES.filter(v => v.topicIndex === topicIndex); }
function memoMonthDay(iso) { const [, m, d] = iso.split('-').map(Number); return `${m}월 ${d}일`; }

// === 듣기 (기기 내장 한국어 음성이 있을 때만, 본문이 보일 때만) ===
function memoKoVoice() {
  const s = window.speechSynthesis;
  if (!s || typeof s.getVoices !== 'function') return null;
  try { return (s.getVoices() || []).find(v => /^ko/i.test(v.lang || '')) || null; } catch (e) { return null; }
}
function memoIsSpeaking(key) {
  const s = window.speechSynthesis;
  return !!(s && memoState().speakingKey === key && s.speaking !== false);
}
// 재생을 멈춘다 (화면 이동·부분 이동·가리기 때 호출; app.js render도 암송 화면을 떠나면 호출)
function memoStopSpeech() {
  const m = volatile.memo;
  if (m) m.speakingKey = null;
  try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
}
function memoSpeak(key, text) {
  const voice = memoKoVoice();
  if (!voice || typeof SpeechSynthesisUtterance === 'undefined') return;
  memoStopSpeech();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice; u.lang = voice.lang; u.rate = 0.9;
  u.onend = u.onerror = () => { if (memoState().speakingKey === key) { memoState().speakingKey = null; if (state.view === 'memorize') renderFromSync(); } };
  memoState().speakingKey = key;
  window.speechSynthesis.speak(u);
}
if (window.speechSynthesis && window.speechSynthesis.addEventListener) {
  window.speechSynthesis.addEventListener('voiceschanged', () => { if (state.view === 'memorize') renderFromSync(); });
}

// === 복습 일정 (기기에만, 계정별) ===
function memoReviewKey() { return 'memorize_review_v1_' + (volatile.userId || 'local'); }
function memoReviewMap() { try { return JSON.parse(localStorage.getItem(memoReviewKey())) || {}; } catch (e) { return {}; } }
function memoSaveReviewMap(m) { try { localStorage.setItem(memoReviewKey(), JSON.stringify(m)); } catch (e) {} }
// 외움을 해제(확정)하거나 새로 외우면 이전 복습 일정을 지운다 (app.js toggleMemorized가 호출)
function memoClearReview(id) {
  const map = memoReviewMap();
  if (map[id]) { delete map[id]; memoSaveReviewMap(map); }
}
function memoDue() {
  const memorized = MemorizeLogic.normalizeMemorized(state.memorized, MEMO_IDS);
  return MemorizeLogic.dueReviews(memorized, memoReviewMap(), todayLocalISO());
}

// === 연습 카드 ===
// scope: 'main'(이번 주·전체 72) | 'review'(복습) — 같은 구절이라도 복습 카드는 상태를 따로 가진다
function renderMemoCard(v, scope) {
  scope = scope || 'main';
  const key = `${scope}:${v.id}`;
  const c = memoCard(key);
  const text = memoText(v);
  const parts = MemorizeLogic.chunkTexts(text, v.chunks);
  const chunked = c.chunked && parts.length > 1;
  const partText = chunked ? parts[Math.min(c.chunk, parts.length - 1)] : text;
  const done = !!state.memorized[v.id];
  const speaking = memoIsSpeaking(key);
  const tts = c.mode === 'read' && memoKoVoice();
  const hintMax = MemorizeLogic.words(partText).length;
  const btn = (a, label, cls, extra) => `<button class="memo-btn ${cls || ''}" data-act="${a}" ${extra || ''}>${label}</button>`;
  return `
    <div class="memo-card ${scope === 'review' ? 'review' : ''}" data-id="${escapeHtml(v.id)}" data-key="${escapeHtml(key)}">
      <div class="memo-card-head">
        <div>
          <div class="memo-topic">${escapeHtml(v.setId)}. ${escapeHtml(v.setTitle)} — ${escapeHtml(v.topicTitle)}</div>
          <div class="memo-ref">${escapeHtml(v.label)}${chunked ? ` <span class="memo-part">${c.chunk + 1} / ${parts.length} 부분</span>` : ''}</div>
        </div>
        ${tts ? btn('tts', speaking ? '■ 정지' : '🔊 듣기', 'ghost small', `aria-pressed="${speaking}"`) : ''}
      </div>
      ${c.mode === 'read'
        ? `<div class="memo-text" style="--verse-size:${verseFontSize()}px">${escapeHtml(partText)}</div>
           <p class="memo-guide">주소 → 본문 → 주소 순서로 말해 보세요</p>
           <div class="memo-actions">
             ${btn('hide', '가리고 말하기', 'primary-btn')}
             ${v.chunks && !chunked ? btn('chunk', '나눠 연습') : ''}
           </div>`
        : `<div class="memo-hidden" aria-live="polite">
             <p>본문을 떠올려 말해 보세요. 막히면 힌트를 누르세요.</p>
             ${c.revealed > 0 ? `<p class="memo-hint" style="--verse-size:${verseFontSize()}px">${escapeHtml(MemorizeLogic.hintText(partText, c.revealed))}</p>` : ''}
           </div>
           <div class="memo-actions">
             ${btn('hint', '힌트', '', c.revealed >= hintMax ? 'disabled' : '')}
             ${btn('show', '본문 보기')}
             ${btn('rehide', '다시 가리기')}
           </div>`}
      ${chunked ? `<div class="memo-actions">
          <button class="memo-btn" data-act="prev" ${c.chunk === 0 ? 'disabled' : ''}>‹ 이전 부분</button>
          <button class="memo-btn" data-act="next" ${c.chunk >= parts.length - 1 ? 'disabled' : ''}>다음 부분 ›</button>
        </div>
        <div class="memo-actions">${btn('whole', '처음부터 말하기')}</div>` : ''}
      ${scope === 'review'
        ? `<div class="memo-actions memo-review-actions">${btn('review-done', '복습 마치기', 'primary-btn')}${btn('review-again', '내일 다시')}</div>`
        : `<button class="memo-mem ${done ? 'done' : ''}" data-act="mem" aria-pressed="${done}">${done ? '✓ 외웠어요 · 누르면 취소' : '○ 외웠어요'}</button>`}
    </div>`;
}

// === 탭: 이번 주 ===
function renderMemoWeek() {
  const w = memoWeek();
  const isOwner = state.mode === 'group' && typeof isGroupOwner === 'function' && isGroupOwner();
  let status = '', body = '';
  if (w.status === 'unset') {
    if (state.mode === 'group') {
      status = isOwner ? '조 암송 시작일을 정하면 매주 2구절씩 함께 외워요' : '조장이 암송 시작일을 정하면 이번 주 구절이 표시돼요';
      body = isOwner ? renderMemoStartControl() : `<button class="memo-btn" data-act="go-all">전체 72구절 보며 연습하기</button>`;
    } else {
      status = '시작하면 매주 2구절씩, 36주 동안 72구절을 외워요';
      body = `<button class="primary memo-start" id="memoSoloStart">오늘부터 암송 시작하기</button>`;
    }
  } else if (w.status === 'future') {
    status = `${memoMonthDay(memoStartDate())}부터 시작해요 · 1주차 미리 보기`;
    body = memoTopicVerses(0).map(v => renderMemoCard(v)).join('');
  } else if (w.status === 'done') {
    status = `72구절 한 바퀴를 마쳤어요 · 외운 구절 ${MemorizeLogic.progressCount(state.memorized, MEMO_IDS)}/72`;
  } else {
    const vs = memoTopicVerses(w.topicIndex);
    status = `${w.week}주차 · ${vs[0].setId}. ${vs[0].setTitle} — ${vs[0].topicTitle}`;
    body = vs.map(v => renderMemoCard(v)).join('');
  }
  // 혼자 모드: 시작한 뒤에도 시작일을 바꿀 수 있게 (설계 5.3)
  const soloChange = state.mode !== 'group' && w.status !== 'unset'
    ? `<div class="memo-start-change"><p class="memo-sub-hint">시작일 바꾸기</p>${renderMemoStartControl()}</div>` : '';
  return `<p class="memo-week-status">${escapeHtml(status)}</p>${body}${renderMemoReview()}${soloChange}`;
}

function renderMemoStartControl() {
  const cur = memoStartDate() || todayLocalISO();
  return `<div class="memo-start-row">
      <label>암송 시작일 <input type="date" id="memoStartInput" value="${escapeHtml(cur)}"></label>
      <button class="memo-btn primary-btn" id="memoStartSave">저장</button>
    </div>`;
}

function renderMemoReview() {
  const m = memoState();
  if (m.reviewing && MEMO_BY_ID[m.reviewing] && state.memorized[m.reviewing]) {
    return `<h3 class="memo-sub">복습</h3>${renderMemoCard(MEMO_BY_ID[m.reviewing], 'review')}`;
  }
  if (!memoDue().length) return '';
  return `<button class="memo-review-btn" id="memoReviewBtn">🔁 복습할 구절이 있어요 · 1구절 복습하기</button>`;
}

// === 탭: 전체 72 ===
function renderMemoAll() {
  const m = memoState();
  const w = memoWeek();
  return window.MEMORIZE72.sets.map(set => {
    const vs = MEMO_VERSES.filter(v => v.setId === set.id);
    const n = vs.filter(v => state.memorized[v.id]).length;
    const open = m.expandedSets.has(set.id) || (w.status === 'active' && vs.some(v => v.topicIndex === w.topicIndex));
    const items = open ? vs.map(v => {
      const thisWeek = w.status === 'active' && v.topicIndex === w.topicIndex;
      return m.allOpen === v.id
        ? renderMemoCard(v)
        : `<button class="memo-item ${thisWeek ? 'this-week' : ''}" data-id="${escapeHtml(v.id)}">
             <span class="memo-item-check">${state.memorized[v.id] ? '✓' : '○'}</span>
             <span><b>${escapeHtml(v.label)}</b><small>${escapeHtml(v.topicTitle)}${thisWeek ? ' · 이번 주' : ''}</small></span>
           </button>`;
    }).join('') : '';
    return `<div class="memo-set" data-set="${set.id}">
        <button class="memo-set-head" aria-expanded="${open}"><span>${set.id}. ${escapeHtml(set.title)}</span><span class="memo-set-count">${n} / 12</span></button>
        ${items}
      </div>`;
  }).join('');
}

// === 탭: 조원 현황 ===
function renderMemoBoard() {
  const m = memoState();
  const w = memoWeek();
  const weekVs = w.status === 'active' ? memoTopicVerses(w.topicIndex) : [];
  const isOwner = typeof isGroupOwner === 'function' && isGroupOwner();
  const rows = (volatile.members || []).map(mb => {
    const mm = MemorizeLogic.normalizeMemorized(mb.memorized, MEMO_IDS);
    return { mb, mm, n: Object.keys(mm).length };
  }).sort((a, b) => b.n - a.n);
  const body = rows.map(({ mb, mm, n }) => {
    const open = m.expandedMember === mb.uid;
    const detail = open ? `<div class="memo-member-detail">${window.MEMORIZE72.sets.map(set => {
      const vs = MEMO_VERSES.filter(v => v.setId === set.id);
      const k = vs.filter(v => mm[v.id]).length;
      return `<div class="memo-member-set"><b>${set.id}. ${escapeHtml(set.title)}</b> ${k}/12
        <div class="memo-member-verses">${vs.map(v => `<span class="${mm[v.id] ? 'on' : ''}">${mm[v.id] ? '✓' : '○'} ${escapeHtml(v.label)}</span>`).join('')}</div></div>`;
    }).join('')}</div>` : '';
    return `<div class="memo-member ${mb.uid === volatile.userId ? 'me' : ''}" data-uid="${escapeHtml(mb.uid)}">
        <button class="memo-member-head" aria-expanded="${open}">
          <span class="memo-member-name">${escapeHtml(mb.displayName || '익명')}${mb.uid === volatile.userId ? ' <span class="you-tag">나</span>' : ''}</span>
          <span class="memo-member-week">${weekVs.map(v => (mm[v.id] ? '✓' : '○')).join(' ')}</span>
          <span class="memo-member-count">${n} / 72</span>
        </button>
        ${detail}
      </div>`;
  }).join('');
  return `${isOwner ? renderMemoStartControl() : ''}
    <p class="memo-week-status">${weekVs.length ? `이번 주(${w.week}주차): ${weekVs.map(v => escapeHtml(v.label)).join(', ')}` : '조원별 외운 구절'}</p>
    ${body || '<p class="hint">조원 정보를 불러오는 중이에요</p>'}`;
}

// === 화면 ===
function memoTabs() {
  const tabs = [['week', '이번 주'], ['all', '전체 72']];
  if (state.mode === 'group' && state.groupId) tabs.push(['board', '조원 현황']);
  return tabs;
}
function renderMemorize() {
  const m = memoState();
  const w = memoWeek();
  const tabs = memoTabs();
  const def = w.status === 'done' ? 'all' : 'week';
  // 지금 보일 수 없는 탭(예: 혼자 모드의 조원 현황)이 남아 있으면 기본 탭으로
  const tab = m.tab && tabs.some(t => t[0] === m.tab) ? m.tab : def;
  const total = MemorizeLogic.progressCount(state.memorized, MEMO_IDS);
  return `
    ${renderHeader()}
    <div class="memo-screen">
      <div class="memo-top">
        <button class="back-btn" id="backBtn">← 돌아가기</button>
        <span class="memo-total">외운 구절 ${total} / 72</span>
      </div>
      <h2 class="memo-title">📖 성경암송 72구절</h2>
      ${w.status === 'done' ? `<p class="memo-done">🎉 72구절 한 바퀴를 마쳤어요 · 외운 구절 ${total}/72</p>` : ''}
      <div class="memo-tabs" role="group" aria-label="암송 보기">
        ${tabs.map(([k, l]) => `<button class="memo-tab ${tab === k ? 'active' : ''}" data-tab="${k}" aria-pressed="${tab === k}">${l}</button>`).join('')}
      </div>
      <div class="memo-body">
        ${tab === 'week' ? renderMemoWeek() : tab === 'all' ? renderMemoAll() : renderMemoBoard()}
      </div>
      <p class="memo-source">${MEMO_SOURCE}</p>
    </div>`;
}

function bindMemorize() {
  const m = memoState();
  const $ = id => document.getElementById(id);
  if ($('backBtn')) $('backBtn').onclick = () => { state.view = 'main'; saveState(); render(); };
  if ($('listBtn')) $('listBtn').onclick = () => { state.view = 'list'; saveState(); render(); };
  if ($('settingsBtn')) $('settingsBtn').onclick = () => { state.view = 'settings'; saveState(); render(); };
  if ($('membersBtn')) $('membersBtn').onclick = () => { state.view = 'members'; saveState(); render(); };
  document.querySelectorAll('.memo-tab').forEach(b => b.onclick = () => { m.tab = b.dataset.tab; memoStopSpeech(); render(); });
  if ($('memoSoloStart')) $('memoSoloStart').onclick = () => memoSaveSoloStart(todayLocalISO(), '암송을 시작했어요. 이번 주 2구절부터 함께 외워요');
  if ($('memoStartSave')) $('memoStartSave').onclick = async () => {
    const v = $('memoStartInput').value;
    if (!MEMO_DATE_RE.test(v)) { alert('날짜를 선택해주세요'); return; }
    if (state.mode !== 'group') { memoSaveSoloStart(v, '암송 시작일을 바꿨어요'); return; }
    try {
      await Groups.setMemoStart(state.groupId, v);
      if (volatile.groupData) volatile.groupData.memoStart = v;
      toast('암송 시작일을 저장했어요'); m.tab = null; render();
    } catch (e) { alert('저장하지 못했어요. 조장만 바꿀 수 있어요. (' + (e.code || e.message) + ')'); }
  };
  if ($('memoReviewBtn')) $('memoReviewBtn').onclick = () => {
    const id = memoDue()[0]; if (!id) return;
    m.reviewing = id;
    m.cards[`review:${id}`] = { mode: 'hidden', chunk: 0, revealed: 0, chunked: false }; // 주소부터 떠올리기
    render();
  };
  document.querySelectorAll('.memo-set-head').forEach(b => b.onclick = () => {
    const id = b.closest('.memo-set').dataset.set;
    if (m.expandedSets.has(id)) m.expandedSets.delete(id); else m.expandedSets.add(id);
    render();
  });
  document.querySelectorAll('.memo-item').forEach(b => b.onclick = () => { m.allOpen = b.dataset.id; render(); });
  document.querySelectorAll('.memo-member-head').forEach(b => b.onclick = () => {
    const uid = b.closest('.memo-member').dataset.uid;
    m.expandedMember = m.expandedMember === uid ? null : uid; render();
  });
  document.querySelectorAll('.memo-card [data-act]').forEach(b => b.onclick = () => {
    const cardEl = b.closest('.memo-card');
    memoCardAction(cardEl.dataset.key, cardEl.dataset.id, b.dataset.act);
  });
  document.querySelectorAll('.memo-body > [data-act="go-all"]').forEach(b => b.onclick = () => { m.tab = 'all'; render(); });
  bindModeToggle();
}

// 혼자 모드 시작일 저장 — 클라우드 저장이 실패하면 이전 날짜로 되돌린다
async function memoSaveSoloStart(dateISO, okMsg) {
  const prev = state.memoStartSolo;
  state.memoStartSolo = dateISO; saveState(); memoState().tab = null; render();
  if (!volatile.userId || !isGoogleLinked()) { toast(okMsg); return; }
  const ok = await Groups.saveProfile(volatile.userId, { memoStart: dateISO });
  if (ok === false) {
    state.memoStartSolo = prev; saveState(); render();
    toast('저장하지 못했어요. 인터넷 연결을 확인해주세요');
  } else toast(okMsg);
}

function memoCardAction(key, id, a) {
  const m = memoState();
  const v = MEMO_BY_ID[id]; if (!v) return;
  if (a === 'mem') {
    const was = !!state.memorized[id];
    toggleMemorized(id).then(r => {
      if (r && r.ok) toast(was ? `${v.label} 외움 표시를 취소했어요` : `${v.label} 외웠어요 ✓`);
    });
    return;
  }
  const c = memoCard(key);
  const parts = MemorizeLogic.chunkTexts(memoText(v), v.chunks);
  const partText = c.chunked ? parts[Math.min(c.chunk, parts.length - 1)] : parts.join(' ');
  if (a === 'tts') {
    if (memoIsSpeaking(key)) memoStopSpeech(); else memoSpeak(key, partText);
    render();
    return;
  }
  if (m.speakingKey === key) memoStopSpeech(); // 카드 상태가 바뀌면 재생 중지
  if (a === 'hide') { c.mode = 'hidden'; c.revealed = 0; }
  else if (a === 'show') { c.mode = 'read'; }
  else if (a === 'rehide') { c.mode = 'hidden'; c.revealed = 0; }
  else if (a === 'hint') { c.revealed = Math.min(c.revealed + 1, MemorizeLogic.words(partText).length); }
  else if (a === 'chunk') { c.chunked = true; c.chunk = 0; c.mode = 'read'; c.revealed = 0; }
  else if (a === 'next') { c.chunk = Math.min(c.chunk + 1, parts.length - 1); c.revealed = 0; c.mode = 'read'; }
  else if (a === 'prev') { c.chunk = Math.max(c.chunk - 1, 0); c.revealed = 0; c.mode = 'read'; }
  else if (a === 'whole') { c.chunked = false; c.chunk = 0; c.mode = 'hidden'; c.revealed = 0; }
  else if (a === 'review-done' || a === 'review-again') {
    const map = memoReviewMap();
    map[id] = MemorizeLogic.reviewNext(map[id] || null, a === 'review-done' ? 'done' : 'again', todayLocalISO());
    memoSaveReviewMap(map);
    m.reviewing = null; delete m.cards[key];
    toast(a === 'review-done' ? '복습을 마쳤어요 👍' : '내일 다시 보여드릴게요');
  }
  render();
}

// === 메인(통독) 화면 카드 ===
function renderMemoWeekCard() {
  const w = memoWeek();
  const n = MemorizeLogic.progressCount(state.memorized, MEMO_IDS);
  let txt;
  if (w.status === 'unset') txt = state.mode === 'group' ? '조장이 시작일을 정하면 함께 시작해요' : '성경암송 72구절 시작하기';
  else if (w.status === 'future') txt = `${memoMonthDay(memoStartDate())} 시작 · 1주차 미리 보기`;
  else if (w.status === 'done') txt = `72구절 한 바퀴 완료 · 외운 구절 ${n}/72`;
  else {
    const vs = memoTopicVerses(w.topicIndex);
    const k = vs.filter(v => state.memorized[v.id]).length;
    txt = `${w.week}주차 · ${vs[0].label} 외 1 · ${k}/2 외움`;
  }
  return `<button class="memo-week-card" id="memoWeekCard"><span>📖 암송</span><span>${escapeHtml(txt)}</span><span aria-hidden="true">›</span></button>`;
}

// 헤더 '암송' 버튼·메인 카드 (모든 화면 공통, 위임)
document.addEventListener('click', e => {
  if (e.target.closest && e.target.closest('#memoBtn, #memoWeekCard')) {
    state.view = 'memorize'; saveState(); render();
  }
});
