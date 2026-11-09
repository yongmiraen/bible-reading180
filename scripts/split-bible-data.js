// bible-data.js(약 19.6MB, 4개 번역본 + 소제목 + 중복 BIBLE)를 번역본별 파일로 나눈다.
//   실행: node scripts/split-bible-data.js
// 결과: bible/GAE.js (개역개정 + 소제목, 첫 화면에 필요 → 동기 로드)
//       bible/SAENEW.js, bible/NIV.js, bible/ESV.js (비교 보기에서 필요할 때 지연 로드)
// window.BIBLE은 GAE와 완전히 같아서 내보내지 않는다.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'bible-data.js');
const OUT = path.join(ROOT, 'bible');

const sandbox = {};
new Function('window', fs.readFileSync(SRC, 'utf8'))(sandbox);
const { BIBLES, SUBTITLES } = sandbox;
if (!BIBLES || !BIBLES.GAE) throw new Error('bible-data.js에서 BIBLES.GAE를 찾지 못함');

fs.mkdirSync(OUT, { recursive: true });
const header = '// 자동 생성: node scripts/split-bible-data.js (원본: bible-data.js)\n';
for (const v of Object.keys(BIBLES)) {
  let body = `${header}(window.BIBLES = window.BIBLES || {}).${v} = ${JSON.stringify(BIBLES[v])};\n`;
  if (v === 'GAE') body += `window.SUBTITLES = ${JSON.stringify(SUBTITLES || {})};\n`;
  fs.writeFileSync(path.join(OUT, `${v}.js`), body);
  console.log(`bible/${v}.js  ${(Buffer.byteLength(body) / 1e6).toFixed(1)}MB  ${Object.keys(BIBLES[v]).length}절`);
}
