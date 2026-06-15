# Firestore Security Rules

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
        && request.resource.data.readDays is map;
    }

    function isPrayerOwner(groupId, prayerId) {
      return signedIn()
        && get(/databases/$(database)/documents/groups/$(groupId)/prayers/$(prayerId)).data.authorUid == request.auth.uid;
    }

    match /users/{userId} {
      allow read, write: if signedIn() && request.auth.uid == userId;
    }

    match /groups/{groupId} {
      // 초대 코드로 참가할 수 있어야 해서 단일 문서 조회(get)는 허용합니다.
      // 전체 그룹 목록 조회(list)는 막습니다.
      allow get: if signedIn();
      allow list: if false;

      allow create: if signedIn() && validGroupCreate();

      // 조 메타 수정/삭제는 조장만 가능합니다.
      allow update: if isGroupOwner(groupId)
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['name', 'startDate'])
        && request.resource.data.name is string
        && request.resource.data.name.size() > 0
        && request.resource.data.name.size() <= 40
        && request.resource.data.startDate is string
        && request.resource.data.startDate.matches('^\\d{4}-\\d{2}-\\d{2}$');

      allow delete: if isGroupOwner(groupId);

      match /members/{userId} {
        // 조원 목록/진도는 같은 조에 참가한 사람만 볼 수 있습니다.
        allow get, list: if isGroupMember(groupId);

        // 본인 멤버 문서만 만들거나 수정할 수 있습니다.
        allow create: if signedIn()
          && request.auth.uid == userId
          && exists(/databases/$(database)/documents/groups/$(groupId))
          && request.resource.data.keys().hasOnly(['displayName', 'plan', 'readDays', 'joinedAt', 'updatedAt'])
          && validMemberData()
          && request.resource.data.joinedAt == request.time
          && request.resource.data.updatedAt == request.time;

        allow update: if signedIn()
          && request.auth.uid == userId
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['displayName', 'plan', 'readDays', 'updatedAt'])
          && validMemberData()
          && request.resource.data.updatedAt == request.time;

        allow delete: if signedIn()
          && (request.auth.uid == userId || isGroupOwner(groupId));
      }

      // 기도제목: 같은 조 조원만 읽기. 작성은 본인 명의로만.
      // 수정/삭제는 작성자 본인 또는 조장(owner).
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

        // 댓글: 조원만 읽기. 작성은 본인 명의로만.
        // 삭제는 댓글 작성자 본인, 글쓴이, 또는 조장.
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

