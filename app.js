// 성경 통독 앱 (180일) — Firebase 그룹 동기화 포함
// 데이터: window.BIBLE, window.SCHEDULE, window.BOOK_NAMES, window.Groups

const TOTAL_DAYS = 180;
const STORAGE_KEY = 'bible180_state_v2';
const SITE_URL = location.origin + location.pathname;

// === 장별 마지막 절 캐시 ===
const CHAPTER_LENGTHS = {};
(function () {
  for (const key in window.BIBLE) {
    const m = key.match(/^(.+?)(\d+):(\d+)$/);
    if (!m) continue;
    const ck = m[1] + ':' + m[2];
    const v = +m[3];
    if (!CHAPTER_LENGTHS[ck] || v > CHAPTER_LENGTHS[ck]) CHAPTER_LENGTHS[ck] = v;
  }
})();

// === 상태 ===
const defaultState = () => ({
  mode: null,           // 'solo' | 'group' | null
  startDate: null,      // solo mode
  groupName: '',        // solo mode (라벨용)
  groupId: null,        // group mode (초대 코드)
  displayName: '',      // group mode 본인 이름
  readDays: {},
  viewDay: null,
  view: 'main',
});

let state = loadState();
let volatile = {
  groupData: null,      // {name, startDate, owner, createdAt}
  members: [],          // [{uid, displayName, readDays, ...}]
  syncStatus: 'idle',   // 'idle' | 'syncing' | 'error'
  authReady: false,
  userId: null,
};
let pendingInviteCode = null;
let lastInviteCode = null;

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (s && typeof s === 'object') return Object.assign(defaultState(), s);
  } catch (e) {}
  // v1 마이그레이션
  try {
    const old = JSON.parse(localStorage.getItem('bible180_state_v1'));
    if (old && typeof old === 'object') {
      const merged = Object.assign(defaultState(), old);
      if (merged.startDate) merged.mode = 'solo';
      return merged;
    }
  } catch (e) {}
  return defaultState();
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

function eachVerseInRange(range, cb) {
  const [book, sc, sv, ec, ev] = range;
  for (let ch = sc; ch <= ec; ch++) {
    let s, e;
    if (ch === sc && ch === ec) { s = sv; e = ev || chapterMax(book, ch); }
    else if (ch === sc) { s = sv; e = chapterMax(book, ch); }
    else if (ch === ec) { s = 1; e = ev || chapterMax(book, ch); }
    else { s = 1; e = chapterMax(book, ch); }
    if (!e) e = 200;
    for (let v = s; v <= e; v++) {
      const text = BIBLE[`${book}${ch}:${v}`];
      if (!text) break;
      cb(book, ch, v, text.trim());
    }
  }
}

function renderRangesHTML(ranges) {
  const parts = [];
  for (const range of ranges) {
    const book = range[0];
    const fullBook = BOOK_NAMES[book] || book;
    parts.push(`<div class="passage-block"><h3 class="book-title">${fullBook}</h3>`);
    let curCh = null, chBuf = [], chHeader = null;
    eachVerseInRange(range, (b, ch, v, text) => {
      if (ch !== curCh) {
        if (chBuf.length) parts.push(`<div class="chapter"><h4 class="ch-title">${chHeader}</h4>${chBuf.join('')}</div>`);
        chBuf = []; curCh = ch; chHeader = chapterLabel(b, ch);
      }
      chBuf.push(`<p class="verse"><span class="vnum">${v}</span>${escapeHtml(text)}</p>`);
    });
    if (chBuf.length) parts.push(`<div class="chapter"><h4 class="ch-title">${chHeader}</h4>${chBuf.join('')}</div>`);
    parts.push('</div>');
  }
  return parts.join('');
}

