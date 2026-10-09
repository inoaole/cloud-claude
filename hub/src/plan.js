// Plan vs reality for the Projects PM view. Pure: no I/O, no LLM.
//
// The plan is GitHub milestones (version → due date → attached issues). Reality is the
// issue/PR state. Everything a phone needs to answer "are we OK?" is derived
// here deterministically, so every verdict has a one-line reason and a test.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OPEN = new Set(['todo', 'unlinked']);
const DAY = 864e5;

/** schedule.json now only carries the timeline's phase bands; versions live in GitHub milestones. */
export function parsePhases(raw) {
  if (!Array.isArray(raw?.phases)) throw new Error('schedule: phases must be an array');
  for (const p of raw.phases) {
    if (!p?.name || !DATE_RE.test(p.start ?? '') || !DATE_RE.test(p.end ?? '')) throw new Error(`bad phase: ${JSON.stringify(p)}`);
  }
  return raw.phases;
}

/**
 * GitHub milestones → versions. A version is every milestone sharing an id ("0.1.0 — MVP" → "0.1.0")
 * across repos; its features are the issues attached to it. Owner = assignee, else the author.
 * repos: [{ repo, milestones, issues: { [milestoneNumber]: issue[] } }]
 */
export function versionsFromMilestones(repos, nameOf) {
  const byId = new Map();
  for (const { repo, milestones, issues } of repos) {
    // ponytail: a milestone without a due date has no place on a timeline; it is left out.
    for (const m of milestones.filter((x) => x.due_on)) {
      const [id, ...rest] = m.title.split(' — ');
      const due = kstDate(m.due_on);
      const v = byId.get(id.trim()) ?? { id: id.trim(), due, goal: '', features: [] };
      if (due < v.due) v.due = due;
      v.goal ||= rest.join(' — ').trim() || (m.description ?? '').split(/[.\n]/)[0].trim();
      for (const i of issues[m.number] ?? []) {
        const login = i.assignees?.[0]?.login ?? i.user?.login ?? '';
        v.features.push({ name: i.title, owner: nameOf[login] ?? login, issues: [`${repo}#${i.number}`] });
      }
      byId.set(v.id, v);
    }
  }
  return [...byId.values()].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
}

const kstDate = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);

export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

const parseRef = (ref) => {
  const [repo, n] = ref.split('#');
  return { repo, n: Number(n) };
};

/** items: repo → raw GitHub /issues list (PRs included), or null when that repo failed. */
export function featureStatus(feature, items) {
  if (!feature.issues.length) return { status: 'unlinked', pr: null };
  const refs = feature.issues.map(parseRef);
  if (refs.some((r) => !items.get(r.repo))) return { status: null, pr: null };
  const issues = refs.map((r) => items.get(r.repo).find((i) => i.number === r.n && !i.pull_request));
  // A typo'd or deleted issue number is "can't tell", not "not started".
  if (issues.some((i) => !i)) return { status: null, pr: null };
  if (issues.every((i) => i.state === 'closed')) return { status: 'done', pr: null };
  for (const [k, r] of refs.entries()) {
    if (issues[k].state === 'closed') continue;
    const mention = new RegExp(`#${r.n}(?!\\d)`);
    const pr = items.get(r.repo).find((i) => i.pull_request && i.state === 'open' && mention.test(i.body ?? ''));
    if (pr) return { status: 'pr', pr: `${r.repo.split('/')[1].split('_').at(-1)}#${pr.number}` };
  }
  return { status: 'todo', pr: null };
}

/** Overdue-and-unfinished wins (what slipped must show first), else the earliest unfinished. */
export function currentVersion(versions, today) {
  // A version with no issues yet is not finished — it must not read as "all done".
  const open = versions.filter((v) => !v.features.length || v.features.some((f) => f.status !== 'done'));
  return open.find((v) => v.due < today) ?? open.find((v) => v.due >= today) ?? null;
}

export function exceptionsOf({ current, people, reviews }) {
  const out = [];
  const todoBy = new Map();
  for (const f of current?.features ?? []) {
    if (OPEN.has(f.status)) todoBy.set(f.owner, [...(todoBy.get(f.owner) ?? []), f.name]);
  }
  for (const [who, names] of todoBy) {
    const p = people.find((x) => x.name === who);
    // Unknown owner, resting, or PRs unknown (GitHub down): we can't honestly call it stalled.
    if (p && p.mode !== 'exempt' && Array.isArray(p.prs) && p.prs.length === 0) {
      out.push({ kind: 'stalled', who, text: `이번 주 PR 없음 · 할 일: ${names.join(' · ')}` });
    }
  }
  for (const p of people) {
    if (p.onTrack !== false) continue;
    const why = p.history.at(-1)?.reason;
    out.push({ kind: 'failed', who: p.name, text: why ? `지난 판정 실패 · ${why}` : '지난 판정 실패' });
  }
  for (const r of reviews) {
    if (r.verdict === 'ok') continue;
    const bad = (r.signals ?? []).filter((s) => !s.ok).slice(0, 2).map((s) => s.detail);
    out.push({ kind: 'review', label: r.label, verdict: r.verdict, url: r.url, question: r.question ?? '', text: [r.author, ...bad].filter(Boolean).join(' · ') });
  }
  return out;
}

export function healthOf({ planState, current, exceptions }) {
  if (planState === 'unconfigured') return { level: 'unknown', why: '일정이 연결되지 않음' };
  if (planState !== 'ok') return { level: 'unknown', why: '일정을 읽지 못함' };
  if (!current) return { level: 'on', why: '모든 버전 완료' };
  if (!current.features.length) return { level: current.daysLeft < 0 ? 'off' : 'risk', why: `${current.id}에 이슈 없음` };
  if (current.features.some((f) => f.status === null)) return { level: 'unknown', why: '진도를 확인하지 못함' };
  const left = current.features.filter((f) => f.status !== 'done');
  const d = current.daysLeft;
  if (d < 0) return { level: 'off', why: `${current.id} 마감 ${-d}일 지남, 미완 ${left.length}개` };
  const idle = left.filter((f) => OPEN.has(f.status));
  if (d <= 3 && idle.length) return { level: 'risk', why: `${current.id}까지 ${d}일, ${idle.map((f) => f.name).join(' · ')} 진행 안 보임` };
  const flagged = exceptions.filter((e) => e.kind === 'failed' || (e.kind === 'review' && e.verdict === 'suspect'));
  if (flagged.length) return { level: 'risk', why: `확인 필요 ${flagged.length}개` };
  const n = current.features.length;
  return { level: 'on', why: `${current.id}까지 ${d}일, ${n}개 중 ${n - left.length}개 머지` };
}
