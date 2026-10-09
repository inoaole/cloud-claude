# Projects 체크리스트 사람별 묶기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상세 화면의 "이번 버전" 체크리스트를 이슈 한 줄씩이 아니라 사람 한 줄씩(진행 막대 · N/M · 남은 것 최대 3개)으로 보여 주고, 머지된 이슈는 접는다.

**Architecture:** 프론트 `Projects.tsx`의 `Plan` 컴포넌트만 바꾼다. 허브 응답(`plan.current.features[]`: name/owner/status/pr)은 그대로 쓰고, 화면에서 owner로 묶는다. 팀원 명단(`team.people`)을 받아 이 버전에 할 일이 없는 사람도 "이 버전 담당 없음"으로 보인다. 진행 막대는 네이티브 `<progress>`.

**Tech Stack:** React 18, CSS modules, vitest + Testing Library

**Spec:** `docs/superpowers/specs/2026-10-09-projects-pm-view-design.md` §6 (상세 한 장) + 채팅 합의(2026-10-10): 이슈가 커밋 단위로 잘게 쪼개져 체크리스트가 길다 → 사람별 한 줄, 완료는 접기. 팀의 GitHub 작업 방식은 바꾸지 않는다.

## Global Constraints

- DESIGN.md "Personal OS App Language": 단색 + Action Blue 하나, 상태는 색이 아니라 모양·문구로 구분
- 상태 문구는 기존 그대로: 시작 안 함 · 이슈 없음 · 확인 불가 · `<pr> PR` — "확인 불가(null)"를 "시작 안 함"과 같은 말로 쓰지 않는다
- 새 의존성 없음, 허브 변경 없음

## Review Focus

1. 담당자가 비어 있는 이슈(owner `''`) → "담당 없음" 줄로 묶이고 빈 이름 칸이 생기지 않는다 (Task 1 테스트)
2. 팀 명단에 없는 GitHub 아이디가 owner → 그 아이디로 자기 줄이 생긴다, 사라지지 않는다 (Task 1 테스트: '담당 없음'과 같은 경로)
3. 남은 것이 3개 넘음 → 앞 3개 + "외 N개" (Task 1 테스트)
4. 남은 것 순서: 확인 불가 → 시작 안 함/이슈 없음 → PR 열림 (멈춘 것이 먼저 보인다) (Task 1 테스트)
5. 머지 0개면 접는 칸 자체가 없다 (Task 1 테스트)

---

### Task 1: 사람별 줄과 접힌 완료 목록

**Files:**
- Modify: `frontend/src/screens/Projects.tsx` (`Plan`, `Steps`, `FILLED` 제거, `ProjectDetail`의 `<Plan>` 호출)
- Modify: `frontend/src/screens/Projects.module.css` (Checklist 블록 교체)
- Test: `frontend/src/screens/Projects.test.tsx` ("체크리스트" 테스트 교체 + 추가)

**Interfaces:**
- Consumes: `PlanData`, `PlanFeature`, `Person` (`frontend/src/lib/api.ts`, 변경 없음)
- Produces: `Plan({ plan, people }: { plan: PlanData; people: string[] })` (파일 내부)

- [ ] **Step 1: 실패하는 테스트** — `Projects.test.tsx`의 `it('체크리스트: 다섯 상태가 서로 다른 문구', …)` 를 아래 셋으로 교체

```tsx
  it('체크리스트: 사람별 한 줄 — 막대 · N/M · 남은 것(멈춘 것 먼저)', async () => {
    mockDetail.mockResolvedValue(detail());
    renderAt('/projects/mabc', <ProjectDetail />);
    expect(await screen.findByRole('progressbar', { name: '종현 1/3' })).toBeInTheDocument();
    expect(screen.getByText('남음 배포 확인 불가 · api#4 PR')).toBeInTheDocument();
    expect(screen.getByText('남음 IA 슬라이스 시작 안 함')).toBeInTheDocument();
    expect(screen.getByText('남음 PRD 슬라이스 이슈 없음')).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')).toHaveLength(3);
    expect(screen.getByText('머지된 1개')).toBeInTheDocument();
    expect(screen.getByText('인증')).toBeInTheDocument(); // 접힌 칸 안에 있다
  });

  it('체크리스트: 남은 것은 3개까지 + 외 N개, 할 일 없는 팀원·담당 없는 이슈도 보인다', async () => {
    const base = detail();
    if (base.plan.state !== 'ok' || !base.plan.current) throw new Error('fixture');
    const todo = (name: string, owner = '종현') => ({ name, owner, status: 'todo' as const, pr: null });
    base.plan.current.features = [todo('a'), todo('b'), todo('c'), todo('d'), todo('e'), todo('f', '')];
    mockDetail.mockResolvedValue(base);
    renderAt('/projects/mabc', <ProjectDetail />);
    expect(await screen.findByText('남음 a 시작 안 함 · b 시작 안 함 · c 시작 안 함 외 2개')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '담당 없음 0/1' })).toBeInTheDocument();
    expect(screen.getAllByText('이 버전 담당 없음')).toHaveLength(2); // 서윤 · 찬웅
    expect(screen.queryByText(/머지된/)).not.toBeInTheDocument();
  });

  it('체크리스트: 모두 머지면 그렇게 말한다', async () => {
    const base = detail();
    if (base.plan.state !== 'ok' || !base.plan.current) throw new Error('fixture');
    base.plan.current.features = [{ name: '인증', owner: '종현', status: 'done', pr: null }];
    mockDetail.mockResolvedValue(base);
    renderAt('/projects/mabc', <ProjectDetail />);
    expect(await screen.findByText('모두 머지')).toBeInTheDocument();
  });
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/screens/Projects.test.tsx`
Expected: FAIL — `Unable to find role="progressbar"` (3개 실패), 나머지는 통과

