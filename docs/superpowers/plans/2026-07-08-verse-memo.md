# 절 단위 메모 기능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 성경 절에 개인 메모를 붙이고(절 단위, 나만 보기), 하이라이트처럼 클라우드로 동기화되어 혼자/조 모드에서 유지되게 한다.

**Architecture:** 기존 하이라이트(`state.highlights`)와 동일한 패턴으로 `state.memos`(verse ref → 텍스트)를 추가한다. 저장·동기화 경로(saveState/pushSoloData/subscribeSolo/init)를 하이라이트와 나란히 태우고, UI는 하이라이트 색상 툴바에 📝 버튼 + 전용 메모 모달 + 메모 있는 절의 📝 뱃지로 구성한다.

**Tech Stack:** Vanilla JS(번들러 없음, script-tag), Firebase compat(Firestore). app.js는 브라우저 전역(window/document/firebase) 의존이라 실행 불가 → `node --check`로 구문만 검증하고 UI는 수동 검증.

## Global Constraints

- 작업은 브랜치 `feature/verse-memo`에서 진행하고, 검증 후 `main`에 병합(= GitHub Pages 자동 배포). 실행 시작 시 `git -C "/c/AI/매일 말씀" checkout -b feature/verse-memo`.
- 수정 파일은 `app.js`, `index.html`만. Firestore 규칙 변경 없음(프로필 문서 필드 추가일 뿐).
- 메모는 개인용·전역: verse ref 키(예: `"창4:2"`), 값은 문자열. 하이라이트와 동일 취급.
- 커밋 메시지 끝에: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- 경로에 한글이 있어 bash `cd` 실패 가능 → node/git은 `"C:/AI/매일 말씀"` 절대경로 인용 사용.

---

## Task 1: memos 상태 + 동기화 배선

**Files:**
- Modify: `app.js` (defaultState ~54, pushSoloData ~178, subscribeSolo ~151, init 프로필로드 ~599)

**Interfaces:**
- Produces: `state.memos`(객체, verse ref → string). Task 3가 읽고 씀. `pushSoloData({ memos })` 지원.

- [ ] **Step 1: defaultState에 memos 추가**

`app.js`에서 `defaultState`의 `highlights: {},` 다음 줄에 추가:
```js
  memos: {},            // { "창4:2": "메모 텍스트", ... } — 개인용, 전역
```

- [ ] **Step 2: pushSoloData에 memos 전역키 처리 추가**

`pushSoloData` 안, `if (patch.highlights !== undefined) profilePatch.highlights = patch.highlights;` 다음 줄에 추가:
```js
  if (patch.memos !== undefined) profilePatch.memos = patch.memos;
```

- [ ] **Step 3: subscribeSolo에 memos 반영 추가**

`subscribeSolo`의 highlights 처리 블록:
```js
    if (data.highlights && JSON.stringify(data.highlights) !== JSON.stringify(state.highlights)) {
      state.highlights = data.highlights; changed = true;
    }
```
바로 다음에 추가:
```js
    if (data.memos && JSON.stringify(data.memos) !== JSON.stringify(state.memos)) {
      state.memos = data.memos; changed = true;
    }
```

- [ ] **Step 4: init 프로필 로드에 memos 복원 추가**

`init()`의 `if (rawCloud && rawCloud.highlights) state.highlights = rawCloud.highlights;` 다음 줄에 추가:
```js
    if (rawCloud && rawCloud.memos) state.memos = rawCloud.memos;
```

- [ ] **Step 5: 구문 검사 + 커밋**

Run: `node --check "C:/AI/매일 말씀/app.js"` → 성공(출력 없음).
```bash
git -C "/c/AI/매일 말씀" add app.js
git -C "/c/AI/매일 말씀" commit -m "feat: memos state + sync plumbing (mirror highlights)"
```

---

## Task 2: 툴바 📝 버튼 + 메모 모달 + CSS (index.html)

