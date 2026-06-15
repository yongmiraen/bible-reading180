# 혼자/조 전환 + 재방문 바로 진입 구조 개편 — 설계 문서

작성일: 2026-06-15

## 배경 / 문제

1. 구글 로그인을 강제했지만, 세팅(plan/mode/startDate/groupId)이 **localStorage(기기별)**에만 있어 새 기기에선 다시 세팅해야 함. → 이미 세팅 이력이 있으면 **바로 통독 화면**으로 가야 편함.
2. `state`에 **모드 하나·진도(readDays) 하나**만 있어 혼자/조가 진도를 **공유**함. 조에 들어가면 조 진도가 덮어써서 진짜 "혼자 ↔ 조 왔다갔다"가 안 됨.
3. (버그) 구글 로그인으로 UID가 바뀌며 예전 익명 조원 문서가 남아 **같은 사람이 조원 목록에 중복**으로 보임.

## 결정 사항

- **진도 완전 분리**: 혼자 통독과 조 통독이 각각 시작일·기간·진도를 가짐
- **재방문 진입**: 앱 열면 **마지막으로 보던 화면(혼자/조)**으로 바로
- **조 참여 범위**: 혼자 1개 + 조 1개 (동시 다수 조는 범위 밖)
- **중복 조원**: 자동 정리 시도(best-effort) + 막힌 경우 재생성 안내
- **전환 토글 위치**: 제목 아래 세그먼트 토글 `[ 🙂 혼자 | 👥 조 ]`

## 접근 방식 (선택: 스냅샷 보관)

화면이 읽는 평면 필드(`plan/readDays/startDate/groupName/groupId/displayName`)는 **현재 활성 모드의 값**으로 그대로 유지한다. 비활성(혼자) 컨텍스트는 `state.soloStash`에 보관하고 전환 시 swap 한다.
→ 렌더링 코드를 거의 건드리지 않아 저위험. 전환/저장/로드 로직만 변경.

(대안: `activePlan()` 등 접근자 함수로 전 호출부 교체 — 더 깔끔하나 고위험이라 채택 안 함.)

## 데이터 모델

### localStorage `state` (현재 보던 것 캐시)
```
mode: 'solo' | 'group' | null         // 활성 모드(마지막 본 화면)
// 활성 컨텍스트 — 기존 평면 필드 그대로:
plan, startDate, groupName, readDays, groupId, displayName, viewDay, view
// 비활성 보관소:
soloStash: { plan, startDate, groupName, readDays }   // 조 볼 때 혼자 데이터 보관
groupRef:  { groupId, displayName } | null            // 혼자 볼 때 조 멤버십 기억
// 전역 공통:
bibleView, highlights
```

규칙:
- `mode === 'solo'`일 때 평면 필드 = 살아있는 혼자 컨텍스트. `groupRef`는 조 멤버십을 기억.
- `mode === 'group'`일 때 평면 필드 = 조 컨텍스트(멤버 문서/그룹 문서에서 옴). 혼자 데이터는 `soloStash`에 보관.

### 클라우드 `users/{uid}` (기기 간 복원 source of truth)
```
activeMode: 'solo' | 'group'
solo: { plan, startDate, groupName, readDays }
groupRef: { groupId, displayName } | null
bibleView, highlights
previousUids: [oldUid, ...]   // 중복 정리에 사용
updatedAt
```
병합 규칙: `readDays`는 **합집합**(읽음은 한 번 읽으면 유지), 시작일/플랜/이름 등 스칼라는 **최신(updatedAt) 우선**, 충돌 시 클라우드 우선.

## 동작 흐름

### 1) 재방문 바로 진입
`init()`에서 구글 인증 후 `users/{uid}` 로드 → localStorage와 병합:
- 프로필에 활성 컨텍스트가 세팅돼 있으면(혼자: startDate 있음 / 조: groupRef 있음) **설정 위저드 건너뛰고 바로 통독 화면(main)**.
- 새 기기에서도 동일하게 복원(조 멤버십 포함).
- 아무 세팅도 없으면 기존 위저드(기간 → 모드 → 세부).

### 2) 혼자 ↔ 조 전환 (제목 아래 세그먼트 토글)
```
[ 🙂 혼자  |  👥 조 ]   ← 현재 모드 강조
```
- **조 → 혼자**: `Groups.unsubscribe()`, 평면 필드를 `soloStash`에서 복원, `mode='solo'`, `applyPlan`, `subscribeSolo`, 클라우드 `activeMode='solo'` 기록.
- **혼자 → 조**: 평면 필드를 `soloStash`에 저장, `groupRef`가 있으면 그 조 구독(평면 readDays/plan은 멤버 문서에서), 없으면 **조 만들기/참가 화면**으로. `activeMode='group'` 기록.
- 전환 시 `activeMode`를 클라우드에 즉시 기록 → 다른 기기도 "마지막 화면" 일치.

### 3) 중복 조원 자동 정리 (best-effort)
- 익명→구글 sign-in으로 UID가 바뀌는 순간 이전 UID를 `previousUids`에 기록.
- 활성 `groupRef.groupId`에 대해, 이전 UID의 조원 문서가 있으면 그 `readDays`를 새 문서에 **합집합 병합 후 이전 문서 삭제**.
- 삭제 권한을 위해 Firestore 규칙에 **"조장은 조원 삭제 가능"**(`allow delete: if isGroupOwner(groupId)`) 추가.
- ⚠️ 한계: 예전 조가 익명 계정으로 만들어져 **owner가 죽은 UID**면 자동 정리/관리가 불가 → 감지해서 **조 재생성 안내/버튼** 제공.

## 컴포넌트 변경

### groups.js
- `watchSoloData`/`saveSoloData`를 "프로필"로 확장: `activeMode`, `solo{}`, `groupRef`, `previousUids` 포함.
- 멤버 readDays 병합 헬퍼(합집합) 추가.
- (선택) 조장 조원 삭제 API: `removeMember(code, uid)`.

### app.js
- `defaultState()`에 `soloStash`, `groupRef` 추가. `loadState()`에서 구버전(평면 단일 모드) → 신구조 마이그레이션.
- `init()`: 클라우드 프로필 로드·병합 → 바로 진입 분기.
- 전환 함수 `switchToSolo()` / `switchToGroup()`.
- 헤더 제목 아래 세그먼트 토글 렌더 + 바인딩(메인/리스트 등 공통).
- 중복 정리: `reconcileMembers()` (로그인 직후 1회).
- 조 owner가 죽은 UID인지 감지 → 재생성 안내.

### FIRESTORE_RULES.md / firestore.rules
- members에 `allow delete: if isGroupOwner(groupId)` 추가(자기 자신 삭제 규칙은 유지).
- `users/{uid}` 규칙 확인(본인만 read/write).

## 마이그레이션 / 호환

- 기존 사용자: `loadState()`가 평면 단일 모드 상태를 신구조로 변환(현재 mode가 solo면 그 값을 solo 컨텍스트로, group이면 groupRef로 채움).
- 진도 유실 방지: 모든 병합은 readDays 합집합.

## 검증 포인트 (구현 후)
1. 혼자→조→혼자 전환 시 각자 진도/시작일 유지
2. 새 기기 로그인 시 마지막 화면으로 바로 진입 + 조 복원
3. 중복 조원이 로그인 후 사라지고 진도 병합됨
4. 익명-owner 조 감지 시 재생성 안내가 뜸
5. 조장 조원 삭제 규칙이 본인 외 타인 삭제를 owner에게만 허용
