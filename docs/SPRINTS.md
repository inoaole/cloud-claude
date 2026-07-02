# cloud-claude — 스프린트 계획

> **Personal OS**, phone-first, self-hosted. 1인 사용자, 4대(MacBook Pro · Desktop · Mac mini ·
> Ubuntu hub). 허브(Oracle Ubuntu, 항상 켜짐)가 폰과 나머지를 잇는 중앙 브레인.
> 디자인 = DESIGN.md "Personal OS App Language"(A/Journal, 다크·SF Pro+Mono·단일 Action Blue·
> `~`추정·honest quiet). IA = 두 평면.
>
> **두 평면 (v1 둘 다):**
> - **Hub plane** — 일상 관리, 기기 무관. 허브가 활동을 하나로 합침 → Today/회고. (센서→타임라인→PWA)
> - **Device plane** — 특정 기기 직접 작업. Machines에서 기기 택1 → 터미널(WebSocket). (Agent 모드 = v1.5)
>
> 설계 근거: `~/.gstack/projects/cloud-claude/a1234-main-design-20260701-112548.md` (ENG CLEARED,
> 양 평면). 각 스프린트 끝에 "증명할 한 가지(Exit)". 1주 단위, 솔로.
>
> 순서 메모: Module 0(공용 기반) 먼저. 그다음 Device plane(M1)·Hub plane(M2)은 **독립**이라
> 순서 교체/병렬(worktree) 가능. 지금은 "밖에서 내 기계 붙기"가 제일 급해 Device plane을 먼저 둠.

---

## Module 0 — Foundation (공용 기반, 두 평면이 다 씀)

### Sprint 0 — 허브 스캐폴드 + HTTPS + PWA 셸
- [x] `hub/`(단일 Node: express, /healthz, PWA 정적 서빙, SPA fallback) + `shared/`(schema 스텁) + `pwa/` 스캐폴드 — 로컬 검증 통과
- [x] `tailscale serve`로 **tailnet-only HTTPS** 노출 (Funnel 금지) — 허브 배포됨, `https://cloud-claude-hub.tail978fc3.ts.net/` 라이브, 폰 접속 확인
- [x] PWA manifest + service worker (secure context, HTML=network-first/자산=cache-first) + app.js 등록
- [x] `.env.example`(HUB_PORT·TZ·SESSION_SECRET·LOG_LEVEL·DEVICES_FILE) + `devices.example.json`(4대 allowlist, 실 tailnet 반영)
- **Exit:** 폰 홈화면 앱에서 빈 PWA 셸이 HTTPS로 뜬다. — **달성 ✅** (폰 홈화면 설치 확인).

### Sprint 1 — PIN 인증 (하드닝) + 앱 셸/탭바
- [x] `POST /auth` PIN → 세션 쿠키(HttpOnly·Secure·SameSite=Strict), crypto-random 세션ID, HMAC 서명, 만료, `/logout` 폐기
- [x] 레이트리밋 + 락아웃(5회→60s), 감사로그(auth_ok/auth_fail/auth_locked, 내용 제외) — 로컬 curl 검증
- [x] PWA: PIN 언락 화면(로고+dots+키패드, A/Journal) + `/auth/me`로 재방문 시 언락 스킵 + 락아웃 카운트다운
- **Exit:** PIN 넣고 언락 → 탭바 있는 다크 셸. 틀린 PIN은 차단된다. — 코드/로컬 ✅, **허브 배포+HUB_PIN 설정+폰 확인 남음**.

### v0.3 — React 프론트 이관 (인프라, 모듈 가로지름)
> `pwa/`(수기 HTML/CSS/JS) → `frontend/`(Vite + React + TS SPA). 백엔드/인증 로직 불변. 계획: `~/.gstack/.../a1234-v0.3-react-migration-plan-20260701.md`.
- [x] Vite+React+TS 스캐폴드 · Router v6 탭 라우팅 · CSS Modules + `tokens.css`(DESIGN 변수 단일소스)
- [x] **AppShell 100dvh 그리드**(header/스크롤 콘텐츠/TabBar) — 탭바를 iOS home indicator 위로 → **iPhone 16 Pro safe-area 버그 수정**
- [x] Unlock 커스텀 키패드(입력필드 없음) + 전체 비주얼 상태(idle/submitting/wrong shake/lockout/no-pin/success) · auth 상태머신(checking 스플래시) · `lib/api` 전역 401 게이트
- [x] `vite-plugin-pwa`(SW navigateFallback denylist: /auth·/logout·/api·/pty·/healthz) + iOS 메타 패리티 · 5개 탭 honest-quiet 스텁
- [x] design-review 이월분 선반영: 탭 구분 글리프 · Cell 후행엣지 디스클로저 · `--t4` 뮤트 대비 · Growth 팔레트/heat 토큰
- [x] Vitest 12 + Playwright smoke 1 통과 · 빌드 클린 · hub `frontend/dist` 서빙(자산 immutable/셸 no-cache) · code-review 보강
- **Exit:** 빌드 → 허브 원자적 배포 → **iPhone 16 Pro에서 탭바가 home indicator 위**(safe-area). — **달성 ✅** (허브 배포 v0.3.0 라이브 + 폰 확인 완료, `pwa/` 삭제).

