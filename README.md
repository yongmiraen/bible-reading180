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
- `bible-data.js` — 개역개정 본문
- `manifest.json` / `icon.svg` — PWA 설정

## 데이터 출처

- 성경 본문: 개역개정 (bible.json)
- 통독 일정: 180일 통독 스케쥴.pdf
