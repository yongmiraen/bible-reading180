// e2e 테스트용 모의 window.Groups — groups.js 대신 로드. 메모리 + localStorage('__mockdb')에 저장(새로고침 유지).
// 실제 API 표면 전체를 흉내내고, 쓰기 횟수를 window.__mockStats에 센다.
(function () {
  const KEY = '__mockdb';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; } };
  const db = load() || { users: {}, groups: {}, members: {}, prayers: {}, comments: {} };
  const persist = () => localStorage.setItem(KEY, JSON.stringify(db));
  const stats = window.__mockStats = { writes: 0, writeBytes: 0, byOp: {} };
  const count = (op, payload) => { stats.writes++; stats.byOp[op] = (stats.byOp[op] || 0) + 1; stats.writeBytes += JSON.stringify(payload || {}).length; };
  const ts = () => { const ms = Date.now(); return { seconds: Math.floor(ms / 1000), toDate: () => new Date(ms) }; };
  const revive = o => { if (o && o.createdAt && o.createdAt.seconds) { const s = o.createdAt.seconds; o.createdAt.toDate = () => new Date(s * 1000); } return o; };
  const uid = 'u-tester';
  const user = { uid, isAnonymous: false, providerData: [{ providerId: 'google.com', email: 'tester@example.com', displayName: '테스터' }] };
  const L = {};
  const on = (k, cb) => { (L[k] = L[k] || []).push(cb); return () => { L[k] = (L[k] || []).filter(x => x !== cb); }; };
  const emit = (k, ...v) => (L[k] || []).forEach(cb => setTimeout(() => cb(...v), 0));
  const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const META = { fromCache: false, hasPendingWrites: false };
  const membersArr = c => Object.entries(db.members[c] || {}).map(([u, d]) => ({ uid: u, ...clone(d) }));
  const prayersArr = c => Object.entries(db.prayers[c] || {}).map(([id, d]) => revive({ id, ...clone(d) })).sort((a, b) => b.createdAt.seconds - a.createdAt.seconds);
  const commentsArr = (c, p) => Object.entries((db.comments[c] || {})[p] || {}).map(([id, d]) => revive({ id, ...clone(d) }));
  const userDoc = u => (db.users[u] ? clone(db.users[u]) : null);
  const emitUser = u => emit('u:' + u, userDoc(u), META);
  const emitMembers = c => emit('m:' + c, membersArr(c));
  let gU = [], seq = 1;
  const id = () => 'id' + (seq++) + Math.random().toString(36).slice(2, 6);
  // 테스트가 실패를 주입: window.__mockFail = { setMemorized: 'permission-denied', leaveGroup: 'unavailable' }
  const failOf = op => (window.__mockFail || {})[op];

  const G = {
    authReady: Promise.resolve(user),
    getUserId: () => uid,
    getUserInfo: () => ({ uid, isAnonymous: false, googleEmail: 'tester@example.com', googleName: '테스터' }),
    onAuthChange() {},
    async createGroup({ name, startDate, displayName, plan, memorized }) {
      const code = 'TEST01';
      db.groups[code] = { name, startDate, owner: uid, createdAt: ts() };
      db.members[code] = { [uid]: { displayName, plan: plan || '180', readDays: {}, ...(memorized ? { memorized: clone(memorized) } : {}) } };
      db.members[code]['u-other'] = { displayName: '다른조원', plan: '180', readDays: { 1: true, 2: true }, memorized: { '고후5:17': '2026-11-01' } };
      count('createGroup', db.groups[code]); persist(); return code;
    },
    async getGroup(c) { return db.groups[c] ? clone(db.groups[c]) : null; },
    async joinGroup({ code, displayName, existingReadDays, plan, memorized }) {
      if (!db.groups[code]) throw new Error('그룹을 찾을 수 없어요. 코드를 확인해주세요');
      db.members[code] = db.members[code] || {};
      const cur = db.members[code][uid];
      db.members[code][uid] = cur
        ? { ...cur, displayName, ...(plan ? { plan } : {}) }
        : { displayName, plan: plan || '180', readDays: existingReadDays || {}, ...(memorized ? { memorized: clone(memorized) } : {}) };
      count('joinGroup', db.members[code][uid]); persist(); emitMembers(code); return clone(db.groups[code]);
    },
    async leaveGroup(c) {
      if (failOf('leaveGroup')) throw Object.assign(new Error('mock fail'), { code: failOf('leaveGroup') });
      delete (db.members[c] || {})[uid]; count('leaveGroup'); persist(); emitMembers(c);
    },
    subscribeGroup(c, onG, onM) {
      G.unsubscribe();
      gU.push(on('g:' + c, onG), on('m:' + c, onM));
      setTimeout(() => { onG(db.groups[c] ? clone(db.groups[c]) : null); onM(membersArr(c)); }, 0);
    },
    unsubscribe() { gU.forEach(f => f()); gU = []; },
    async setReadDays(c, readDays) {
      const m = (db.members[c] || {})[uid];
      if (!m) throw Object.assign(new Error('not-found'), { code: 'not-found' });
      m.readDays = clone(readDays); count('setReadDays', { readDays }); persist(); emitMembers(c);
    },
    async updateMyMember(c, patch) {
      const m = (db.members[c] || {})[uid];
      if (!m) throw Object.assign(new Error('not-found'), { code: 'not-found' });
      Object.assign(m, clone(patch)); count('updateMyMember', patch); persist(); emitMembers(c);
    },
    async updateGroupMeta(c, patch) { Object.assign(db.groups[c], clone(patch)); count('updateGroupMeta', patch); persist(); emit('g:' + c, clone(db.groups[c])); },
    async setMemoStart(c, dateISO) { return G.updateGroupMeta(c, { memoStart: dateISO }); },
    subscribePrayers(c, cb) { const u = on('p:' + c, cb); setTimeout(() => cb(prayersArr(c)), 0); return u; },
    async addPrayer(c, text, authorName) { (db.prayers[c] = db.prayers[c] || {})[id()] = { authorUid: uid, authorName: authorName || '익명', text, createdAt: ts() }; count('addPrayer', { text }); persist(); emit('p:' + c, prayersArr(c)); },
    async editPrayer(c, pid, text) { db.prayers[c][pid].text = text; count('editPrayer', { text }); persist(); emit('p:' + c, prayersArr(c)); },
    async deletePrayer(c, pid) { delete db.prayers[c][pid]; count('deletePrayer'); persist(); emit('p:' + c, prayersArr(c)); },
    subscribeComments(c, p, cb) { const u = on('c:' + c + p, cb); setTimeout(() => cb(commentsArr(c, p)), 0); return u; },
    async addComment(c, p, text, authorName) { db.comments[c] = db.comments[c] || {}; (db.comments[c][p] = db.comments[c][p] || {})[id()] = { authorUid: uid, authorName, text, createdAt: ts() }; count('addComment', { text }); persist(); emit('c:' + c + p, commentsArr(c, p)); },
    async deleteComment(c, p, cid) { delete db.comments[c][p][cid]; count('deleteComment'); persist(); emit('c:' + c + p, commentsArr(c, p)); },
    async linkOrSignInGoogle() { return { action: 'linked', user }; },
    async signOutToAnonymous() { return user; },
    watchSoloData(u, cb) { const x = on('u:' + u, cb); setTimeout(() => cb(userDoc(u), META), 0); return x; },
    async saveSoloData(u, data) { db.users[u] = { ...(db.users[u] || {}), ...clone(data) }; count('saveSoloData', data); persist(); emitUser(u); },
    // localStorage.__mockSlowProfile='1'이면 두 번째 구독부터 첫 스냅샷을 2.5초 늦춤(초기 로드 경로만 따로 검증)
    watchProfile(u, cb) {
      const n = (stats.watchProfileCalls = (stats.watchProfileCalls || 0) + 1);
      const slow = localStorage.getItem('__mockSlowProfile') === '1' && n > 1;
      let live = !slow;
      const x = on('u:' + u, (...a) => { if (live) cb(...a); });
      setTimeout(() => { live = true; cb(userDoc(u), META); }, slow ? 2500 : 0);
      return x;
    },
    // 실제 groups.js 의미론: set(mergeFields) → 보낸 최상위 필드만 통째로 교체
    async saveProfile(u, patch) { const p = clone(patch); delete p.previousUids; db.users[u] = Object.assign(db.users[u] || {}, p); count('saveProfile', patch); persist(); emitUser(u); return true; },
    async setProfileMapKeys(u, field, entries) {
      if (!db.users[u]) return false;
      const m = db.users[u][field] = db.users[u][field] || {};
      for (const [k, v] of entries) { if (v == null) delete m[k]; else m[k] = v; }
      count('setProfileMapKeys', { field, entries }); persist(); emitUser(u); return true;
    },
    async setMemorized(u, vid, dateISO) {
      if (failOf('setMemorized')) return { ok: false, code: failOf('setMemorized') };
      db.users[u] = db.users[u] || {};
      const m = db.users[u].memorized = db.users[u].memorized || {};
      if (dateISO) m[vid] = dateISO; else delete m[vid];
      count('setMemorized', { vid, dateISO }); persist(); emitUser(u); return { ok: true };
    },
    async reconcileMemorized(c, u, validIds) {
      const mem = (db.members[c] || {})[u];
      if (!mem) return 'no-member';
      const prof = db.users[u] || {};
      if ('groupRef' in prof && (!prof.groupRef || prof.groupRef.groupId !== c)) return 'not-current';
      const Lg = window.MemorizeLogic;
      const orig = Lg ? Lg.normalizeMemorized((db.users[u] || {}).memorized, validIds) : clone((db.users[u] || {}).memorized || {});
      const same = Lg ? Lg.sameMemorized(orig, mem.memorized || {}) : JSON.stringify(orig) === JSON.stringify(mem.memorized || {});
      stats.reconcileCalls = (stats.reconcileCalls || 0) + 1;
      if (same) return 'same';
      mem.memorized = orig; count('reconcileMemorized', orig); persist(); emitMembers(c); return 'updated';
    },
    async getMemberOnce(c, u) { return (db.members[c] || {})[u] ? clone(db.members[c][u]) : null; },
    async removeMember(c, u) { delete db.members[c][u]; count('removeMember'); persist(); emitMembers(c); },
  };
  window.Groups = G;

  // 다른 조원의 활동 흉내
  window.__mockExternal = {
    otherChecks(c, day) { db.members[c]['u-other'].readDays[day] = true; persist(); emitMembers(c); },
    otherComments(c, p, text) { db.comments[c] = db.comments[c] || {}; (db.comments[c][p] = db.comments[c][p] || {})[id()] = { authorUid: 'u-other', authorName: '다른조원', text, createdAt: ts() }; persist(); emit('c:' + c + p, commentsArr(c, p)); },
    otherPrays(c, text) { (db.prayers[c] = db.prayers[c] || {})[id()] = { authorUid: 'u-other', authorName: '다른조원', text, createdAt: ts() }; persist(); emit('p:' + c, prayersArr(c)); },
    otherMemorizes(c, vid, dateISO) {
      const m = db.members[c]['u-other'].memorized = db.members[c]['u-other'].memorized || {};
      if (dateISO) m[vid] = dateISO; else delete m[vid];
      persist(); emitMembers(c);
    },
    // 다른 사람이 만든 조 (조 이동 시나리오용)
    makeGroup(c, name) {
      db.groups[c] = { name: name || '다른조', startDate: '2026-11-01', owner: 'u-other', createdAt: ts() };
      db.members[c] = { 'u-other': { displayName: '다른조장', plan: '180', readDays: {} } };
      persist();
    },
    listenerCount: k => (L[k] || []).length,
    db: () => clone(db),
  };
})();
