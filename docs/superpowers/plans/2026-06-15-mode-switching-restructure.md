# 혼자/조 전환 + 재방문 바로 진입 구조 개편 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 혼자/조 통독 진도를 완전 분리하고, 구글 로그인 사용자가 어느 기기에서든 마지막으로 보던 화면으로 바로 진입하게 하며, 중복 조원을 best-effort로 정리한다.

**Architecture:** 화면 렌더 코드는 "활성 컨텍스트"의 평면 필드를 그대로 읽고, 비활성(혼자) 데이터는 `state.soloStash`에 보관해 전환 시 swap한다(스냅샷 보관 방식). 기기 간 복원의 source of truth는 클라우드 `users/{uid}` 프로필이다. 병합/마이그레이션 같은 순수 로직은 `lib/state-logic.js`로 분리해 `node --test`로 검증한다.

**Tech Stack:** Vanilla JS (script-tag, 번들러 없음), Firebase compat SDK (Auth + Firestore), Node 24 내장 `node:test`.

---

## File Structure

- **Create** `lib/state-logic.js` — 순수 함수(`mergeReadDays`, `migrateState`, `mergeProfile`, `isProfileSetUp`). 브라우저(`window.StateLogic`) + Node(`module.exports`) 양쪽 노출.
- **Create** `test/state-logic.test.js` — 위 함수들의 `node:test` 단위 테스트.
- **Modify** `index.html` — `state-logic.js`를 `app.js`보다 먼저 로드.
- **Modify** `groups.js` — 프로필 read/write 확장(`watchProfile`/`saveProfile`), `removeMember`, `getMemberOnce`.
- **Modify** `app.js` — `defaultState`/`loadState`/`init`/전환 함수/토글 UI/중복 정리/owner 감지.
- **Modify** `firestore.rules` & `FIRESTORE_RULES.md` — members `owner delete` 규칙 추가, `users/{uid}` 규칙 명시.

---

## Task 1: 순수 로직 모듈 + 테스트 (mergeReadDays)

**Files:**
- Create: `lib/state-logic.js`
- Test: `test/state-logic.test.js`

- [ ] **Step 1: Write the failing test**

`test/state-logic.test.js`:
```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/state-logic.test.js`
Expected: FAIL — `Cannot find module '../lib/state-logic.js'`

- [ ] **Step 3: Write minimal implementation**

`lib/state-logic.js`:
```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/state-logic.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git -C "/c/AI/매일 말씀" add lib/state-logic.js test/state-logic.test.js
git -C "/c/AI/매일 말씀" commit -m "feat: state-logic mergeReadDays (union) + test"
```

---

## Task 2: migrateState (구버전 평면 상태 → 신구조)

**Files:**
- Modify: `lib/state-logic.js`
- Modify: `test/state-logic.test.js`

- [ ] **Step 1: Write the failing test** (append)

```js
test('migrateState: solo flat state -> soloStash filled, groupRef null', () => {
  const old = { mode: 'solo', plan: '365', startDate: '2026-01-01', groupName: '나의통독', readDays: { 1: true } };
  const s = SL.migrateState(old);
  assert.strictEqual(s.mode, 'solo');
  assert.deepStrictEqual(s.soloStash, { plan: '365', startDate: '2026-01-01', groupName: '나의통독', readDays: { 1: true } });
  assert.strictEqual(s.groupRef, null);
});

test('migrateState: group flat state -> groupRef filled', () => {
  const old = { mode: 'group', plan: '180', groupId: 'ABC123', displayName: '용환', readDays: { 2: true } };
  const s = SL.migrateState(old);
  assert.deepStrictEqual(s.groupRef, { groupId: 'ABC123', displayName: '용환' });
  // 조 모드일 땐 혼자 데이터 비어있는 기본 stash
  assert.deepStrictEqual(s.soloStash, { plan: '180', startDate: null, groupName: '', readDays: {} });
});

test('migrateState: already-migrated state passes through (idempotent)', () => {
  const cur = { mode: 'solo', soloStash: { plan: '180', startDate: null, groupName: '', readDays: {} }, groupRef: null };
  const s = SL.migrateState(cur);
  assert.deepStrictEqual(s.soloStash, cur.soloStash);
  assert.strictEqual(s.groupRef, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/state-logic.test.js`
