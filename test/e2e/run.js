// 7개 환경(휴대폰 4 + PC 3) 사용 시나리오 — 모의 백엔드로 앱 전체 흐름 검증
//   node test/e2e/run.js            # 전체
//   node test/e2e/run.js android    # 한 기기 (iphone|iphoneSE|android|galaxyS|pcChrome|pcEdge|macSafari)
//   node test/e2e/run.js mobile|pc  # 묶음
// 결과: test/e2e/results.json, 스크린샷: test/e2e/shots/  (둘 다 gitignore)
// 종료 코드: 하나라도 FAIL이거나 페이지 오류가 있으면 1
const path = require('path');
const fs = require('fs');
const { BASE, DEVICES, startServer, routeMocks, webkit } = require('./devices');
const extraScenarios = fs.existsSync(path.join(__dirname, 'scenarios-memorize.js')) ? require('./scenarios-memorize') : null;

const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const START = (() => { const d = new Date(Date.now() - 10 * 864e5); return d.toISOString().slice(0, 10); })();

async function audit(page, label) {
  return page.evaluate((label) => {
    const vw = innerWidth, out = { label, overflowX: document.documentElement.scrollWidth - vw, smallFonts: [], offscreen: [] };
    document.querySelectorAll('button, a, input, textarea, select').forEach(el => {
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      if (!r.width || cs.display === 'none' || cs.visibility === 'hidden' || el.closest('#hl-toolbar:not(.show)') || el.closest('#memo-modal:not(.show)')) return;
      const name = (el.id ? '#' + el.id : '.' + String(el.className).split(' ')[0]);
      if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && parseFloat(cs.fontSize) < 16) out.smallFonts.push(`${name} ${cs.fontSize}`);
      if (r.right > vw + 1 || r.left < -1) out.offscreen.push(name);
    });
    return out;
  }, label);
}

