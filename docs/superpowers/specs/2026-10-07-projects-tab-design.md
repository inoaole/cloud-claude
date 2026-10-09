# Projects 탭 설계

- 작성일: 2026-10-07
- 상태: 승인됨 (brainstorming, 2026-10-07)
- 범위: Growth 탭 제거 → Projects 탭 신설. mabc_final(Unikey) 팀 진도 + Discord 메시지, SWYP는 빈 자리

## 1. 목적

프로젝트가 많고 Discord는 회사 계정에 묶여 있어서 팀에서 무슨 일이 일어나는지 놓친다. 폰에서 프로젝트
하나를 누르면 그 프로젝트의 현황을 한눈에 본다. mabc_final은 내가 리더라서 **누가 무엇을 하고 있고, 제
진도로 가고 있는지**가 가장 중요하다.

**성공 기준**
- Projects 탭 → mabc를 누르면 사람별 이번 주 PR, 최근 4주 판정, 지정 채널 최근 메시지가 한 화면에 보인다.
- 맨 위 한 줄(`2/3 on track`)로 팀 상태를 판단할 수 있다.
- 데이터를 손으로 입력하지 않는다.
- 소스가 고장 나면 "고장"으로 보인다. 고장이 "활동 없음"이나 "전원 패스"로 위장하지 않는다.

**하지 않는 것 (YAGNI)**
- 안 읽은 메시지 수, AI 요약, 메시지 보내기, 스레드 메시지, SWYP 데이터 소스, 기획(plan) 메시지 집계
  (plan 기간은 2026-10-05에 끝났다). 실제로 써보고 필요해지면 추가한다.

## 2. 데이터 출처

사실마다 출처는 한 곳이다. 허브와 penalty-bot이 같은 Oracle 서버(`ubuntu@168.107.46.132`, 허브는
`User=ubuntu`)에 있으므로 허브가 penalty-bot 파일을 디스크에서 직접 읽는다.

| 사실 | 출처 | 읽는 법 |
|---|---|---|
| 팀원·GitHub 아이디·휴식 기간·레포·`plan_until` | `~/penalty-bot/config.json` | 디스크 읽기 |
| 지난 주간 판정 | `~/penalty-bot/ledger.json` (`weeks[월요일ISO][이름] = {status, mode, reason, amount}`) | 디스크 읽기 |
| 이번 주 PR | GitHub REST `GET /repos/{r}/pulls?state=all&sort=updated&direction=desc&per_page=100` | 레포당 1회 호출 후 작성자로 거름 |
| Discord 메시지 | Discord REST `GET /channels/{id}/messages?limit=50` | 채널당 1회, 최상위 메시지만 |

### 2.1 `projects.json` (새 파일, gitignored)

`devices.json`과 같은 방식이다. 레포 루트에 두고 `projects.example.json`을 커밋한다. 경로는
`PROJECTS_FILE` 환경변수로 바꿀 수 있다.

```json
[
  {
    "id": "mabc",
    "name": "Unikey",
    "penaltyBotDir": "/home/ubuntu/penalty-bot",
    "discordChannels": [
      { "id": "1482547310591348769", "name": "벌금bot" }
    ]
  },
  { "id": "swyp", "name": "SWYP 7기" }
]
```

- `penaltyBotDir`가 없으면 팀·PR 섹션은 `unconfigured`.
- `discordChannels`가 없거나 비어 있으면 Discord 섹션은 `unconfigured`.
- 볼 채널 ID는 사용자가 Discord에서 복사해 넣는다(개발자 모드 → 채널 우클릭 → ID 복사). 봇
  `1490576514704605194`이 그 채널을 읽을 권한이 있어야 한다.
- `id`는 `^[a-z0-9-]{1,32}$`. 로드할 때 검사하고, 어기면 허브 시작 시 에러를 낸다.

### 2.2 토큰

허브 `.env`에 추가한다. 둘 다 penalty-bot이 쓰는 **읽기 전용 봇 토큰**과 같은 것이다.

- `DISCORD_BOT_TOKEN`: 봇 계정 `1490576514704605194`
- `GITHUB_TOKEN`: `claude-bot-jh`, uni-keyyy 조직 api·web 레포 Read

토큰이 없으면 해당 섹션은 `unconfigured`다. 에러를 내지 않는다.

## 3. 판정 규칙

### 3.1 주

- 한 주는 KST 월요일 00:00 ~ 일요일 23:59:59. penalty-bot과 같다.
- KST 날짜는 `market.js`의 `kstParts`를 재사용한다.

