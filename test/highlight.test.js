// 형광펜 회귀 테스트 (Playwright + node:test)
//   실행: node --test test/highlight.test.js
// 1) 색을 눌러도 읽던 위치가 유지되는가 (배경 재렌더가 맨 위로 튀지 않는가)
// 2) 여러 절을 드래그 선택한 뒤 색을 누르면 전부 칠해지는가
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const FIXTURE = pathToFileURL(path.join(__dirname, 'fixtures', 'highlight.html')).href;

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { if (browser) await browser.close(); });

async function openFixture() {
  const page = await browser.newPage({ viewport: { width: 480, height: 800 } });
  await page.goto(FIXTURE);
  await page.waitForFunction(() => window.__appLoaded === true);
  return page;
}

// 본문 절 마크업을 #app에 심고 state를 초기화한다.
async function seedVerses(page) {
  await page.evaluate(() => {
    state.highlights = {};
    state.memos = {};
    const refs = ['창1:1', '창1:2', '창1:3', '창1:4', '창1:5'];
    document.getElementById('app').innerHTML =
      '<div style="height:600px"></div>' +
      refs.map((r, i) =>
        `<p class="verse" data-ref="${r}"><span class="vnum">${i + 1}</span>${i + 1}절 본문입니다. 충분히 긴 문장으로 채워 둡니다.</p>`
      ).join('') +
      '<div style="height:2000px"></div>';
  });
}