async function runDevice(d) {
  const R = { device: d.key, steps: [], errors: [], audits: [] };
  const browser = await d.engine.launch(d.launch || {});
  const ctx = await browser.newContext({ ...d.dev, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await routeMocks(ctx);
  const page = await ctx.newPage();
  const bibleReqs = [];
  page.on('request', rq => { const m = rq.url().match(/\/(bible\/\w+\.js|bible-data\.js)/); if (m) bibleReqs.push(m[1]); });
  page.on('pageerror', e => R.errors.push('pageerror: ' + e.message + ' @after: ' + (R.steps[R.steps.length - 1] || '').slice(0, 40)));
  page.on('dialog', async dl => { R.steps.push(`  dialog(${dl.type()}): ${dl.message().slice(0, 50).replace(/\n/g, ' ')}`); await dl.accept(); });

  const step = async (name, fn) => {
    const t = Date.now();
    try { const v = await fn(); R.steps.push(`OK   ${name} (${Date.now() - t}ms)${v ? ' → ' + v : ''}`); }
    catch (e) {
      R.steps.push(`FAIL ${name}: ${e.message.split('\n')[0].slice(0, 180)}`);
      await page.screenshot({ path: path.join(SHOTS, `${d.key}-FAIL-${name.replace(/[^\w가-힣]+/g, '_').slice(0, 60)}.png`) }).catch(() => {});
    }
  };
  const shot = n => page.screenshot({ path: path.join(SHOTS, `${d.key}-${n}.png`) });
  const tap = sel => d.desktop ? page.click(sel, { timeout: 8000 }) : page.tap(sel, { timeout: 8000 });
  // Windows용 Playwright WebKit은 터치 탭에서 click을 합성하지 않음(실기기 iOS는 합성) → WebKit·PC는 click
  const tapEl = el => (d.desktop || d.engine === webkit) ? el.click() : el.tap();
  const verse = async i => (await page.$$('.verse, .verse-compare'))[i];
  const writes = () => page.evaluate(() => ({ ...window.__mockStats, byOp: { ...window.__mockStats.byOp } }));
  const ctxObj = { d, page, R, step, shot, tap, tapEl, verse, writes, audit, START, BASE };

  // ───── 혼자 모드 ─────
  await step('첫 로드', async () => {
    const t = Date.now();
    await page.goto(BASE, { waitUntil: 'load', timeout: 120000 });
    await page.waitForSelector('#plan180', { timeout: 30000 });
    await shot('01-plan');
    return `${Date.now() - t}ms`;
  });
  await step('첫 로드 시 받은 성경 데이터는 GAE만', async () => {
    const got = [...new Set(bibleReqs)];
    if (got.join() !== 'bible/GAE.js') throw new Error(got.join(','));
  });
  await step('180일 → 혼자 → 시작', async () => {
    await tap('#plan180'); await tap('#modeSolo'); await page.waitForSelector('#startBtn');
    await page.fill('#startDate', START); await page.fill('#groupName', '테스트 통독'); await tap('#startBtn');
    await page.waitForSelector('.passage-card', { timeout: 15000 }); await shot('03-main');
    return await page.$eval('.day-num', e => e.textContent);
  });
  R.audits.push(await audit(page, '메인'));
  await step('읽음 체크 → 버튼 즉시 갱신', async () => {
    await tap('#checkBtn'); await page.waitForSelector('.passage-card.is-read', { timeout: 5000 });
    return await page.$eval('#checkBtn', e => e.textContent.trim());
  });
  await step('읽음 취소 → 되살아나지 않음', async () => {
    await page.evaluate(() => toggleRead(getViewDay() - 1)); await page.waitForTimeout(200);
    await tap('#checkBtn'); await page.waitForTimeout(500);
    if (await page.evaluate(() => !!state.readDays[getViewDay()])) throw new Error('되살아남');
  });
  await step('사도행전 24장 26절 모두 표시(Day 162)', async () => {
    const r = await page.evaluate(() => { state.viewDay = 162; render(); const n = document.querySelectorAll('.verse[data-ref^="행24:"]').length; state.viewDay = null; render(); return n; });
    if (r !== 26) throw new Error(`행24 ${r}절`);
  });
  await step('이전/다음 날', async () => {
    await tap('.prev-day-btn'); const a = await page.$eval('.day-num', e => e.textContent);
    await tap('.next-day-btn'); const b = await page.$eval('.day-num', e => e.textContent);
    return `${a} → ${b}`;
  });
  await step('절 탭 → 툴바 화면 안', async () => {
    await tapEl(await verse(3)); await page.waitForSelector('#hl-toolbar.show', { timeout: 3000 });
    const r = await page.$eval('#hl-toolbar', e => { const b = e.getBoundingClientRect(); return [b.left, b.right, b.top, b.bottom, innerWidth, innerHeight]; });
    if (r[0] < 0 || r[1] > r[4] || r[2] < 0 || r[3] > r[5]) throw new Error('툴바 화면 밖 ' + r);
  });
  await step('형광펜 2개 칠하고 1개 지우기 → 유지', async () => {
    await tap('#hl-toolbar .hl-btn[data-color="yellow"]'); await page.waitForTimeout(150);
    await tapEl(await verse(8)); await tap('#hl-toolbar .hl-btn[data-color="green"]'); await page.waitForTimeout(150);
    await tapEl(await verse(3)); await tap('#hl-toolbar .hl-remove'); await page.waitForTimeout(500);
    const s = await page.evaluate(() => { const r = document.querySelectorAll('.verse')[3].dataset.ref; return { local: state.highlights[r] || null, n: Object.keys(state.highlights).length }; });
    if (s.local || s.n !== 1) throw new Error(JSON.stringify(s));
  });
  await step('빈 곳 탭 → 툴바 닫힘', async () => {
    await tapEl(await verse(4)); await page.waitForSelector('#hl-toolbar.show');
    if (d.desktop) await page.mouse.click(5, 5); else await page.touchscreen.tap(5, 5);
    await page.waitForTimeout(300);
    if (await page.$eval('#hl-toolbar', e => e.classList.contains('show'))) throw new Error('안 닫힘');
  });
  await step('메모 작성·삭제 유지', async () => {
    await tapEl(await verse(6)); await tap('#hl-toolbar .hl-memo-btn'); await page.waitForSelector('#memo-modal.show');
    await page.fill('#memo-text', '테스트 메모'); await tap('#memo-save'); await page.waitForTimeout(200);
    await tapEl(await verse(9)); await tap('#hl-toolbar .hl-memo-btn'); await page.waitForSelector('#memo-modal.show');
    await page.fill('#memo-text', '두 번째'); await tap('#memo-save'); await page.waitForTimeout(200);
    await tap('.verse-memo-badge'); await page.waitForSelector('#memo-modal.show'); await tap('#memo-del'); await page.waitForTimeout(400);
    const n = await page.evaluate(() => Object.keys(state.memos).length);
    if (n !== 1) throw new Error('메모 ' + n);
  });
  await step('번역 비교(지연 로드) 켜기/끄기', async () => {
    const chips = await page.$$eval('.bible-toggle button', a => a.map(b => b.dataset.ver));
    for (const v of chips.slice(1)) await tap(`.bible-toggle button[data-ver="${v}"]`);
    await page.waitForFunction(() => document.querySelectorAll('.verse-compare .ver-line').length > document.querySelectorAll('.verse-compare').length, null, { timeout: 15000 });
    R.audits.push(await audit(page, '번역 비교'));
    await page.evaluate(() => { state.bibleView = ['GAE']; saveState(); render(); });
  });
  await step('드라마바이블 플레이어 열고 닫기', async () => {
    const btn = await page.$('.listen-btn'); if (!btn) return '버튼 없음';
    await tapEl(btn); await page.waitForSelector('#yt-overlay', { timeout: 3000 });
    const ch = await page.$('.yt-ch-btn, .yt-book-btn'); if (ch) await tapEl(ch);
    await page.waitForTimeout(400);
    const src = await page.$eval('#yt-overlay iframe', e => e.src).catch(() => '');
    await tap('.yt-close'); await page.waitForTimeout(300);
    if (await page.$('#yt-overlay')) throw new Error('안 닫힘');
    return 'playsinline=' + /playsinline=1/.test(src);
  });
  await step('전체 일정 → 3일차 이동', async () => {
    await tap('#listBtn'); await page.waitForSelector('.day-list');
    R.audits.push(await audit(page, '목록'));
    await tapEl((await page.$$('.list-item'))[2]); await page.waitForSelector('.passage-card');
    return await page.$eval('.day-num', e => e.textContent);
  });
  await step('일괄 읽음', async () => {
    await tap('.goto-today-btn').catch(() => {}); await page.waitForSelector('.passage-card');
    const b = await page.$('#bulkReadBtn'); if (!b) return '버튼 없음';
    await tapEl(b); await page.waitForTimeout(400);
    return await page.$eval('.progress-text', e => e.textContent);
  });
  await step('새로고침 후 상태 유지', async () => {
    await page.reload({ waitUntil: 'load' }); await page.waitForSelector('.passage-card', { timeout: 30000 });
    const s = await page.evaluate(() => ({ hl: Object.keys(state.highlights).length, memo: Object.keys(state.memos).length }));
    if (s.hl !== 1 || s.memo !== 1) throw new Error(JSON.stringify(s));
  });
  await step('뒤로가기: 목록 → 메인', async () => {
    await tap('#listBtn'); await page.waitForSelector('.day-list');
    await page.goBack(); await page.waitForSelector('.passage-card', { timeout: 3000 });
  });
  await step('뒤로가기: 건의 → 설정 → 메인', async () => {
    await tap('#settingsBtn'); await page.waitForSelector('#feedbackBtn'); R.audits.push(await audit(page, '설정'));
    await tap('#feedbackBtn'); await page.waitForSelector('#fbEmail');
    await page.goBack(); await page.waitForSelector('#feedbackBtn', { timeout: 3000 });
    await page.goBack(); await page.waitForSelector('.passage-card', { timeout: 3000 });
  });
  await step('건의 입력·전송', async () => {
    await tap('#settingsBtn'); await page.waitForSelector('#feedbackBtn'); await tap('#feedbackBtn'); await page.waitForSelector('#fbEmail');
    R.audits.push(await audit(page, '건의'));
    await page.fill('#fbMessage', '테스트'); await tap('#fbSendBtn'); await page.waitForSelector('#feedbackBtn', { timeout: 5000 });
    await tap('#backBtn'); await page.waitForSelector('.passage-card');
  });
  await step('UX: 글자 크기 22px, 새로고침 후 유지', async () => {
    await tap('.rt-btn[data-fs="1"]'); await tap('.rt-btn[data-fs="1"]');
    await page.reload(); await page.waitForSelector('.passage-card');
    const fsz = await page.$eval('.passage-body .verse', e => getComputedStyle(e).fontSize);
    await tap('.rt-btn[data-fs="-1"]'); await tap('.rt-btn[data-fs="-1"]');
    if (fsz !== '22px') throw new Error(fsz);
  });
  await step('UX: 상단 읽음 버튼으로 체크/취소(위·아래 버튼 함께)', async () => {
    const states = () => page.$$eval('[data-act="check"]', a => a.map(e => e.classList.contains('checked')));
    const s0 = await states();
    await tap('.check-top'); await page.waitForTimeout(300);
    const s1 = await states();
    await tap('.check-top'); await page.waitForTimeout(300);
    const s2 = await states();
    if (s1.some(x => x === s0[0]) || s2.some(x => x !== s0[0])) throw new Error(JSON.stringify({ s0, s1, s2 }));
  });
  await step('UX: 일정 끝·미완주 → 남은 본문 목록', async () => {
    await page.evaluate(() => { state.startDate = new Date(Date.now() - 200 * 864e5).toISOString().slice(0, 10); state.viewDay = null; state.readDays = { 1: true, 2: true }; saveState(); render(); });
    const title = await page.$eval('.status-card h2', e => e.textContent);
    await tap('#unreadListBtn'); await page.waitForSelector('.day-list');
    const n = await page.$$eval('.list-item', a => a.length);
    await page.evaluate(s => { state.startDate = s; state.readDays = {}; state.viewDay = null; state.view = 'main'; volatile.listUnreadOnly = false; saveState(); render(); }, START);
    await page.waitForSelector('.passage-card');
    if (title !== '통독 일정이 끝났어요' || n !== 178) throw new Error(`${title} / ${n}`);
  });

  if (d.desktop) {
    await step('PC: 가운데 680px', async () => {
      const r = await page.evaluate(() => { const a = document.getElementById('app').getBoundingClientRect(); return { w: a.width, l: a.left, r: innerWidth - a.right }; });
      if (r.w > 680 || Math.abs(r.l - r.r) > 2) throw new Error(JSON.stringify(r));
    });
    await step('PC: 드래그로 3절 선택 → 한 번에 형광펜, 툴바는 선택 위', async () => {
      const vs = await page.$$('.verse'); await vs[10].scrollIntoViewIfNeeded();
      const a = await vs[10].boundingBox(), b = await vs[12].boundingBox();
      await page.mouse.move(a.x + 40, a.y + 8); await page.mouse.down();
      await page.mouse.move(b.x + b.width * 0.5, b.y + b.height - 8, { steps: 12 }); await page.mouse.up();
      await page.waitForSelector('#hl-toolbar.show', { timeout: 3000 });
      const pos = await page.evaluate(() => { const t = document.getElementById('hl-toolbar').getBoundingClientRect(); const s = getSelection().getRangeAt(0).getBoundingClientRect(); return { tb: t.bottom, sel: s.top, top: t.top }; });
      await page.click('#hl-toolbar .hl-btn[data-color="blue"]'); await page.waitForTimeout(300);
      const refs = await page.$$eval('.verse[data-hl="blue"]', x => x.map(e => e.dataset.ref));
      await page.evaluate(r => { r.forEach(x => delete state.highlights[x]); saveState(); render(); }, refs);
      if (refs.length !== 3 || !(pos.tb <= pos.sel + 2 || pos.top < 8)) throw new Error(JSON.stringify({ refs, pos }));
    });
    await step('PC: 메모 창 Tab 가두기·Esc', async () => {
      await (await page.$$('.verse'))[2].click(); await page.click('#hl-toolbar .hl-memo-btn'); await page.waitForSelector('#memo-modal.show');
      const inside = [];
      for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); inside.push(await page.evaluate(() => document.getElementById('memo-modal').contains(document.activeElement))); }
      await page.keyboard.press('Escape'); await page.waitForTimeout(150);
      if (!inside.every(Boolean) || await page.$eval('#memo-modal', e => e.classList.contains('show'))) throw new Error(String(inside));
    });
  }

  // ───── 조 모드 ─────
  await step('조 만들기 → 초대 → 메인', async () => {
    await page.goto(BASE); await page.waitForSelector('#toggleGroup', { timeout: 30000 });
    await tap('#toggleGroup'); await page.waitForSelector('#goCreate', { timeout: 5000 });
    await tap('#goCreate'); await page.waitForSelector('#createBtn');
    await page.fill('#groupName', '테스트조'); await page.fill('#startDate', START); await page.fill('#displayName', '홍길동');
    await tap('#createBtn'); await page.waitForSelector('#goMainBtn', { timeout: 8000 });
    await tapEl(await page.$('#goMainBtn')); await page.waitForSelector('.passage-card', { timeout: 8000 });
    R.audits.push(await audit(page, '조 메인'));
  });
  await step('조 읽음 체크', async () => { await tap('#checkBtn'); await page.waitForSelector('#checkBtn.checked', { timeout: 3000 }); });
  await step('조 모드 형광펜 → 조 문서 쓰기 없음', async () => {
    const w0 = await writes();
    await tapEl(await verse(2)); await tap('#hl-toolbar .hl-btn[data-color="pink"]'); await page.waitForTimeout(300);
    const w = await writes();
    if ((w.byOp.setReadDays || 0) !== (w0.byOp.setReadDays || 0)) throw new Error('setReadDays 발생');
  });
  await step('다른 조원 체크 → 메인 다시 그리기 0회', async () => {
    await page.evaluate(() => { window.__renders = 0; new MutationObserver(() => window.__renders++).observe(document.getElementById('app'), { childList: true }); });
    await page.evaluate(() => window.__mockExternal.otherChecks('TEST01', 5)); await page.waitForTimeout(300);
    const n = await page.evaluate(() => window.__renders); if (n) throw new Error(n + '회');
  });
  await step('조원 화면', async () => { await tap('#membersBtn'); await page.waitForSelector('.members-card', { timeout: 5000 }); R.audits.push(await audit(page, '조원')); await tap('#backBtn'); });
  await step('기도제목·댓글(입력 중 보존)·수정·삭제, XSS 없음', async () => {
    await tap('#prayerBtn'); await page.waitForSelector('#prayerInput', { timeout: 5000 });
    await page.fill('#prayerInput', '<img src=x onerror="window.__xss=1"> 기도'); await tap('#prayerSubmit'); await page.waitForSelector('.prayer-card');
    await tap('[data-act="comment-toggle"]'); await page.waitForTimeout(300);
    await (await page.$('.comment-input')).fill('아멘'); await tap('[data-act="comment-send"]'); await page.waitForTimeout(300);
    const n0 = await page.$$eval('.comment-row', a => a.length);
    await (await page.$('.comment-input')).focus(); await page.keyboard.type('쓰는 중');
    const pid = await page.$eval('.comment-input', e => e.id.replace('cinput-', ''));
    await page.evaluate(p => window.__mockExternal.otherComments('TEST01', p, '다른 댓글'), pid); await page.waitForTimeout(300);
    const kept = await page.$eval('.comment-input', e => e.value);
    await page.evaluate(() => document.activeElement.blur()); await page.waitForTimeout(300);
    const n1 = await page.$$eval('.comment-row', a => a.length);
    await tap('[data-act="edit"]'); await page.fill('.prayer-edit-area', '수정됨'); await tap('[data-act="edit-save"]'); await page.waitForTimeout(300);
    await tap('[data-act="del"]'); await page.waitForTimeout(300);
    const xss = await page.evaluate(() => !!window.__xss);
    if (kept !== '쓰는 중' || n1 !== n0 + 1 || xss) throw new Error(JSON.stringify({ kept, n0, n1, xss }));
  });
  await step('뒤로가기: 기도 → 메인', async () => { await page.goBack(); await page.waitForSelector('.passage-card', { timeout: 3000 }); });
  await step('가로 회전', async () => {
    if (d.desktop) return '생략';
    const { width, height } = d.dev.viewport; await page.setViewportSize({ width: height, height: width });
    await page.reload(); await page.waitForSelector('.passage-card', { timeout: 15000 });
    R.audits.push(await audit(page, '가로'));
    await page.setViewportSize({ width, height });
  });
  await step('조 기간 변경 → updateMyMember 한 번', async () => {
    const w0 = await writes();
    await tap('#settingsBtn'); await page.waitForSelector('#changePlanBtn'); await tap('#changePlanBtn'); await page.waitForTimeout(400);
    const w = await writes();
    await tap('#changePlanBtn'); await page.waitForTimeout(300);
    if ((w.byOp.updateMyMember || 0) - (w0.byOp.updateMyMember || 0) !== 1) throw new Error(JSON.stringify(w.byOp));
  });
  await step('초대 링크 → 참가하지 않고 돌아가기', async () => {
    await page.goto(BASE + '?join=ZZZ999'); await page.waitForSelector('#skipInviteBtn', { timeout: 15000 });
    await tap('#skipInviteBtn'); await page.reload(); await page.waitForSelector('header', { timeout: 15000 });
    if (await page.$('#skipInviteBtn')) throw new Error('초대 화면 다시 뜸');
  });

  if (extraScenarios) await extraScenarios(ctxObj);

  await step('조 나가기 → 새로고침 후 다시 안 들어감', async () => {
    if (await page.$('#backBtn')) await tap('#backBtn');
    await tap('#settingsBtn'); await page.waitForSelector('#leaveBtn'); await tap('#leaveBtn'); await page.waitForTimeout(400);
    await page.reload(); await page.waitForSelector('#app > *'); await page.waitForTimeout(400);
    const s = await page.evaluate(() => ({ g: state.groupId, ref: state.groupRef }));
    if (s.g || s.ref) throw new Error(JSON.stringify(s));
  });
  await step('전체 초기화 → 처음 화면, 형광펜·메모·외운 구절 유지', async () => {
    const before = await page.evaluate(() => [Object.keys(state.highlights).length, Object.keys(state.memos).length, Object.keys(state.memorized || {}).length]);
    if (await page.$('#modeSolo')) { await tap('#modeSolo'); await page.waitForTimeout(300); }
    if (await page.$('#startBtn')) { await page.fill('#startDate', START); await tap('#startBtn'); }
    await page.waitForSelector('#settingsBtn', { timeout: 8000 }); await tap('#settingsBtn'); await page.waitForSelector('#resetAllBtn');
    await tap('#resetAllBtn'); await page.waitForTimeout(400); await page.reload(); await page.waitForTimeout(800);
    const s = await page.evaluate(() => ({ plan: !!document.getElementById('plan180'), hl: Object.keys(state.highlights).length, memo: Object.keys(state.memos).length, mz: Object.keys(state.memorized || {}).length }));
    if (!s.plan || s.hl !== before[0] || s.memo !== before[1] || s.mz !== before[2]) throw new Error(JSON.stringify({ before, s }));
  });

  await browser.close();
  return R;
}

