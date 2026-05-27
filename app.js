// 성경 통독 앱 (180일) — Firebase 그룹 동기화 포함
// 데이터: window.BIBLE, window.SCHEDULE, window.BOOK_NAMES, window.Groups

// Firebase Analytics 이벤트 기록 (Groups 초기화 후 사용 가능)
function logEvent(name, params) {
  try {
    if (window.firebase && firebase.app().options) {
      firebase.analytics().logEvent(name, params || {});
    }
  } catch(e) {}
}

let TOTAL_DAYS = 180;
let SCHEDULE = window.SCHEDULE;
const STORAGE_KEY = 'bible180_state_v2';
const SITE_URL = location.origin + location.pathname;
function inviteLink(code) { return `${SITE_URL}?join=${code}`; }
const FEEDBACK_ENDPOINT = 'https://formspree.io/f/mdajorvp';

// === 장별 마지막 절 캐시 ===
const CHAPTER_LENGTHS = {};
(function () {
  const ref = (window.BIBLES && window.BIBLES.GAE) || window.BIBLE || {};
  for (const key in ref) {
    const m = key.match(/^(.+?)(\d+):(\d+)$/);
    if (!m) continue;
    const ck = m[1] + ':' + m[2];
    const v = +m[3];
    if (!CHAPTER_LENGTHS[ck] || v > CHAPTER_LENGTHS[ck]) CHAPTER_LENGTHS[ck] = v;
  }
})();

// 번역본 라벨
const VERSION_LABEL = { GAE: '개역개정', SAENEW: '새번역', NIV: 'NIV', ESV: 'ESV' };
const VERSION_TAG   = { GAE: '개역',     SAENEW: '새번역',  NIV: 'NIV', ESV: 'ESV' };
const VERSION_ORDER = ['GAE', 'SAENEW', 'NIV', 'ESV'];
function bibleDict(v) { return (window.BIBLES && window.BIBLES[v]) || window.BIBLE || {}; }
function sortVersions(arr) {
  return [...arr].sort((a,b) => VERSION_ORDER.indexOf(a) - VERSION_ORDER.indexOf(b));
}

// === 상태 ===
const defaultState = () => ({
  plan: null,           // '180' | '365' | null
  mode: null,           // 'solo' | 'group' | null
  startDate: null,      // solo mode
  groupName: '',        // solo mode (라벨용)
  groupId: null,        // group mode (초대 코드)
  displayName: '',      // group mode 본인 이름
  readDays: {},
  viewDay: null,
  view: 'main',
  bibleView: ['GAE'],   // 선택된 번역 배열 (1~2개). 가능: 'GAE','SAENEW','NIV'
});

// 이전 버전 호환: 문자열이면 배열로 변환
function normalizeBibleView(v) {
  if (Array.isArray(v)) return v.length ? v.slice(0, 2) : ['GAE'];
  if (v === 'BOTH') return ['GAE', 'SAENEW'];
  if (v === 'GAE' || v === 'SAENEW' || v === 'NIV') return [v];
  return ['GAE'];
}

function applyPlan(plan) {
  if (plan === '365') {
    SCHEDULE = window.SCHEDULE_365;
    TOTAL_DAYS = 365;
  } else {
    SCHEDULE = window.SCHEDULE;
    TOTAL_DAYS = 180;
  }
}

function convertReadDays(readDays, fromPlan, toPlan) {
  const s365 = window.SCHEDULE_365;
  const converted = {};

  if (fromPlan === '180' && toPlan === '365') {
    for (const dayStr in readDays) {
      if (!readDays[dayStr]) continue;
      const day180 = +dayStr;
      const matching = s365.filter(d => d.src === day180);
      matching.forEach(d => { converted[d.d] = true; });
    }
  } else if (fromPlan === '365' && toPlan === '180') {
    const srcGroups = {};
    s365.forEach(d => {
      if (!srcGroups[d.src]) srcGroups[d.src] = [];
      srcGroups[d.src].push(d.d);
    });
    for (const src in srcGroups) {
      const days365 = srcGroups[src];
      const allRead = days365.every(d => readDays[d]);
      if (allRead) converted[+src] = true;
    }
  }

  return converted;
}

let state = loadState();
applyPlan(state.plan);
let volatile = {
  groupData: null,      // {name, startDate, owner, createdAt}
  members: [],          // [{uid, displayName, readDays, ...}]
  syncStatus: 'idle',   // 'idle' | 'syncing' | 'error'
  authReady: false,
  userId: null,
};
let pendingInviteCode = null;
let lastInviteCode = null;
let soloUnsub = null;

// Google 로그인 여부
function isGoogleLinked() {
  const info = Groups.getUserInfo ? Groups.getUserInfo() : null;
  return !!(info && !info.isAnonymous && info.googleEmail);
}

// 혼자 모드 Firestore 구독
function subscribeSolo() {
  if (soloUnsub) { soloUnsub(); soloUnsub = null; }
  if (!volatile.userId || !isGoogleLinked()) return;
  soloUnsub = Groups.watchSoloData(volatile.userId, (data) => {
    if (!data) return;
    let changed = false;
    if (data.plan && data.plan !== state.plan) {
      state.plan = data.plan;
      applyPlan(data.plan);
      changed = true;
    }
    if (data.startDate && data.startDate !== state.startDate) {
      state.startDate = data.startDate; changed = true;
    }
    if (data.groupName !== undefined && data.groupName !== state.groupName) {
      state.groupName = data.groupName; changed = true;
    }
    if (data.readDays) {
      const filtered = {};
      for (const k in data.readDays) {
        if (data.readDays[k] && +k >= 1 && +k <= TOTAL_DAYS) filtered[k] = true;
      }
      if (JSON.stringify(filtered) !== JSON.stringify(state.readDays)) {
        state.readDays = filtered; changed = true;
      }
    }
    if (changed) { saveState(); render(); }
  });
}

// 혼자 모드 Firestore에 현재 상태 저장
function pushSoloData(patch) {
  if (state.mode !== 'solo' || !isGoogleLinked() || !volatile.userId) return;
  const data = { plan: state.plan, ...patch };
  Groups.saveSoloData(volatile.userId, data).catch(e => console.error('solo save:', e));
}

