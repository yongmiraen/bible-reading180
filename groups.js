// groups.js — Firebase 인증 + Firestore 그룹 관리
// 전역 window.Groups 로 노출. Firebase compat SDK 사용.

(function() {
  if (!window.firebase) {
    console.error('Firebase SDK not loaded');
    return;
  }
  if (!window.FIREBASE_CONFIG) {
    console.error('Firebase config not loaded');
    return;
  }

  firebase.initializeApp(window.FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db = firebase.firestore();

  // 오프라인 캐시 (best-effort)
  db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

  let currentUser = null;
  let groupUnsub = null;
  let membersUnsub = null;

  auth.onAuthStateChanged(user => { currentUser = user; });

  // 익명 로그인 (즉시 호출)
  const authReadyPromise = (async () => {
    try {
      if (!auth.currentUser) {
        const cred = await auth.signInAnonymously();
        currentUser = cred.user;
      } else {
        currentUser = auth.currentUser;
      }
      return currentUser;
    } catch (e) {
      console.error('Anonymous sign-in failed:', e);
      throw e;
    }
  })();

  function genCode(len = 6) {
    // 헷갈리는 글자 제외 (0/1/I/O)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  async function ensureSignedIn() {
    await authReadyPromise;
    if (!currentUser) throw new Error('Sign-in failed');
    return currentUser;
  }

  async function createGroup({ name, startDate, displayName }) {
    const user = await ensureSignedIn();
    let code;
    for (let i = 0; i < 10; i++) {
      code = genCode();
      const exists = await db.collection('groups').doc(code).get();
      if (!exists.exists) break;
      if (i === 9) throw new Error('초대 코드 생성에 실패했어요');
    }
    const now = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('groups').doc(code).set({
      name, startDate,
      owner: user.uid,
      createdAt: now
    });
    await db.collection('groups').doc(code).collection('members').doc(user.uid).set({
      displayName,
      readDays: {},
      joinedAt: now,
      updatedAt: now
    });
    return code;
  }

  async function getGroup(code) {
    await ensureSignedIn();
    const snap = await db.collection('groups').doc(code).get();
    if (!snap.exists) return null;
    return snap.data();
  }

  async function joinGroup({ code, displayName, existingReadDays }) {
    const user = await ensureSignedIn();
    const snap = await db.collection('groups').doc(code).get();
    if (!snap.exists) throw new Error('그룹을 찾을 수 없어요. 코드를 확인해주세요');
    const memberRef = db.collection('groups').doc(code).collection('members').doc(user.uid);
    const memberSnap = await memberRef.get();
    const now = firebase.firestore.FieldValue.serverTimestamp();
    if (memberSnap.exists) {
      await memberRef.update({ displayName, updatedAt: now });
    } else {
      await memberRef.set({
        displayName,
        readDays: existingReadDays || {},
        joinedAt: now,
        updatedAt: now
      });
    }
    return snap.data();
  }

  async function leaveGroup(code) {
    const user = await ensureSignedIn();
    await db.collection('groups').doc(code).collection('members').doc(user.uid).delete();
  }

  function subscribeGroup(code, onGroupData, onMembers) {
    unsubscribe();
    groupUnsub = db.collection('groups').doc(code).onSnapshot(
      snap => onGroupData(snap.exists ? snap.data() : null),
      err => console.error('group sub error:', err)
    );
    membersUnsub = db.collection('groups').doc(code).collection('members').onSnapshot(
      qs => {
        const members = [];
        qs.forEach(d => members.push({ uid: d.id, ...d.data() }));
        onMembers(members);
      },
      err => console.error('members sub error:', err)
    );
  }

  function unsubscribe() {
    if (groupUnsub) { groupUnsub(); groupUnsub = null; }
    if (membersUnsub) { membersUnsub(); membersUnsub = null; }
  }

  async function setReadDays(code, readDays) {
    const user = await ensureSignedIn();
    await db.collection('groups').doc(code).collection('members').doc(user.uid).set({
      readDays,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  async function updateGroupMeta(code, patch) {
    await ensureSignedIn();
    await db.collection('groups').doc(code).update(patch);
  }

  function getUserId() {
    return currentUser ? currentUser.uid : null;
  }

  window.Groups = {
    authReady: authReadyPromise,
    getUserId,
    createGroup,
    getGroup,
    joinGroup,
    leaveGroup,
    subscribeGroup,
    unsubscribe,
    setReadDays,
    updateGroupMeta
  };
})();
