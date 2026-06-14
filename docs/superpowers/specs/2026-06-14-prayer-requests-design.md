# 조모드 기도제목 나눔 — 설계 문서

작성일: 2026-06-14

## 목표

조모드(그룹)에서 조원들끼리 기도제목을 서로 공유하고, 실시간으로 볼 수 있게 한다.
또한 조장 권한이 기기마다 달라지는 문제를 막기 위해 **모든 사용자에게 앱 시작 시 Google 로그인을 강제**한다.

## 결정 사항

- **형태:** 피드형 (한 사람이 여러 개 게시, 최신순)
- **상호작용:** 댓글 지원
- **위치:** 헤더에 🙏 전용 탭
- **권한:** 글/댓글은 본인이 수정·삭제. 조장(owner)은 모든 글/댓글 수정·삭제 (댓글은 삭제만)
- **작성자 표시:** 항상 조원 이름(displayName). 익명 옵션 없음
- **실시간:** Firestore `onSnapshot`
- **로그인:** 모든 사용자 앱 진입 시 Google 로그인 강제 (PC/모바일 동일인 보장)

## 데이터 모델 (Firestore)

```
groups/{code}/prayers/{prayerId}
  authorUid: string
  authorName: string   // 작성 시점 이름 스냅샷 (표시는 현재 멤버 displayName 우선)
  text: string         // 1~1000자
  createdAt: timestamp
  updatedAt: timestamp
  └─ comments/{commentId}
       authorUid: string
       authorName: string
       text: string    // 1~500자
       createdAt: timestamp
```

기존 `members` 서브컬렉션 패턴을 그대로 따른다.

## 실시간 구독 전략

- 🙏 탭 진입 시 `prayers` 컬렉션 구독(최신순), 탭 이탈 시 해제
- 댓글은 글을 펼칠 때 해당 글의 `comments`만 구독, 접으면 해제 → 리스너 수 최소화
- 작성자 이름은 현재 조원 목록(`volatile.members`)의 displayName으로 표시, 없으면 저장된 `authorName` 폴백

## 컴포넌트

### groups.js (window.Groups API 추가)
- `subscribePrayers(code, cb)` → unsub
- `addPrayer(code, text, authorName)`
- `editPrayer(code, prayerId, text)`
- `deletePrayer(code, prayerId)` — 하위 댓글 batch 삭제 포함
- `subscribeComments(code, prayerId, cb)` → unsub
- `addComment(code, prayerId, text, authorName)`
- `deleteComment(code, prayerId, commentId)`

### app.js
- 헤더에 🙏 `prayerBtn` (조모드 한정), 전역 delegation으로 라우팅
- `renderPrayer()` / `bindPrayer()` — 작성창 + 피드 + 인라인 수정 + 댓글 스레드
- 구독 수명관리: `ensurePrayerSub()`, `cleanupPrayerSubs()`, `toggleComments()`
- 로그인 게이트: `renderLoginGate()` / `bindLoginGate()` — `init()`에서 Google 미연결 시 표시
- 초대 링크 join 코드는 `sessionStorage`로 보존(로그인 후 reload에도 유지)

### index.html
- `.prayer-*` CSS 추가
- 기도 피드/카드/댓글 스타일

### FIRESTORE_RULES.md
- `prayers`, `comments` match 블록 추가 (조원 읽기, 본인 생성, 본인·조장 수정/삭제, 글자수 검증)
- 기존 member 규칙에 `plan` 필드 반영(코드와 동기화)

## 권한 규칙 요약

- 읽기: 조원만 (`isGroupMember`)
- 생성: 본인(`authorUid == auth.uid`)만, 조원일 것
- 수정/삭제: 작성자 본인 또는 조장(owner)

## 마이그레이션 / 주의

- Google 로그인 강제 후, 기존 익명 사용자는 같은 기기에서 익명→Google 연결(link)로 UID 유지 시도, 다른 기기 기존 Google 계정이면 해당 계정으로 sign-in
- **규칙은 Firebase Console에 수동 배포 필요** (배포 전엔 기도제목 읽기/쓰기 권한 오류)
