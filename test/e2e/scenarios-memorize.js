// 성경암송 시나리오 — run.js가 조 모드 단계(초대 스킵) 뒤, 조 나가기 전에 호출한다.
// 상태: 조 모드, 조 TEST01(u-tester 조장, u-other 조원).
module.exports = async function memorizeScenarios({ d, page, step, tap, audit, shot }) {
  const db = () => page.evaluate(() => window.__mockExternal.db());
  const wait = ms => page.waitForTimeout(ms);
  const card = id => `.memo-card[data-id="${id}"]`;
  const act = (id, a) => tap(`${card(id)} [data-act="${a}"]`);
  const today = () => page.evaluate(() => todayLocalISO());

  // ── Task 7: 암송 화면 ──
  await step('암송 화면 진입(헤더 암송) · 출처 문구', async () => {
    await tap('#memoBtn'); await page.waitForSelector('.memo-screen', { timeout: 5000 });
    const src = await page.$eval('.memo-source', e => e.textContent.trim());
    if (src !== '출처: 사랑의교회 성경암송 72구절 (네비게이토)') throw new Error(src);
  });
  await step('이번 주: 시작일 미설정 → 조장 설정 → 1주차 고후5:17·갈2:20', async () => {
    const s0 = await page.$eval('.memo-week-status', e => e.textContent);
    await page.fill('#memoStartInput', await today()); await tap('#memoStartSave');
    await page.waitForSelector(card('고후5:17'), { timeout: 5000 }); await page.waitForSelector(card('갈2:20'));
    const s1 = await page.$eval('.memo-week-status', e => e.textContent);
    await shot('memo-01-week');
    if (!/시작일/.test(s0) || !/1주차/.test(s1)) throw new Error(`${s0} / ${s1}`);
  });
  await step('미래 시작일 → "M월 D일부터 시작해요", 36주 이후 → 한 바퀴·전체 72 기본', async () => {
    const t = await today();
    await page.evaluate(x => { volatile.groupData.memoStart = MemorizeLogic.addDays(x, 7); render(); }, t);
    const fut = await page.$eval('.memo-week-status', e => e.textContent);
    await page.evaluate(x => { volatile.groupData.memoStart = MemorizeLogic.addDays(x, -260); volatile.memo.tab = null; render(); }, t);
    const done = await page.$eval('.memo-screen', e => e.textContent);
    const allTab = await page.$eval('.memo-tab[data-tab="all"]', e => e.getAttribute('aria-pressed'));
    await page.evaluate(x => { volatile.groupData.memoStart = x; volatile.memo.tab = null; render(); }, t);
    if (!/\d+월 \d+일부터 시작해요/.test(fut) || !/한 바퀴/.test(done) || allTab !== 'true') throw new Error(JSON.stringify({ fut, allTab }));
  });
  await step('가리고 말하기 → 본문 숨김, 주소·소주제 보임', async () => {
    await act('고후5:17', 'hide'); await wait(150);
    const s = await page.$eval(card('고후5:17'), e => ({ text: !!e.querySelector('.memo-text'), ref: e.querySelector('.memo-ref').textContent, leaked: e.textContent.includes('새로운 피조물') }));
    const status = await page.$eval('.memo-week-status', e => e.textContent); // 소주제는 위 주차 줄에 보임
    if (s.text || s.leaked || !/고린도후서 5:17/.test(s.ref) || !/중심되신 그리스도/.test(status)) throw new Error(JSON.stringify({ s, status }));
  });
  await step('힌트 2번 → 두 어절 + …, 다시 가리기 → 초기화', async () => {
    await act('고후5:17', 'hint'); await act('고후5:17', 'hint'); await wait(100);
    const h = await page.$eval(`${card('고후5:17')} .memo-hint`, e => e.textContent.trim());
    await act('고후5:17', 'rehide'); await wait(100);
    const after = await page.$(`${card('고후5:17')} .memo-hint`);
    if (h !== '그런즉 누구든지 …' || after) throw new Error(h);
  });
  await step('연습 상태가 동기화 재렌더 후 유지', async () => {
    await act('고후5:17', 'hint'); await wait(100);
    await page.evaluate(() => window.__mockExternal.otherMemorizes('TEST01', '갈2:20', '2026-11-20')); await wait(300);
    const s = await page.$eval(card('고후5:17'), e => ({ text: !!e.querySelector('.memo-text'), hint: (e.querySelector('.memo-hint') || {}).textContent }));
    if (s.text || (s.hint || '').trim() !== '그런즉 …') throw new Error(JSON.stringify(s));
    await act('고후5:17', 'show');
  });
  await step('갈2:20 나눠 연습: 1/5 → 다음 → 이전 → 처음부터', async () => {
    await act('갈2:20', 'chunk'); await wait(100);
    const p1 = await page.$eval(`${card('갈2:20')} .memo-part`, e => e.textContent);
    await act('갈2:20', 'next'); const p2 = await page.$eval(`${card('갈2:20')} .memo-part`, e => e.textContent);
    await act('갈2:20', 'prev'); const p3 = await page.$eval(`${card('갈2:20')} .memo-part`, e => e.textContent);
    await shot('memo-02-chunk');
    await act('갈2:20', 'whole'); await wait(100);
    const gone = !(await page.$(`${card('갈2:20')} .memo-part`));
    if (!/1 \/ 5 부분/.test(p1) || !/2 \/ 5 부분/.test(p2) || !/1 \/ 5 부분/.test(p3) || !gone) throw new Error([p1, p2, p3, gone].join(' | '));
  });
  await step('외웠어요 → aria-pressed·토스트·전체 72 카운트, 다시 누르면 취소', async () => {
    await act('고후5:17', 'mem'); await wait(300);
    const pressed = await page.$eval(`${card('고후5:17')} [data-act="mem"]`, e => e.getAttribute('aria-pressed'));
    const toastTxt = await page.$eval('#toast', e => e.textContent);
    await tap('.memo-tab[data-tab="all"]'); await wait(100);
    const cnt = await page.$eval('.memo-set[data-set="A"] .memo-set-count', e => e.textContent);
    await tap('.memo-tab[data-tab="week"]'); await wait(100);
    await act('고후5:17', 'mem'); await wait(300);
    const after = await page.$eval(`${card('고후5:17')} [data-act="mem"]`, e => e.getAttribute('aria-pressed'));
    if (pressed !== 'true' || !/외웠어요/.test(toastTxt) || !/1\s*\/\s*12/.test(cnt) || after !== 'false') throw new Error(JSON.stringify({ pressed, toastTxt, cnt, after }));
  });
  await step('듣기 기능 없음(사용자 결정), 이번 주 카드엔 소주제 줄 없음(위 주차 줄과 중복)', async () => {
    // 한국어 음성이 있는 기기여도 듣기 버튼이 없어야 한다
    await page.evaluate(() => {
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => [{ lang: 'ko-KR', name: '모의 음성' }], speak() {}, cancel() {}, addEventListener() {} } });
      render();
    });
    const tts = await page.$$eval('[data-act="tts"]', a => a.length);
    const topicInWeek = await page.$$eval('.memo-body > .memo-card .memo-topic', a => a.length);
    if (tts || topicInWeek) throw new Error(JSON.stringify({ tts, topicInWeek }));
  });
  await step('조원 현황: N/72, 이번 주 2구절 ✓/○, 펼치면 묶음별', async () => {
    await tap('.memo-tab[data-tab="board"]'); await page.waitForSelector('.memo-member[data-uid="u-other"]', { timeout: 3000 });
    const row = await page.$eval('.memo-member[data-uid="u-other"]', e => ({ count: e.querySelector('.memo-member-count').textContent, week: e.querySelector('.memo-member-week').textContent }));
    await tap('.memo-member[data-uid="u-other"] .memo-member-head'); await wait(100);
    const detail = await page.$eval('.memo-member[data-uid="u-other"] .memo-member-detail', e => e.textContent).catch(() => '');
    await shot('memo-03-board');
    await tap('.memo-tab[data-tab="week"]');
    if (!/2\s*\/\s*72/.test(row.count) || (row.week.match(/✓/g) || []).length !== 2 || !/새로운 삶/.test(detail)) throw new Error(JSON.stringify({ row, detail: detail.slice(0, 40) }));
  });
  await step('복습 1구절: 복습할 때 노출 → 복습 마치기 → 3일 뒤', async () => {
    const t = await today();
    await page.evaluate(() => toggleMemorized('롬12:1')); await wait(300);
    await page.evaluate(x => { localStorage.setItem('memorize_review_v1_u-tester', JSON.stringify({ '롬12:1': { intervalStep: 0, nextReviewOn: x } })); render(); }, t);
    await tap('#memoReviewBtn'); await page.waitForSelector('.memo-card.review [data-act="review-done"]', { timeout: 3000 });
    await tap('.memo-card.review [data-act="review-done"]'); await wait(200);
    const map = await page.evaluate(() => JSON.parse(localStorage.getItem('memorize_review_v1_u-tester')));
    const stillBtn = await page.$('#memoReviewBtn');
    const expect = await page.evaluate(x => MemorizeLogic.addDays(x, 3), t);
    await page.evaluate(() => toggleMemorized('롬12:1')); await wait(300);
    const cleared = await page.evaluate(() => (JSON.parse(localStorage.getItem('memorize_review_v1_u-tester')) || {})['롬12:1'] || null);
    if (!map['롬12:1'] || map['롬12:1'].nextReviewOn !== expect || stillBtn || cleared) throw new Error(JSON.stringify({ map, stillBtn: !!stillBtn, cleared }));
  });
  await step('320px·글자 24px: 헤더 5아이콘·암송 화면 가로넘침 없음', async () => {
    const vp = page.viewportSize();
    await page.setViewportSize({ width: 320, height: 640 });
    await page.evaluate(() => { state.fontSize = 24; saveState(); render(); });
    // 카드별 연습 상태가 유지되므로(앞 단계 '처음부터 말하기'로 가려 둠) 먼저 펼친다
    if (await page.$(`${card('갈2:20')} [data-act="show"]`)) await act('갈2:20', 'show');
    await act('갈2:20', 'chunk'); await wait(150);
    const a = await audit(page, '암송 320px');
    const header = await page.$eval('.header-actions', e => { const r = e.getBoundingClientRect(); return r.right <= innerWidth + 1; });
    await shot('memo-04-320');
    await act('갈2:20', 'whole'); await act('갈2:20', 'show');
    await page.evaluate(() => { state.fontSize = 18; saveState(); render(); });
    await page.setViewportSize(vp);
    if (a.overflowX > 0 || a.offscreen.length || !header) throw new Error(JSON.stringify(a));
  });
  await step('메인 카드 문구가 주차와 일치 · 뒤로가기로 메인 복귀', async () => {
    await page.goBack(); await page.waitForSelector('.passage-card', { timeout: 3000 });
    const txt = await page.$eval('#memoWeekCard', e => e.textContent);
    await tap('#memoWeekCard'); await page.waitForSelector('.memo-screen', { timeout: 3000 });
    await page.goBack(); await page.waitForSelector('.passage-card', { timeout: 3000 });
    if (!/1주차/.test(txt)) throw new Error(txt);
  });
  // ── 최종 리뷰 지적 수정 검증 ──
  await step('리뷰: 연습 상태는 카드마다 따로 (두 번째 카드를 가려도 첫 카드는 가린 채)', async () => {
    await tap('#memoBtn'); await page.waitForSelector(card('고후5:17'));
    await act('고후5:17', 'hide'); await act('갈2:20', 'hide'); await wait(150);
    const s = await page.evaluate(() => [...document.querySelectorAll('.memo-card')].map(c => !!c.querySelector('.memo-text')));
    await act('고후5:17', 'show'); await act('갈2:20', 'show');
    if (s[0] || s[1]) throw new Error(JSON.stringify(s));
  });
  await step('리뷰: 힌트를 끝까지 보면 힌트 버튼 비활성', async () => {
    await act('고후5:17', 'hide');
    const n = await page.evaluate(() => MemorizeLogic.words(memoText(MEMO_BY_ID['고후5:17'])).length);
    for (let i = 0; i < n; i++) await act('고후5:17', 'hint');
    const dis = await page.$eval(`${card('고후5:17')} [data-act="hint"]`, e => e.disabled);
    await act('고후5:17', 'show');
    if (!dis) throw new Error('활성 상태');
  });
  await step('리뷰: 다시 외우면 복습 일정 새로 시작, 해제 실패 시 일정 유지', async () => {
    const K = 'memorize_review_v1_u-tester';
    await page.evaluate(k => localStorage.setItem(k, JSON.stringify({ '롬12:1': { intervalStep: 4, nextReviewOn: '2099-01-01' } })), K);
    await page.evaluate(() => toggleMemorized('롬12:1')); await wait(300);
    const afterCheck = await page.evaluate(k => (JSON.parse(localStorage.getItem(k)) || {})['롬12:1'] || null, K);
    await page.evaluate(k => localStorage.setItem(k, JSON.stringify({ '롬12:1': { intervalStep: 1, nextReviewOn: '2099-01-01' } })), K);
    await page.evaluate(() => { window.__mockFail = { setMemorized: 'unavailable' }; });
    await page.evaluate(() => toggleMemorized('롬12:1')); await wait(300);
    const afterFail = await page.evaluate(k => (JSON.parse(localStorage.getItem(k)) || {})['롬12:1'] || null, K);
    await page.evaluate(() => { window.__mockFail = null; });
    await page.evaluate(() => toggleMemorized('롬12:1')); await wait(300);
    const afterUncheck = await page.evaluate(k => (JSON.parse(localStorage.getItem(k)) || {})['롬12:1'] || null, K);
    if (afterCheck || !afterFail || afterUncheck) throw new Error(JSON.stringify({ afterCheck, afterFail, afterUncheck }));
  });
  await step('리뷰: 첫 로드가 서버 확인값이면 다른 기기에서 해제한 구절을 바로 반영', async () => {
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('bible180_state_v2'));
      s.memorized = Object.assign({}, s.memorized, { '요15:7': '2026-11-01' }); // 클라우드엔 없음
      localStorage.setItem('bible180_state_v2', JSON.stringify(s));
      localStorage.setItem('__mockSlowProfile', '1'); // 실시간 구독 스냅샷을 늦춰 첫 로드 경로만 검증
    });
    await page.reload(); await page.waitForSelector('header', { timeout: 15000 }); await wait(400);
    const has = await page.evaluate(() => !!state.memorized['요15:7']);
    await page.evaluate(() => localStorage.removeItem('__mockSlowProfile'));
    await page.reload(); await page.waitForSelector('header', { timeout: 15000 });
    if (has) throw new Error('첫 로드 후에도 남음');
  });
  await step('리뷰: 초대 링크 화면에서도 프로필 구독 유지, 참가 안 하고 돌아가도 유지', async () => {
    await page.goto(page.url().split('?')[0] + '?join=ZZZ998'); await page.waitForSelector('#skipInviteBtn', { timeout: 15000 });
    const onInvite = await page.evaluate(() => window.__mockExternal.listenerCount('u:u-tester'));
    await tap('#skipInviteBtn'); await page.waitForSelector('header'); await wait(300);
    const afterSkip = await page.evaluate(() => window.__mockExternal.listenerCount('u:u-tester'));
    if (onInvite < 1 || afterSkip !== 1) throw new Error(JSON.stringify({ onInvite, afterSkip }));
  });
  await step('리뷰: 혼자 모드 암송 시작일 바꾸기', async () => {
    await page.evaluate(() => { switchToSolo(); state.view = 'memorize'; saveState(); render(); });
    if (await page.$('#memoSoloStart')) { await tap('#memoSoloStart'); await wait(200); }
    const t = await page.evaluate(() => MemorizeLogic.addDays(todayLocalISO(), -7));
    await page.fill('#memoStartInput', t); await tap('#memoStartSave'); await wait(300);
    const s = await page.evaluate(() => ({ local: state.memoStartSolo, cloud: (window.__mockExternal.db().users['u-tester'] || {}).memoStart, status: document.querySelector('.memo-week-status').textContent }));
    await page.evaluate(() => { switchToGroup(); state.view = 'main'; saveState(); render(); });
    await page.waitForSelector('.passage-card', { timeout: 5000 });
    if (s.local !== t || s.cloud !== t || !/2주차/.test(s.status)) throw new Error(JSON.stringify(s));
  });

  await step('리뷰: 조장이 날짜를 고르는 중 동기화가 와도 입력값 유지', async () => {
    await tap('#memoBtn'); await page.waitForSelector('.memo-screen');
    await tap('.memo-tab[data-tab="board"]'); await page.waitForSelector('#memoStartInput');
    await page.fill('#memoStartInput', '2027-01-05'); await page.focus('#memoStartInput');
    await page.evaluate(() => window.__mockExternal.otherMemorizes('TEST01', '마18:20', '2026-11-20')); await wait(300);
    const v = await page.$eval('#memoStartInput', e => e.value);
    await page.evaluate(() => { document.activeElement.blur(); window.__mockExternal.otherMemorizes('TEST01', '마18:20', null); });
    await tap('.memo-tab[data-tab="week"]');
    if (v !== '2027-01-05') throw new Error(v);
  });
  await step('리뷰: 혼자 모드로 바꾸면 조원 현황이 보이지 않음', async () => {
    await page.evaluate(() => { volatile.memo.tab = 'board'; switchToSolo(); state.view = 'memorize'; saveState(); render(); });
    const leaked = await page.$('.memo-member');
    const tab = await page.$eval('.memo-tab.active', e => e.dataset.tab);
    await page.evaluate(() => { switchToGroup(); state.view = 'main'; saveState(); render(); });
    await page.waitForSelector('.passage-card', { timeout: 5000 });
    if (leaked || tab === 'board') throw new Error(JSON.stringify({ leaked: !!leaked, tab }));
  });
  await step('리뷰: 조 모드 프로필 스냅샷이 혼자 진도 정보를 빈 값으로 덮지 않음', async () => {
    const s = await page.evaluate(async () => {
      state.soloStash = Object.assign({}, state.soloStash, { plan: '365', startDate: '2026-01-01', groupName: '내 통독' });
      await Groups.saveProfile(volatile.userId, { solo: { readDays: {} } }); // 클라우드 solo에 plan·startDate 없음
      await new Promise(r => setTimeout(r, 200));
      return { plan: state.soloStash.plan, startDate: state.soloStash.startDate };
    });
    if (s.plan !== '365' || s.startDate !== '2026-01-01') throw new Error(JSON.stringify(s));
  });
  await step('리뷰: 잘못된 혼자 시작일 값은 무시하고 화면에 그대로 넣지 않음', async () => {
    const s = await page.evaluate(async () => {
      await Groups.saveProfile(volatile.userId, { memoStart: '"><img src=x onerror=window.__xss2=1>' });
      await new Promise(r => setTimeout(r, 200));
      return { v: state.memoStartSolo, xss: !!window.__xss2 };
    });
    if (s.v !== null || s.xss) throw new Error(JSON.stringify(s));
  });

  // 정리: 다른 조원 외운 구절 원복(Task 6 시나리오 전제)
  await page.evaluate(() => window.__mockExternal.otherMemorizes('TEST01', '갈2:20', null));

  // ── Task 6: 기록 상태·동기화·정책 ──
  await step('암송: 체크 → 원본 저장, 새로고침 후 유지', async () => {
    await page.evaluate(() => toggleMemorized('고후5:17')); await wait(300);
    const s = await page.evaluate(() => state.memorized);
    const cloud = (await db()).users['u-tester'].memorized;
    await page.reload(); await page.waitForSelector('header', { timeout: 15000 }); await wait(500);
    const after = await page.evaluate(() => state.memorized);
    if (!s['고후5:17'] || !cloud['고후5:17'] || !after['고후5:17']) throw new Error(JSON.stringify({ s, cloud, after }));
  });
  await step('암송: 조원 문서 사본이 원본에 자동으로 맞춰짐', async () => {
    await wait(500);
    const copy = (await db()).members.TEST01['u-tester'].memorized || {};
    if (!copy['고후5:17']) throw new Error(JSON.stringify(copy));
  });
  await step('암송: 혼자 모드에서 해제 → 조 사본에도 반영', async () => {
    await page.evaluate(() => switchToSolo()); await wait(300);
    const calls0 = await page.evaluate(() => window.__mockStats.reconcileCalls || 0);
    await page.evaluate(() => toggleMemorized('고후5:17')); await wait(600);
    const d = await db();
    const calls1 = await page.evaluate(() => window.__mockStats.reconcileCalls || 0);
    await page.evaluate(() => switchToGroup()); await wait(400);
    if ((d.members.TEST01['u-tester'].memorized || {})['고후5:17'] || calls1 <= calls0) throw new Error(JSON.stringify({ copy: d.members.TEST01['u-tester'].memorized, calls0, calls1 }));
  });
  await step('암송: 저장 거부 시 체크 되돌림 + 안내', async () => {
    await page.evaluate(() => { window.__mockFail = { setMemorized: 'permission-denied' }; });
    await page.evaluate(() => toggleMemorized('갈2:20')); await wait(300);
    const s = await page.evaluate(() => ({ m: state.memorized['갈2:20'] || null, toast: (document.getElementById('toast') || {}).textContent || '' }));
    await page.evaluate(() => { window.__mockFail = null; });
    if (s.m || !/저장하지 못했어요/.test(s.toast)) throw new Error(JSON.stringify(s));
  });
  await step('암송: 메모·형광펜은 조원 문서에 실리지 않음', async () => {
    await page.evaluate(() => toggleMemorized('갈2:20')); await wait(500);
    const mem = (await db()).members.TEST01['u-tester'];
    if ('highlights' in mem || 'memos' in mem || !(mem.memorized || {})['갈2:20']) throw new Error(Object.keys(mem).join(','));
  });
  await step('암송: 다른 조로 참가 — 안내 문구, 새 조 사본 채움, 기록 유지', async () => {
    await page.evaluate(() => window.__mockExternal.makeGroup('TEST02', '두번째조'));
    await page.goto(page.url().split('?')[0] + '?join=TEST02'); await page.waitForSelector('#joinBtn', { timeout: 15000 });
    const notice = await page.evaluate(() => document.body.innerText.includes('이전 조원들은 내 마지막 진도·암송 현황을 계속 볼 수 있어요'));
    await page.fill('#displayName', '홍길동'); await tap('#joinBtn');
    await page.waitForSelector('.passage-card', { timeout: 8000 }); await wait(500);
    const d = await db();
    const s = await page.evaluate(() => ({ g: state.groupId, m: Object.keys(state.memorized) }));
    const copy = (d.members.TEST02['u-tester'] || {}).memorized || {};
    if (!notice || s.g !== 'TEST02' || !s.m.includes('갈2:20') || !copy['갈2:20']) throw new Error(JSON.stringify({ notice, s, copy }));
  });
  await step('암송: 조 나가기 삭제 실패 시 조 유지', async () => {
    await page.evaluate(() => { window.__mockFail = { leaveGroup: 'unavailable' }; });
    await tap('#settingsBtn'); await page.waitForSelector('#leaveBtn'); await tap('#leaveBtn'); await wait(400);
    const s = await page.evaluate(() => ({ g: state.groupId, ref: state.groupRef && state.groupRef.groupId }));
    await page.evaluate(() => { window.__mockFail = null; });
    await tap('#backBtn').catch(() => {});
    if (s.g !== 'TEST02' || s.ref !== 'TEST02') throw new Error(JSON.stringify(s));
  });
};
