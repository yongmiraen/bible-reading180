// 자정 넘김: 23:58:30에 10일차를 읽는 중 → 3분 경과 → 보던 날 유지·체크는 10일차 → 앱 다시 열기 → 11일차
//   node test/e2e/midnight.js   (종료 코드 1 = 실패)
const { BASE, DEVICES, startServer, routeMocks } = require('./devices');

(async () => {
  const server = await startServer();
  let failed = 0;
  try {
    for (const d of DEVICES.filter(x => x.key === 'android' || x.key === 'iphone')) {
      const b = await d.engine.launch(d.launch || {});
      const ctx = await b.newContext({ ...d.dev, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
      await routeMocks(ctx);
      const p = await ctx.newPage();
      const errs = []; p.on('pageerror', e => errs.push(e.message));
      await p.clock.install({ time: new Date('2026-11-10T23:58:30+09:00') });
      await p.goto(BASE, { timeout: 120000 });
      await p.waitForSelector('#plan180', { timeout: 60000 });
      await p.click('#plan180'); await p.click('#modeSolo');
      await p.fill('#startDate', '2026-11-01'); await p.click('#startBtn');
      await p.waitForSelector('.passage-card');
      const r = {};
      r.before = await p.$eval('.day-num', e => e.textContent);
      await p.evaluate(() => window.scrollTo(0, 600));
      await p.clock.fastForward('03:00');
      await p.waitForTimeout(300);
      r.afterMidnight = await p.$eval('.day-num', e => e.textContent);
      r.todayBtn = await p.$eval('.goto-today-btn', e => e.textContent).catch(() => '(없음)');
      r.scrollKept = await p.evaluate(() => scrollY);
      await p.click('#checkBtn'); await p.waitForTimeout(200);
      r.checked = await p.evaluate(() => Object.keys(state.readDays).join(','));
      await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await p.waitForTimeout(300);
      r.reopened = await p.$eval('.day-num', e => e.textContent) + ' ' + (await p.$('.today-tag') ? '(오늘)' : '');
      const ok = r.before === '10일차' && r.afterMidnight === '10일차' && /11일차/.test(r.todayBtn)
        && r.checked === '10' && /^11일차 \(오늘\)$/.test(r.reopened) && r.scrollKept > 0 && !errs.length;
      if (!ok) failed++;
      console.log(d.key, ok ? 'PASS' : 'FAIL', JSON.stringify(r), errs.length ? errs : '');
      await b.close();
    }
  } finally { server.close(); }
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
