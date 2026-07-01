# cloud_claude — 스프린트 계획

> 설계 문서(`~/.gstack/projects/cloud-claude/a1234-main-design-20260628-231912.md`)의
> v1 → v1.5 → v2 단계를 1주 단위 스프린트로 분해. 솔로 사이드 프로젝트 기준,
> 의존성 순서로 정렬. 각 스프린트 끝에 "증명할 한 가지"(Exit)를 둔다.

---

## v1 — 터미널 코어 (파이프 증명)

### Sprint 0 — 인프라 부트스트랩 (셋업이 릴레이보다 클 수 있음)
- [ ] 허브(Ubuntu) Node 프로젝트 스캐폴드 (서버 + 정적 PWA 셸)
- [ ] `tailscale serve`로 HTTPS 노출 → 폰에서 https 접속 + 홈화면 설치 확인
- [ ] PWA manifest + service worker 등록 (secure context 검증)
- [ ] `devices.json` 스키마 정의 (host/user/ssh-key 경로)
- **Exit:** 폰 홈화면 앱 아이콘에서 빈 PWA 셸이 HTTPS로 뜬다.

### Sprint 1 — 인증 + 기기 메뉴
- [ ] `POST /auth` — PIN 검증 → 세션 쿠키, 무차별 대입 레이트리밋
- [ ] `GET /` — 미인증이면 PIN 화면, 인증되면 기기 메뉴
- [ ] `GET /devices` — `tailscale status`(힌트) + SSH/TCP 프로브로 ●/○ 표시
- [ ] devices.json 없음/깨짐 → 서버 안 죽고 명확한 에러
- **Exit:** PIN 넣고 들어가면 기기 목록이 온/오프라인 점과 함께 보인다.

### Sprint 2 — 터미널 파이프 (핵심 wedge)
- [ ] `WS /session?device=&name=` — `node-pty` → `ssh` → `tmux new -A`
- [ ] `xterm.js` 콘솔 + 리사이즈(가로/세로 전환 시 TUI 안 깨짐)
- [ ] 기기 선택 → tmux 세션 생성 → `claude` 실행 → 폰 스트림
- [ ] `sanitizeName` — 세션 이름 셸 메타문자(`; | ` `$()`) 거부
- **Exit:** 폰 → 허브 → 맥미니 tmux → claude 실행 → 출력이 폰에 흐른다. (Critical Path #1)

### Sprint 3 — 복원력 + 맥 sleep
- [ ] 재진입/재연결 → 같은 세션 attach + `tmux capture-pane` 스크롤백 무손실
- [ ] 폰 WS close → 허브 pty 정리, tmux 세션은 생존
- [ ] 두 탭이 같은 tmux attach → geometry 충돌(최소 클라 기준) 처리
- [ ] 대상 맥 `caffeinate -dimsu` launchd agent + wake-on-network을 셋업에 포함
- [ ] 자는 맥(online 힌트지만 SSH 실패) → 메뉴 ○ 표시 / 화면에 명확한 에러
- **Exit:** 끊고 다시 들어가도 이어서 보이고, 자던 맥도 깨워서 붙는다. (Critical Path #2)

### Sprint 4 — 폰 입력 컴포저 + v1 마감
- [ ] 폰 최적화 입력 컴포저 (여러 줄 + 전송 + 퀵키 바)
- [ ] 한 기기에 세션 2개+ → 메뉴에 둘 다 보임
- [ ] v1 QA 패스(`/qa`) + 셸 인젝션/PIN 차단 검증(Critical Path #3)
- **Exit:** v1 Success Criteria 충족 — 터미널 코어만으로 실사용 가능.

---

## v1.5 — 한 기기 에이전트 서버 (진짜 차별점)

### Sprint 5 — 에이전트 서버 (구조화 스트림)
- [ ] 맥미니용 agent-server: `claude -p --output-format stream-json` 래퍼 (또는 Agent SDK)
- [ ] 온디맨드 SSH 기동 → 세션 시작 시 데몬으로 승격
- [ ] wedge 축소: 맥미니 1대 · Claude Code 세션 1개 · 동시 pending 승인 1개
- **Exit:** 에이전트 모드에서 구조화 이벤트(JSONL)가 폰까지 도달한다.

### Sprint 6 — 에이전트 UI (승인/카드)
- [ ] 인라인 승인/거부 (`canUseTool` 콜백 → 커스텀 UI)
- [ ] 상태 pill + tool 호출 카드 + diff 카드 렌더
- [ ] 권한 모드(default/acceptEdits/plan) 토글
- **Exit:** 폰에서 도구 호출을 보고 승인/거부하며 Claude Code 세션을 운전한다.

---

## v2 — 허브 통합 / 관제탑

### Sprint 7 — 멀티 세션 카드
- [ ] 세션 카드 목록(멀티뷰) — 여러 기기/세션 한눈에
- [ ] 멀티 기기 라우팅

### Sprint 8 — 웹푸시
- [ ] iOS 웹푸시(홈화면+제스처+HTTPS 전제) — best-effort 백그라운드 알림

### Sprint 9 — 허브 통합 + codex
- [ ] 허브 캘린더(내 Google OAuth + 팀원 FreeBusy) / GitHub MCP
- [ ] codex 지원 (`codex exec --json` + 승인 정책)

> 확장 순서(설계 158번 줄): 멀티 세션 카드 → 웹푸시 → 캘린더/깃허브 MCP.
> v2 연기 항목: 멀티유저 OAuth 함대, 이벤트 내용 읽기(FreeBusy만), 데몬 상주 설치 자동화.