function loadState() {
  let s;
  try { s = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) {}
  if (!s || typeof s !== 'object') {
    try {
      const old = JSON.parse(localStorage.getItem('bible180_state_v1'));
      if (old && typeof old === 'object') {
        s = Object.assign({}, old);
        if (s.startDate) s.mode = 'solo';
      }
    } catch (e) {}
  }
  const merged = Object.assign(defaultState(), s || {});
  merged.bibleView = normalizeBibleView(merged.bibleView);
  if (!merged.plan && merged.mode) merged.plan = '180';
  return merged;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// === 날짜/일수 계산 ===
function todayLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function effectiveStartDate() {
  if (state.mode === 'group' && volatile.groupData) return volatile.groupData.startDate;
  return state.startDate;
}

function effectiveTitle() {
  if (state.mode === 'group' && volatile.groupData) return volatile.groupData.name;
  return state.groupName;
}

function calcCurrentDay() {
  const sd = effectiveStartDate();
  if (!sd) return null;
  const start = new Date(sd + 'T00:00:00');
  const today = new Date(todayLocalISO() + 'T00:00:00');
  return Math.floor((today - start) / 86400000) + 1;
}

function getViewDay() {
  return state.viewDay != null ? state.viewDay : calcCurrentDay();
}

function getDay(n) { return SCHEDULE.find(d => d.d === n); }

// === 본문 ===
function chapterMax(book, ch) { return CHAPTER_LENGTHS[book + ':' + ch] || 0; }
function chapterLabel(book, ch) { return (book === '시') ? `${ch}편` : `${ch}장`; }

// 각 절을 순회하면서 모든 번역본+소제목을 콜백에 전달
function eachVerseInRange(range, cb) {
  const [book, sc, sv, ec, ev] = range;
  const dicts = { GAE: bibleDict('GAE'), SAENEW: bibleDict('SAENEW'), NIV: bibleDict('NIV'), ESV: bibleDict('ESV') };
  const subs = window.SUBTITLES || {};
  for (let ch = sc; ch <= ec; ch++) {
    let s, e;
    if (ch === sc && ch === ec) { s = sv; e = ev || chapterMax(book, ch); }
    else if (ch === sc) { s = sv; e = chapterMax(book, ch); }
    else if (ch === ec) { s = 1; e = ev || chapterMax(book, ch); }
    else { s = 1; e = chapterMax(book, ch); }
    if (!e) e = 200;
    for (let v = s; v <= e; v++) {
      const key = `${book}${ch}:${v}`;
      const gae = dicts.GAE[key];
      if (!gae) break;
      cb(book, ch, v, {
        GAE: gae.trim(),
        SAENEW: (dicts.SAENEW[key] || '').trim(),
        NIV: (dicts.NIV[key] || '').trim(),
        ESV: (dicts.ESV[key] || '').trim(),
        sub: subs[key] || null,
      });
    }
  }
}

function renderRangesHTML(ranges) {
  const view = sortVersions(normalizeBibleView(state.bibleView));
  const isCompare = view.length > 1;
  const parts = [];
  for (const range of ranges) {
    const book = range[0];
    const fullBook = BOOK_NAMES[book] || book;
    parts.push(`<div class="passage-block"><h3 class="book-title">${fullBook}</h3>`);
    let curCh = null, chBuf = [], chHeader = null;
    let lastSubKey = null;
    eachVerseInRange(range, (b, ch, v, d) => {
      if (ch !== curCh) {
        if (chBuf.length) parts.push(`<div class="chapter"><h4 class="ch-title">${chHeader}</h4>${chBuf.join('')}</div>`);
        chBuf = []; curCh = ch; chHeader = chapterLabel(b, ch);
        lastSubKey = null;
      }
      // 소제목 (한국어 번역에만 있음) — 연속 중복 제거
      if (d.sub) {
        const koVers = view.filter(x => x === 'GAE' || x === 'SAENEW');
        let subKey = null, subHtml = null;
        if (koVers.length === 1) {
          const s = d.sub[koVers[0]];
          if (s) {
            subKey = koVers[0] + '\n' + s;
            subHtml = `<div class="subtitle">${escapeHtml(s)}</div>`;
          }
        } else if (koVers.length === 2) {
          const a = d.sub.GAE, c = d.sub.SAENEW;
          if (a || c) {
            subKey = (a||'') + '|' + (c||'');
            const subLines = [];
            if (a) subLines.push(`<span class="sub-line gae">${escapeHtml(a)}</span>`);
            if (c) subLines.push(`<span class="sub-line saenew">${escapeHtml(c)}</span>`);
            subHtml = `<div class="subtitle compare">${subLines.join('')}</div>`;
          }
        }
        if (subKey && subKey !== lastSubKey) {
          chBuf.push(subHtml);
          lastSubKey = subKey;
        }
      }
      // 본문
      if (isCompare) {
        const verseLines = view.map(ver => {
          const text = d[ver];
          if (!text) return '';
          return `<p class="ver-line ${ver.toLowerCase()}"><span class="ver-tag">${VERSION_TAG[ver]}</span>${escapeHtml(text)}</p>`;
        }).filter(Boolean).join('');
        chBuf.push(`<div class="verse-compare"><span class="vnum">${v}</span>${verseLines}</div>`);
      } else {
        const text = d[view[0]] || d.GAE;
        chBuf.push(`<p class="verse"><span class="vnum">${v}</span>${escapeHtml(text)}</p>`);
      }
    });
    if (chBuf.length) parts.push(`<div class="chapter"><h4 class="ch-title">${chHeader}</h4>${chBuf.join('')}</div>`);
    parts.push('</div>');
  }
  return parts.join('');
}

function rangesToText(ranges) {
  const view = sortVersions(normalizeBibleView(state.bibleView));
  const isCompare = view.length > 1;
  const lines = [];
  for (const range of ranges) {
    const book = range[0];
    const fullBook = BOOK_NAMES[book] || book;
    let curCh = null;
    eachVerseInRange(range, (b, ch, v, d) => {
      if (ch !== curCh) {
        if (lines.length) lines.push('');
        lines.push(`〈${fullBook} ${chapterLabel(b, ch)}〉`);
        curCh = ch;
      }
      if (isCompare) {
        view.forEach((ver, i) => {
          const text = d[ver];
          if (!text) return;
          const prefix = i === 0 ? `${v}. ` : '   ';
          lines.push(`${prefix}[${VERSION_TAG[ver]}] ${text}`);
        });
      } else {
        const text = d[view[0]] || d.GAE;
        lines.push(`${v}. ${text}`);
      }
    });
    lines.push('');
  }
  return lines.join('\n').trim();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

// Microsoft Fluent Emoji 3D — MIT 라이선스
// 이름은 폴더명 그대로, 파일은 소문자+언더스코어
const FLUENT_BASE = 'https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/assets/';
function emoji3d(name, sizeClass = 'md', alt = '') {
  const file = name.toLowerCase().replace(/ /g, '_') + '_3d.png';
  const url = FLUENT_BASE + encodeURIComponent(name) + '/3D/' + file;
  return `<img class="emoji-3d ${sizeClass}" src="${url}" alt="${escapeHtml(alt)}" loading="lazy">`;
}

function relativeTime(ts) {
  if (!ts) return '활동 기록 없음';
  let date;
  try { date = ts.toDate ? ts.toDate() : (ts.seconds ? new Date(ts.seconds*1000) : new Date(ts)); }
  catch (e) { return ''; }
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return '방금 전';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return '방금 전';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}일 전`;
  if (days < 30) return `${Math.floor(days/7)}주 전`;
  return `${Math.floor(days/30)}달 전`;
}

function countReadDays(readDays, total) {
  if (!readDays) return 0;
  const max = total || TOTAL_DAYS;
  return Object.keys(readDays).filter(k => readDays[k] && +k >= 1 && +k <= max).length;
}

// === 진도 토글 (자동 동기화) ===
function toggleRead(day) {
  const wasRead = !!state.readDays[day];
  if (wasRead) delete state.readDays[day];
  else state.readDays[day] = true;
  saveState();
  toast(wasRead ? `Day ${day} 읽음 표시를 취소했어요` : `Day ${day} 읽음 완료 ✓`);
  if (!wasRead) logEvent('mark_read', { day, mode: state.mode });
  if (state.mode === 'group' && state.groupId) {
    volatile.syncStatus = 'syncing';
    Groups.setReadDays(state.groupId, state.readDays)
      .then(() => { volatile.syncStatus = 'idle'; render(); })
      .catch(e => { volatile.syncStatus = 'error'; console.error('sync', e); render(); });
  } else if (state.mode === 'solo') {
    pushSoloData({ readDays: state.readDays });
  }
}

// === 그룹 구독 ===
function subscribeToGroup() {
  if (!state.groupId) return;
  Groups.subscribeGroup(state.groupId,
    (groupData) => {
      if (!groupData) {
        toast('이 조는 더 이상 존재하지 않아요');
        exitGroup();
        return;
      }
      volatile.groupData = groupData;
      render();
    },
    (members) => {
      volatile.members = members;
      const me = members.find(m => m.uid === volatile.userId);
      if (me && me.readDays) {
        const filtered = {};
        for (const k in me.readDays) {
          if (me.readDays[k] && +k >= 1 && +k <= TOTAL_DAYS) filtered[k] = true;
        }
        state.readDays = filtered;
        saveState();
      }
      render();
    }
  );
}

function exitGroup() {
  Groups.unsubscribe();
  state = defaultState();
  saveState();
  volatile.groupData = null;
  volatile.members = [];
  render();
}

// === 초기화 ===
async function init() {
  const params = new URLSearchParams(location.search);
  const joinCode = params.get('join');
  if (joinCode) {
    pendingInviteCode = joinCode.toUpperCase();
    history.replaceState(null, '', location.pathname);
  }

  try {
    const user = await Groups.authReady;
    volatile.userId = user.uid;
    volatile.authReady = true;
  } catch (e) {
    console.error('Auth failed', e);
    document.getElementById('app').innerHTML =
      '<div class="setup"><h1>📖 성경 통독</h1><p class="lead">인증 오류 — 인터넷 연결을 확인해주세요</p></div>';
    return;
  }

  if (pendingInviteCode) {
    state.view = 'join-from-link';
    render();
    return;
  }

  if (state.mode === 'group' && state.groupId) {
    subscribeToGroup();
  } else if (state.mode === 'solo' && isGoogleLinked()) {
    subscribeSolo(); // Google 연동 시 혼자 모드도 동기화
  }
  render();
}

window.addEventListener('DOMContentLoaded', init);

// === 라우터 ===
function render() {
  const app = document.getElementById('app');

  if (!volatile.authReady) {
    app.innerHTML = '<div class="setup"><h1>📖 성경 통독</h1><p class="lead">불러오는 중...</p></div>';
    return;
  }

  if (!state.plan) {
    app.innerHTML = renderPlanSelect();
    bindPlanSelect();
    return;
  }

  if (state.view === 'join-from-link' && pendingInviteCode) {
    app.innerHTML = renderJoinForm(pendingInviteCode, true);
    bindJoinForm(true);
    return;
  }

  if (!state.mode) {
    app.innerHTML = renderModeSelect();
    bindModeSelect();
    return;
  }

  if (state.mode === 'solo' && !state.startDate) {
    app.innerHTML = renderSoloSetup();
    bindSoloSetup();
    return;
  }

  if (state.mode === 'group' && !state.groupId) {
    if (state.view === 'group-create') {
      app.innerHTML = renderCreateForm();
      bindCreateForm();
    } else if (state.view === 'group-join') {
      app.innerHTML = renderJoinForm('', false);
      bindJoinForm(false);
    } else {
      app.innerHTML = renderGroupChoice();
      bindGroupChoice();
    }
    return;
  }

  if (state.view === 'invite-share') {
    app.innerHTML = renderInviteShare();
    bindInviteShare();
    return;
  }
  if (state.view === 'list') {
    app.innerHTML = renderList();
    bindList();
    scrollToToday();
    return;
  }
  if (state.view === 'settings') {
    app.innerHTML = renderSettings();
    bindSettings();
    return;
  }
  if (state.view === 'members') {
    app.innerHTML = renderMembers();
    bindMembers();
    return;
  }
  if (state.view === 'feedback') {
    app.innerHTML = renderFeedback();
    bindFeedback();
    return;
  }

  app.innerHTML = renderMain();
  bindMain();
  window.scrollTo(0, 0);
}

// === 헤더 ===
// 해당 날의 챕터 목록 (드라마바이블 영상 있는 것만)
function getDayChapters(entry) {
  if (!window.DRAMA_BIBLE || !entry.r) return [];
  const seen = new Set();
  const chapters = [];
  for (const range of entry.r) {
    const [book, sc, , ec] = range;
    const fullBook = BOOK_NAMES[book] || book;
    for (let ch = sc; ch <= ec; ch++) {
      const key = `${book}${ch}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const videoId = window.DRAMA_BIBLE[key];
      if (videoId) chapters.push({ key, label: `${fullBook} ${chapterLabel(book, ch)}`, videoId });
    }
  }
  return chapters;
}

