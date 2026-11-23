# Firestore Security Rules

> **2026-11 성경암송 72구절 기능**: 조원 문서의 `memorized`(외운 구절 사본)와 조의 `memoStart`(암송 시작일)를 허용하도록 바뀌었습니다.
> **앱을 배포하기 전에 반드시 아래 규칙을 먼저 게시(Publish)** 하세요. 앱이 먼저 배포되면 조 만들기·참가·암송 저장이 거부됩니다.
> 규칙 테스트: `firebase emulators:exec --project demo-memorize --only firestore "node --test test/rules/firestore-rules.test.js"`

Firebase Console > Firestore Database > Rules 에 아래 내용을 붙여넣고 Publish 합니다.

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() {
      return request.auth != null;
    }

    function isGroupOwner(groupId) {
      return signedIn()
        && get(/databases/$(database)/documents/groups/$(groupId)).data.owner == request.auth.uid;
    }

    function isGroupMember(groupId) {
      return signedIn()
        && exists(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid));
    }

    function validGroupCreate() {
      return request.resource.data.keys().hasOnly(['name', 'startDate', 'owner', 'createdAt'])
        && request.resource.data.owner == request.auth.uid
        && request.resource.data.name is string
        && request.resource.data.name.size() > 0
        && request.resource.data.name.size() <= 40
        && request.resource.data.startDate is string
        && request.resource.data.startDate.matches('^\\d{4}-\\d{2}-\\d{2}$')
        && request.resource.data.createdAt == request.time;
    }

    function validMemberData() {
      return request.resource.data.displayName is string
        && request.resource.data.displayName.size() > 0
        && request.resource.data.displayName.size() <= 20
        && request.resource.data.readDays is map
        && validMemorized();
    }

    // 성경암송 72구절: 외운 구절 사본 (선택 필드). 원본은 users/{uid}.memorized
    function validMemorized() {
      return !('memorized' in request.resource.data)
        || (request.resource.data.memorized is map && request.resource.data.memorized.size() <= 72);
    }

    // 조 암송 시작일 (선택 필드, 조장만)
    function validMemoStart() {
      return !('memoStart' in request.resource.data)
        || (request.resource.data.memoStart is string
            && request.resource.data.memoStart.matches('^\\d{4}-\\d{2}-\\d{2}$'));
    }

    function isPrayerOwner(groupId, prayerId) {
      return signedIn()
        && get(/databases/$(database)/documents/groups/$(groupId)/prayers/$(prayerId)).data.authorUid == request.auth.uid;
    }

    match /users/{userId} {
      allow read, write: if signedIn() && request.auth.uid == userId;
    }

    match /groups/{groupId} {
      allow get: if signedIn();
      allow list: if false;

      allow create: if signedIn() && validGroupCreate();

      allow update: if isGroupOwner(groupId)
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['name', 'startDate', 'memoStart'])
        && request.resource.data.name is string
        && request.resource.data.name.size() > 0
        && request.resource.data.name.size() <= 40
        && request.resource.data.startDate is string
        && request.resource.data.startDate.matches('^\\d{4}-\\d{2}-\\d{2}$')
        && validMemoStart();

      allow delete: if isGroupOwner(groupId);

      match /members/{userId} {
        // 참가(join) 시 본인 문서 존재 확인을 위해, 본인 문서는 조원이 아니어도 읽기 허용.
        // 목록(list)과 타인 문서 조회는 조원만 가능.
        allow get: if signedIn() && (request.auth.uid == userId || isGroupMember(groupId));
        allow list: if isGroupMember(groupId);

        allow create: if signedIn()
          && request.auth.uid == userId
          && exists(/databases/$(database)/documents/groups/$(groupId))
          && request.resource.data.keys().hasOnly(['displayName', 'plan', 'readDays', 'memorized', 'joinedAt', 'updatedAt'])
          && validMemberData()
          && request.resource.data.joinedAt == request.time
          && request.resource.data.updatedAt == request.time;

        allow update: if signedIn()
          && request.auth.uid == userId
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['displayName', 'plan', 'readDays', 'memorized', 'updatedAt'])
          && validMemberData()
          && request.resource.data.updatedAt == request.time;

        allow delete: if signedIn()
          && (request.auth.uid == userId || isGroupOwner(groupId));
      }

      match /prayers/{prayerId} {
        allow get, list: if isGroupMember(groupId);

        allow create: if isGroupMember(groupId)
          && request.resource.data.authorUid == request.auth.uid
          && request.resource.data.keys().hasOnly(['authorUid', 'authorName', 'text', 'createdAt', 'updatedAt'])
          && request.resource.data.text is string
          && request.resource.data.text.size() > 0
          && request.resource.data.text.size() <= 1000
          && request.resource.data.authorName is string
          && request.resource.data.authorName.size() <= 20
          && request.resource.data.createdAt == request.time
          && request.resource.data.updatedAt == request.time;

        allow update: if isGroupMember(groupId)
          && (resource.data.authorUid == request.auth.uid || isGroupOwner(groupId))
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['text', 'updatedAt'])
          && request.resource.data.text is string
          && request.resource.data.text.size() > 0
          && request.resource.data.text.size() <= 1000
          && request.resource.data.updatedAt == request.time;

        allow delete: if isGroupMember(groupId)
          && (resource.data.authorUid == request.auth.uid || isGroupOwner(groupId));

        match /comments/{commentId} {
          allow get, list: if isGroupMember(groupId);

          allow create: if isGroupMember(groupId)
            && request.resource.data.authorUid == request.auth.uid
            && request.resource.data.keys().hasOnly(['authorUid', 'authorName', 'text', 'createdAt'])
            && request.resource.data.text is string
            && request.resource.data.text.size() > 0
            && request.resource.data.text.size() <= 500
            && request.resource.data.authorName is string
            && request.resource.data.authorName.size() <= 20
            && request.resource.data.createdAt == request.time;

          allow delete: if isGroupMember(groupId)
            && (resource.data.authorUid == request.auth.uid
                || isPrayerOwner(groupId, prayerId)
                || isGroupOwner(groupId));
        }
      }
    }
  }
}
```