**Files:**
- Modify: `index.html` (hl-toolbar 마크업 ~498-504, CSS ~279 부근, body에 모달 추가)

**Interfaces:**
- Produces: DOM 요소 `#hl-toolbar .hl-memo-btn`, `#memo-modal`(내부 `#memo-ref`, `#memo-text`, `#memo-save`, `#memo-del`, `#memo-cancel`). CSS 클래스 `.verse-memo-badge`. Task 3가 이 요소들을 바인딩.

- [ ] **Step 1: 툴바에 📝 버튼 추가**

`index.html`의 `#hl-toolbar` 마크업에서 `<button class="hl-btn hl-remove" data-color="">✕</button>` 다음 줄에 추가:
```html
    <button class="hl-memo-btn" title="메모">📝</button>
```
(주의: 클래스에 `hl-btn`을 넣지 말 것 — 색상 처리 루프에 걸리면 안 됨.)

- [ ] **Step 2: 메모 모달 마크업 추가**

`index.html`에서 `#hl-toolbar`를 닫는 `</div>` 바로 다음에 추가:
```html
  <div id="memo-modal">
    <div class="memo-card">
      <div class="memo-ref" id="memo-ref"></div>
      <textarea id="memo-text" maxlength="1000" rows="5" placeholder="이 절에 대한 메모를 남겨보세요 (나만 봅니다)"></textarea>
      <div class="memo-actions">
        <button class="primary" id="memo-save">저장</button>
        <button class="memo-del" id="memo-del">삭제</button>
        <button class="memo-cancel" id="memo-cancel">취소</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 3: CSS 추가**

`index.html`의 `.hl-btn.hl-remove:hover{...}` 규칙 다음 줄에 추가:
```css
.hl-memo-btn{
  width:32px;height:32px;border-radius:50%;border:1.5px solid var(--line);
  background:#fff;cursor:pointer;transition:.15s;
  font-size:.95rem;display:flex;align-items:center;justify-content:center;
}
.hl-memo-btn:hover{transform:scale(1.15);border-color:var(--accent)}
.verse-memo-badge{
  display:inline-flex;align-items:center;margin-left:6px;padding:0 2px;
  font-size:.8rem;background:none;border:none;cursor:pointer;vertical-align:baseline;
}
#memo-modal{
  display:none;position:fixed;inset:0;z-index:210;
  background:rgba(0,0,0,.4);align-items:center;justify-content:center;padding:20px;
}
#memo-modal.show{display:flex}
.memo-card{
  background:#fff;width:100%;max-width:420px;border-radius:16px;padding:18px;
  box-shadow:0 8px 30px rgba(0,0,0,.2);
}
.memo-ref{font-weight:700;color:var(--accent);margin-bottom:8px}
#memo-text{
  width:100%;font-family:inherit;font-size:16px;padding:.7em .9em;
  border:1.5px solid var(--line);border-radius:10px;background:#fff;color:var(--text);
  resize:vertical;box-sizing:border-box;
}
.memo-actions{display:flex;gap:8px;margin-top:12px;align-items:center}
.memo-actions .primary{width:auto;flex:1;margin-top:0;padding:12px}
.memo-del{color:var(--bad);font-size:.9rem;padding:8px 12px}
.memo-cancel{color:var(--muted);font-size:.9rem;padding:8px 12px}
```

- [ ] **Step 4: 커밋**

(index.html은 정적이라 별도 실행 검증 없음. 브라우저 확인은 Task 4에서.)
```bash
git -C "/c/AI/매일 말씀" add index.html
git -C "/c/AI/매일 말씀" commit -m "feat: memo toolbar button, memo modal markup + CSS"
```

---

## Task 3: 메모 동작 JS (에디터 + 뱃지 + 툴바 연결)

**Files:**
- Modify: `app.js` (verse 렌더 ~325-330, 하이라이트 IIFE `initHighlighter` ~2162, 파일 하단에 메모 배선 추가)

**Interfaces:**
- Consumes: Task 1의 `state.memos`, `pushSoloData({memos})`. Task 2의 DOM(`#memo-modal`, `.hl-memo-btn`, `.verse-memo-badge`).
- Produces: 전역 함수 `openMemoEditor(ref)`.

