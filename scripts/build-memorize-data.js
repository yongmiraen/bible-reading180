// 사랑의교회 성경암송 72구절 원자료(scripts/amsong72-source.json) → memorize-data.js 생성
//   node scripts/build-memorize-data.js            # memorize-data.js 생성
//   node scripts/build-memorize-data.js --review   # 분할(chunks) 검토표(마크다운) 출력
//
// 본문은 앱의 개역개정(bible/GAE.js)을 쓰고, 여기서는 참조·소주제·분할 위치만 만든다.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
global.window = global.window || {};
require(path.join(ROOT, 'schedule-data.js'));
require(path.join(ROOT, 'bible/GAE.js'));
const GAE = global.window.BIBLES.GAE;
const FULL2ABBR = Object.fromEntries(Object.entries(global.window.BOOK_NAMES).map(([a, f]) => [f, a]));
const SOURCE = require('./amsong72-source.json').items;

const SOURCE_LABEL = '사랑의교회 성경암송 72구절 (네비게이토)';
// 사이트 표기 오류 보정 (참조 → 소주제)
const TOPIC_FIXES = { '고린도후서 9:6,7': '후히 드릴 것' };
// 사람 검토 후 분할 위치 수동 지정: { [id]: ['새 부분이 시작되는 문구', ...] }
// 자동 분할이 의미 중간(예: "나를 / 사랑하사")에서 끊긴 곳만. 검토표: docs/superpowers/specs/2026-11-23-memorize-72-chunks.md
const CHUNK_STARTS = {
  '갈2:20': ['그런즉 이제는', '이제 내가 육체', '나를 사랑하사', '하나님의 아들을'],
  '요14:21': ['나를 사랑하는 자는'],
  '수1:8': ['그 안에 기록된'],
  '사53:6': ['여호와께서는'],
  '요5:24': ['내 말을 듣고', '심판에 이르지'],
  '롬12:2': ['하나님의 선하시고'],
  '고후4:5': ['오직 그리스도', '또 예수를'],
  '행1:8': ['예루살렘과'],
  '히11:6': ['하나님께 나아가는', '또한 그가'],
  '골1:28': ['모든 지혜로', '이를 위하여'],
  '고후9:6': ['각각 그 마음에', '인색함으로나'],
  '요일2:15': ['누구든지 세상을', '이는 세상에', '다 아버지께로부터'],
  '골3:16': ['시와 찬송과'],
};

// 시작 문구 → 어절 인덱스 (앞 경계 이후에서 처음 나오는 위치)
function startsToCuts(w, starts, label) {
  const cuts = [];
  let from = 1;
  for (const phrase of starts) {
    const pw = phrase.split(' ');
    let found = -1;
    for (let i = from; i <= w.length - pw.length; i++) {
      if (pw.every((x, j) => w[i + j] === x)) { found = i; break; }
    }
    if (found < 0) throw new Error(`${label}: 시작 문구 없음 "${phrase}"`);
    cuts.push(found);
    from = found + 1;
  }
  return cuts;
}

const MAX_WORDS = 15;          // 이하면 나누지 않음
const MIN_PART = 4;            // 한 부분 최소 어절
const WIN_MIN = 8, WIN_MAX = 14; // 연결어미 분할 창
const CONNECTIVE = /[니고며요라되나매면]$/;

const words = s => s.trim().split(/\s+/);

function parseRef(ref) {
  const m = ref.match(/^(.+?)\s*(\d+):(.+)$/);
  if (!m) throw new Error('참조 형식 오류: ' + ref);
  const abbr = FULL2ABBR[m[1]];
  if (!abbr) throw new Error('책 이름 없음: ' + m[1]);
  const ch = +m[2];
  const nums = [];
  for (const part of m[3].split(',')) {
    const [a, b] = part.split(/[~\-]/).map(Number);
    for (let x = a; x <= (b || a); x++) nums.push(x);
  }
  return nums.map(n => `${abbr}${ch}:${n}`);
}

