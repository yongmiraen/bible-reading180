# 절 단위 메모 기능 + 하이라이트 공유 확인 — 설계 문서

작성일: 2026-07-08

## 목표

1. 성경 절에 **개인 메모**를 붙일 수 있게 한다(절 단위, 나만 보기, 기기 간 동기화).
2. 하이라이트가 혼자/조 모드에서 공유되어 유지됨을 확인/보장한다(이미 구조상 전역·개인용이라 별도 변경 없음).

## 결정 사항

- **메모 단위:** 절 단위 (하이라이트와 동일하게 verse ref 키)
- **공개 범위:** 나만 (개인). 클라우드 프로필에 동기화, 조원과 공유하지 않음
- **입력 UI:** 하이라이트 색상 툴바에 📝 버튼 추가 → 전용 모달(textarea + 저장/삭제/취소)
- **표시:** 메모 있는 절에 작은 📝 뱃지, 탭하면 편집창(내용 보기+수정)
- **하이라이트:** 이미 전역·개인용이라 혼자↔조 유지됨. 구조 변경 없음

## 데이터 모델

```js
state.memos = { "창4:2": "가인=농부, 아벨=목자", ... }   // verse ref → 메모 텍스트(문자열)
```
- `defaultState()`에 `memos: {}` 추가
- 하이라이트(`highlights`)와 완전히 같은 취급: 전역, 개인용, 절 ref 키
- 클라우드 프로필 `users/{uid}` 문서에 top-level `memos` 필드로 저장(=`highlights`와 나란히)
- Firestore 규칙 변경 불필요(프로필 문서는 본인만 read/write, 필드 자유)

## 동기화 경로 (하이라이트와 동일)

- 저장: `state.memos` 수정 → `saveState()`(localStorage) + `pushSoloData({ memos: state.memos })`(클라우드)
- `pushSoloData`: 전역 키 `memos`를 `highlights`처럼 프로필 patch에 포함
- `subscribeSolo`: 클라우드 `data.memos`가 로컬과 다르면 `state.memos` 갱신(JSON 비교 가드로 렌더 루프 방지)
- `init`: `rawCloud.memos` 있으면 `state.memos`에 복원
- 병합 정책: 하이라이트와 동일하게 last-writer-wins(개인 데이터, 기기 동시편집 드묾). 별도 union 없음

## 컴포넌트 변경

### app.js
- `defaultState()`에 `memos: {}` 추가
- `pushSoloData`: `if (patch.memos !== undefined) profilePatch.memos = patch.memos;`
- `subscribeSolo`: `highlights` 처리 바로 옆에 `memos` 처리 추가(JSON 비교 후 `changed`)
- `init` 프로필 로드: `if (rawCloud && rawCloud.memos) state.memos = rawCloud.memos;`
- 본문 렌더(절 생성부, 현재 `.verse` / `.verse-compare` 만드는 곳): 해당 절에 메모가 있으면 절 안에 `📝 뱃지`(`<button class="verse-memo-badge" data-ref="...">📝</button>`) 삽입
- 하이라이트 모듈(IIFE) 근처에 **메모 모듈**(IIFE) 추가:
  - 툴바의 📝 버튼 클릭 → 현재 선택 절 ref로 메모 모달 열기
  - `.verse-memo-badge` 클릭(위임) → 해당 ref로 메모 모달 열기
  - 모달: textarea에 기존 메모 프리필, 저장/삭제/취소
  - 저장: `state.memos[ref] = text.trim()` (빈 값이면 delete) → `saveState()` + `pushSoloData({memos})` → 뱃지/모달 갱신 후 재렌더 또는 DOM 갱신

### index.html
- 하이라이트 툴바(`#hl-toolbar`)에 `📝` 버튼 추가(색상 버튼 `.hl-btn`과 구분되는 클래스 `.hl-memo-btn` — 색상 처리 로직에 안 걸리게)
- 메모 모달 마크업 추가(`#memo-modal` + `.memo-card` + `#memo-text` textarea + 저장/삭제/취소 버튼)
- CSS: `.verse-memo-badge`, `.memo-modal`, `.memo-card`, `.memo-actions` 등

## UI 세부

- 색상 툴바 버튼: `[노랑][초록][분홍][파랑][×][📝]`
- 📝 클릭 시: 선택된 절 ref 기준으로 모달 오픈(선택이 없으면 무시)
- 메모 모달: 상단에 절 표기(예: "창 4:2"), textarea(여러 줄, maxlength 1000), 하단 [저장][삭제][취소]
- 메모 있는 절: 절 끝(또는 절 번호 옆)에 작은 📝 — 탭하면 편집창. 텍스트 선택(하이라이트)과 겹치지 않도록 뱃지는 별도 클릭 처리

## 검증 포인트 (구현 후)

1. 절 선택 → 📝 → 메모 작성/저장 → 절에 📝 뱃지 표시
2. 뱃지 탭 → 기존 메모 보이고 수정/삭제 가능
3. 혼자↔조 전환해도 메모·하이라이트 유지
4. 다른 기기 로그인 시 메모 동기화(subscribe/init 경로)
5. 하이라이트만/메모만/둘 다 각각 독립 동작
6. 렌더 루프 없음(subscribeSolo memos 변경 가드)

## YAGNI (범위 밖)

- 조원과 메모 공유(추후 별도 기능)
- Day 단위 메모, 자유 메모장
- 메모 검색/목록 화면