---

## Module 1 — Device plane (Terminal 모드) — "밖에서 내 기계 붙기"

### Sprint 2 — 기기 목록 + 프로브 (Machines 탭)
- [x] `GET /devices`(requireAuth) — `tailscale status --json`(힌트) + TCP SSH:22 프로브 → ●/○, **구분된 사유**(disabled/asleep/not-on-tailnet/ssh-closed/firewall). `hub/src/devices.js`(순수 분류기+주입식 TCP), probeAll 기기별 예외 격리.
- [x] Machines 탭: 4대 그룹드 리스트(상태 dot=모노+Action Blue, 허브는 Hub 태그) + loading/error/empty 상태 + Recheck. `Cell`에 leading 슬롯.
- [x] 테스트: hub `node --test` 10 + Vitest 3 (총 25 그린). 허브 실배포+실프로브 검증(MacBook Pro·hub ●online, Mac mini·Desktop ○disabled).
- **Exit:** Machines에서 4대 상태(●/○)가 정확히 보이고, 오프라인 사유가 구분된다. — **달성 ✅** (허브 실프로브 검증; 사유 구분은 유닛테스트 커버, 현재 enabled 2대 online).

### Sprint 3 — 터미널 릴레이 (핵심)
- [x] `WS /pty?device=` — Origin 검증 + PIN 세션서 발급한 **단기(30s)·단일사용 WS 토큰**(`POST /pty/token`) + `sessionValid` 재확인. bad-origin 403 / bad-token 401 / bad-device 404.
- [x] `spawn(file,args)`(셸 금지) → hub=로컬 tmux / Mac=classic ssh(허브키+절대 tmux) / Linux=`tailscale ssh` → `tmux new -A -s phone`. `assertSafeArg`로 인자 인젝션 방어.
- [x] node-pty ↔ WS 브리지(client→JSON stdin/resize·클램프, server→raw bytes), xterm.js 콘솔(FitAddon, resize), 풀스크린 라우트 `/machines/:id`.
- [x] device는 devices.json **allowlist**로만(고정 세션명 `phone`). Machines online 행만 tap-to-open. 테스트 hub node:test 18 + Vitest 15.
- **Exit:** 폰 → 허브 → ssh → tmux → 명령 실행 → 폰에 출력. (Critical Path) — **달성 ✅** (허브 실배포, 헤드리스 WS로 device=hub·macbook-pro 양쪽 echo 왕복 실증; 인터랙티브 폰 확인만 남음).

### Sprint 4 — 복원력 + 안전 + 자원
- [ ] 재접속: `tmux attach` 자체 redraw(vim/htop 포함) + `capture-pane -S -N`(상한) 스크롤백
- [ ] 폰 WS close → ~45s **유예** 후 pty/ssh kill (tmux는 생존); 모바일 백그라운드/네트워크 flap 대응
- [ ] **백프레셔 = pty read 일시정지**(바이트 안 버림) + 버퍼 상한 + 과부하 시 끊기
- [ ] 자원 상한: 세션당 바이트 캡·최대 동시 세션·idle/connect 타임아웃 (Hub plane API 굶기지 않게)
- [ ] 원격 출력 OSC 시퀀스 스트립(특히 OSC 52 클립보드), UTF-8 경계·붙여넣기 상한
- [ ] 감사로그: WS open/close·기기·ACL/연결 실패·세션 시간 (내용 로깅 금지)
- **Exit:** 끊고 다시 붙어도 화면·스크롤백 복원, 출력 폭주에도 안 깨지고 허브 안 죽는다.

---

## Module 2 — Hub plane (일상 루프) — "하루를 비춰주기"