// 한 구간 [s, e)을 연결어미 뒤에서 WIN_MIN~WIN_MAX 어절 단위로 나눈 경계들
function splitSegment(w, s, e) {
  const cuts = [];
  let start = s;
  while (e - start > MAX_WORDS) {
    const len = e - start;
    const target = start + Math.round(len / Math.ceil(len / WIN_MAX));
    let best = null;
    for (let p = start + WIN_MIN; p <= Math.min(start + WIN_MAX, e - MIN_PART); p++) {
      if (!CONNECTIVE.test(w[p - 1].replace(/[^가-힣]/g, ''))) continue;
      if (best === null || Math.abs(p - target) < Math.abs(best - target)) best = p;
    }
    const cut = best !== null ? best : Math.min(target, e - MIN_PART);
    cuts.push(cut);
    start = cut;
  }
  return cuts;
}

function makeChunks(keys) {
  const verseWords = keys.map(k => words(GAE[k]));
  const w = verseWords.flat();
  if (w.length <= MAX_WORDS) return null;
  // ① 여러 절이면 절 경계 우선 (너무 짧은 절은 이웃과 합침)
  let bounds = [0];
  if (keys.length > 1) {
    let acc = 0;
    for (let i = 0; i < verseWords.length - 1; i++) {
      acc += verseWords[i].length;
      if (acc - bounds[bounds.length - 1] >= MIN_PART && w.length - acc >= MIN_PART) bounds.push(acc);
    }
  }
  bounds.push(w.length);
  // ② 그래도 긴 구간은 연결어미 뒤에서
  const cuts = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    if (i > 0) cuts.push(bounds[i]);
    cuts.push(...splitSegment(w, bounds[i], bounds[i + 1]));
  }
  return cuts.length ? cuts : null;
}

function build() {
  const sets = [];
  for (const item of SOURCE) {
    let set = sets.find(s => s.id === item.set);
    if (!set) {
      set = { id: item.set, title: item.section.replace(/^[A-F]\.\s*/, ''), topics: [] };
      sets.push(set);
    }
    const topicTitle = TOPIC_FIXES[item.ref] || item.topic;
    let topic = set.topics[set.topics.length - 1];
    if (!topic || topic.verses.length === 2) {
      topic = { title: topicTitle, verses: [] };
      set.topics.push(topic);
    }
    const keys = parseRef(item.ref);
    const id = keys[0];
    const chunks = CHUNK_STARTS[id]
      ? startsToCuts(keys.flatMap(k => words(GAE[k])), CHUNK_STARTS[id], item.ref)
      : makeChunks(keys);
    topic.verses.push({ id, label: item.ref, keys, chunks });
  }
  return { source: SOURCE_LABEL, sets };
}

function reviewTable(data) {
  const rows = ['| 참조 | 어절 | 부분 |', '|---|---|---|'];
  for (const s of data.sets) for (const t of s.topics) for (const v of t.verses) {
    if (!v.chunks) continue;
    const w = v.keys.flatMap(k => words(GAE[k]));
    const cuts = [0, ...v.chunks, w.length];
    const parts = [];
    for (let i = 0; i < cuts.length - 1; i++) parts.push(w.slice(cuts[i], cuts[i + 1]).join(' '));
    rows.push(`| ${v.label} | ${w.length} | ${parts.join(' **/** ')} |`);
  }
  return rows.join('\n');
}

const data = build();
if (process.argv.includes('--review')) {
  console.log(reviewTable(data));
} else {
  const body = `// 자동 생성: node scripts/build-memorize-data.js (원자료: scripts/amsong72-source.json)
// 출처: ${SOURCE_LABEL}. 본문은 bible/GAE.js(개역개정)에서 keys로 찾는다.
(function () {
  var DATA = ${JSON.stringify(data, null, 1)};
  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;
  if (typeof window !== 'undefined') window.MEMORIZE72 = DATA;
})();
`;
  fs.writeFileSync(path.join(ROOT, 'memorize-data.js'), body);
  console.log('memorize-data.js 생성:', data.sets.length, '묶음,', data.sets.reduce((n, s) => n + s.topics.length * 2, 0), '구절');
}