### 3.2 사람별 이번 주 모드 (penalty-bot `mode_for` 이식)

1. 주 시작일(월)이 `plan_until`보다 앞이면 `plan`
2. 주(월~일)가 그 사람의 `rest: [시작, 끝]`과 하루라도 겹치면 `exempt`
3. 둘 다 아니면 `dev`

penalty-bot과 결과가 같아야 한다. 테스트는 penalty-bot `selftest`의 모드 표(9/28 ~ 11/2 경계 주)를 그대로 옮긴다.

### 3.3 이번 주 PR

- 레포는 penalty-bot `config.json`의 `repos`를 쓴다.
- 대상: `user.login`(대소문자 무시)이 그 사람의 `github`이고, `updated_at >= 이번 주 월요일 00:00 KST`인 PR.
  penalty-bot의 관대한 기준과 같다.
- 사람별로 `{label: "web#30", title, url, state: open|merged|closed}`를 보여준다. `merged_at`이
  있으면 merged다.
- 레포 페이지가 100개 꽉 차고 마지막 PR도 이번 주면 다음 페이지를 읽는다(penalty-bot과 같은 종료 조건).

### 3.4 on track

- 사람의 **최근 판정**은 `ledger.weeks`에서 가장 늦은 월요일의 그 사람 결과다.
- 최근 판정이 `pass`, `exempt`, `hold` 중 하나면 on track, `fail`이면 off track.
- 판정 기록이 없는 사람은 `onTrack: null`이고 "판정 없음"으로 보여준다.
- 팀 요약: `onTrack 수 / 판정 있는 사람 수`. 판정 있는 사람이 0명이면 요약은 null.
- 이번 주는 아직 판정 전이므로 pass나 fail을 표시하지 않는다. PR 목록과 모드만 보여준다.
- 이력은 최근 4주(오래된 순)를 `[{week, status, reason}]`으로 보여준다.

## 4. API

두 엔드포인트 모두 `requireAuth`(PIN 세션) 뒤에 둔다. 응답은 항상 섹션별 상태를 명시하고, 섹션이
실패해도 200을 보낸다(market `latest`와 같은 원칙). 섹션 상태는 `ok | error | unconfigured`다.

### `GET /api/projects`

```json
[
  { "id": "mabc", "name": "Unikey",
    "summary": { "onTrack": 2, "judged": 3 },
    "lastMessageAt": "2026-10-07T03:12:00.000Z" },
  { "id": "swyp", "name": "SWYP 7기", "summary": null, "lastMessageAt": null }
]
```

목록은 프로젝트마다 아래의 상세 계산(캐시 포함)을 재사용한다. 프로젝트가 2개라 따로 최적화하지 않는다.

### `GET /api/projects/:id`

```json
{
  "id": "mabc", "name": "Unikey", "weekStart": "2026-10-06",
  "team": {
    "state": "ok",
    "summary": { "onTrack": 2, "judged": 3 },
    "people": [
      { "name": "종현", "github": "inoaole", "mode": "dev", "onTrack": true,
        "history": [ { "week": "2026-09-28", "status": "pass", "reason": "…" } ],
        "prs": [ { "label": "web#30", "title": "…", "url": "…", "state": "merged" } ] }
    ]
  },
  "ledger": { "state": "ok" },
  "github": { "state": "ok" },
  "discord": {
    "state": "ok",
    "channels": [
      { "id": "…", "name": "벌금bot", "state": "ok",
        "messages": [ { "id": "…", "author": "종현", "content": "…", "ts": "…", "attachments": 0 } ] }
    ]
  }
}
```

- 알 수 없는 `id`면 404 `{error: "not_found"}`. 존재하지 않는 프로젝트이므로 상태로 뭉개지 않는다.
- `team.state`는 `config.json`을 읽을 수 있는지를 뜻한다. 못 읽으면 `error`이고 `people`은 `[]`이다.
- `ledger`, `github` 상태는 팀 섹션 안의 부분 실패를 알린다.
  - ledger 파일이 없으면 `ok`이고 모든 사람이 `onTrack: null`이다. 판정이 아직 한 번도 안 돈 것은 정상이다.
  - 파일이 있는데 JSON이 깨졌으면 `error`이다.
  - GitHub 호출이 실패하면 `github.state = error`, 사람별 `prs`는 `null`이다. 빈 배열 `[]`("PR 없음")과 구분한다.
- Discord는 채널마다 상태를 따로 가진다. 한 채널이 403이어도 나머지 채널은 보인다.
  `discord.state`는 전부 실패면 `error`, 일부라도 성공하면 `ok`다.