### Sprint 5 — 수집기 (MacBook Pro) + 허브 인제스트
스코프 2-split (eng-review + codex 2026-07-02): **v1a** = 파이프라인 실증(commit_seen+heartbeat),
**v1b** = session_observed(프로세스 스캔, 스파이크 후). v1a는 `feature/v0.7.0/collector-ingest`에서 완료.
- [~] `collector/`(Node, launchd 폴러): `commit_seen`(git)·`heartbeat` **DONE(v1a)**; `session_observed`(ps: claude/codex/tmux, cwd via lsof/tmux) = **v1b(스파이크 후)**
- [x] **결정적 event_id**(`commit:device:repoId:sha`, `heartbeat:device:ts`), 영속 워터마크(첫실행 무백필·rebase 가드) + outbox 재전송(auth/5xx→keep, 400→drop)
- [x] `POST /ingest` — per-device 토큰(timingSafeEqual, enabled 킬스위치), `event_id` 멱등 dedup(INSERT OR IGNORE), SQLite(better-sqlite3 WAL) append-only, ts_device+ts_hub, schema_version + `GET /timeline`(PIN)
- **Exit(v1a 충족):** MacBook Pro 커밋이 허브 타임라인에 실제로 쌓임, 재시작·재전송해도 중복 없음(87 유닛 + e2e 실증). 세션 활동은 v1b.

### Sprint 6 — Today (저녁 회고 PWA)
플랜 eng-review + codex 완료(2026-07-02, `feature/v0.8.0/today-reflection`). Sessions 카드는 v1b
(session_observed) 이후 — 가짜 자리 표시 없음(honest-quiet).
- [x] `GET /rollup?date=&tz=`(로컬 TZ, 클라이언트 tz 전달) — Commits(author-day, repo·기기 dedupe) +
  Day pulse(디바이스별 집계), 지속시간은 **추정(`~`)** 표기. on-read 유도 → 늦은 이벤트 자동 반영
- [x] Today 화면(A/Journal): Commits 활동 카드 + `~active` pulse 라인 + 한 줄 회고 컴포저(`POST /note`
  upsert, 하루 1줄) + 저장 시 조용한 체크. 자정 넘김 시 focus에서 날짜 재계산
- [x] 상태 언어: quiet day vs "no data — offline"(heartbeat 공백 15분 hysteresis, ts_hub 기준) vs
  "sensor issue"(git 스캔 실패가 quiet로 위장 못 함) + 브라우저 오프라인 배너 — 전부 시각 구분
- [~] 늦은 이벤트 → on-read라 자동 재계산(캐시 없음). **retention purge + `day_rollups` 영구 테이블은
  한 쌍으로 Sprint 7로 이동** (codex P1: 퍼지+캐시없음 = "rollups forever" 모순; 첫 퍼지 대상 ~97일 후)
- **Exit:** 7일 연속 저녁에 열면 오늘 실제 한 일 자동 요약 + 한 줄 회고. 자던/오프라인도 정직하게 구분.

---

## Module 3 — v1 마감

### Sprint 7 — 폴리시 + QA + 보안 검증 + 배포
- [ ] **retention 한 쌍(Sprint 6에서 이월):** `day_rollups` 영구 요약 테이블(퍼지 전 적재) + raw 90d+7d
  grace 퍼지 잡 — 함께 출하해야 "rollups forever" 유지 (플랜 D6)
- [ ] design-review 이월분: 탭바 구분 글리프 · 디스클로저 후행엣지 통일 · 최소 뮤트 텍스트 대비 · 프로젝트 팔레트/heat 토큰화
- [ ] QA(`/qa`): 두 평면 크리티컬 패스 + 보안 테스트(미인증/bad-Origin WS 거부, 미등록 기기 거부, PIN 차단)
- [ ] 허브 배포(Oracle Ubuntu) + 각 기기 Tailscale SSH ACL 설정(허브=비루트·no-sudo, 4대만)
- **Exit:** v1 = Today 회고 루프 + 4대 터미널이 실사용 가능. ENG/디자인/QA 통과.

---

## Later (post-v1)
- **v1.5 Agent 모드** (Device plane): `claude -p --output-format stream-json` / `codex exec --json`,
  `canUseTool` 인라인 승인/거부, 상태 pill·tool/diff 카드, pending 승인 상태 관리.
- **센서 팬아웃**: 수집기를 Desktop·Mac mini·Ubuntu hub로 확대(배포 스크립트, 토큰 발급 at scale).
- **Timeline** 탭(지난 날 스크롤 + Day detail), **Growth**(주간 집계·time-by-project·heat·인사이트 카드).
- **캘린더**(내 Google OAuth + FreeBusy), **웹푸시** 알림(iOS), 멀티세션(tmux window).