// verseFrom~verseTo 절에 걸쳐 텍스트 선택을 만든다 (드래그 선택 재현).
async function selectVerses(page, fromIdx, toIdx) {
  await page.evaluate(([f, t]) => {
    const verses = document.querySelectorAll('.verse');
    const startNode = verses[f].lastChild;   // 본문 텍스트 노드
    const endNode = verses[t].lastChild;
    const range = document.createRange();
    range.setStart(startNode, 0);
    range.setEnd(endNode, endNode.textContent.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }, [fromIdx, toIdx]);
  // selectionchange 는 태스크 끝에 비동기로 발생한다
  await page.waitForFunction(() => document.getElementById('hl-toolbar').classList.contains('show'));
}

test('여러 절을 선택하고 색을 누르면 선택한 절이 모두 칠해진다', async () => {
  const page = await openFixture();
  await seedVerses(page);
  await selectVerses(page, 1, 3); // 창1:2 ~ 창1:4

  await page.click('#hl-toolbar .hl-btn[data-color="yellow"]');

  const result = await page.evaluate(() => ({
    highlights: state.highlights,
    dom: [...document.querySelectorAll('.verse')].map(el => [el.dataset.ref, el.getAttribute('data-hl')]),
  }));

  assert.deepStrictEqual(result.highlights, { '창1:2': 'yellow', '창1:3': 'yellow', '창1:4': 'yellow' });
  assert.deepStrictEqual(result.dom, [
    ['창1:1', null], ['창1:2', 'yellow'], ['창1:3', 'yellow'], ['창1:4', 'yellow'], ['창1:5', null],
  ]);
  await page.close();
});

test('여러 절을 선택하고 지우개를 누르면 선택한 절이 모두 지워진다', async () => {
  const page = await openFixture();
  await seedVerses(page);
  await selectVerses(page, 1, 3);
  await page.click('#hl-toolbar .hl-btn[data-color="yellow"]');
  await selectVerses(page, 1, 3);
  await page.click('#hl-toolbar .hl-btn.hl-remove');

  const highlights = await page.evaluate(() => state.highlights);
  assert.deepStrictEqual(highlights, {});
  await page.close();
});

test('한 절만 탭하면 그 절만 칠해진다', async () => {
  const page = await openFixture();
  await seedVerses(page);
  await page.click('.verse[data-ref="창1:3"]');
  await page.waitForSelector('#hl-toolbar.show');
  await page.click('#hl-toolbar .hl-btn[data-color="green"]');

  const highlights = await page.evaluate(() => state.highlights);
  assert.deepStrictEqual(highlights, { '창1:3': 'green' });
  await page.close();
});

// 같은 화면을 다시 그리는 재렌더(클라우드 동기화 등)에서는 읽던 위치가 유지되어야 한다.
async function setupMainView(page) {
  await page.evaluate(() => {
    window.renderMain = () => '<div style="height:4000px">본문</div>';
    window.bindMain = () => {};
    volatile.authReady = true;
    volatile.needsLogin = false;
    state.plan = '180';
    state.mode = 'solo';
    state.startDate = '2026-01-01';
    state.groupId = null;
    state.view = 'main';
    state.viewDay = null;
  });
}

test('같은 화면 재렌더는 스크롤 위치를 유지한다', async () => {
  const page = await openFixture();
  await setupMainView(page);

  const y = await page.evaluate(() => {
    render();
    window.scrollTo(0, 1200);
    render(); // 배경 동기화로 인한 재렌더
    return window.scrollY;
  });

  assert.strictEqual(y, 1200);
  await page.close();
});

test('다른 날/다른 화면으로 이동하면 맨 위로 올라간다', async () => {
  const page = await openFixture();
  await setupMainView(page);

  const y = await page.evaluate(() => {
    render();
    window.scrollTo(0, 1200);
    state.viewDay = 7; // 다른 날로 이동
    render();
    return window.scrollY;
  });

  assert.strictEqual(y, 0);
  await page.close();
});

test('색칠 후에도 읽던 위치가 유지된다 (동기화 재렌더 포함)', async () => {
  const page = await openFixture();
  await setupMainView(page);
  await page.evaluate(() => {
    render();
    // 실제 본문 대신 절 마크업을 넣고, 그 위치로 스크롤
    document.getElementById('app').innerHTML =
      '<div style="height:1500px"></div>' +
      '<p class="verse" data-ref="창1:1"><span class="vnum">1</span>첫째 절 본문입니다.</p>' +
      '<p class="verse" data-ref="창1:2"><span class="vnum">2</span>둘째 절 본문입니다.</p>' +
      '<div style="height:2000px"></div>';
    state.highlights = {};
    window.scrollTo(0, 1400);
  });

  await page.click('.verse[data-ref="창1:1"]');
  await page.waitForSelector('#hl-toolbar.show');
  await page.click('#hl-toolbar .hl-btn[data-color="pink"]');

  // 클라우드 스냅샷이 되돌아와 재렌더되는 상황
  const y = await page.evaluate(() => { render(); return window.scrollY; });
  assert.strictEqual(y, 1400);
  await page.close();
});

test('비교 보기(.verse-compare)에서도 여러 절이 한 번에 칠해진다', async () => {
  const page = await openFixture();
  await page.evaluate(() => {
    state.highlights = {};
    const refs = ['창1:1', '창1:2', '창1:3'];
    document.getElementById('app').innerHTML = refs.map((r, i) =>
      `<div class="verse-compare" data-ref="${r}"><span class="vnum">${i + 1}</span>` +
      `<p class="ver-line gae"><span class="ver-tag">개역</span>${i + 1}절 개역개정 본문입니다.</p>` +
      `<p class="ver-line saenew"><span class="ver-tag">새번역</span>${i + 1}절 새번역 본문입니다.</p></div>`
    ).join('');
  });
  await page.evaluate(() => {
    const lines = document.querySelectorAll('.verse-compare .ver-line');
    const start = lines[0].lastChild;          // 창1:1 개역 줄
    const end = lines[3].lastChild;            // 창1:2 새번역 줄
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, end.textContent.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.waitForSelector('#hl-toolbar.show');
  await page.click('#hl-toolbar .hl-btn[data-color="blue"]');

  const highlights = await page.evaluate(() => state.highlights);
  assert.deepStrictEqual(highlights, { '창1:1': 'blue', '창1:2': 'blue' });
  await page.close();
});