- 메시지 `author`는 `author.global_name ?? author.username`이다. `content`는 원문 문자열 그대로
  주고 렌더링은 프론트가 텍스트로만 한다.

### 4.1 캐시와 타임아웃

- 프로젝트별 상세 응답 전체를 메모리에 60초 캐시한다. 에러가 섞인 응답도 캐시한다(장애 시 API 연타 방지).
- `?fresh=1`은 만들지 않는다. 60초를 기다리면 된다.
- 외부 호출마다 `AbortSignal.timeout(8000)`. Discord 429도 에러로 처리한다.
- 외부 호출은 `fetch`(Node 20 내장)를 쓴다. 새 의존성을 추가하지 않는다.

## 5. 코드 구조

### 허브

| 파일 | 역할 |
|---|---|
| `hub/src/projects.js` (신규) | 순수 함수(`modeFor`, `summarizePerson`, `teamSummary`, `filterPrs`, `mapMessage`) + `loadProjects(file)` + `getProject(project, {fetchFn, readFn, now, env})`. `fetchFn`/`readFn`을 주입받아 HTTP 없이 테스트한다(`market.js` 패턴) |
| `hub/src/projects.test.js` (신규) | node:test |
| `hub/src/config.js` | `projectsFile` 추가 (`PROJECTS_FILE` 또는 `<repoRoot>/projects.json`) |
| `hub/src/server.js` | 라우트 두 개, 프로세스 메모리 캐시(`Map<id, {at, body}>`) |
| `projects.example.json` (신규) | 위 2.1 예시 |
| `.gitignore` | `projects.json` 추가 |

### 프론트

| 파일 | 역할 |
|---|---|
| `frontend/src/screens/Projects.tsx` (신규) | 목록(`/projects`)과 상세(`/projects/:id`) 두 컴포넌트를 한 파일에 둔다 |
| `frontend/src/screens/Projects.module.css` (신규) | |
| `frontend/src/screens/Projects.test.tsx` (신규) | vitest, `Market.test.tsx` 패턴 |
| `frontend/src/lib/api.ts` | 타입 + `getProjects()`, `getProject(id)` |
| `frontend/src/lib/tabs.tsx` | Growth 자리에 `{ path: '/projects', label: 'Projects', Icon: IconProjects }` |
| `frontend/src/components/icons.tsx` | `IconGrowth` 삭제, `IconProjects`(폴더) 추가 |
| `frontend/src/App.tsx` | `/growth` 라우트 삭제. AppShell 안에 `/projects`, `/projects/:id` 추가(탭 바 유지, 드릴다운) |
| `frontend/src/screens/Growth.tsx` | 삭제 |
| `frontend/src/styles/tokens.css` | 쓰는 곳이 없어지는 `--growth-p1..p5` 삭제 |
| `DESIGN.md` | Personal OS 섹션의 탭 바 줄을 실제 탭으로 고친다. Growth 전용 RISK 1·2는 "Growth 제거로 보류"라고 적는다 |

## 6. 화면 (DESIGN.md Personal OS App Language 준수)

### `/projects`: 그룹 리스트

```
Projects
┌─────────────────────────────────────────┐
│ Unikey                                 › │
│ 2/3 on track · 마지막 메시지 ~2시간 전    │
├─────────────────────────────────────────┤
│ SWYP 7기                               › │
│ 연결된 소스 없음                          │
└─────────────────────────────────────────┘
```

- 요약이 null이면 "판정 없음"으로 표시한다. off track이 하나라도 있으면 숫자만 보여주고 색은 쓰지 않는다
  (DESIGN: 크롬은 모노크롬 + Action Blue뿐).
- 상대 시간은 `~` 표기를 쓴다.

### `/projects/:id`: 드릴다운

```
‹ Projects        Unikey
2/3 on track · 이번 주 10/6~

팀
┌─────────────────────────────────────────┐
│ 종현  dev        ✅ ✅ ❌ ✅             │
│   web#30  merged   web#31  open          │
├─────────────────────────────────────────┤
│ 서윤  dev        ✅ ⏸ ❌ ❌   off track  │
│   이번 주 PR 없음                         │
└─────────────────────────────────────────┘

Discord   [ 벌금bot | general ]
┌─────────────────────────────────────────┐
│ 찬웅                         10/07 12:03 │
│ IA 화면 명세 올렸습니다                     │
└─────────────────────────────────────────┘
```

