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
  const analytics = firebase.analytics();

  // 오프라인 캐시 (best-effort, iOS Safari 호환을 위해 synchronizeTabs 제거)
  db.enablePersistence().catch(() => {});

  let currentUser = null;
  let groupUnsub = null;
  let membersUnsub = null;
  let authChangeCallbacks = [];

  // 인증 상태: 첫 번째 onAuthStateChanged 이벤트를 기다린 뒤
  // 저장된 사용자가 없으면 익명 로그인 (iOS Safari ITP 대응 포함)
  let _lastKnownGoodUser = null; // authReady 시점의 신뢰 가능한 사용자

  const authReadyPromise = new Promise((resolve, reject) => {
    let firstFired = false;
    auth.onAuthStateChanged(async (user) => {
      if (!firstFired) {
        firstFired = true;
        if (user) {
          currentUser = user;
          _lastKnownGoodUser = user;
          resolve(user);
        } else {
          try {
            const cred = await auth.signInAnonymously();
            currentUser = cred.user;
            _lastKnownGoodUser = cred.user;
            resolve(cred.user);
          } catch (e) {
            console.error('Anonymous sign-in failed:', e);
            reject(e);
          }
        }
      } else {
        // 후속 상태 변경
        const prevUid = currentUser ? currentUser.uid : null;
        const newUid = user ? user.uid : null;
        currentUser = user;
        if (user) _lastKnownGoodUser = user;
        if (newUid !== prevUid) {
          authChangeCallbacks.forEach(cb => cb(user, prevUid));
        }
      }
    });
  });

  function onAuthChange(cb) { authChangeCallbacks.push(cb); }

  function genCode(len = 6) {
    // 헷갈리는 글자 제외 (0/1/I/O)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  async function ensureSignedIn() {
    await authReadyPromise;
    // currentUser가 null이면 iOS ITP 등으로 auth 상태가 날아간 것
    // _lastKnownGoodUser 또는 재로그인으로 복구
    if (!currentUser) {
      if (_lastKnownGoodUser && !_lastKnownGoodUser.isAnonymous) {
        // Google 로그인 사용자라면 세션 복구 불가 → 안내
        throw new Error('로그인 세션이 만료되었어요. 설정에서 Google 로그인을 다시 해주세요.');
      }
      // 익명 사용자: 재시도
      try {
        const cred = await auth.signInAnonymously();
        currentUser = cred.user;
        _lastKnownGoodUser = cred.user;
        return currentUser;
      } catch (e) {
        throw new Error('로그인 실패. 인터넷 연결 확인 후 다시 시도해주세요. (Safari 개인정보보호 탭이라면 일반 탭에서 열어주세요)');
      }
    }
    return currentUser;
  }

  async function createGroup({ name, startDate, displayName, plan }) {
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
      plan: plan || '180',
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

  async function joinGroup({ code, displayName, existingReadDays, plan }) {
    const user = await ensureSignedIn();
    const snap = await db.collection('groups').doc(code).get();
    if (!snap.exists) throw new Error('그룹을 찾을 수 없어요. 코드를 확인해주세요');
    const memberRef = db.collection('groups').doc(code).collection('members').doc(user.uid);
    const memberSnap = await memberRef.get();
    const now = firebase.firestore.FieldValue.serverTimestamp();
    if (memberSnap.exists) {
      const updateData = { displayName, updatedAt: now };
      if (plan) updateData.plan = plan;
      await memberRef.update(updateData);
    } else {
      await memberRef.set({
        displayName,
        plan: plan || '180',
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

  async function replaceReadDays(code, readDays) {
    const user = await ensureSignedIn();
    await db.collection('groups').doc(code).collection('members').doc(user.uid).update({
      readDays,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  async function updateGroupMeta(code, patch) {
    await ensureSignedIn();
    await db.collection('groups').doc(code).update(patch);
  }

  // 혼자 모드 클라우드 동기화
  function watchSoloData(uid, cb) {
    return db.collection('users').doc(uid).onSnapshot(
      snap => cb(snap.exists ? snap.data() : null),
      err => console.error('solo sync error:', err)
    );
  }

  async function saveSoloData(uid, data) {
    await db.collection('users').doc(uid).set(
      { ...data, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
  }

  async function replaceSoloReadDays(uid, readDays, extraFields) {
    await db.collection('users').doc(uid).update({
      readDays,
      ...(extraFields || {}),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  function getUserId() {
    return currentUser ? currentUser.uid : null;
  }

  function getUserInfo() {
    if (!currentUser) return null;
    const google = (currentUser.providerData || []).find(p => p.providerId === 'google.com');
    return {
      uid: currentUser.uid,
      isAnonymous: currentUser.isAnonymous,
      googleEmail: google ? google.email : null,
      googleName: google ? google.displayName : null,
    };
  }

  // Google 로그인 — 익명 사용자면 연결(link), 이미 연결된 계정이면 sign-in
  async function linkOrSignInGoogle() {
    await ensureSignedIn();
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      // 현재 익명 사용자 → Google 계정 연결 (같은 UID 유지)
      const result = await currentUser.linkWithPopup(provider);
      return { action: 'linked', user: result.user };
    } catch (e) {
      if (e.code === 'auth/credential-already-in-use' || e.code === 'auth/email-already-in-use') {
        // 이 Google 계정은 다른 기기에서 이미 연결됨 → 기존 계정으로 sign-in
        const cred = e.credential || firebase.auth.GoogleAuthProvider.credentialFromError(e);
        if (cred) {
          const result = await auth.signInWithCredential(cred);
          return { action: 'signed-in', user: result.user };
        }
        // credential 없는 경우 → 직접 sign-in popup
        const result = await auth.signInWithPopup(provider);
        return { action: 'signed-in', user: result.user };
      }
      throw e;
    }
  }

  async function signOutToAnonymous() {
    await auth.signOut();
    // 자동으로 onAuthStateChanged → null → signInAnonymously 재실행
    // 하지만 우리 init은 1회성이라 명시적으로 재로그인
    const cred = await auth.signInAnonymously();
    currentUser = cred.user;
    return cred.user;
  }

  window.Groups = {
    authReady: authReadyPromise,
    getUserId,
    getUserInfo,
    onAuthChange,
    createGroup,
    getGroup,
    joinGroup,
    leaveGroup,
    subscribeGroup,
    unsubscribe,
    setReadDays,
    replaceReadDays,
    updateGroupMeta,
    linkOrSignInGoogle,
    signOutToAnonymous,
    watchSoloData,
    saveSoloData,
    replaceSoloReadDays,
  };
})();