function rangesToText(ranges) {
  const lines = [];
  for (const range of ranges) {
    const book = range[0];
    const fullBook = BOOK_NAMES[book] || book;
    let curCh = null;
    eachVerseInRange(range, (b, ch, v, text) => {
      if (ch !== curCh) {
        if (lines.length) lines.push('');
        lines.push(`〈${fullBook} ${chapterLabel(b, ch)}〉`);
        curCh = ch;
      }
      lines.push(`${v}. ${text}`);
    });
    lines.push('');
  }
  return lines.join('\n').trim();
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// === 진도 토글 (자동 동기화) ===
function toggleRead(day) {
  if (state.readDays[day]) delete state.readDays[day];
  else state.readDays[day] = true;
  saveState();
  if (state.mode === 'group' && state.groupId) {
    volatile.syncStatus = 'syncing';
    Groups.setReadDays(state.groupId, state.readDays)
      .then(() => { volatile.syncStatus = 'idle'; render(); })
      .catch(e => { volatile.syncStatus = 'error'; console.error('sync', e); render(); });
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
        state.readDays = me.readDays;
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

  app.innerHTML = renderMain();
  bindMain();
  window.scrollTo(0, 0);
}

// === 헤더 ===
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
function renderModeSelect() {
  return `
    <div class="setup">
      <h1>📖 성경 통독</h1>
      <p class="lead">180일 동안 함께 통독해요</p>
      <div class="mode-choice">
        <button class="mode-card" id="modeSolo">
          <span class="mode-icon">🙂</span>
          <span class="mode-text">
            <div class="mode-title">혼자 사용</div>
            <div class="mode-desc">내 진도만 표시. 인터넷 없이도 사용 가능</div>
          </span>
        </button>
        <button class="mode-card" id="modeGroup">
          <span class="mode-icon">👥</span>
          <span class="mode-text">
            <div class="mode-title">조와 함께</div>
            <div class="mode-desc">조원들과 진도를 공유하며 통독</div>
          </span>
        </button>
      </div>
    </div>`;
}

function bindModeSelect() {
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
    saveState(); render();
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
          <span class="mode-icon">✨</span>
          <span class="mode-text">
            <div class="mode-title">새 조 만들기</div>
            <div class="mode-desc">조장이 되어 초대 링크 생성</div>
          </span>
        </button>
        <button class="mode-card" id="goJoin">
          <span class="mode-icon">🔗</span>
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
      const code = await Groups.createGroup({ name, startDate, displayName });
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
      await Groups.joinGroup({ code, displayName, existingReadDays: state.readDays });
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
  const link = `${SITE_URL}?join=${code}`;
  return `
    ${renderHeader()}
    <div class="card">
      <h2 style="text-align:center;margin-top:4px">🎉 조가 만들어졌어요!</h2>
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
  const link = `${SITE_URL}?join=${code}`;
  const msg = `📖 성경 통독 180일 — 함께해요!\n\n조: ${effectiveTitle()}\n초대 코드: ${code}\n\n링크 클릭으로 바로 참가:\n${link}`;
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
      <h2>📅 통독 시작 전</h2>
      <p>시작일: <b>${effectiveStartDate()}</b></p>
      ${day != null ? `<p><b>${1-day}일</b> 후에 시작됩니다.</p>` : ''}
    </div>`;
  }
  if (day > TOTAL_DAYS) {
    return `${renderHeader()}
    <div class="card status-card">
      <h2>🎉 통독 완주를 축하합니다!</h2>
      <p>총 ${TOTAL_DAYS}일 완료 (${totalRead}일 체크)</p>
    </div>`;
  }

  const entry = getDay(day);
  const isRead = !!state.readDays[day];
  const isToday = (state.viewDay == null) || (state.viewDay === realToday);

  return `
    ${renderHeader()}
    ${state.mode === 'group' ? renderMembersPreview() : ''}
    <div class="progress-wrap">
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="progress-text">${totalRead} / ${TOTAL_DAYS}일 (${pct}%)</div>
    </div>

    <nav class="day-nav">
      <button id="prevDay" ${day<=1?'disabled':''}>← 이전</button>
      <div class="day-indicator">
        <div class="day-num">Day ${day}</div>
        ${isToday ? '<span class="today-tag">오늘</span>' : `<button class="goto-today" id="todayBtn">오늘로 (Day ${realToday})</button>`}
      </div>
      <button id="nextDay" ${day>=TOTAL_DAYS?'disabled':''}>다음 →</button>
    </nav>

    <div class="card passage-card">
      <h2 class="passage-label">${escapeHtml(entry.l)}</h2>
      ${entry.p ? `<div class="passage-ref">📚 교재 ${entry.p}</div>` : ''}
      ${entry.r.length === 0 ?
        `<div class="study-only">
          <p>📖 오늘은 성경 본문 대신 외부 교재를 읽어요.</p>
          <p class="study-text">${escapeHtml(entry.s || '')}</p>
        </div>` :
        `<div class="passage-body">${renderRangesHTML(entry.r)}</div>`}
    </div>

    <div class="actions">
      <button class="check ${isRead?'checked':''}" id="checkBtn">
        ${isRead ? '✓ 읽음' : '○ 읽음 표시'}
      </button>
      <button class="share" id="shareBtn">📤 공유</button>
      <button class="copy" id="copyBtn">📋 본문 복사</button>
    </div>
    ${volatile.syncStatus === 'error' ? '<div class="sync-status sync-error">⚠ 동기화 오류 — 인터넷 연결을 확인해주세요</div>' : ''}
  `;
}

function renderMembersPreview() {
  if (!volatile.members.length) return '';
  const top = [...volatile.members].sort((a,b) => {
    const ad = Object.keys(a.readDays||{}).filter(k=>a.readDays[k]).length;
    const bd = Object.keys(b.readDays||{}).filter(k=>b.readDays[k]).length;
    return bd - ad;
  }).slice(0, 4);
  const rows = top.map(m => {
    const isMe = m.uid === volatile.userId;
    const days = Object.keys(m.readDays||{}).filter(k=>m.readDays[k]).length;
    const pct = Math.round(days/TOTAL_DAYS*100);
    return `<div class="member-row ${isMe?'me':''}">
      <span class="member-name">${escapeHtml(m.displayName || '익명')}${isMe?'<span class="you-tag">나</span>':''}</span>
      <span class="member-progress"><b>${days}</b>일 (${pct}%)</span>
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
  if ($('prevDay')) $('prevDay').onclick = () => goDay(getViewDay() - 1);
  if ($('nextDay')) $('nextDay').onclick = () => goDay(getViewDay() + 1);
  if ($('todayBtn')) $('todayBtn').onclick = () => { state.viewDay = null; saveState(); render(); };
  if ($('checkBtn')) $('checkBtn').onclick = () => toggleRead(getViewDay());
  if ($('shareBtn')) $('shareBtn').onclick = shareDay;
  if ($('copyBtn')) $('copyBtn').onclick = copyDay;
  if ($('listBtn')) $('listBtn').onclick = () => { state.view = 'list'; saveState(); render(); };
  if ($('settingsBtn')) $('settingsBtn').onclick = () => { state.view = 'settings'; saveState(); render(); };
  if ($('membersBtn')) $('membersBtn').onclick = () => { state.view = 'members'; saveState(); render(); };
  if ($('moreMembersBtn')) $('moreMembersBtn').onclick = () => { state.view = 'members'; saveState(); render(); };
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
  const items = SCHEDULE.map(d => {
    const isRead = !!state.readDays[d.d];
    const isToday = (d.d === cur);
    const isStudy = d.r.length === 0;
    return `<li class="list-item ${isRead?'read':''} ${isToday?'today':''} ${isStudy?'study':''}" data-day="${d.d}">
      <span class="li-num">${d.d}</span>
      <span class="li-label">${escapeHtml(d.l)}</span>
      <span class="li-check">${isRead ? '✓' : ''}</span>
    </li>`;
  }).join('');
  return `
    ${renderHeader()}
    <div class="list-toolbar">
      <button class="back-btn" id="backBtn">← 돌아가기</button>
      <span class="list-summary">${Object.keys(state.readDays).filter(k=>state.readDays[k]).length} / ${TOTAL_DAYS} 완료</span>
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
  const sorted = [...volatile.members].sort((a,b) => {
    const ad = Object.keys(a.readDays||{}).filter(k=>a.readDays[k]).length;
    const bd = Object.keys(b.readDays||{}).filter(k=>b.readDays[k]).length;
    return bd - ad;
  });
  const rows = sorted.map(m => {
    const isMe = m.uid === volatile.userId;
    const days = Object.keys(m.readDays||{}).filter(k=>m.readDays[k]).length;
    const pct = Math.round(days/TOTAL_DAYS*100);
    return `<div class="member-row ${isMe?'me':''}">
      <span class="member-name">${escapeHtml(m.displayName || '익명')}${isMe?'<span class="you-tag">나</span>':''}</span>
      <span class="member-progress"><b>${days}</b>일 (${pct}%)</span>
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

// === 설정 ===
function renderSettings() {
  const isGroup = state.mode === 'group' && state.groupId;
  const inviteLink = isGroup ? `${SITE_URL}?join=${state.groupId}` : '';

  return `
    ${renderHeader()}
    <button class="back-btn" id="backBtn">← 돌아가기</button>
    <div class="card settings-card">
      <h2>설정</h2>

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
          <div class="invite-link">${inviteLink}</div>
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
  if ($('saveSoloBtn')) $('saveSoloBtn').onclick = () => {
    const d = $('startDate').value;
    if (!d) { alert('시작일을 선택해주세요'); return; }
    state.startDate = d;
    state.groupName = $('groupName').value.trim();
    state.view = 'main'; state.viewDay = null;
    saveState(); toast('저장되었어요'); render();
  };
  if ($('saveNameBtn')) $('saveNameBtn').onclick = async () => {
    const dn = $('displayName').value.trim();
    if (!dn) { alert('이름을 입력해주세요'); return; }
    try {
      await Groups.joinGroup({ code: state.groupId, displayName: dn });
      state.displayName = dn;
      saveState();
      toast('저장되었어요');
    } catch (e) { alert('저장 실패: ' + e.message); }
  };
  if ($('shareLinkBtn')) $('shareLinkBtn').onclick = async () => {
    const link = `${SITE_URL}?join=${state.groupId}`;
    const msg = `📖 성경 통독 180일 — 함께해요!\n조: ${effectiveTitle()}\n${link}`;
    if (navigator.share) {
      try { await navigator.share({ title: '성경 통독 초대', text: msg }); }
      catch (e) { if (e.name !== 'AbortError') fallbackCopy(msg, '복사했어요'); }
    } else fallbackCopy(msg, '복사했어요');
  };
  if ($('copyLinkBtn')) $('copyLinkBtn').onclick = () => {
    fallbackCopy(`${SITE_URL}?join=${state.groupId}`, '링크를 복사했어요');
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
