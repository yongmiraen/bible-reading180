# e2e 테스트

| 명령 | 내용 |
|---|---|
| `npm test` | 순수 로직·데이터 단위 테스트 (`test/*.test.js`) |
| `npm run test:rules` | Firestore 에뮬레이터: 보안 규칙 + `groups.js` 저장·동기화 (Java 21 + firebase-tools 필요) |
| `node test/e2e/run.js [기기]` | 7개 환경 사용 시나리오 (모의 백엔드). 기기: `iphone` `iphoneSE` `android` `galaxyS` `pcChrome` `pcEdge` `macSafari`, 묶음 `mobile` `pc` |
| `node test/e2e/midnight.js` | 자정 넘김 시나리오 (Android·iPhone) |

- `run.js`는 로컬 서버(127.0.0.1:8765)를 직접 띄우고, Firebase 스크립트와 `groups.js`를 `mock-firebase.js`·`mock-groups.js`로 바꿔 끼운다. 실제 서버에는 아무것도 쓰지 않는다.
- Windows용 Playwright WebKit은 터치 탭에서 click을 합성하지 않아(실기기 iOS는 합성), WebKit·PC는 `click`으로 조작한다.
- 결과 `test/e2e/results.json`, 스크린샷 `test/e2e/shots/` (gitignore).
- 시나리오 추가: `scenarios-memorize.js`가 있으면 조 모드 단계 뒤에 실행된다.
- PC 시나리오는 설치된 Chrome(`channel: chrome`)·Edge(`channel: msedge`)를 쓴다.
