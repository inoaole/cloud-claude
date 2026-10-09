# Projects PM 뷰 설계

- 작성일: 2026-10-09
- 상태: 승인 대기 (시안 승인: `2026-10-09-projects-pm-view-mockup.html`)
- 선행: `2026-10-07-projects-tab-design.md` (PR #14, 머지됨). 그 설계의 섹션 상태 원칙(`ok | error | unconfigured`, 확인 불가 ≠ 없음)을 그대로 따른다.

## 1. 목적

Projects 탭은 연결은 되지만 한눈에 안 들어온다. Discord 원문 나열, 사람 전원 목록, 계획 없는 PR 수. 리더가 폰에서 **10초 안에** 세 가지에 답하게 만든다.

1. 우리 괜찮은가? (건강 판정)
2. 일정에서 어디쯤이고, 이번 버전에서 무엇이 끝났나? (타임라인 + 체크리스트)
3. 내가 개입할 것은? (예외: 멈춘 사람, 의심 PR, 답 없는 질문)

**성공 기준**
- 상세 화면 첫 화면(스크롤 전)에 판정 한 줄 + 타임라인 + 이번 버전 체크리스트가 보인다.
- 정상인 사람·PR은 상세 첫 화면에 나오지 않는다.
- Discord는 날짜별 결정·막힘·질문·공지 몇 줄로 읽힌다. 원문은 한 탭 아래.
- 이번 주 PR마다 "의도가 남아 있는가" 판정과 리뷰에서 물어볼 질문 1개가 있다. 리더만 본다.
- LLM이 만든 것은 전부 `~` 추정 표기 + 생성 시각.

**하지 않는 것 (YAGNI)**
퍼센트 진행률, 번다운/차트, 사람 전원 카드, 알림 푸시, 판정을 팀 채널에 게시, 커밋 단위 분석(커밋 API 추가 호출), SWYP 데이터, 앱 안에서 일정 편집.

## 2. 데이터 출처

| 사실 | 출처 | 갱신 |
|---|---|---|
| 계획 (기간·버전·기능·오너) | **`schedule.json`** — 팀 레포 `uni-keyyy/Unikey-outline`의 `기획/schedule.json`, GitHub contents API로 읽음 | 요청 시 (60초 캐시) |
| 기능이 끝났는가 | 기능에 연결된 **GitHub 이슈** 상태 + 그 이슈를 `#N`으로 언급하는 PR | 요청 시 |
| 팀원·주간 판정·이번 주 PR | 기존 그대로 (penalty-bot `config.json`/`ledger.json`, GitHub pulls) | 요청 시 |
| Discord 요약, PR 판정 | **배치 러너**가 `claude -p`로 만든 `data/briefs/<project>.json` | cron 2시간마다 |
| Discord 원문 | 기존 그대로 (채널 최근 50개) | 요청 시 |

허브는 LLM을 직접 부르지 않는다. 요청 경로는 지금처럼 파일 읽기 + REST뿐이고, 느리고 비싼 일은 배치가 한다(시안 승인 시 결정한 A안).

### 2.1 `schedule.json` 형식

v6 일정(`mabc_final/docs/개발_일정_v6.md`)을 옮긴 것. 사람이 손으로 고치는 파일이라 최소 필드만.

```json
{
  "phases": [
    { "name": "W1", "start": "2026-10-10", "end": "2026-10-12" },
    { "name": "S 솔로", "start": "2026-10-13", "end": "2026-10-19" },
    { "name": "휴식", "start": "2026-10-20", "end": "2026-10-28", "rest": true },
    { "name": "W2", "start": "2026-10-29", "end": "2026-11-01" },
    { "name": "W3", "start": "2026-11-02", "end": "2026-11-08" },
    { "name": "런칭", "start": "2026-11-09", "end": "2026-11-15" }
  ],
  "versions": [
    { "id": "0.0.3", "due": "2026-10-12", "goal": "한 줄 관통", "features": [
      { "name": "기획 CRUD · 배포", "owner": "종현", "issues": ["uni-keyyy/uni-keyyy_api#4"] },
      { "name": "PRD 슬라이스", "owner": "서윤", "issues": [] }
    ] }
  ]
}
```

- `owner`는 penalty-bot `config.json`의 `name`과 같은 문자열.
- `issues`는 `owner/repo#N` 전체 표기. 비어 있으면 그 기능은 **"이슈 없음"** — 진도를 알 수 없다는 뜻이고, "시작 안 함"과 구분한다.
- `milestone`(타임라인 마름모)은 `versions`의 `id`·`due`가 곧 마일스톤이다. 따로 두지 않는다.
- 검증: 날짜는 `YYYY-MM-DD`, `issues` 원소는 `^[\w.-]+/[\w.-]+#\d+$`. 어기면 `plan.state = error`.

### 2.2 `projects.json` 추가 필드

```json
{ "id": "mabc", "...": "기존 필드",
  "schedule": { "repo": "uni-keyyy/Unikey-outline", "path": "기획/schedule.json" } }
```

`schedule`이 없으면 계획 섹션은 `unconfigured`. 봇 토큰(`claude-bot-jh`)에 Unikey-outline **Read** 권한을 추가해야 한다(사용자 작업). 권한이 없으면 404 → `plan.state = error`.

## 3. 판정 규칙 (허브, 결정적 — LLM 없음)

### 3.1 기능 상태

| 상태 | 조건 |
|---|---|
| `done` (머지) | 연결된 이슈가 **전부 닫힘** |
| `pr` (PR 열림) | 열린 이슈가 있고, 그 이슈 번호를 본문에 `#N`으로 언급하는 **열린 PR**이 같은 레포에 있음 |
| `todo` (시작 안 함) | 열린 이슈가 있고 연결 PR 없음 |
| `unlinked` (이슈 없음) | `issues`가 비어 있음 |
| `null` (확인 불가) | GitHub 실패 |

시안의 4단계 막대(계약→슬라이스→PR→머지)는 **관측 가능한 3단계**(시작 안 함→PR→머지)로 줄인다. "계약"·"슬라이스"는 GitHub에서 기계적으로 보이지 않는다. 보이지 않는 것을 그리면 가짜 정밀도다.

### 3.2 현재 버전

`due >= 오늘(KST)`이고 `done`이 아닌 기능이 있는 가장 이른 버전. 단, **`due < 오늘`인데 미완 기능이 있는 버전이 있으면 그 버전이 현재**(밀린 것이 먼저 보여야 한다). 모든 버전이 끝났으면 null.

### 3.3 건강 판정 (위에서부터 첫 번째로 맞는 것)

| 판정 | 조건 | 이유 한 줄 예 |
|---|---|---|
| `unknown` | `plan.state != ok` | "일정을 읽지 못함" |
| `off` | 현재 버전 `due < 오늘` | "`0.0.3` 마감 2일 지남, 미완 2개" |
| `risk` | 현재 버전 D-3 이내에 `todo`·`unlinked` 기능 있음 | "`0.0.3`까지 3일, PRD 슬라이스 시작 전" |
| `risk` | 예외(3.4) 중 `suspect` PR 또는 지난주 `fail`인 사람 있음 | "확인 필요 PR 1개" |
| `on` | 그 외 | "`0.0.3`까지 3일, 5개 중 2개 머지" |

### 3.4 예외 ("확인 필요")

| 종류 | 조건 |
|---|---|
| `stalled` | 현재 버전에 `todo`/`unlinked` 기능을 가진 오너가 이번 주 PR 0개이고 휴식 모드가 아님 |
| `review` | brief의 PR 판정이 `check` 또는 `suspect` |
| `failed` | 지난 판정이 `fail` (기존 off track) |

정상인 사람은 예외 목록에 없다.

## 4. 배치 러너 `hub/src/brief.js`

`node hub/src/brief.js` — 서버 cron `0 */2 * * *`. 프로젝트마다:

1. **Discord TL;DR**: 채널별로 최근 2일(KST 오늘·어제) 메시지를 모아 `claude -p`에 넘김 → 날짜별 `[{kind: 결정|막힘|질문|공지, text}]`, 날짜당 최대 5줄. 메시지가 없는 날은 생략.
2. **PR 판정**: 이번 주 PR(기존 `filterPrs` 결과)마다 diff(60k자 상한, lock 파일 제외) + PR 제목·본문 + 커밋 메시지 목록 + **계획 맥락**(현재 버전의 기능 목록과 작성자의 담당 기능)을 넘김 → `{verdict: ok|check|suspect, signals: [{kind, ok, detail}], question}`.
   - `kind`: `plan`(계획 일치) · `chunk`(덩어리 투하) · `reason`(이유 부재) · `contract`(계약 이탈) · `smell`(코드 냄새) · `tests`.
   - 판정 기준은 "AI를 썼나"가 아니라 **"의도와 이유가 남아 있나"**. 프롬프트에 명시.
   - **head sha가 같으면 다시 판정하지 않는다** (이전 brief에서 재사용). PR이 갱신될 때만 비용이 든다.
3. 결과를 `data/briefs/<project>.json`에 원자적으로 쓴다(임시 파일 → rename).

```json
{ "generatedAt": "2026-10-09T08:00:00Z",
  "tldr": [ { "day": "2026-10-09", "count": 47, "items": [ { "kind": "결정", "text": "…" } ] } ],
  "reviews": { "uni-keyyy/uni-keyyy_web#12@<sha>": { "label": "web#12", "author": "chanwoongYoon", "title": "…", "url": "…",
               "verdict": "suspect", "signals": [ … ], "question": "…" } } }
```

- `claude -p PROMPT --tools ""` + stdin, 타임아웃 5분. 자식 프로세스에는 `CLAUDE_CODE_OAUTH_TOKEN`만 넘기고 GitHub·Discord 토큰은 뺀다(penalty-bot `child_env`와 같은 원칙). 출력은 JSON 한 덩어리를 파싱·검증하고, 실패하면 그 항목만 이전 값 유지 + 로그.
- 러너 실패가 화면에서 "조용한 하루"로 위장하지 않게: 허브는 `generatedAt`이 **6시간 넘게 지났으면 `brief.state = error`**("요약이 6시간째 갱신되지 않음").
- 허브 `.env`에 `CLAUDE_CODE_OAUTH_TOKEN`을 추가한다(penalty-bot과 같은 값).

## 5. API 변경

`GET /api/projects/:id`에 필드 추가 (기존 필드는 유지 — 하위 호환):

```json
{
  "plan": { "state": "ok", "today": "2026-10-09",
    "phases": [ … ], "milestones": [ { "id": "0.0.3", "due": "2026-10-12", "done": false } ],
    "current": { "id": "0.0.3", "due": "2026-10-12", "goal": "한 줄 관통", "daysLeft": 3,
      "features": [ { "name": "PRD 슬라이스", "owner": "서윤", "status": "todo", "pr": null } ] } },
  "health": { "level": "risk", "why": "0.0.3까지 3일, PRD 슬라이스 시작 전" },
  "exceptions": [ { "kind": "stalled", "who": "서윤", "text": "…" },
                  { "kind": "review", "label": "web#12", "verdict": "suspect", "text": "…", "question": "…" } ],
  "brief": { "state": "ok", "generatedAt": "…", "tldr": [ … ], "reviews": [ … ] }
}
```

`GET /api/projects` 목록 항목에 `health`, `currentId`, `daysLeft`, `exceptionCount` 추가.

`brief` 파일이 없으면 `unconfigured`(러너가 아직 안 돌았음), 깨졌거나 6시간 넘었으면 `error`.

## 6. 화면 (시안 그대로, 3단계 막대만 조정)

| 경로 | 내용 |
|---|---|
| `/projects` | 행마다 건강 점(●◐○, 모르면 점선) · `0.0.3` D-3 · 확인 필요 N |
| `/projects/:id` | ① 판정 한 줄 ② 타임라인 SVG(기간 띠·오늘 선·버전 마름모) ③ 현재 버전 체크리스트(오너·3단계 막대·상태) ④ 확인 필요(예외만) ⑤ 팀 대화 요약 카드(오늘) + "원문 N개 ›" ⑥ `<details>` 지난 판정(기존 사람 줄) |
| `/projects/:id/prs` | 이번 주 PR 판정 — 세그먼트 [확인 필요 / 괜찮음], 신호 목록, 물어볼 것, GitHub 링크 |
| `/projects/:id/chat` | 세그먼트 [요약 / 원문] — 요약은 날짜별 TL;DR, 원문은 기존 채널 메시지 |

- 색 대신 모양: 건강 ●(on, Action Blue) ◐(risk) ○(off) 점선(unknown). 의심 PR 배지만 흰 바탕 반전.
- LLM 산출물은 `~` + 생성 시각(`~40분 전`).
- 섹션 상태 문구는 기존 `SECTION_TEXT`를 재사용("연결된 소스 없음" / "불러오지 못함"). 기능 `unlinked`는 "이슈 없음", `null`은 "확인 불가".
- 타임라인은 외부 라이브러리 없이 인라인 SVG 한 개(기간 6~7개, 마름모 6개 수준).

## 7. 에러 처리

| 실패 | 결과 |
|---|---|
| schedule 없음 / 권한 없음 / 형식 오류 | `plan.state` unconfigured / error / error, `health.level = unknown`. 나머지 섹션은 그대로 |
| 이슈 조회 실패 | 기능 `status: null`("확인 불가"), 건강 판정은 `unknown` |
| brief 없음 / 6시간 경과 / 깨짐 | `brief.state` unconfigured / error / error. 예외의 `review`는 비고 TL;DR 카드에 상태 문구 |
| `claude -p` 실패·JSON 깨짐 | 러너가 그 항목만 이전 값 유지, 로그. 전부 실패해도 `generatedAt`은 갱신하지 않는다(→ 6시간 뒤 error로 드러남) |

## 8. 보안·프라이버시

- PR 판정과 질문은 허브 응답(PIN 뒤, tailnet 전용)에만 있다. 어디에도 게시하지 않는다.
- `claude -p`에는 도구를 주지 않고(`--tools ""`), OAuth 토큰 외 비밀을 넘기지 않는다.
- Discord 원문·요약 모두 텍스트로만 렌더링.

## 9. 테스트

**허브 (node:test)**
- schedule 검증: 날짜 형식, 이슈 표기, 잘못된 값 → error.
- 기능 상태: 이슈 전부 닫힘 → done, 열린 이슈 + `#N` 언급 열린 PR → pr, 없으면 todo, 빈 issues → unlinked, GitHub 실패 → null.
- 현재 버전: 밀린 버전 우선, 전부 끝 → null, `daysLeft` KST 경계.
- 건강: 표 3.3의 각 행을 한 번씩.
- 예외: 휴식 모드 사람은 stalled 아님, ok 판정 PR은 예외 아님.
- brief: 없음 → unconfigured, 6시간 경과 → error, 깨진 JSON → error.
- 러너: `claude` 출력 파싱(코드펜스·잡설 섞임), 같은 sha 재사용(호출 0회), 실패 시 이전 값 유지, 자식 env에 GitHub·Discord 토큰 없음.

**프론트 (vitest)**
- 판정 문구와 점 모양이 level별로 다르다. unknown은 "일정을 읽지 못함".
- 체크리스트: todo / pr / done / unlinked / null 문구가 서로 다르다.
- 정상 상태에서는 "확인 필요" 섹션이 없다.
- TL;DR이 텍스트로 렌더링되고 `~` 시각이 붙는다.
- PR 판정 화면: suspect 배지, 질문 표시.

## 10. 배포·운영

1. 사용자: 봇 토큰에 Unikey-outline Read 권한 추가, `기획/schedule.json` 커밋(플랜에서 v6 문서로 초안 생성), 볼 Discord 채널 ID 추가.
2. 허브 `.env`에 `CLAUDE_CODE_OAUTH_TOKEN` 추가.
3. 서버 crontab: `0 */2 * * * cd ~/cloud-claude && /usr/bin/node hub/src/brief.js >> brief.log 2>&1`.
4. 허브 파일 + `frontend/dist` 배포(기존 절차) → 러너 1회 수동 실행 → 폰 확인.
