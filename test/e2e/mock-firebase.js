// e2e 테스트용: gstatic firebase-app-compat.js 대신 로드되는 최소 모의 firebase (실제 통신 없음)
window.firebase = {
  app: () => ({ options: { projectId: 'mock' } }),
  analytics: () => ({ logEvent() {} }),
  firestore: {
    FieldValue: { serverTimestamp: () => ({ __ts: true }), arrayUnion: (...a) => ({ __arrayUnion: a }), delete: () => ({ __delete: true }) },
  },
};