Expected: FAIL — `SL.migrateState is not a function`

- [ ] **Step 3: Implement** (add inside factory, include in return)

```js
  function migrateState(s) {
    s = s || {};
    const out = Object.assign({}, s);
    // 이미 신구조면 보정만
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
```
return에 `migrateState` 추가: `return { mergeReadDays, migrateState };`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/state-logic.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git -C "/c/AI/매일 말씀" add lib/state-logic.js test/state-logic.test.js
git -C "/c/AI/매일 말씀" commit -m "feat: migrateState flat->nested (idempotent) + tests"
```

---

## Task 3: mergeProfile + isProfileSetUp (클라우드 ↔ 로컬 병합)

**Files:**
- Modify: `lib/state-logic.js`
- Modify: `test/state-logic.test.js`

- [ ] **Step 1: Write the failing test** (append)

```js
test('mergeProfile: cloud solo readDays union with local, scalars prefer cloud', () => {
  const localSolo = { plan: '180', startDate: '2026-01-01', groupName: 'L', readDays: { 1: true } };
  const cloud = { activeMode: 'group', solo: { plan: '365', startDate: '2026-02-02', groupName: 'C', readDays: { 3: true } }, groupRef: { groupId: 'XY', displayName: '용환' } };
  const m = SL.mergeProfile(localSolo, cloud);
  assert.strictEqual(m.activeMode, 'group');
  assert.strictEqual(m.solo.plan, '365');               // cloud 우선
  assert.deepStrictEqual(m.solo.readDays, { 1: true, 3: true }); // union
  assert.deepStrictEqual(m.groupRef, { groupId: 'XY', displayName: '용환' });
});

test('mergeProfile: no cloud -> derive from local solo, activeMode solo', () => {
  const localSolo = { plan: '180', startDate: '2026-01-01', groupName: 'L', readDays: { 1: true } };
  const m = SL.mergeProfile(localSolo, null);
  assert.strictEqual(m.activeMode, 'solo');
  assert.deepStrictEqual(m.solo.readDays, { 1: true });
  assert.strictEqual(m.groupRef, null);
});

