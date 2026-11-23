// 성경암송 시나리오 — run.js가 조 모드 단계(초대 스킵) 뒤, 조 나가기 전에 호출한다.
// 상태: 조 모드, 조 TEST01(u-tester 조장, u-other 조원).
module.exports = async function memorizeScenarios({ page, step, tap }) {
  const db = () => page.evaluate(() => window.__mockExternal.db());
  const wait = ms => page.waitForTimeout(ms);

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