- [ ] **Step 1: 절 렌더에 메모 뱃지 추가**

`app.js` 본문 렌더에서 현재:
```js
        const hlC = state.highlights[`${b}${ch}:${v}`];
        chBuf.push(`<div class="verse-compare" data-ref="${b}${ch}:${v}"${hlC?` data-hl="${hlC}"`:``}><span class="vnum">${v}</span>${verseLines}</div>`);
      } else {
        const text = d[view[0]] || d.GAE;
        const hlS = state.highlights[`${b}${ch}:${v}`];
        chBuf.push(`<p class="verse" data-ref="${b}${ch}:${v}"${hlS?` data-hl="${hlS}"`:``}><span class="vnum">${v}</span>${escapeHtml(text)}</p>`);
      }
```
를 다음으로 교체:
```js
        const refC = `${b}${ch}:${v}`;
        const hlC = state.highlights[refC];
        const memoC = state.memos[refC] ? `<button class="verse-memo-badge" data-ref="${refC}" title="메모 보기">📝</button>` : '';
        chBuf.push(`<div class="verse-compare" data-ref="${refC}"${hlC?` data-hl="${hlC}"`:``}><span class="vnum">${v}</span>${verseLines}${memoC}</div>`);
      } else {
        const text = d[view[0]] || d.GAE;
        const refS = `${b}${ch}:${v}`;
        const hlS = state.highlights[refS];
        const memoS = state.memos[refS] ? `<button class="verse-memo-badge" data-ref="${refS}" title="메모 보기">📝</button>` : '';
        chBuf.push(`<p class="verse" data-ref="${refS}"${hlS?` data-hl="${hlS}"`:``}><span class="vnum">${v}</span>${escapeHtml(text)}${memoS}</p>`);
      }
```

- [ ] **Step 2: openMemoEditor + 메모 모듈 추가**

`app.js` 하단, 하이라이트 IIFE `(function initHighlighter() { ... })();` 다음에 추가:
```js
// === 메모 에디터 ===
function memoRefLabel(ref) {
  // "창4:2" -> "창 4:2"
  return String(ref).replace(/^(\D+)/, '$1 ');
}

function openMemoEditor(ref) {
  const modal = document.getElementById('memo-modal');
  const ta = document.getElementById('memo-text');
  if (!modal || !ta || !ref) return;
  modal.dataset.ref = ref;
  const refEl = document.getElementById('memo-ref');
  if (refEl) refEl.textContent = memoRefLabel(ref);
  ta.value = state.memos[ref] || '';
  const delBtn = document.getElementById('memo-del');
  if (delBtn) delBtn.style.display = state.memos[ref] ? '' : 'none';
  modal.classList.add('show');
  setTimeout(() => ta.focus(), 50);
}

(function initMemo() {
  const modal = document.getElementById('memo-modal');
  if (!modal) return;
  const ta = document.getElementById('memo-text');

  function close() { modal.classList.remove('show'); modal.dataset.ref = ''; }

  function saveMemo(ref, text) {
    if (text) state.memos[ref] = text;
    else delete state.memos[ref];
    saveState();
    pushSoloData({ memos: state.memos });
    close();
    render();
  }

  const saveBtn = document.getElementById('memo-save');
  if (saveBtn) saveBtn.onclick = () => {
    const ref = modal.dataset.ref;
    if (!ref) return;
    saveMemo(ref, ta.value.trim());
  };
  const delBtn = document.getElementById('memo-del');
  if (delBtn) delBtn.onclick = () => {
    const ref = modal.dataset.ref;
    if (!ref) return;
    saveMemo(ref, '');
  };
  const cancelBtn = document.getElementById('memo-cancel');
  if (cancelBtn) cancelBtn.onclick = close;

  // 카드 바깥 클릭 시 닫기
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  // 메모 뱃지 클릭(위임) → 편집창 열기
  document.addEventListener('click', (e) => {
    const badge = e.target.closest && e.target.closest('.verse-memo-badge');
    if (badge) { e.preventDefault(); e.stopPropagation(); openMemoEditor(badge.dataset.ref); }
  });
})();
```