(async () => {
  const only = process.argv[2];
  const list = DEVICES.filter(x => !only || x.key === only || (only === 'pc' && x.desktop) || (only === 'mobile' && !x.desktop));
  const server = await startServer();
  const results = [];
  try { for (const d of list) results.push(await runDevice(d)); }
  finally { server.close(); }
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 1));
  let bad = 0;
  for (const r of results) {
    const fails = r.steps.filter(s => s.startsWith('FAIL'));
    const auditIssues = r.audits.filter(a => a.overflowX > 0 || a.smallFonts.length || a.offscreen.length);
    bad += fails.length + r.errors.length + auditIssues.length;
    console.log(`\n### ${r.device}: ${r.steps.filter(s => s.startsWith('OK')).length} OK, ${fails.length} FAIL, 오류 ${r.errors.length}, 레이아웃 ${auditIssues.length}`);
    for (const s of fails) console.log('  ' + s);
    for (const e of [...new Set(r.errors)]) console.log('  ERR ' + e);
    for (const a of auditIssues) console.log(`  [${a.label}] 가로넘침 ${a.overflowX} 작은입력 ${a.smallFonts} 화면밖 ${a.offscreen}`);
  }
  console.log(bad ? `\nE2E FAIL (${bad})` : '\nE2E PASS');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