// 사복음서 교재일(132-146): 책별로 챕터 묶기
const GOSPEL_BOOK_NAMES = { 마: '마태복음', 막: '마가복음', 눅: '누가복음', 요: '요한복음' };
const GOSPEL_BOOK_ORDER = ['마', '막', '눅', '요'];

function isGospelHarmonyDay(entry) {
  return entry.l && entry.l.startsWith('사복음서');
}

function getGospelDayBooks(entry) {
  if (!window.DRAMA_BIBLE || !entry.r) return null;
  const books = {};
  const seen = new Set();
  for (const range of entry.r) {
    const [book, sc, , ec] = range;
    if (!GOSPEL_BOOK_ORDER.includes(book)) continue;
    if (!books[book]) books[book] = [];
    const fullBook = BOOK_NAMES[book] || book;
    for (let ch = sc; ch <= ec; ch++) {
      const key = `${book}${ch}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const videoId = window.DRAMA_BIBLE[key];
      if (videoId) books[book].push({ key, label: `${fullBook} ${chapterLabel(book, ch)}`, videoId });
    }
  }
  const hasAny = Object.values(books).some(chs => chs.length > 0);
  return hasAny ? books : null;
}

function renderListenBtn(entry) {
  if (!entry.r || entry.r.length === 0) return '';
  if (!window.DRAMA_BIBLE) return '';

  if (isGospelHarmonyDay(entry)) {
    const books = getGospelDayBooks(entry);
    if (!books) return '';
    const bookLabel = GOSPEL_BOOK_ORDER.filter(b => books[b] && books[b].length)
      .map(b => GOSPEL_BOOK_NAMES[b]).join(' · ');
    return `<button class="listen-btn" onclick="openGospelPlayer()">🎧 드라마바이블 (${bookLabel})</button>`;
  }

  const chapters = getDayChapters(entry);
  if (!chapters.length) return '';
  return `<button class="listen-btn" onclick="openPlayer()">🎧 드라마바이블로 듣기 (${chapters.length}개 챕터)</button>`;
}

// 현재 날의 챕터 저장 (팝업에서 사용)
let _playerChapters = [];
let _gospelBooks = {};     // 사복음서 모드: {마:[...], 막:[...], 눅:[...], 요:[...]}
let _gospelMode = false;

window.openPlayer = function() {
  const day = getViewDay();
  const entry = getDay(day);
  if (!entry) return;
  _gospelMode = false;
  logEvent('open_drama_bible', { day });
  _playerChapters = getDayChapters(entry);
  if (!_playerChapters.length) { toast('해당 본문의 영상을 찾을 수 없어요'); return; }
  if (_playerChapters.length === 1) {
    renderPlayerOverlay(_playerChapters[0].videoId, _playerChapters[0].label, 0);
  } else {
    renderPlayerOverlay(null, null, -1);  // 챕터 선택 화면
  }
};

window.openGospelPlayer = function() {
  const day = getViewDay();
  const entry = getDay(day);
  if (!entry) return;
  _gospelMode = true;
  logEvent('open_drama_bible', { day });
  _gospelBooks = getGospelDayBooks(entry) || {};
  if (!Object.keys(_gospelBooks).length) { toast('해당 본문의 영상을 찾을 수 없어요'); return; }
  window.renderGospelBookOverlay();
};

window.renderGospelBookOverlay = function renderGospelBookOverlay() {
  let overlay = document.getElementById('yt-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'yt-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) window.closePlayer(); };
    document.body.appendChild(overlay);
  }
  const booksHtml = GOSPEL_BOOK_ORDER
    .filter(b => _gospelBooks[b] && _gospelBooks[b].length)
    .map(b => {
      const chs = _gospelBooks[b];
      return `<button class="yt-book-btn" onclick="selectGospelBook('${b}')">
        <span class="yt-book-name">${GOSPEL_BOOK_NAMES[b]}</span>
        <span class="yt-book-count">${chs.length}개 챕터</span>
      </button>`;
    }).join('');
  overlay.innerHTML = `
    <div class="yt-sheet">
      <div class="yt-header">
        <span class="yt-title">드라마바이블</span>
        <button class="yt-close" onclick="closePlayer()">✕</button>
      </div>
      <div class="yt-book-list">${booksHtml}</div>
    </div>`;
}

window.selectGospelBook = function(bookKey) {
  _playerChapters = _gospelBooks[bookKey] || [];
  if (!_playerChapters.length) return;
  if (_playerChapters.length === 1) {
    renderPlayerOverlay(_playerChapters[0].videoId, _playerChapters[0].label, 0, true);
  } else {
    renderPlayerOverlay(null, null, -1, true);
  }
};

window.closePlayer = function() {
  const el = document.getElementById('yt-overlay');
  if (el) el.remove();
};

window.playChapter = function(idx) {
  const ch = _playerChapters[idx];
  if (!ch) return;
  renderPlayerOverlay(ch.videoId, ch.label, idx, _gospelMode);
};

function renderPlayerOverlay(videoId, label, activeIdx, showBack) {
  let overlay = document.getElementById('yt-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'yt-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) window.closePlayer(); };
    document.body.appendChild(overlay);
  }

  const chipsHtml = _playerChapters.map((ch, i) =>
    `<button class="yt-ch-btn ${i===activeIdx?'playing':''}" onclick="playChapter(${i})">${ch.label}</button>`
  ).join('');

  const backBtn = showBack
    ? `<button class="yt-back" onclick="renderGospelBookOverlay()">◀ 복음서 선택</button>`
    : '';

  overlay.innerHTML = `
    <div class="yt-sheet">
      <div class="yt-header">
        ${backBtn}
        <span class="yt-title">${videoId ? label : '드라마바이블'}</span>
        <button class="yt-close" onclick="closePlayer()">✕</button>
      </div>
      ${_playerChapters.length > 1 ? `<div class="yt-chapters">${chipsHtml}</div>` : ''}
      ${videoId ? `
        <div class="yt-iframe-wrap">
          <iframe src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen></iframe>
        </div>` : `<p style="padding:16px;color:var(--muted);text-align:center">챕터를 선택해주세요</p>`}
    </div>`;
}

function renderBibleToggle() {
  const sel = new Set(normalizeBibleView(state.bibleView));
  const chip = (ver) => `<button class="${sel.has(ver)?'active':''} ver-${ver.toLowerCase()}" data-ver="${ver}">${sel.has(ver)?'✓ ':''}${VERSION_LABEL[ver]}</button>`;
  const hint = sel.size === 1 ? '하나 더 골라 비교할 수 있어요' : `${sel.size}개 비교 중`;
  return `
    <div class="bible-toggle chip" role="tablist">
      ${chip('GAE')}${chip('SAENEW')}${chip('NIV')}${chip('ESV')}
    </div>
    <div class="bible-toggle-hint">${hint}</div>`;
}

function renderHeader() {
  const title = effectiveTitle();
  return `
    <header>
      <div class="header-title">
        <h1>📖 성경 통독</h1>
        ${title ? `<div class="group-name">${escapeHtml(title)}</div>` : ''}
      </div>
      <div class="header-actions">
        ${state.mode === 'group' ? `<button class="icon-btn" id="membersBtn" title="조원">👥</button>` : ''}
        <button class="icon-btn" id="listBtn" title="전체 일정">📅</button>
        <button class="icon-btn" id="settingsBtn" title="설정">⚙️</button>
      </div>
    </header>`;
}

// === 모드 선택 ===
function renderPlanSelect() {
  return `
    <div class="setup">
      <h1>📖 성경 통독</h1>
      <p class="lead">통독 기간을 선택해주세요</p>
      <div class="mode-choice">
        <button class="mode-card" id="plan180">
          <span class="mode-icon">${emoji3d('Fire','md','180일')}</span>
          <span class="mode-text">
            <div class="mode-title">180일 통독</div>
            <div class="mode-desc">약 6개월 · 하루 평균 6장</div>
          </span>
        </button>
        <button class="mode-card" id="plan365">
          <span class="mode-icon">${emoji3d('Calendar','md','365일')}</span>
          <span class="mode-text">
            <div class="mode-title">365일 통독</div>
            <div class="mode-desc">1년 · 하루 평균 3장</div>
          </span>
        </button>
      </div>
    </div>`;
}

function bindPlanSelect() {
  document.getElementById('plan180').onclick = () => {
    state.plan = '180';
    applyPlan('180');
    saveState(); render();
  };
  document.getElementById('plan365').onclick = () => {
    state.plan = '365';
    applyPlan('365');
    saveState(); render();
  };
}

function renderModeSelect() {
  return `
    <div class="setup">
      <button class="back-btn" id="backToPlan">← 기간 선택으로</button>
      <h1>📖 성경 통독</h1>
      <p class="lead">${TOTAL_DAYS}일 동안 함께 통독해요</p>
      <div class="mode-choice">
        <button class="mode-card" id="modeSolo">
          <span class="mode-icon">${emoji3d('Slightly smiling face','md','혼자')}</span>
          <span class="mode-text">
            <div class="mode-title">혼자 사용</div>
            <div class="mode-desc">내 진도만 표시. 인터넷 없이도 사용 가능</div>
          </span>
        </button>
        <button class="mode-card" id="modeGroup">
          <span class="mode-icon">${emoji3d('Busts in silhouette','md','조와 함께')}</span>
          <span class="mode-text">
            <div class="mode-title">조와 함께</div>
            <div class="mode-desc">조원들과 진도를 공유하며 통독</div>
          </span>
        </button>
      </div>
    </div>`;
}

function bindModeSelect() {
  const backBtn = document.getElementById('backToPlan');
  if (backBtn) backBtn.onclick = () => {
    state.plan = null;
    applyPlan(null);
    saveState(); render();
  };
  document.getElementById('modeSolo').onclick = () => {
    state.mode = 'solo';
    state.view = 'main';
    saveState(); render();
  };
  document.getElementById('modeGroup').onclick = () => {
    state.mode = 'group';
    state.view = 'main';
    saveState(); render();
  };
}

// === Solo 설정 ===
function renderSoloSetup() {
  return `
    <div class="setup">
      <button class="back-btn" id="backToMode">← 모드 선택으로</button>
      <h1>🙂 혼자 사용</h1>
      <p class="lead">통독 시작일을 정해주세요</p>
      <label class="form-row">통독 시작일
        <input type="date" id="startDate" value="${todayLocalISO()}">
      </label>
      <label class="form-row">표시 이름 <span class="optional">(선택)</span>
        <input type="text" id="groupName" placeholder="예) 나의 통독" maxlength="40">
      </label>
      <button class="primary" id="startBtn">시작하기</button>
    </div>`;
}

function bindSoloSetup() {
  document.getElementById('backToMode').onclick = () => {
    state.mode = null; saveState(); render();
  };
  document.getElementById('startBtn').onclick = () => {
    const d = document.getElementById('startDate').value;
    if (!d) { alert('시작일을 선택해주세요'); return; }
    state.startDate = d;
    state.groupName = document.getElementById('groupName').value.trim();
    state.view = 'main';
    state.viewDay = null;
    saveState();
    subscribeSolo(); // Google 연동 상태면 구독 시작
    pushSoloData({ plan: state.plan, startDate: state.startDate, groupName: state.groupName, readDays: state.readDays });
    render();
  };
}

// === 그룹 선택 (만들기 vs 참가) ===
function renderGroupChoice() {
  return `
    <div class="setup">
      <button class="back-btn" id="backToMode">← 모드 선택으로</button>
      <h1>👥 조와 함께</h1>
      <p class="lead">새로 만드시겠어요, 참가하시겠어요?</p>
      <div class="mode-choice">
        <button class="mode-card" id="goCreate">
          <span class="mode-icon">${emoji3d('Sparkles','md','새 조 만들기')}</span>
          <span class="mode-text">
            <div class="mode-title">새 조 만들기</div>
            <div class="mode-desc">조장이 되어 초대 링크 생성</div>
          </span>
        </button>
        <button class="mode-card" id="goJoin">
          <span class="mode-icon">${emoji3d('Link','md','초대 참가')}</span>
          <span class="mode-text">
            <div class="mode-title">초대받은 조 참가</div>
            <div class="mode-desc">6자리 초대 코드 입력</div>
          </span>
        </button>
      </div>
    </div>`;
}

function bindGroupChoice() {
  document.getElementById('backToMode').onclick = () => {
    state.mode = null; saveState(); render();
  };
  document.getElementById('goCreate').onclick = () => {
    state.view = 'group-create'; saveState(); render();
  };
  document.getElementById('goJoin').onclick = () => {
    state.view = 'group-join'; saveState(); render();
  };
}

// === 조 만들기 폼 ===
function renderCreateForm() {
  return `
    <div class="setup">
      <button class="back-btn" id="backToGroupChoice">← 돌아가기</button>
      <h1>✨ 새 조 만들기</h1>
      <p class="lead">조원들이 모두 같은 일정으로 통독해요</p>
      <label class="form-row">조 이름
        <input type="text" id="groupName" placeholder="예) 2026 봄 1조" maxlength="40">
      </label>
      <label class="form-row">통독 시작일
        <input type="date" id="startDate" value="${todayLocalISO()}">
      </label>
      <label class="form-row">본인 이름 <span class="optional">(조원들에게 표시됨)</span>
        <input type="text" id="displayName" placeholder="예) 홍길동" maxlength="20">
      </label>
      <button class="primary" id="createBtn">조 만들기</button>
      <p class="hint">만들면 초대 링크가 생성됩니다.</p>
    </div>`;
}

function bindCreateForm() {
  document.getElementById('backToGroupChoice').onclick = () => {
    state.view = 'main'; saveState(); render();
  };
  document.getElementById('createBtn').onclick = async () => {
    const name = document.getElementById('groupName').value.trim();
    const startDate = document.getElementById('startDate').value;
    const displayName = document.getElementById('displayName').value.trim();
    if (!name) { alert('조 이름을 입력해주세요'); return; }
    if (!startDate) { alert('시작일을 선택해주세요'); return; }
    if (!displayName) { alert('본인 이름을 입력해주세요'); return; }
    const btn = document.getElementById('createBtn');
    btn.disabled = true; btn.textContent = '만드는 중...';
    try {
      const code = await Groups.createGroup({ name, startDate, displayName, plan: state.plan });
      logEvent('create_group');
      state.groupId = code;
      state.displayName = displayName;
      state.readDays = {};
      lastInviteCode = code;
      state.view = 'invite-share';
      saveState();
      subscribeToGroup();
      render();
    } catch (e) {
      btn.disabled = false; btn.textContent = '조 만들기';
      alert('만들기 실패: ' + e.message);
    }
  };
}

// === 조 참가 폼 ===
function renderJoinForm(prefilledCode, fromLink) {
  return `
    <div class="setup">
      ${fromLink ? '' : `<button class="back-btn" id="backToGroupChoice">← 돌아가기</button>`}
      <h1>🔗 ${fromLink ? '초대받은 조 참가' : '조 참가'}</h1>
      <p class="lead">${fromLink ? '초대 링크로 들어오셨어요. 본인 이름만 입력하면 끝!' : '조장에게 받은 6자리 코드를 입력하세요'}</p>
      <label class="form-row">초대 코드
        <input type="text" id="joinCode" value="${escapeHtml(prefilledCode||'')}" placeholder="예) ABC123" maxlength="6" ${fromLink?'readonly':''} style="text-transform:uppercase;letter-spacing:.2em">
      </label>
      <label class="form-row">본인 이름 <span class="optional">(조원들에게 표시됨)</span>
        <input type="text" id="displayName" placeholder="예) 홍길동" maxlength="20" value="${escapeHtml(state.displayName||'')}">
      </label>
      <button class="primary" id="joinBtn">참가하기</button>
    </div>`;
}

function bindJoinForm(fromLink) {
  if (!fromLink) {
    document.getElementById('backToGroupChoice').onclick = () => {
      state.view = 'main'; saveState(); render();
    };
  }
  document.getElementById('joinBtn').onclick = async () => {
    const code = document.getElementById('joinCode').value.trim().toUpperCase();
    const displayName = document.getElementById('displayName').value.trim();
    if (!code || code.length !== 6) { alert('초대 코드를 정확히 입력해주세요 (6자리)'); return; }
    if (!displayName) { alert('본인 이름을 입력해주세요'); return; }
    const btn = document.getElementById('joinBtn');
    btn.disabled = true; btn.textContent = '참가 중...';
    try {
      await Groups.joinGroup({ code, displayName, existingReadDays: state.readDays, plan: state.plan });
      logEvent('join_group');
      state.mode = 'group';
      state.groupId = code;
      state.displayName = displayName;
      pendingInviteCode = null;
      state.view = 'main';
      state.viewDay = null;
      saveState();
      subscribeToGroup();
      render();
    } catch (e) {
      btn.disabled = false; btn.textContent = '참가하기';
      alert('참가 실패: ' + e.message);
    }
  };
}

// === 초대 공유 ===
function renderInviteShare() {
  const code = state.groupId || lastInviteCode;
  const link = inviteLink(code);
  return `
    ${renderHeader()}
    <div class="card" style="text-align:center">
      ${emoji3d('Party popper','lg')}
      <h2 style="margin-top:4px">조가 만들어졌어요!</h2>
      <p style="text-align:center;color:var(--muted);margin-top:0">아래 링크를 조원들에게 공유하세요</p>
      <div class="invite-box">
        <div style="font-size:.8rem;color:var(--muted)">초대 코드</div>
        <div class="invite-code">${code}</div>
        <div class="invite-link">${link}</div>
      </div>
      <div class="invite-actions">
        <button id="shareLinkBtn">📤 링크 공유</button>
        <button id="copyLinkBtn">📋 링크 복사</button>
      </div>
      <button class="primary" id="goMainBtn" style="margin-top:14px">시작하기</button>
      <p class="hint">설정에서 언제든 초대 링크를 다시 볼 수 있어요.</p>
    </div>`;
}

function bindInviteShare() {
  const code = state.groupId || lastInviteCode;
  const link = inviteLink(code);
  const msg = `📖 성경 통독 ${TOTAL_DAYS}일 — 함께해요!\n\n조: ${effectiveTitle()}\n초대 코드: ${code}\n\n링크 클릭으로 바로 참가:\n${link}`;
  document.getElementById('shareLinkBtn').onclick = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: '성경 통독 초대', text: msg }); }
      catch (e) { if (e.name !== 'AbortError') fallbackCopy(msg, '복사했어요. 단톡방에 붙여넣어주세요.'); }
    } else fallbackCopy(msg, '복사했어요. 단톡방에 붙여넣어주세요.');
  };
  document.getElementById('copyLinkBtn').onclick = () => fallbackCopy(link, '링크를 복사했어요.');
  document.getElementById('goMainBtn').onclick = () => {
    state.view = 'main'; saveState(); render();
  };
  if (document.getElementById('listBtn')) document.getElementById('listBtn').onclick = () => { state.view='list'; saveState(); render(); };
  if (document.getElementById('settingsBtn')) document.getElementById('settingsBtn').onclick = () => { state.view='settings'; saveState(); render(); };
  if (document.getElementById('membersBtn')) document.getElementById('membersBtn').onclick = () => { state.view='members'; saveState(); render(); };
}

// === 메인 ===
function renderMain() {
  const day = getViewDay();
  const realToday = calcCurrentDay();
  const totalRead = Object.keys(state.readDays).filter(k => state.readDays[k]).length;
  const pct = Math.round(totalRead / TOTAL_DAYS * 100);

  if (day == null || day < 1) {
    return `${renderHeader()}
    <div class="card status-card">
      ${emoji3d('Spiral calendar','lg')}
      <h2>통독 시작 전</h2>
      <p>시작일: <b>${effectiveStartDate()}</b></p>
      ${day != null ? `<p><b>${1-day}일</b> 후에 시작됩니다.</p>` : ''}
    </div>`;
  }
  if (day > TOTAL_DAYS) {
    return `${renderHeader()}
    <div class="card status-card">
      ${emoji3d('Party popper','xl')}
      <h2>통독 완주를 축하합니다!</h2>
      <p>총 ${TOTAL_DAYS}일 완료 (${totalRead}일 체크)</p>
    </div>`;
  }

  const entry = getDay(day);
  const isRead = !!state.readDays[day];
  const isToday = (state.viewDay == null) || (state.viewDay === realToday);

  return `
    ${renderHeader()}
    <div class="progress-wrap">
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="progress-text">${totalRead} / ${TOTAL_DAYS}일 (${pct}%)</div>
    </div>

    ${renderDayNav(day, realToday, isToday)}

    <div class="card passage-card ${isRead?'is-read':''}">
      ${isRead ? '<div class="read-banner">✓ 오늘 본문 읽기 완료</div>' : ''}
      <h2 class="passage-label">${escapeHtml(entry.l)}</h2>
      ${entry.p ? `<div class="passage-ref">📚 교재 ${entry.p}</div>` : ''}
      ${renderListenBtn(entry)}
      ${entry.r.length === 0 ?
        `<div class="study-only">
          <p>📖 오늘은 성경 본문 대신 외부 교재를 읽어요.</p>
          <p class="study-text">${escapeHtml(entry.s || '')}</p>
        </div>` :
        `${renderBibleToggle()}<div class="passage-body">${renderRangesHTML(entry.r)}</div>`}
    </div>

    <div class="actions">
      <button class="check ${isRead?'checked':''}" id="checkBtn">
        ${isRead ? '✓ 읽음' : '○ 읽음 표시'}
      </button>
      <button class="share" id="shareBtn">📤 공유</button>
      <button class="copy" id="copyBtn">📋 본문 복사</button>
    </div>
    ${day > 1 ? `<button class="bulk-read-btn" id="bulkReadBtn">Day 1~${day} 까지 모두 읽음 표시</button>` : ''}
    ${renderDayNav(day, realToday, isToday)}
    ${volatile.syncStatus === 'error' ? '<div class="sync-status sync-error">⚠ 동기화 오류 — 인터넷 연결을 확인해주세요</div>' : ''}
  `;
}

function renderDayNav(day, realToday, isToday) {
  return `
    <nav class="day-nav">
      <button class="prev-day-btn" ${day<=1?'disabled':''}>← 이전</button>
      <div class="day-indicator">
        <div class="day-num">Day ${day}</div>
        ${isToday ? '<span class="today-tag">오늘</span>' : `<button class="goto-today goto-today-btn">오늘로 (Day ${realToday})</button>`}
      </div>
      <button class="next-day-btn" ${day>=TOTAL_DAYS?'disabled':''}>다음 →</button>
    </nav>`;
}

function memberTotalDays(m) {
  return m.plan === '365' ? 365 : 180;
}

function renderMembersPreview() {
  if (!volatile.members.length) return '';
  const top = [...volatile.members].sort((a,b) => countReadDays(b.readDays, memberTotalDays(b)) - countReadDays(a.readDays, memberTotalDays(a))).slice(0, 4);
  const rows = top.map(m => {
    const isMe = m.uid === volatile.userId;
    const mTotal = memberTotalDays(m);
    const days = countReadDays(m.readDays, mTotal);
    const pct = Math.round(days/mTotal*100);
    return `<div class="member-row ${isMe?'me':''}">
      <span class="member-name">${escapeHtml(m.displayName || '익명')}${isMe?'<span class="you-tag">나</span>':''}</span>
      <span class="member-progress"><b>${days}</b>/${mTotal}일 (${pct}%)</span>
    </div>`;
  }).join('');
  const more = volatile.members.length > 4 ? `<span class="more" id="moreMembersBtn">전체 보기 →</span>` : `<span class="more" id="moreMembersBtn">자세히 →</span>`;
  return `
    <div class="members-preview">
      <div class="members-preview-head">
        <span class="label">조원 진도 (${volatile.members.length}명)</span>
        ${more}
      </div>
      ${rows}
    </div>`;
}

function bindMain() {
  const $ = id => document.getElementById(id);
  const goDay = (n) => {
    state.viewDay = (n === calcCurrentDay()) ? null : n;
    saveState(); render();
  };
  document.querySelectorAll('.prev-day-btn').forEach(b => b.onclick = () => goDay(getViewDay() - 1));
  document.querySelectorAll('.next-day-btn').forEach(b => b.onclick = () => goDay(getViewDay() + 1));
  document.querySelectorAll('.goto-today-btn').forEach(b => b.onclick = () => { state.viewDay = null; saveState(); render(); });
  if ($('checkBtn')) $('checkBtn').onclick = () => toggleRead(getViewDay());
  if ($('bulkReadBtn')) $('bulkReadBtn').onclick = () => {
    const day = getViewDay();
    if (!confirm(`Day 1부터 ${day}까지 모두 읽음으로 표시할까요?`)) return;
    for (let i = 1; i <= day; i++) state.readDays[i] = true;
    saveState();
    if (state.mode === 'group' && state.groupId) {
      Groups.setReadDays(state.groupId, state.readDays).catch(e => console.error('sync', e));
    } else if (state.mode === 'solo') {
      pushSoloData({ readDays: state.readDays });
    }
    toast(`Day 1~${day} 읽음 표시 완료`);
    render();
  };
  if ($('shareBtn')) $('shareBtn').onclick = shareDay;
  if ($('copyBtn')) $('copyBtn').onclick = copyDay;
  if ($('listBtn')) $('listBtn').onclick = () => { state.view = 'list'; saveState(); render(); };
  if ($('settingsBtn')) $('settingsBtn').onclick = () => { state.view = 'settings'; saveState(); render(); };
  if ($('membersBtn')) $('membersBtn').onclick = () => { state.view = 'members'; saveState(); render(); };
  if ($('moreMembersBtn')) $('moreMembersBtn').onclick = () => { state.view = 'members'; saveState(); render(); };
  document.querySelectorAll('.bible-toggle button').forEach(b => {
    b.onclick = () => {
      const ver = b.dataset.ver;
      let cur = normalizeBibleView(state.bibleView);
      if (cur.includes(ver)) {
        // 해제 — 단 마지막 1개는 유지
        if (cur.length === 1) return;
        cur = cur.filter(x => x !== ver);
      } else {
        cur.push(ver);
        if (cur.length > 2) cur.shift(); // 가장 오래된 항목 제거
      }
      state.bibleView = cur;
      saveState();
      render();
    };
  });
}

async function shareDay() {
  const d = getViewDay();
  const entry = getDay(d);
  const tag = effectiveTitle() ? `[${effectiveTitle()}] ` : '';
  const summary = `📖 ${tag}성경 통독 Day ${d} / ${TOTAL_DAYS}\n\n오늘 본문: ${entry.l}` +
    (entry.s ? `\n📚 ${entry.s}` : '') +
    (entry.p ? `\n(교재 ${entry.p})` : '');
  if (navigator.share) {
    try { await navigator.share({ title: `성경 통독 Day ${d}`, text: summary }); }
    catch (e) { if (e.name !== 'AbortError') fallbackCopy(summary, '공유 시트 못 열어서 복사했어요.'); }
  } else fallbackCopy(summary, '요약을 복사했어요. 단톡방에 붙여넣어주세요.');
}

function copyDay() {
  const d = getViewDay();
  const entry = getDay(d);
  if (entry.r.length === 0) {
    fallbackCopy(`[성경 통독 Day ${d}] ${entry.l}\n${entry.s || ''}`, '안내문을 복사했어요.');
    return;
  }
  const header = `[성경 통독 Day ${d}] ${entry.l}`;
  const body = rangesToText(entry.r);
  const text = `${header}\n\n${body}`;
  fallbackCopy(text, `본문 전체를 복사했어요 (${text.length.toLocaleString()}자)`);
}

function fallbackCopy(text, msg) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => toast(msg), () => legacyCopy(text, msg));
  } else {
    legacyCopy(text, msg);
  }
}
function legacyCopy(text, msg) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast(msg); } catch (e) { toast('복사에 실패했어요'); }
  document.body.removeChild(ta);
}

function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}

// === 일정 목록 ===
function renderList() {
  const cur = calcCurrentDay();
  const isGroup = state.mode === 'group' && volatile.members.length > 0;
  const memberCount = volatile.members.length;

  // 일자별: 어떤 조원이 읽었는지 사전 계산
  const dayReaders = {};
  if (isGroup) {
    for (const m of volatile.members) {
      const rd = m.readDays || {};
      for (const k in rd) {
        if (rd[k]) {
          if (!dayReaders[k]) dayReaders[k] = [];
          dayReaders[k].push(m);
        }
      }
    }
  }

  const items = SCHEDULE.map(d => {
    const isRead = !!state.readDays[d.d];
    const isToday = (d.d === cur);
    const isStudy = d.r.length === 0;
    let stat;
    if (isGroup) {
      const readers = dayReaders[d.d] || [];
      const names = readers.map(m => escapeHtml(m.displayName || '익명')).join(', ');
      stat = `<span class="li-group-stat ${readers.length===memberCount?'all':''}" title="${names || '아직 읽은 조원 없음'}">${readers.length}/${memberCount}</span>`;
    } else {
      stat = `<span class="li-check">${isRead ? '✓' : ''}</span>`;
    }
    return `<li class="list-item ${isRead?'read':''} ${isToday?'today':''} ${isStudy?'study':''}" data-day="${d.d}">
      <span class="li-num">${d.d}</span>
      <span class="li-label">${escapeHtml(d.l)}</span>
      ${stat}
    </li>`;
  }).join('');

  return `
    ${renderHeader()}
    <div class="list-toolbar">
      <button class="back-btn" id="backBtn">← 돌아가기</button>
      <span class="list-summary">${isGroup ? `조원 ${memberCount}명 · ` : ''}내 진도 ${countReadDays(state.readDays)} / ${TOTAL_DAYS}</span>
    </div>
    <ul class="day-list">${items}</ul>
  `;
}

function bindList() {
  document.getElementById('backBtn').onclick = () => { state.view = 'main'; saveState(); render(); };
  document.getElementById('listBtn').onclick = () => { state.view = 'main'; saveState(); render(); };
  document.getElementById('settingsBtn').onclick = () => { state.view = 'settings'; saveState(); render(); };
  if (document.getElementById('membersBtn')) document.getElementById('membersBtn').onclick = () => { state.view = 'members'; saveState(); render(); };
  document.querySelectorAll('.list-item').forEach(li => {
    li.onclick = () => {
      const d = +li.dataset.day;
      state.viewDay = (d === calcCurrentDay()) ? null : d;
      state.view = 'main';
      saveState(); render();
    };
  });
}

function scrollToToday() {
  const el = document.querySelector('.list-item.today');
  if (el) el.scrollIntoView({ block: 'center' });
}

// === 조원 보기 ===
function renderMembers() {
  const sorted = [...volatile.members].sort((a,b) => countReadDays(b.readDays, memberTotalDays(b)) - countReadDays(a.readDays, memberTotalDays(a)));
  const rows = sorted.map(m => {
    const isMe = m.uid === volatile.userId;
    const mTotal = memberTotalDays(m);
    const days = countReadDays(m.readDays, mTotal);
    const pct = Math.round(days/mTotal*100);
    const last = relativeTime(m.updatedAt);
    const planTag = mTotal === 365 ? '<span class="plan-tag t365">365</span>' : '<span class="plan-tag t180">180</span>';
    return `<div class="member-row ${isMe?'me':''}">
      <span class="member-name">${escapeHtml(m.displayName || '익명')}${isMe?'<span class="you-tag">나</span>':''}${planTag}</span>
      <span class="member-progress"><b>${days}</b>/${mTotal}일 (${pct}%)</span>
      <span class="member-last-full">마지막 활동 <b>${last}</b></span>
      <div class="member-bar"><div class="member-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
  return `
    ${renderHeader()}
    <button class="back-btn" id="backBtn">← 돌아가기</button>
    <div class="card members-card">
      <h2 style="margin-top:4px">👥 조원 진도 (${volatile.members.length}명)</h2>
      ${rows || '<p style="color:var(--muted);text-align:center;padding:20px">조원이 아직 없어요</p>'}
    </div>`;
}

function bindMembers() {
  document.getElementById('backBtn').onclick = () => { state.view = 'main'; saveState(); render(); };
  if (document.getElementById('listBtn')) document.getElementById('listBtn').onclick = () => { state.view = 'list'; saveState(); render(); };
  if (document.getElementById('settingsBtn')) document.getElementById('settingsBtn').onclick = () => { state.view = 'settings'; saveState(); render(); };
  if (document.getElementById('membersBtn')) document.getElementById('membersBtn').onclick = () => {};
}

// === 건의사항 ===
function renderFeedback() {
  return `
    ${renderHeader()}
    <button class="back-btn" id="backBtn">← 돌아가기</button>
    <div class="card">
      <div style="text-align:center">${emoji3d('Speech balloon','lg')}</div>
      <h2 style="margin-top:4px;text-align:center">건의/문의 보내기</h2>
      <p style="color:var(--muted);font-size:.9rem;margin-top:4px">개선 아이디어, 버그 신고, 문의 등 자유롭게 보내주세요. 직접 확인하고 답변드려요.</p>
      <label class="form-row">이름 <span class="optional">(선택)</span>
        <input type="text" id="fbName" maxlength="40" value="${escapeHtml(state.displayName||state.groupName||'')}">
      </label>
      <label class="form-row">이메일 <span class="optional">(답장 받으려면)</span>
        <input type="email" id="fbEmail" placeholder="answer@example.com">
      </label>
      <label class="form-row">내용 *
        <textarea id="fbMessage" rows="6" maxlength="2000" placeholder="자유롭게 적어주세요..." style="width:100%;font-family:inherit;font-size:16px;padding:.7em .9em;border:1.5px solid var(--line);border-radius:10px;background:#fff;color:var(--text);margin-top:.4em;resize:vertical"></textarea>
      </label>
      <button class="primary" id="fbSendBtn">보내기</button>
      <p class="hint" id="fbStatus">＊ 표시는 필수 항목입니다</p>
    </div>`;
}

function bindFeedback() {
  const $ = id => document.getElementById(id);
  $('backBtn').onclick = () => { state.view = 'settings'; saveState(); render(); };
  if ($('listBtn')) $('listBtn').onclick = () => { state.view = 'list'; saveState(); render(); };
  if ($('settingsBtn')) $('settingsBtn').onclick = () => { state.view = 'settings'; saveState(); render(); };
  if ($('membersBtn')) $('membersBtn').onclick = () => { state.view = 'members'; saveState(); render(); };
  $('fbSendBtn').onclick = async () => {
    const name = $('fbName').value.trim();
    const email = $('fbEmail').value.trim();
    const message = $('fbMessage').value.trim();
    if (!message) { alert('내용을 입력해주세요'); return; }
    const btn = $('fbSendBtn');
    const status = $('fbStatus');
    btn.disabled = true; btn.textContent = '보내는 중...';
    status.textContent = '';

    const day = calcCurrentDay();
    const context = [
      `모드: ${state.mode || '미설정'}`,
      `플랜: ${state.plan || '미설정'}일`,
      state.mode === 'group' ? `조: ${effectiveTitle()}` : `시작일: ${state.startDate || '-'}`,
      `Day: ${day != null ? day : '-'} / ${TOTAL_DAYS}`,
      `읽은 일수: ${Object.keys(state.readDays).filter(k=>state.readDays[k]).length}`,
      `URL: ${SITE_URL}`,
    ].join('\n');

    try {
      const res = await fetch(FEEDBACK_ENDPOINT, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || '익명',
          email: email || '',
          message,
          _replyto: email || '',
          _subject: `[성경통독] ${name||'익명'} 건의사항`,
          context,
        })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      toast('보냈어요. 감사합니다 🙏');
      state.view = 'settings';
      saveState();
      render();
    } catch (e) {
      btn.disabled = false; btn.textContent = '보내기';
      status.innerHTML = '<span style="color:var(--bad)">전송 실패 — 인터넷 연결을 확인하거나 잠시 후 다시 시도해주세요</span>';
      console.error('feedback', e);
    }
  };
}

// === 설정 ===
function renderSettings() {
  const isGroup = state.mode === 'group' && state.groupId;
  const settingsInviteLink = isGroup ? inviteLink(state.groupId) : '';

  return `
    ${renderHeader()}
    <button class="back-btn" id="backBtn">← 돌아가기</button>
    <div class="card settings-card">
      <h2>설정</h2>
      <div class="form-row" style="color:var(--text);display:flex;align-items:center;justify-content:space-between">
        <b>📅 통독 기간: ${TOTAL_DAYS}일</b>
        <button class="plan-change-btn" id="changePlanBtn">${TOTAL_DAYS === 180 ? '365일로 변경' : '180일로 변경'}</button>
      </div>

      ${isGroup ? `
        <div class="form-row" style="color:var(--text)">
          <b>📖 조 모드</b><br>
          <span style="color:var(--muted);font-size:.85rem">조: ${escapeHtml(effectiveTitle())} · 시작일: ${effectiveStartDate()}</span>
        </div>
        <label class="form-row">본인 이름
          <input type="text" id="displayName" value="${escapeHtml(state.displayName||'')}" maxlength="20">
        </label>
        <button class="primary" id="saveNameBtn">이름 저장</button>
        <div class="invite-box" style="margin-top:16px">
          <div style="font-size:.8rem;color:var(--muted)">초대 코드</div>
          <div class="invite-code">${state.groupId}</div>
          <div class="invite-link">${settingsInviteLink}</div>
        </div>
        <div class="invite-actions">
          <button id="shareLinkBtn">📤 공유</button>
          <button id="copyLinkBtn">📋 복사</button>
        </div>
        <div class="divider"></div>
        <button class="danger-outline" id="leaveBtn">조 나가기</button>
      ` : `
        <div class="form-row" style="color:var(--text)">
          <b>🙂 혼자 모드</b>
        </div>
        <label class="form-row">통독 시작일
          <input type="date" id="startDate" value="${state.startDate||todayLocalISO()}">
        </label>
        <label class="form-row">표시 이름
          <input type="text" id="groupName" value="${escapeHtml(state.groupName||'')}" maxlength="40">
        </label>
        <button class="primary" id="saveSoloBtn">저장</button>
        <div class="divider"></div>
        <button class="danger-outline" id="resetReadBtn">읽음 진도만 초기화</button>
      `}
      <div class="divider"></div>
      ${renderGoogleSyncRow()}
      <div class="divider"></div>
      <button class="primary" id="feedbackBtn" style="background:#fff;color:var(--text);border:1.5px solid var(--line)">💬 건의/문의 보내기</button>
      <div class="divider"></div>
      <button class="danger" id="resetAllBtn">전체 초기화 (처음부터)</button>
      <p class="hint">전체 초기화는 모든 로컬 데이터를 지웁니다. 조에서도 나가게 됩니다.</p>
    </div>`;
}

function renderGoogleSyncRow() {
  const info = Groups.getUserInfo ? Groups.getUserInfo() : null;
  if (info && info.googleEmail) {
    return `
      <div class="form-row" style="color:var(--text)">
        <b>🔗 Google 동기화 사용 중</b><br>
        <span style="color:var(--muted);font-size:.85rem">${escapeHtml(info.googleEmail)}</span>
      </div>
      <button class="danger-outline" id="googleSignOutBtn">Google 로그아웃</button>
      <p class="hint" style="margin-top:6px">로그아웃하면 이 기기는 다시 익명 계정이 됩니다. 같은 Google 계정으로 다시 로그인하면 데이터가 복구돼요.</p>
    `;
  }
  return `
    <div class="form-row" style="color:var(--text)">
      <b>🔗 다른 기기에서도 사용하기</b><br>
      <span style="color:var(--muted);font-size:.85rem">Google 계정으로 연결하면 PC·모바일에서 같은 사람으로 인식돼요</span>
    </div>
    <button class="primary" id="googleLinkBtn" style="background:#fff;color:var(--text);border:1.5px solid var(--line)">
      <span style="display:inline-block;width:16px;height:16px;vertical-align:-3px;margin-right:8px;background:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 48 48%22><path fill=%22%23FFC107%22 d=%22M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z%22/><path fill=%22%23FF3D00%22 d=%22M6.3 14.7l6.6 4.8c1.8-4.4 6-7.5 11-7.5 3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.1 4 9.3 8.4 6.3 14.7z%22/><path fill=%22%234CAF50%22 d=%22M24 44c5.5 0 10.5-2.1 14.3-5.5l-6.6-5.6C29.6 34.3 26.9 35 24 35c-5.2 0-9.6-3.3-11.2-7.9l-6.6 5.1C9.3 39.6 16.1 44 24 44z%22/><path fill=%22%231976D2%22 d=%22M43.6 20.1H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.7l6.6 5.6c-.5.4 7.4-5.4 7.4-15.3 0-1.3-.1-2.6-.4-3.9z%22/></svg>') center/contain no-repeat"></span>
      Google로 동기화하기
    </button>
  `;
}

function bindSettings() {
  const $ = id => document.getElementById(id);
  $('backBtn').onclick = () => { state.view = 'main'; saveState(); render(); };
  if ($('listBtn')) $('listBtn').onclick = () => { state.view = 'list'; saveState(); render(); };
  if ($('membersBtn')) $('membersBtn').onclick = () => { state.view = 'members'; saveState(); render(); };
  if ($('settingsBtn')) $('settingsBtn').onclick = () => {};
  if ($('changePlanBtn')) $('changePlanBtn').onclick = () => {
    const newPlan = state.plan === '180' ? '365' : '180';
    const label = newPlan === '365' ? '365일' : '180일';
    if (!confirm(`통독 기간을 ${label}로 변경할까요?\n읽음 기록이 새 기간에 맞게 변환됩니다.`)) return;
    const converted = convertReadDays(state.readDays, state.plan, newPlan);
    const lastRead = Object.keys(converted).filter(k => converted[k]).map(Number);
    const lastDay = lastRead.length ? Math.max(...lastRead) : null;
    state.readDays = converted;
    state.plan = newPlan;
    state.viewDay = lastDay;
    applyPlan(newPlan);
    saveState();
    if (state.mode === 'group' && state.groupId) {
      Groups.joinGroup({ code: state.groupId, displayName: state.displayName, plan: newPlan }).catch(() => {});
      Groups.replaceReadDays(state.groupId, state.readDays).catch(() => {});
    }
    if (state.mode === 'solo' && isGoogleLinked()) {
      Groups.replaceSoloReadDays(volatile.userId, state.readDays, { plan: newPlan }).catch(() => {});
    }
    toast(`${label} 통독으로 변경되었어요`);
    render();
  };
  if ($('saveSoloBtn')) $('saveSoloBtn').onclick = () => {
    const d = $('startDate').value;
    if (!d) { alert('시작일을 선택해주세요'); return; }
    state.startDate = d;
    state.groupName = $('groupName').value.trim();
    state.view = 'main'; state.viewDay = null;
    saveState();
    pushSoloData({ startDate: state.startDate, groupName: state.groupName });
    toast('저장되었어요'); render();
  };
  if ($('saveNameBtn')) $('saveNameBtn').onclick = async () => {
    const dn = $('displayName').value.trim();
    if (!dn) { alert('이름을 입력해주세요'); return; }
    try {
      await Groups.joinGroup({ code: state.groupId, displayName: dn, plan: state.plan });
      state.displayName = dn;
      saveState();
      toast('저장되었어요');
    } catch (e) { alert('저장 실패: ' + e.message); }
  };
  if ($('shareLinkBtn')) $('shareLinkBtn').onclick = async () => {
    const link = inviteLink(state.groupId);
    const msg = `📖 성경 통독 ${TOTAL_DAYS}일 — 함께해요!\n조: ${effectiveTitle()}\n${link}`;
    if (navigator.share) {
      try { await navigator.share({ title: '성경 통독 초대', text: msg }); }
      catch (e) { if (e.name !== 'AbortError') fallbackCopy(msg, '복사했어요'); }
    } else fallbackCopy(msg, '복사했어요');
  };
  if ($('copyLinkBtn')) $('copyLinkBtn').onclick = () => {
    fallbackCopy(inviteLink(state.groupId), '링크를 복사했어요');
  };
  if ($('leaveBtn')) $('leaveBtn').onclick = async () => {
    if (!confirm(`조 "${effectiveTitle()}"에서 나가시겠어요?\n진도 기록은 사라지지 않지만 조원들 진도는 더 이상 볼 수 없게 돼요.`)) return;
    try { await Groups.leaveGroup(state.groupId); } catch (e) { console.error(e); }
    Groups.unsubscribe();
    state.groupId = null;
    state.mode = null;
    state.view = 'main';
    volatile.groupData = null;
    volatile.members = [];
    saveState(); render();
  };
  if ($('resetReadBtn')) $('resetReadBtn').onclick = () => {
    if (!confirm('읽음 진도만 초기화할까요?')) return;
    state.readDays = {};
    saveState();
    if (state.mode === 'group' && state.groupId) {
      Groups.replaceReadDays(state.groupId, {}).catch(e => console.error('sync', e));
    } else if (state.mode === 'solo' && isGoogleLinked()) {
      Groups.replaceSoloReadDays(volatile.userId, {}).catch(e => console.error('sync', e));
    }
    toast('진도가 초기화되었어요');
    render();
  };
  if ($('googleLinkBtn')) $('googleLinkBtn').onclick = async () => {
    const btn = $('googleLinkBtn');
    btn.disabled = true; btn.textContent = '연결 중...';
    try {
      const res = await Groups.linkOrSignInGoogle();
      if (res.action === 'linked') {
        toast('Google 계정에 연결되었어요. 다른 기기에서도 같은 계정으로 동기화돼요.');
        if (state.mode === 'solo') {
          subscribeSolo();
          pushSoloData({ plan: state.plan, startDate: state.startDate, groupName: state.groupName, readDays: state.readDays });
        }
        render();
      } else {
        // sign-in (다른 기기의 기존 계정으로 로그인됨) → UID가 바뀌었으므로 새로고침
        alert('기존 Google 계정으로 로그인했어요. 데이터를 불러오기 위해 페이지를 새로고침합니다.');
        location.reload();
      }
    } catch (e) {
      btn.disabled = false;
      if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') {
        btn.textContent = 'Google로 동기화하기';
        return;
      }
      alert('연결 실패: ' + (e.message || e.code || e));
      render();
    }
  };
  if ($('googleSignOutBtn')) $('googleSignOutBtn').onclick = async () => {
    if (!confirm('Google 로그아웃하시겠어요?\n이 기기는 다시 익명 계정으로 돌아갑니다 (다른 기기와 분리됨). 같은 Google 계정으로 다시 로그인하면 복구 가능.')) return;
    try {
      Groups.unsubscribe();
      await Groups.signOutToAnonymous();
      state = defaultState();
      saveState();
      volatile.groupData = null;
      volatile.members = [];
      location.reload();
    } catch (e) {
      alert('로그아웃 실패: ' + (e.message || e));
    }
  };
  if ($('feedbackBtn')) $('feedbackBtn').onclick = () => {
    state.view = 'feedback'; saveState(); render();
  };
  $('resetAllBtn').onclick = async () => {
    if (!confirm('전체 초기화 후 처음부터 시작하시겠어요?\n조 모드라면 조에서도 나갑니다.')) return;
    if (state.mode === 'group' && state.groupId) {
      try { await Groups.leaveGroup(state.groupId); } catch (e) {}
      Groups.unsubscribe();
    }
    state = defaultState();
    saveState();
    volatile.groupData = null;
    volatile.members = [];
    render();
  };
}