- 사람 줄: 이름(SF Pro), 모드·PR 라벨·시간은 SF Mono 데이터 칩. 판정 아이콘 ✅❌⚠️⏸는 penalty-bot과
  같은 의미이고, 탭하면 그 주 `reason`을 보여준다(`title` 속성 정도면 충분).
- `exempt` 모드면 PR 줄 대신 "휴식 중"을 쓴다.
- Discord: 채널이 2개 이상이면 기존 `Segmented` 컴포넌트로 전환한다. 메시지는 최신이 위. `content`는
  React 텍스트 노드로만 렌더링한다(`dangerouslySetInnerHTML` 금지). 첨부가 있으면 `📎 n` 칩.
- 상태 문구 (서로 달라 보여야 함):

| 상황 | 문구 |
|---|---|
| 섹션 `unconfigured` | "연결된 소스 없음" (조용한 빈 상태) |
| 섹션 `error` | "불러오지 못함" (muted, 경고 톤) |
| PR `[]` | "이번 주 PR 없음" |
| PR `null` (GitHub 에러) | "PR 확인 불가" |
| 채널 메시지 `[]` | "메시지 없음" |
| `onTrack: null` | "판정 없음" |

## 7. 에러 처리 요약

| 실패 | 결과 |
|---|---|
| `projects.json` 없음 | 목록 `[]`, 탭은 빈 상태 "projects.json 없음". 허브는 정상 기동 |
| `projects.json` 형식 오류 / 잘못된 id | 허브 시작 시 에러 로그를 남기고 Projects만 빈 목록. 다른 탭은 영향 없음 |
| penalty-bot `config.json` 못 읽음 | `team.state = error` |
| `ledger.json` 없음 / 깨짐 | 없음 → 모두 `onTrack: null` / 깨짐 → `ledger.state = error` |
| GitHub 실패·타임아웃 | `github.state = error`, `prs: null` |
| Discord 채널 하나 실패 | 그 채널만 `state: error` |
| 토큰 없음 | 해당 섹션 `unconfigured` |

외부 에러 메시지 본문은 응답에 넣지 않는다(토큰·내부 URL 노출 방지). 허브 로그에는
`audit('projects_source_error', {project, source, status})`만 남긴다.

## 8. 보안

- 두 엔드포인트 모두 `requireAuth` 뒤에 있고, tailnet 전용(`tailscale serve`)이다.
- 토큰은 허브 `.env`에만 있고 응답에 실리지 않는다.
- Discord 원문은 텍스트로만 렌더링한다.
- `:id`는 `projects.json`에 있는 id로만 조회한다. 경로 조립에 쓰지 않는다.
- `penaltyBotDir`는 운영자가 쓰는 설정이라 신뢰한다. 읽는 파일은 `config.json`, `ledger.json` 두 개로 고정한다.

## 9. 테스트

**허브 `projects.test.js` (node:test)**
- `modeFor`: penalty-bot selftest 모드 표 6개 주 × 서윤·종현이 일치한다.
- on track: pass·exempt·hold → true, fail → false, 기록 없음 → null. 가장 늦은 주를 고른다.
- 팀 요약: 판정 있는 사람만 분모에 넣고, 0명이면 null.
- PR 필터: 작성자 대소문자 무시, 주 시작 경계(일 23:59 KST는 제외, 월 00:00 KST는 포함), merged 판정.
- 소스 실패: fetch가 throw → `github.state = error` + `prs: null`, Discord 채널 하나만 실패 → 그 채널만 error.
- ledger 없음 → 전원 null(상태 ok) / 깨진 JSON → `ledger.state = error`.
- 토큰 없음 → `unconfigured`, `fetchFn`을 호출하지 않는다.
- `loadProjects`: 잘못된 id를 거부한다.

**프론트 `Projects.test.tsx` (vitest)**
- 목록이 요약을 렌더링하고, null 요약은 "판정 없음"으로 보인다.
- 상세: `prs: null`과 `prs: []`가 서로 다른 문구로 보인다.
- 섹션 error와 unconfigured가 서로 다른 문구로 보인다.
- `<b>x</b>` 같은 메시지 content가 태그가 아니라 문자로 보인다.
- 탭 바에 Growth가 없고 Projects가 있다.

## 10. 배포

1. 서버에 `projects.json` 작성, 허브 `.env`에 토큰 두 개 추가
2. 허브가 `~/penalty-bot/config.json`, `ledger.json`을 읽을 수 있는지 확인(같은 `ubuntu` 사용자)
3. 기존 절차대로 `frontend/dist`와 `hub/` 배포 → `systemctl restart cloud-claude-hub`
4. 폰에서 Projects → Unikey 확인
