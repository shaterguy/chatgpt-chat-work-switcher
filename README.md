# ChatGPT Request Snapshot Calibrator

`v0.2.0-dev1`은 기존 Chat ↔ Work Switcher의 요청 가로채기 기술을 **전송 순간 스냅샷 캘리브레이터**로 전환한 TEST 버전입니다.

## 무엇을 기록하나

- 사용자가 시나리오를 `캡처 대기`로 지정한 뒤 실제 프롬프트를 전송할 때 발생하는 ChatGPT conversation POST 요청만 1회 캡처합니다.
- 모델/추론 메뉴를 열거나 항목을 클릭하는 과정은 기록하지 않습니다.
- 요청은 변경하지 않습니다. 전송 직전에 읽기만 하고 ChatGPT가 만든 원래 요청을 그대로 보냅니다.
- 분석용으로 짧은 enum/boolean/number 등 안전한 primitive 제어값과 요청 구조 메타데이터를 저장합니다.

## 저장하지 않는 것

다음 값은 구조적으로 제외합니다.

- 프롬프트와 메시지 원문
- 첨부파일 및 파일 내용
- conversation/message/parent/request/user/account/workspace ID 값
- 쿠키, 세션, 인증 헤더, 토큰, 비밀번호/credential류
- URL·이메일·UUID·긴 opaque 문자열
- `client_contextual_info`와 대표적인 화면/시간 변동값

## 최소 캡처 시나리오

확장프로그램 팝업에 현재 UI에서 선택 가능한 항목을 입력합니다.

- Chat 모델 목록 C개
- Chat 추론 목록 Rc개
- Work 모델 목록 W개
- Work 추론 목록 Rw개

각 목록의 첫 번째 값이 기준값입니다. 필수 최소 횟수는 다음과 같습니다.

`C + Rc - 1 + 2 × (W + Rw - 1)`

구성은 다음 세 묶음입니다.

1. **Chat 첫 턴**: 기준 조합 1회 + 모델만 하나씩 변경 + 추론만 하나씩 변경
2. **Work 첫 턴**: 기준 조합 1회 + 모델만 하나씩 변경 + 추론만 하나씩 변경
3. **Work 동일 대화 후속 턴**: Work 기준 첫 대화를 계속 사용하면서 기준 후속 턴 1회 + 매 턴 모델만 변경 + 매 턴 추론만 변경

Work 모델과 추론이 각각 2개 이상이면 모델+추론을 동시에 바꾸는 **선택 교차검증 1회**도 표시합니다. 이것은 최소 필수 횟수에는 포함하지 않습니다.

## 사용 순서

1. Chrome에서 이 ZIP을 압축 해제하고 `chrome://extensions` → 개발자 모드 → `압축해제된 확장 프로그램을 로드합니다`.
2. 이미 열려 있던 ChatGPT 탭은 설치 후 한 번 새로고침합니다.
3. ChatGPT 탭에서 확장프로그램 아이콘을 열고 Chat/Work 모델 및 추론 목록을 입력한 뒤 `시나리오 생성·저장`을 누릅니다.
4. `다음 미캡처 대기`를 누릅니다.
5. 팝업에 표시된 시나리오대로 ChatGPT UI의 모델·추론 상태를 맞춥니다. 이 클릭 과정은 기록되지 않습니다.
6. 아무 짧은 프롬프트를 **한 번 실제 전송**합니다. 그 전송 요청만 캡처되고 대기는 자동 해제됩니다.
7. 팝업을 다시 열고 다음 시나리오를 반복합니다.
8. 필수 시나리오를 완료하면 `결과 JSON 복사` 또는 `JSON 파일 저장`으로 내보내 ChatGPT에 전달합니다.

## Work 후속 턴 주의점

`work-first-base`로 생성한 **동일한 Work conversation**을 그대로 유지한 채 `work-followup-*` 시나리오들을 순서대로 실행합니다. 이 구간이 Work에서 턴마다 모델 또는 추론을 바꾸었을 때 실제 전송값이 어떻게 달라지는지 확인하는 핵심 표본입니다.

## 결과 형식

내보내는 JSON에는 다음이 포함됩니다.

- 입력한 캘리브레이션 옵션과 최소 시나리오 계획
- 시나리오별 sanitized request snapshot
- 기준 시나리오 대비 `changed / added / removed` 차분
- first/followup 판정, endpoint, transport 등 구조 메타데이터

결과 JSON을 분석하면 SelfRun/Prompt Scheduler가 UI 메뉴를 찾지 않고 실제 전송 순간에 필요한 제어 필드만 원하는 프로필로 치환하는 Request Profile Engine의 기준 자료로 사용할 수 있습니다.

## 개발 검증

```bash
npm run check
```

CI는 구문 검사와 단위/계약 테스트 후 바로 로드 가능한 TEST ZIP을 Actions artifact로 생성합니다.
