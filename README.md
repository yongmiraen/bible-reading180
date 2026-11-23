# 성경 통독 180일

조원들과 함께하는 180일 성경 통독 웹앱.

## 사용법

- 배포 URL: https://yongmiraen.github.io/bible-reading180/
- 핸드폰 브라우저에서 열고 "홈 화면에 추가" → 앱처럼 사용
- 시작일을 입력하면 매일 그 날의 본문이 자동으로 표시됨
- 조원이 바뀌면 설정 → 전체 초기화 후 새로 시작

## 구성

- `index.html` — 앱 본체
- `app.js` — 로직
- `schedule-data.js` — 180일 통독 일정 (PDF에서 추출)
- `bible/GAE.js` — 개역개정 본문 + 소제목 (첫 화면에 로드)
- `bible/SAENEW.js`, `bible/NIV.js`, `bible/ESV.js` — 비교 보기에서 필요할 때 로드
- `bible-data.js` — 원본 (4개 번역 통합). 수정 후 `node scripts/split-bible-data.js`로 `bible/` 재생성
- `memorize.js` — 성경암송 72구절 화면 (이번 주·전체 72·조원 현황·연습·복습)
- `memorize-data.js` — 72구절 목록·분할 (생성물: `node scripts/build-memorize-data.js`, 원자료 `scripts/amsong72-source.json`, 출처: 사랑의교회 성경암송 72구절·네비게이토)
- `lib/memorize-logic.js` — 주차·정규화·힌트·복습 계산 (브라우저·node 공용)
- `firestore.rules` / `FIRESTORE_RULES.md` — 보안 규칙 (콘솔에 붙여넣어 게시. **앱보다 먼저**)

## 테스트

`npm install` 후 `npm test`(단위), `npm run test:rules`(Firestore 에뮬레이터, Java 21 필요), `node test/e2e/run.js`(7개 환경). 자세한 내용은 `test/e2e/README.md`.
- `manifest.json` / `icon.svg` — PWA 설정

## 데이터 출처

- 성경 본문: 개역개정 (bible.json)
- 통독 일정: 180일 통독 스케쥴.pdf