test('isProfileSetUp: group with groupRef is set up; empty is not', () => {
  assert.strictEqual(SL.isProfileSetUp({ activeMode: 'group', groupRef: { groupId: 'X' }, solo: {} }), true);
  assert.strictEqual(SL.isProfileSetUp({ activeMode: 'solo', groupRef: null, solo: { startDate: '2026-01-01' } }), true);
  assert.strictEqual(SL.isProfileSetUp({ activeMode: 'solo', groupRef: null, solo: { startDate: null } }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/state-logic.test.js`
Expected: FAIL — `SL.mergeProfile is not a function`

- [ ] **Step 3: Implement** (add inside factory + return)

```js
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
```
return: `return { mergeReadDays, migrateState, mergeProfile, isProfileSetUp };`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/state-logic.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git -C "/c/AI/매일 말씀" add lib/state-logic.js test/state-logic.test.js
git -C "/c/AI/매일 말씀" commit -m "feat: mergeProfile + isProfileSetUp + tests"
```

---

## Task 4: state-logic.js를 앱에 연결 (defaultState/loadState)

**Files:**
- Modify: `index.html` (script 로드 순서)
- Modify: `app.js:43-55` (defaultState), `app.js:170-186` (loadState)

- [ ] **Step 1: index.html에 스크립트 추가**

`<script src="groups.js"></script>` 바로 다음 줄에 추가:
```html
  <script src="lib/state-logic.js"></script>
```
(주의: `app.js`보다 먼저 로드되어야 함)

- [ ] **Step 2: defaultState에 신규 필드 추가**

`app.js` `defaultState`의 `highlights: {},` 다음, 닫는 `})` 앞에 추가:
```js
  soloStash: { plan: '180', startDate: null, groupName: '', readDays: {} },
  groupRef: null,        // { groupId, displayName } | null
```

- [ ] **Step 3: loadState에서 마이그레이션 적용**

`app.js` `loadState`의 `const merged = Object.assign(defaultState(), s || {});` 다음 줄에 추가:
```js
  const migrated = window.StateLogic.migrateState(merged);
  Object.assign(merged, migrated);
```

- [ ] **Step 4: 구문 검사**

Run: `node --check "/c/AI/매일 말씀/app.js" && echo OK`
Expected: `OK`

- [ ] **Step 5: 수동 확인 + Commit**

브라우저에서 앱 로드 → 콘솔 에러 없음, 기존 진도 그대로 보임 확인.
```bash
git -C "/c/AI/매일 말씀" add index.html app.js
git -C "/c/AI/매일 말씀" commit -m "feat: wire state-logic, add soloStash/groupRef to state"
```

---

## Task 5: groups.js — 프로필 read/write + 멤버 헬퍼

**Files:**
- Modify: `groups.js` (watchSoloData/saveSoloData 인근, exports)

- [ ] **Step 1: 프로필 저장/구독 + 멤버 헬퍼 추가**

`groups.js`의 `function getUserId()` 앞에 추가:
```js
  // 사용자 프로필(혼자 컨텍스트 + 조 포인터 + 메타) — users/{uid}
  function watchProfile(uid, cb) {
    return db.collection('users').doc(uid).onSnapshot(
      snap => cb(snap.exists ? snap.data() : null),
      err => console.error('profile sync error:', err)
    );
  }
  async function saveProfile(uid, patch) {
    const ref = db.collection('users').doc(uid);
    const payload = { ...patch, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    try { await ref.set(payload, { merge: true }); }
    catch (e) { console.error('profile save:', e); }
  }
  async function getMemberOnce(code, uid) {
    const snap = await db.collection('groups').doc(code).collection('members').doc(uid).get();
    return snap.exists ? snap.data() : null;
  }
  async function removeMember(code, uid) {
    await ensureSignedIn();
    await db.collection('groups').doc(code).collection('members').doc(uid).delete();
  }
```

- [ ] **Step 2: exports에 추가**

`window.Groups = { ... }`의 `watchSoloData,` 다음에 추가:
```js
    watchProfile,
    saveProfile,
    getMemberOnce,
    removeMember,
```

- [ ] **Step 3: 구문 검사**

Run: `node --check "/c/AI/매일 말씀/groups.js" && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git -C "/c/AI/매일 말씀" add groups.js
git -C "/c/AI/매일 말씀" commit -m "feat: Groups.watchProfile/saveProfile/getMemberOnce/removeMember"
```

---

## Task 6: Firestore 규칙 — members owner-delete + users 명시 + 배포

**Files:**
- Modify: `firestore.rules`, `FIRESTORE_RULES.md`

- [ ] **Step 1: members delete 규칙 확장**

`firestore.rules`의 members 블록:
```
        allow delete: if signedIn() && request.auth.uid == userId;
```
을 다음으로 교체:
```
        allow delete: if signedIn()
          && (request.auth.uid == userId || isGroupOwner(groupId));
```

- [ ] **Step 2: users 컬렉션 규칙 추가**

`firestore.rules`의 `match /groups/{groupId} {` 바로 앞에 추가:
```
    match /users/{userId} {
      allow read, write: if signedIn() && request.auth.uid == userId;
    }
```

- [ ] **Step 3: FIRESTORE_RULES.md도 동일하게 반영**

`FIRESTORE_RULES.md`의 동일 두 지점을 같은 내용으로 수정(문서 일관성 유지).

- [ ] **Step 4: 규칙 컴파일 검증 + 배포**

Run:
```bash
cd "/c/AI/매일 말씀" && npx -y firebase-tools deploy --only firestore:rules --project biblereading-180days --non-interactive
```
Expected: `compiled successfully` + `Deploy complete!`

- [ ] **Step 5: Commit**

```bash
git -C "/c/AI/매일 말씀" add firestore.rules FIRESTORE_RULES.md
git -C "/c/AI/매일 말씀" commit -m "feat: firestore rules - owner can delete members, users profile rules"
```

---

## Task 7: 전환 함수 + 세그먼트 토글 UI

**Files:**
- Modify: `app.js` (전환 함수 신규, renderHeader 인근, 공통 바인딩)

- [ ] **Step 1: 전환 함수 추가**

`app.js`의 `function exitGroup()` 앞에 추가:
```js
// === 혼자 ↔ 조 전환 ===
function persistActiveMode() {
  if (!volatile.userId || !isGoogleLinked()) return;
  Groups.saveProfile(volatile.userId, {
    activeMode: state.mode,
    groupRef: state.groupRef || null
  });
}

function switchToSolo() {
  if (state.mode === 'solo') return;
  Groups.unsubscribe();
  // 조 멤버십 포인터 보존
  state.groupRef = state.groupId ? { groupId: state.groupId, displayName: state.displayName } : state.groupRef;
  // 평면 필드를 혼자 데이터로 복원
  const s = state.soloStash || { plan: '180', startDate: null, groupName: '', readDays: {} };
  state.mode = 'solo';
  state.plan = s.plan || '180';
  state.startDate = s.startDate || null;
  state.groupName = s.groupName || '';
  state.readDays = s.readDays || {};
  state.groupId = null;
  state.displayName = '';
  state.viewDay = null;
  state.view = 'main';
  applyPlan(state.plan);
  saveState();
  persistActiveMode();
  subscribeSolo();
  render();
}

function switchToGroup() {
  if (state.mode === 'group') return;
  // 현재 혼자 데이터를 stash에 저장
  state.soloStash = { plan: state.plan, startDate: state.startDate, groupName: state.groupName, readDays: state.readDays };
  if (state.groupRef && state.groupRef.groupId) {
    state.mode = 'group';
    state.groupId = state.groupRef.groupId;
    state.displayName = state.groupRef.displayName || '';
    state.viewDay = null;
    state.view = 'main';
    saveState();
    persistActiveMode();
    subscribeToGroup();
    render();
  } else {
    // 아직 조 없음 → 조 만들기/참가 플로우
    state.mode = 'group';
    state.groupId = null;
    state.view = 'main';
    saveState();
    render(); // renderGroupChoice 로 분기됨
  }
}
```

- [ ] **Step 2: 토글 렌더 함수 추가**

`function renderHeader()` 앞에 추가:
```js
function renderModeToggle() {
  if (!isGoogleLinked()) return '';
  const solo = state.mode === 'solo';
  return `
    <div class="mode-toggle">
      <button class="mode-toggle-btn ${solo?'active':''}" id="toggleSolo">🙂 혼자</button>
      <button class="mode-toggle-btn ${!solo?'active':''}" id="toggleGroup">👥 조</button>
    </div>`;
}
```

- [ ] **Step 3: 헤더에 토글 삽입**

`renderHeader`의 `</header>` 바로 다음(반환 문자열 끝)에 토글을 붙인다. 현재:
```js
    </header>`;
```
를:
```js
    </header>
    ${renderModeToggle()}`;
```

- [ ] **Step 4: 공통 바인딩 함수 추가 + 호출**

`app.js`에 헤더 바인딩 헬퍼 추가(`renderHeader` 근처):
```js
function bindModeToggle() {
  const s = document.getElementById('toggleSolo');
  const g = document.getElementById('toggleGroup');
  if (s) s.onclick = () => switchToSolo();
  if (g) g.onclick = () => switchToGroup();
}
```
그리고 `bindMain`, `bindList`, `bindMembers`, `bindSettings`, `bindPrayer` 각 함수 맨 끝에 `bindModeToggle();` 추가.

- [ ] **Step 5: CSS 추가**

`index.html` `</style>` 앞에:
```css
.mode-toggle{display:flex;gap:6px;max-width:560px;margin:0 auto 12px;padding:0 4px}
.mode-toggle-btn{flex:1;padding:8px 0;border-radius:10px;border:1.5px solid var(--line);background:#fff;color:var(--muted);font-weight:600;font-size:.9rem}
.mode-toggle-btn.active{background:var(--accent);color:#fff;border-color:var(--accent)}
```

- [ ] **Step 6: 구문 검사 + 수동 확인 + Commit**

Run: `node --check "/c/AI/매일 말씀/app.js" && echo OK` → `OK`
브라우저: 토글로 혼자↔조 전환 시 각 진도/시작일 유지 확인.
```bash
git -C "/c/AI/매일 말씀" add app.js index.html
git -C "/c/AI/매일 말씀" commit -m "feat: solo<->group switch + segmented toggle UI"
```

---

## Task 8: init() — 프로필 로드 후 마지막 화면 바로 진입

**Files:**
- Modify: `app.js:438-469` (init), `subscribeSolo`/`pushSoloData` 인근

- [ ] **Step 1: pushSoloData를 프로필 저장으로 확장**

`app.js` `pushSoloData` 본문을 다음으로 교체(혼자 데이터를 프로필.solo로 저장):
```js
function pushSoloData(patch) {
  if (!isGoogleLinked() || !volatile.userId) return;
  // 평면 혼자 필드 + patch 를 프로필.solo 로 병합 저장
  const solo = {
    plan: state.plan, startDate: state.startDate,
    groupName: state.groupName, readDays: state.readDays, ...patch
  };
  // 단, 현재 조 모드면 평면이 조 데이터이므로 soloStash 기준으로 저장
  const base = state.mode === 'group' ? (state.soloStash || {}) : solo;
  const merged = state.mode === 'group' ? { ...base, ...patch } : solo;
  Groups.saveProfile(volatile.userId, { solo: merged, activeMode: state.mode, groupRef: state.groupRef || null });
}
```

- [ ] **Step 2: init에 프로필 로드/병합 + 바로진입 분기 추가**

`app.js` init의 `volatile.needsLogin = false;` 다음, `document.addEventListener('click', ...)`(prayerBtn) 앞에 추가:
```js
  // 클라우드 프로필 로드 → 마지막 화면 복원
  try {
    const cloud = await new Promise((resolve) => {
      let done = false;
      const unsub = Groups.watchProfile(volatile.userId, (data) => {
        if (!done) { done = true; resolve(data); }
        // 이후 변경은 무시(단발 로드). 지속 동기화는 subscribeSolo가 담당.
        if (unsub) unsub();
      });
      setTimeout(() => { if (!done) { done = true; resolve(null); } }, 4000);
    });
    const merged = window.StateLogic.mergeProfile(state.soloStash, cloud);
    state.soloStash = merged.solo;
    state.groupRef = merged.groupRef;
    // 마지막 활성 모드로 평면 필드 세팅
    if (merged.activeMode === 'group' && merged.groupRef && merged.groupRef.groupId) {
      state.mode = 'group';
      state.groupId = merged.groupRef.groupId;
      state.displayName = merged.groupRef.displayName || '';
    } else if (window.StateLogic.isProfileSetUp(merged)) {
      state.mode = 'solo';
      state.plan = merged.solo.plan; state.startDate = merged.solo.startDate;
      state.groupName = merged.solo.groupName; state.readDays = merged.solo.readDays;
      applyPlan(state.plan);
    }
    saveState();
  } catch (e) { console.error('profile load', e); }
```

- [ ] **Step 3: init의 모드별 구독 분기 갱신**

기존:
```js
  if (state.mode === 'group' && state.groupId) {
    subscribeToGroup();
  } else if (state.mode === 'solo' && isGoogleLinked()) {
    subscribeSolo();
  }
  render();
```
이미 적절. 단 `subscribeSolo`가 프로필(solo) 변경을 평면에 반영하도록 Task 9에서 갱신.

- [ ] **Step 4: 구문 검사 + 수동 확인**

Run: `node --check "/c/AI/매일 말씀/app.js" && echo OK` → `OK`
새 시크릿 창(또는 다른 기기)에서 로그인 → 위저드 없이 마지막 화면 진입 확인.

- [ ] **Step 5: Commit**

```bash
git -C "/c/AI/매일 말씀" add app.js
git -C "/c/AI/매일 말씀" commit -m "feat: load cloud profile on init, restore last view"
```

---

## Task 9: subscribeSolo를 프로필 기반으로 갱신

**Files:**
- Modify: `app.js:122-161` (subscribeSolo / watchSoloData 사용처)

- [ ] **Step 1: subscribeSolo가 watchProfile을 쓰도록 교체**

`subscribeSolo` 본문에서 `Groups.watchSoloData(...)` 호출을 `Groups.watchProfile(...)`로 바꾸고, 콜백에서 `data.solo`를 평면(혼자 모드일 때만)에 반영:
```js
function subscribeSolo() {
  if (soloUnsub) { soloUnsub(); soloUnsub = null; }
  if (!volatile.userId || !isGoogleLinked()) return;
  soloUnsub = Groups.watchProfile(volatile.userId, (data) => {
    if (!data) return;
    state.groupRef = data.groupRef || state.groupRef;
    const cs = data.solo;
    if (cs) {
      const mergedRead = window.StateLogic.mergeReadDays(
        state.mode === 'solo' ? state.readDays : (state.soloStash && state.soloStash.readDays),
        cs.readDays
      );
      if (state.mode === 'solo') {
        let changed = false;
        if (cs.plan && cs.plan !== state.plan) { state.plan = cs.plan; applyPlan(cs.plan); changed = true; }
        if (cs.startDate && cs.startDate !== state.startDate) { state.startDate = cs.startDate; changed = true; }
        if (cs.groupName !== undefined && cs.groupName !== state.groupName) { state.groupName = cs.groupName; changed = true; }
        state.readDays = mergedRead;
        state.soloStash = { plan: state.plan, startDate: state.startDate, groupName: state.groupName, readDays: mergedRead };
        saveState(); if (changed || true) render();
      } else {
        state.soloStash = { plan: cs.plan, startDate: cs.startDate, groupName: cs.groupName, readDays: mergedRead };
        saveState();
      }
    }
  });
}
```

- [ ] **Step 2: 구문 검사**

Run: `node --check "/c/AI/매일 말씀/app.js" && echo OK` → `OK`

- [ ] **Step 3: 수동 확인 + Commit**

두 기기에서 혼자 모드 진도 체크 → 양쪽 합쳐짐 확인.
```bash
git -C "/c/AI/매일 말씀" add app.js
git -C "/c/AI/매일 말씀" commit -m "feat: subscribeSolo via profile, union readDays sync"
```

---

## Task 10: 중복 조원 자동 정리 (best-effort) + 이전 UID 캡처

**Files:**
- Modify: `groups.js` (onAuthChange에서 prevUid 노출 — 이미 콜백에 prevUid 전달됨), `app.js` (reconcile 로직)

- [ ] **Step 1: 로그인 시 이전 UID를 프로필에 기록**

`app.js` init에서 프로필 로드 직후(merged 처리 후)에 추가:
```js
  // 이전(익명) UID 기록 — UID 변경 감지용
  Groups.onAuthChange((user, prevUid) => {
    if (user && prevUid && prevUid !== user.uid) {
      Groups.saveProfile(user.uid, { previousUids: firebase.firestore.FieldValue.arrayUnion(prevUid) });
      reconcileDuplicateMember(prevUid);
    }
  });
```

- [ ] **Step 2: reconcile 함수 추가**

`app.js` switchToGroup 인근에 추가:
```js
async function reconcileDuplicateMember(oldUid) {
  try {
    const code = (state.groupRef && state.groupRef.groupId) || state.groupId;
    if (!code || !oldUid || !volatile.userId) return;
    const oldMember = await Groups.getMemberOnce(code, oldUid);
    if (!oldMember) return;
    const myMember = await Groups.getMemberOnce(code, volatile.userId);
    // 내 새 문서에 이전 진도 합집합 병합
    const mergedRead = window.StateLogic.mergeReadDays(
      myMember ? myMember.readDays : {}, oldMember.readDays
    );
    await Groups.setReadDays(code, mergedRead);
    // 이전 문서 삭제 (조장 권한 필요 — 규칙에서 owner delete 허용)
    await Groups.removeMember(code, oldUid);
    toast('이전 기록을 정리했어요');
  } catch (e) { console.warn('reconcile skipped:', e.message || e); }
}
```

- [ ] **Step 3: 구문 검사 + Commit**

Run: `node --check "/c/AI/매일 말씀/app.js" && echo OK` → `OK`
```bash
git -C "/c/AI/매일 말씀" add app.js
git -C "/c/AI/매일 말씀" commit -m "feat: best-effort reconcile duplicate member on uid change"
```

---

## Task 11: 익명-owner(죽은 조) 감지 + 재생성 안내

**Files:**
- Modify: `app.js` (renderMembers 또는 조 진입 시 점검)

- [ ] **Step 1: 감지 + 배너 렌더**

`app.js` `renderMembers()`의 카드 상단(`<h2 ...>조원 진도...` 다음)에 삽입:
```js
      ${(() => {
        const gd = volatile.groupData;
        if (!gd || state.mode !== 'group') return '';
        const ownerPresent = volatile.members.some(m => m.uid === gd.owner);
        if (ownerPresent) return '';
        return `<div class="orphan-warn">
          ⚠️ 이 조는 만든 사람의 계정이 사라져 관리가 어려운 상태예요.
          새 조를 만들어 초대 링크를 다시 공유하시길 권장합니다.
          <button class="prayer-mini-btn" id="recreateGroupBtn" style="margin-top:8px">새 조 만들기</button>
        </div>`;
      })()}
```

- [ ] **Step 2: 버튼 바인딩**

`bindMembers()`에 추가:
```js
  const rc = document.getElementById('recreateGroupBtn');
  if (rc) rc.onclick = () => { state.mode = 'group'; state.groupId = null; state.groupRef = null; state.view = 'group-create'; saveState(); render(); };
```

- [ ] **Step 3: CSS**

`index.html` `</style>` 앞:
```css
.orphan-warn{background:#fef3c7;border:1px solid #fcd34d;color:#92400e;border-radius:10px;padding:12px;font-size:.88rem;line-height:1.5;margin:8px 0 12px}
```

- [ ] **Step 4: 구문 검사 + Commit**

Run: `node --check "/c/AI/매일 말씀/app.js" && echo OK` → `OK`
```bash
git -C "/c/AI/매일 말씀" add app.js index.html
git -C "/c/AI/매일 말씀" commit -m "feat: detect orphaned-owner group, offer recreate"
```

---

## Task 12: 전체 검증 + 푸시

- [ ] **Step 1: 전체 테스트**

Run: `node --test "/c/AI/매일 말씀/test/"`
Expected: 모든 테스트 PASS (8개)

- [ ] **Step 2: 구문 검사 일괄**

Run: `for f in app.js groups.js lib/state-logic.js; do node --check "/c/AI/매일 말씀/$f" && echo "$f OK"; done`
Expected: 3개 모두 OK

- [ ] **Step 3: 수동 검증 체크리스트** (브라우저)

1. 혼자→조→혼자 전환 시 각자 진도/시작일 유지
2. 새 시크릿창 로그인 → 위저드 없이 마지막 화면 진입 + 조 복원
3. 중복 조원이 로그인 후 정리되고 진도 병합
4. 익명-owner 조에서 재생성 안내 노출
5. 조장이 아닌 사람은 타인 삭제 불가(조장만 가능)

- [ ] **Step 4: 푸시**

```bash
git -C "/c/AI/매일 말씀" push origin main
```

---

## Self-Review (작성자 점검 결과)

- **Spec coverage:** 진도 분리(Task 7,9), 재방문 진입(Task 8), 중복 정리(Task 10), 익명-owner 안내(Task 11), 규칙(Task 6) — 전부 태스크 존재. ✓
- **Placeholder scan:** "TODO/TBD" 없음, 모든 코드 스텝에 실제 코드 포함. ✓
- **Type consistency:** `mergeReadDays/migrateState/mergeProfile/isProfileSetUp` 명칭이 정의(Task1-3)와 사용처(Task4,8,9,10)에서 일치. `soloStash/groupRef` 형태 일관. `Groups.saveProfile/watchProfile/getMemberOnce/removeMember` 정의(Task5)와 사용(Task7-10) 일치. ✓
- **주의(실행자에게):** Task 9의 subscribeSolo는 단발 로드(Task8)와 지속 구독이 같은 `watchProfile`을 쓰므로, 무한 렌더 루프가 없도록 변경 감지 후에만 render 하도록 유지할 것.
