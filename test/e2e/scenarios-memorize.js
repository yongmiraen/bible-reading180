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
    const s = await page.$eval(card('고후5:17'), e => ({ text: !!e.querySelector('.memo-text'), ref: e.querySelector('.memo-ref').textContent, topic: !!e.querySelector('.memo-topic'), leaked: e.textContent.includes('새로운 피조물') }));
    if (s.text || s.leaked || !/고린도후서 5:17/.test(s.ref) || !s.topic) throw new Error(JSON.stringify(s));
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
  await step('듣기: 한국어 음성 없으면 버튼 없음, 있으면 본문 보일 때만', async () => {
    await page.evaluate(() => {
      window.__voices = [];
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => window.__voices, speak() {}, cancel() {}, addEventListener() {}, removeEventListener() {} } });
      render();
    });
    const none = await page.$(`${card('고후5:17')} [data-act="tts"]`);
    await page.evaluate(() => { window.__voices = [{ lang: 'ko-KR', name: '모의 음성' }]; render(); });
    const shown = await page.$(`${card('고후5:17')} [data-act="tts"]`);
    await act('고후5:17', 'hide'); await wait(100);
    const hiddenBtn = await page.$(`${card('고후5:17')} [data-act="tts"]`);
    await act('고후5:17', 'show');
    if (none || !shown || hiddenBtn) throw new Error(JSON.stringify({ none: !!none, shown: !!shown, hiddenBtn: !!hiddenBtn }));
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
    await act('갈2:20', 'chunk'); await wait(150);
    const a = await audit(page, '암송 320px');
    const header = await page.$eval('.header-actions', e => { const r = e.getBoundingClientRect(); return r.right <= innerWidth + 1; });
    await shot('memo-04-320');
    await act('갈2:20', 'whole');
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