- [ ] **Step 3: 구현** — `Projects.tsx`

`FILLED` 상수와 `Steps` 컴포넌트를 지우고, `Plan`을 교체:

```tsx
// What a leader should see first in "남음": can't-tell, then not started, then waiting on review.
const RANK: Record<string, number> = { null: 0, todo: 1, unlinked: 1, pr: 2 };
const leftText = (f: PlanFeature) => (f.status === 'pr' && f.pr ? `${f.pr} PR` : `${f.name} ${f.status === null ? '확인 불가' : FEATURE[f.status]}`);

function Plan({ plan, people }: { plan: PlanData; people: string[] }) {
  if (plan.state !== 'ok') return <Group header="일정"><p className={styles.section}>{SECTION_TEXT[plan.state]}</p></Group>;
  const cur = plan.current;
  const merged = cur ? cur.features.filter((f) => f.status === 'done') : [];
  // Issues are commit-sized, so one row per issue is a todo list, not a PM view: one row per owner.
  const owners = cur ? [...new Set(cur.features.map((f) => f.owner || '담당 없음'))] : [];
  const idle = people.filter((p) => !owners.includes(p));
  return (
    <>
      <Group header="일정">
        <div className={styles.tl}><ProjectTimeline phases={plan.phases} milestones={plan.milestones} today={plan.today} /></div>
      </Group>
      {cur ? (
        <>
          <Group header={`${cur.id} · ${mmdd(cur.due)} · ${cur.goal} · ${merged.length}/${cur.features.length}`}>
            {owners.map((o) => {
              const mine = cur.features.filter((f) => (f.owner || '담당 없음') === o);
              const done = mine.filter((f) => f.status === 'done').length;
              const left = mine.filter((f) => f.status !== 'done').sort((a, b) => RANK[String(a.status)] - RANK[String(b.status)]);
              return (
                <Cell
                  key={o}
                  leading={<span className={styles.who}>{o}</span>}
                  title={<progress className={styles.bar} value={done} max={mine.length} aria-label={`${o} ${done}/${mine.length}`} />}
                  subtitle={left.length
                    ? `남음 ${left.slice(0, 3).map(leftText).join(' · ')}${left.length > 3 ? ` 외 ${left.length - 3}개` : ''}`
                    : '모두 머지'}
                  value={<span className="mono">{done}/{mine.length}</span>}
                />
              );
            })}
            {idle.map((p) => (
              <Cell key={p} leading={<span className={styles.who}>{p}</span>} title={<span className={styles.quiet}>이 버전 담당 없음</span>} />
            ))}
          </Group>
          {merged.length > 0 && (
            <details className={styles.past}>
              <summary>머지된 {merged.length}개</summary>
              <Group>{merged.map((f, i) => <Cell key={i} leading={<span className={styles.who}>{f.owner}</span>} title={f.name} />)}</Group>
            </details>
          )}
        </>
      ) : <Group header="이번 버전"><p className={styles.section}>모든 버전 완료</p></Group>}
    </>
  );
}
```

import 목록에 `type PlanFeature` 추가. `ProjectDetail`의 호출을 교체:

```tsx
      <Plan plan={d.plan} people={d.team.people.map((p) => p.name)} />
```

- [ ] **Step 4: 스타일** — `Projects.module.css`의 `/* Checklist: 3 observable steps */` 블록(`.who`~`.stepsDone i`)을 교체 (`.strong`은 PR 화면이 쓰므로 남긴다)

```css
/* Checklist: one row per owner, native <progress> */
.who { font-size: 12px; color: var(--t3); min-width: 30px; }
.bar { appearance: none; -webkit-appearance: none; width: 100%; height: 4px; border: 0; border-radius: 2px; background: #3a3a3c; vertical-align: middle; }
.bar::-webkit-progress-bar { background: #3a3a3c; border-radius: 2px; }
.bar::-webkit-progress-value { background: var(--accent); border-radius: 2px; }
.bar::-moz-progress-bar { background: var(--accent); border-radius: 2px; }
```

- [ ] **Step 5: 통과 확인**

Run: `cd frontend && npm test && npm run typecheck && npm run build`
Expected: 전부 PASS (80 tests), 타입 에러 없음, 빌드 성공

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/screens/Projects.tsx frontend/src/screens/Projects.module.css frontend/src/screens/Projects.test.tsx docs/superpowers/plans/2026-10-10-projects-owner-rows.md
git commit -m "feat(projects): 이번 버전을 사람별 한 줄로 묶고 머지된 이슈는 접는다"
```
