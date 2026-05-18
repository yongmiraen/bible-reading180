// 성경 통독 앱 (180일)
// 데이터: window.BIBLE, window.SCHEDULE, window.BOOK_NAMES (script 태그로 로드)

const TOTAL_DAYS = 180;
const STORAGE_KEY = 'bible180_state_v1';

// === 장별 마지막 절 캐시 ===
const CHAPTER_LENGTHS = {};
(function buildChapterLengths() {
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
  startDate: null,
  groupName: '',
  readDays: {},
  viewDay: null,
  view: 'main',
});

let state = loadState();

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (s && typeof s === 'object') return Object.assign(defaultState(), s);
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

function calcCurrentDay() {
  if (!state.startDate) return null;
  const start = new Date(state.startDate + 'T00:00:00');
  const today = new Date(todayLocalISO() + 'T00:00:00');
  return Math.floor((today - start) / 86400000) + 1;
}

function getViewDay() {
  return state.viewDay != null ? state.viewDay : calcCurrentDay();
}

function getDay(n) {
  return SCHEDULE.find(d => d.d === n);
}

// === 본문 렌더 ===
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
    let curCh = null;
    let chBuf = [];
    let chHeader = null;
    eachVerseInRange(range, (b, ch, v, text) => {
      if (ch !== curCh) {
        if (chBuf.length) parts.push(`<div class="chapter"><h4 class="ch-title">${chHeader}</h4>${chBuf.join('')}</div>`);
        chBuf = [];
        curCh = ch;
        chHeader = chapterLabel(b, ch);
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

// === 라우터/렌더 ===
function render() {
  const app = document.getElementById('app');
  if (!state.startDate) {
    app.innerHTML = renderSetup();
    bindSetup();
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
  app.innerHTML = renderMain();
  bindMain();
  window.scrollTo(0, 0);
}

function renderHeader() {
  return `
    <header>
      <div class="header-title">
        <h1>📖 성경 통독</h1>
        ${state.groupName ? `<div class="group-name">${escapeHtml(state.groupName)}</div>` : ''}
      </div>
      <div class="header-actions">
        <button class="icon-btn" id="listBtn" title="전체 일정">📅</button>
        <button class="icon-btn" id="settingsBtn" title="설정">⚙️</button>
      </div>
    </header>`;
}

function renderSetup() {
  return `
    <div class="setup">
      <h1>📖 성경 통독</h1>
      <p class="lead">조원들과 180일 동안 함께 통독해요</p>
      <label class="form-row">통독 시작일
        <input type="date" id="startDate" value="${todayLocalISO()}">
      </label>
      <label class="form-row">조 이름 <span class="optional">(선택)</span>
        <input type="text" id="groupName" placeholder="예) 2026 봄 1조" maxlength="40">
      </label>
      <button class="primary" id="startBtn">시작하기</button>
      <p class="hint">시작일은 언제든 설정에서 바꿀 수 있어요.</p>
    </div>`;
}

function bindSetup() {
  document.getElementById('startBtn').onclick = () => {
    const d = document.getElementById('startDate').value;
    const g = document.getElementById('groupName').value.trim();
    if (!d) { alert('시작일을 선택해주세요'); return; }
    state.startDate = d;
    state.groupName = g;
    state.view = 'main';
    state.viewDay = null;
    saveState();
    render();
  };
}

function renderMain() {
  const day = getViewDay();
  const realToday = calcCurrentDay();
  const totalRead = Object.values(state.readDays).filter(Boolean).length;
  const pct = Math.round(totalRead / TOTAL_DAYS * 100);

  if (day < 1) {
    return `${renderHeader()}
    <div class="card status-card">
      <h2>📅 통독 시작 전</h2>
      <p>시작일: <b>${state.startDate}</b></p>
      <p><b>${1-day}일</b> 후에 시작됩니다.</p>
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
  `;
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
  if ($('checkBtn')) $('checkBtn').onclick = () => {
    const d = getViewDay();
    if (state.readDays[d]) delete state.readDays[d]; else state.readDays[d] = true;
    saveState(); render();
  };
  if ($('shareBtn')) $('shareBtn').onclick = shareDay;
  if ($('copyBtn')) $('copyBtn').onclick = copyDay;
  if ($('listBtn')) $('listBtn').onclick = () => { state.view = 'list'; saveState(); render(); };
  if ($('settingsBtn')) $('settingsBtn').onclick = () => { state.view = 'settings'; saveState(); render(); };
}

async function shareDay() {
  const d = getViewDay();
  const entry = getDay(d);
  const tag = state.groupName ? `[${state.groupName}] ` : '';
  const summary = `📖 ${tag}성경 통독 Day ${d} / ${TOTAL_DAYS}\n\n오늘 본문: ${entry.l}` +
    (entry.s ? `\n📚 ${entry.s}` : '') +
    (entry.p ? `\n(교재 ${entry.p})` : '');
  if (navigator.share) {
    try { await navigator.share({ title: `성경 통독 Day ${d}`, text: summary }); }
    catch (e) { if (e.name !== 'AbortError') fallbackCopy(summary, '공유 시트를 열 수 없어서 요약을 복사했어요.'); }
  } else {
    fallbackCopy(summary, '요약을 복사했어요. 단톡방에 붙여넣어주세요.');
  }
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
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); toast(msg); }
  catch (e) { toast('복사에 실패했어요'); }
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

// === 목록 뷰 ===
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
      <span class="list-summary">${Object.values(state.readDays).filter(Boolean).length} / ${TOTAL_DAYS} 완료</span>
    </div>
    <ul class="day-list">${items}</ul>
  `;
}

function bindList() {
  document.getElementById('backBtn').onclick = () => { state.view = 'main'; saveState(); render(); };
  document.getElementById('listBtn').onclick = () => { state.view = 'main'; saveState(); render(); };
  document.getElementById('settingsBtn').onclick = () => { state.view = 'settings'; saveState(); render(); };
  document.querySelectorAll('.list-item').forEach(li => {
    li.onclick = () => {
      const d = +li.dataset.day;
      state.viewDay = (d === calcCurrentDay()) ? null : d;
      state.view = 'main';
      saveState();
      render();
    };
  });
}

function scrollToToday() {
  const el = document.querySelector('.list-item.today');
  if (el) el.scrollIntoView({ block: 'center' });
}

// === 설정 뷰 ===
function renderSettings() {
  return `
    ${renderHeader()}
    <button class="back-btn" id="backBtn">← 돌아가기</button>
    <div class="card settings-card">
      <h2>설정</h2>
      <label class="form-row">통독 시작일
        <input type="date" id="startDate" value="${state.startDate||todayLocalISO()}">
      </label>
      <label class="form-row">조 이름
        <input type="text" id="groupName" value="${escapeHtml(state.groupName||'')}" maxlength="40" placeholder="예) 2026 봄 1조">
      </label>
      <button class="primary" id="saveBtn">저장</button>
      <div class="divider"></div>
      <button class="danger-outline" id="resetReadBtn">읽음 진도만 초기화</button>
      <button class="danger" id="resetAllBtn">전체 초기화 (새 조 시작)</button>
      <p class="hint">전체 초기화는 시작일·조 이름·진도까지 모두 지웁니다. 새 조원과 시작할 때 사용하세요.</p>
    </div>
  `;
}

function bindSettings() {
  document.getElementById('backBtn').onclick = () => { state.view = 'main'; saveState(); render(); };
  document.getElementById('listBtn').onclick = () => { state.view = 'list'; saveState(); render(); };
  document.getElementById('settingsBtn').onclick = () => {};
  document.getElementById('saveBtn').onclick = () => {
    const d = document.getElementById('startDate').value;
    if (!d) { alert('시작일을 선택해주세요'); return; }
    state.startDate = d;
    state.groupName = document.getElementById('groupName').value.trim();
    state.view = 'main';
    state.viewDay = null;
    saveState();
    toast('저장되었어요');
    render();
  };
  document.getElementById('resetReadBtn').onclick = () => {
    if (!confirm('읽음 진도만 초기화할까요? (시작일과 조 이름은 유지됩니다)')) return;
    state.readDays = {};
    saveState();
    toast('진도가 초기화되었어요');
    render();
  };
  document.getElementById('resetAllBtn').onclick = () => {
    if (!confirm('전체 초기화 후 새로운 조로 시작하시겠어요?\n시작일·조 이름·진도가 모두 사라집니다.')) return;
    state = defaultState();
    saveState();
    render();
  };
}

// === 시작 ===
window.addEventListener('DOMContentLoaded', render);
