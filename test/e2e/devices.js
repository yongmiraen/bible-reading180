// e2e 공통: 기기 목록, 로컬 정적 서버, 모의 Firebase/Groups 라우팅
const http = require('http');
const fs = require('fs');
const path = require('path');
const { webkit, chromium, devices } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const PORT = 8765;
const BASE = `http://127.0.0.1:${PORT}/index.html`;

const DEVICES = [
  { key: 'iphone', engine: webkit, dev: devices['iPhone 13'] },
  { key: 'iphoneSE', engine: webkit, dev: devices['iPhone SE'] },
  { key: 'android', engine: chromium, dev: devices['Pixel 7'] },
  { key: 'galaxyS', engine: chromium, dev: devices['Galaxy S9+'] },
  // PC (마우스, 터치 없음) — 설치된 실제 Chrome/Edge
  { key: 'pcChrome', engine: chromium, launch: { channel: 'chrome' }, dev: { viewport: { width: 1366, height: 768 } }, desktop: true },
  { key: 'pcEdge', engine: chromium, launch: { channel: 'msedge' }, dev: { viewport: { width: 1920, height: 1080 } }, desktop: true },
  { key: 'macSafari', engine: webkit, dev: devices['Desktop Safari'], desktop: true },
];

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
function startServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(ROOT, url === '/' ? 'index.html' : url);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    }).listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

// 모의 백엔드 라우팅: firebase-app-compat → mock-firebase, 나머지 firebase 스크립트 → 빈 파일, groups.js → mock-groups
async function routeMocks(ctx) {
  await ctx.route(/gstatic\.com\/firebasejs\/.*-app-compat\.js/, r => r.fulfill({ path: path.join(__dirname, 'mock-firebase.js'), contentType: 'text/javascript' }));
  await ctx.route(/gstatic\.com\/firebasejs\//, r => r.fulfill({ body: '', contentType: 'text/javascript' }));
  await ctx.route(/127\.0\.0\.1:8765\/groups\.js$/, r => r.fulfill({ path: path.join(__dirname, 'mock-groups.js'), contentType: 'text/javascript' }));
  await ctx.route(/formspree\.io/, r => r.fulfill({ status: 200, body: '{"ok":true}', contentType: 'application/json' }));
}

module.exports = { ROOT, PORT, BASE, DEVICES, startServer, routeMocks, webkit, chromium };