- [ ] **Step 3: 하이라이트 툴바의 📝 버튼 연결**

`app.js` `initHighlighter` IIFE 안, 색상 버튼을 바인딩하는 블록:
```js
  toolbar.querySelectorAll('.hl-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyHighlight(btn.dataset.color);
    });
  });
```
바로 다음에 추가:
```js
  const memoBtn = toolbar.querySelector('.hl-memo-btn');
  if (memoBtn) memoBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ref = _targetRef;
    hideToolbar();
    window.getSelection().removeAllRanges();
    if (ref) openMemoEditor(ref);
  });
```
(`_targetRef`, `hideToolbar`는 이 IIFE 스코프 안에 이미 존재. `openMemoEditor`는 상단 함수 선언이라 호출 가능.)

- [ ] **Step 4: 구문 검사 + 커밋**

Run: `node --check "C:/AI/매일 말씀/app.js"` → 성공.
```bash
git -C "/c/AI/매일 말씀" add app.js
git -C "/c/AI/매일 말씀" commit -m "feat: memo editor modal + verse badge + toolbar wiring"
```

---

## Task 4: 검증 + 병합 + 배포

**Files:** 없음(검증/병합만)

- [ ] **Step 1: 전체 구문 검사 + 기존 테스트 회귀 확인**

Run: `node --check "C:/AI/매일 말씀/app.js" && echo APP_OK`
Run: `node --test "C:/AI/매일 말씀/test/state-logic.test.js"` → 8 pass(메모는 이 테스트와 무관, 회귀 없음 확인)

- [ ] **Step 2: 수동 검증 체크리스트(브라우저, 로컬 또는 배포 후)**

1. 절 텍스트 선택 → 색상 툴바에 📝 보임 → 클릭 → 모달 열림(절 표기 "창 4:2")
2. 메모 입력 → 저장 → 그 절에 📝 뱃지 표시
3. 📝 뱃지 탭 → 기존 메모 보임 → 수정/삭제 동작
4. 혼자↔조 토글해도 메모·하이라이트 유지
5. 색상 툴바의 색상/✕ 버튼은 기존대로 하이라이트만(📝가 색 로직에 안 걸림)
6. 콘솔 에러 없음

- [ ] **Step 3: main 병합 + 푸시(배포)**

```bash
git -C "/c/AI/매일 말씀" checkout main
git -C "/c/AI/매일 말씀" merge --no-ff feature/verse-memo -m "Merge: 절 단위 메모 기능"
git -C "/c/AI/매일 말씀" push origin main
```

---

## Self-Review (작성자 점검)

- **Spec coverage:** 데이터 모델(memos)=Task1 · 동기화 경로(push/subscribe/init)=Task1 · 툴바 📝+모달=Task2 · 뱃지·에디터·툴바연결=Task3 · 하이라이트 공유(기존 유지, 변경 없음)=설계상 확인, 별도 태스크 불필요 · 검증=Task4. 모든 스펙 항목 커버. ✓
- **Placeholder scan:** TODO/TBD 없음. 모든 코드 스텝에 실제 코드 포함. ✓
- **Type consistency:** `state.memos`(객체), `openMemoEditor(ref:string)`, `pushSoloData({memos})`, DOM id(`memo-modal/memo-text/memo-ref/memo-save/memo-del/memo-cancel`), 클래스(`hl-memo-btn`, `verse-memo-badge`)가 Task 전반에서 일치. ✓
- **주의:** 📝 툴바 버튼은 `hl-btn` 클래스를 갖지 않아야 색상 처리 루프(`querySelectorAll('.hl-btn')`)에 안 걸림 — Task2 Step1에 명시.
