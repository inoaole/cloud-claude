// GET /api/projects + GET /api/projects/:id — what each team project looks like right now.
//
// Facts come from where they already live: penalty-bot's config.json / ledger.json on this same
// server, GitHub for this week's PRs, Discord for recent messages. Nothing is copied here.
// Every source reports ok | error | unconfigured on its own: a failed fetch must never render
// as "no activity", and a missing ledger must never render as "everyone passed".
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { kstParts } from './market.js';
import { parseSchedule, daysBetween, featureStatus, currentVersion, exceptionsOf, healthOf } from './plan.js';

const ID_RE = /^[a-z0-9-]{1,32}$/;
const CHANNEL_RE = /^\d{1,20}$/;
// A week someone was excused or the judge itself failed is not that person falling behind.
const ON_TRACK = new Set(['pass', 'exempt', 'hold']);
const DAY = 864e5;

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** projects.json → array. Missing file = no projects; a malformed one throws (caller logs). */
export async function loadProjects(file) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) throw new Error('projects.json must be an array');
  for (const p of list) {
    if (!ID_RE.test(p?.id ?? '')) throw new Error(`bad project id: ${JSON.stringify(p?.id)}`);
    // Channel ids are interpolated into a Discord URL — digits only.
    for (const ch of p.discordChannels ?? []) {
      if (!CHANNEL_RE.test(ch?.id ?? '')) throw new Error(`bad channel id: ${JSON.stringify(ch?.id)}`);
    }
    // schedule.repo/path are interpolated into a GitHub URL.
    if (p.schedule && (!/^[\w.-]+\/[\w.-]+$/.test(p.schedule.repo ?? '') || !p.schedule.path
      || `${p.schedule.repo}/${p.schedule.path}`.split('/').includes('..'))) {
      throw new Error(`bad schedule: ${JSON.stringify(p.schedule)}`);
    }
  }
  return list;
}

/** This week's Monday (KST) as YYYY-MM-DD. Same week definition as penalty-bot. */
export function weekStart(nowMs) {
  const { date } = kstParts(nowMs);
  const back = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -back);
}

/** Port of penalty-bot mode_for. ISO dates compare correctly as strings. */
export function modeFor(person, monday, planUntil) {
  if (monday < planUntil) return 'plan';
  const [restStart, restEnd] = person.rest ?? [];
  if (restStart && restEnd && restStart <= addDays(monday, 6) && restEnd >= monday) return 'exempt';
  return 'dev';
}

/** Last 4 judged weeks (oldest first) + on-track from the latest one. No record → null. */
export function summarizePerson(weeks, name) {
  const mine = Object.keys(weeks).sort().filter((w) => weeks[w]?.[name]);
  const history = mine.slice(-4).map((week) => ({
    week, status: weeks[week][name].status, reason: weeks[week][name].reason ?? '',
  }));
  const last = history.at(-1);
  return { history, onTrack: last ? ON_TRACK.has(last.status) : null };
}

export function teamSummary(people) {
  const judged = people.filter((p) => p.onTrack !== null);
  return judged.length ? { onTrack: judged.filter((p) => p.onTrack).length, judged: judged.length } : null;
}

/** This person's PRs touched since Monday 00:00 KST (penalty-bot's lenient rule).
    No GitHub login = can't check → null, never [] ("no PRs"). */
export function filterPrs(pulls, login, startMs) {
  if (!login) return null;
  const me = login.toLowerCase();
  return pulls
    .filter(({ pr }) => pr.user?.login?.toLowerCase() === me && Date.parse(pr.updated_at) >= startMs)
    .map(({ repo, pr }) => ({
      label: `${repo.split('_').at(-1)}#${pr.number}`,
      title: pr.title,
      url: pr.html_url,
      state: pr.merged_at ? 'merged' : pr.state,
      repo,
      number: pr.number,
    }));
}

export function mapMessage(m) {
  return {
    id: m.id,
    author: m.author?.global_name ?? m.author?.username ?? '?',
    content: m.content ?? '',
    ts: m.timestamp,
    // Embed-only bot posts have empty content; count embeds so they don't render as blank cards.
    attachments: (m.attachments?.length ?? 0) + (m.embeds?.length ?? 0),
  };
}

const TIMEOUT_MS = 8000;
const UA = 'cloud-claude-hub';

export async function getJson(fetchFn, url, headers) {
  const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw Object.assign(new Error(`http ${res.status}`), { status: res.status });
  return res.json();
}

export const ghHeaders = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': UA });

async function fetchPulls(fetchFn, token, repos, startMs) {
  const headers = ghHeaders(token);
  const out = [];
  for (const repo of repos) {
    for (let page = 1; ; page += 1) {
      const batch = await getJson(fetchFn,
        `https://api.github.com/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`, headers);
      out.push(...batch.map((pr) => ({ repo, pr })));
      if (batch.length < 100 || Date.parse(batch.at(-1).updated_at) < startMs) break;
    }
  }
  return out;
}

async function teamSections(project, ctx, monday, startMs) {
  const unconfigured = {
    team: { state: 'unconfigured', summary: null, people: [] },
    ledger: { state: 'unconfigured' },
    github: { state: 'unconfigured' },
  };
  if (!project.penaltyBotDir) return unconfigured;
  const dir = project.penaltyBotDir;

  let cfg;
  try {
    cfg = JSON.parse(await ctx.readFn(path.join(dir, 'config.json')));
    if (!Array.isArray(cfg?.people) || !Array.isArray(cfg.repos ?? [])) throw new Error('config.json: people/repos must be arrays');
  } catch (e) {
    ctx.onError('team', e);
    return { ...unconfigured, team: { state: 'error', summary: null, people: [] } };
  }

  // No ledger yet = the judge has never run. That is normal, not an error.
  let weeks = {};
  let ledger = { state: 'ok' };
  try {
    weeks = JSON.parse(await ctx.readFn(path.join(dir, 'ledger.json'))).weeks ?? {};
  } catch (e) {
    if (e.code !== 'ENOENT') { ledger = { state: 'error' }; ctx.onError('ledger', e); }
  }

  // null = could not check. Never collapse it into [] ("no PRs").
  let pulls = null;
  let github = { state: 'unconfigured' };
  if (ctx.env.GITHUB_TOKEN) {
    try {
      pulls = await fetchPulls(ctx.fetchFn, ctx.env.GITHUB_TOKEN, cfg.repos ?? [], startMs);
      github = { state: 'ok' };
    } catch (e) {
      github = { state: 'error' };
      ctx.onError('github', e);
    }
  }

  const people = (cfg.people ?? []).map((p) => ({
    name: p.name,
    github: p.github || null,
    mode: modeFor(p, monday, cfg.plan_until ?? ''),
    ...summarizePerson(weeks, p.name),
    prs: pulls && filterPrs(pulls, p.github, startMs),
  }));
  return { team: { state: 'ok', summary: teamSummary(people), people }, ledger, github };
}

async function discordSection(project, ctx) {
  const chans = project.discordChannels ?? [];
  const token = ctx.env.DISCORD_BOT_TOKEN;
  if (!chans.length || !token) return { state: 'unconfigured', channels: [] };
  const headers = { Authorization: `Bot ${token}`, 'User-Agent': UA };
  const channels = await Promise.all(chans.map(async (ch) => {
    try {
      const msgs = await getJson(ctx.fetchFn, `https://discord.com/api/v10/channels/${ch.id}/messages?limit=50`, headers);
      return { id: ch.id, name: ch.name, state: 'ok', messages: msgs.map(mapMessage) };
    } catch (e) {
      ctx.onError('discord', e);
      return { id: ch.id, name: ch.name, state: 'error', messages: [] };
    }
  }));
  return { state: channels.some((c) => c.state === 'ok') ? 'ok' : 'error', channels };
}

async function planSection(project, ctx, today) {
  const token = ctx.env.GITHUB_TOKEN;
  if (!project.schedule || !token) return { state: 'unconfigured' };
  const { repo, path: file } = project.schedule;
  let schedule;
  try {
    const url = `https://api.github.com/repos/${repo}/contents/${file.split('/').map(encodeURIComponent).join('/')}`;
    schedule = parseSchedule(await getJson(ctx.fetchFn, url, { ...ghHeaders(token), Accept: 'application/vnd.github.raw+json' }));
  } catch (e) {
    ctx.onError('plan', e);
    return { state: 'error' };
  }
  const repos = [...new Set(schedule.versions.flatMap((v) => v.features.flatMap((f) => f.issues.map((r) => r.split('#')[0]))))];
  // ponytail: first 100 issues+PRs per repo; paginate when a repo outgrows it.
  const items = new Map(await Promise.all(repos.map(async (r) => {
    try {
      return [r, await getJson(ctx.fetchFn, `https://api.github.com/repos/${r}/issues?state=all&per_page=100`, ghHeaders(token))];
    } catch (e) {
      ctx.onError('issues', e);
      return [r, null];
    }
  })));
  const versions = schedule.versions.map((v) => ({
    ...v, features: v.features.map((f) => ({ name: f.name, owner: f.owner, ...featureStatus(f, items) })),
  }));
  const cur = currentVersion(versions, today);
  return {
    state: 'ok', today, phases: schedule.phases,
    milestones: versions.map((v) => ({ id: v.id, due: v.due, done: v.features.every((f) => f.status === 'done') })),
    current: cur && { id: cur.id, due: cur.due, goal: cur.goal, daysLeft: daysBetween(today, cur.due), features: cur.features },
  };
}

const STALE_MS = 6 * 3600e3;

/** The batch runner's output. A runner that stopped must read as broken, never as a quiet day. */
async function briefSection(project, ctx, now) {
  if (!ctx.briefsDir) return { state: 'unconfigured' };
  let b;
  try {
    b = JSON.parse(await ctx.readFn(path.join(ctx.briefsDir, `${project.id}.json`)));
  } catch (e) {
    if (e.code === 'ENOENT') return { state: 'unconfigured' };
    ctx.onError('brief', e);
    return { state: 'error' };
  }
  const generatedAt = b?.generatedAt ?? null;
  if (!(now - Date.parse(generatedAt ?? '') < STALE_MS)) return { state: 'error', generatedAt };
  return {
    state: 'ok', generatedAt,
    tldr: Array.isArray(b.tldr) ? b.tldr : [],
    reviews: Object.entries(b.reviews ?? {}).map(([key, r]) => ({ key, ...r })),
  };
}

/** Assemble one project. Never throws — every failure is a section state. */
export async function getProject(project, {
  fetchFn = fetch, readFn = (f) => readFile(f, 'utf8'), env = process.env, now = Date.now(), onError = () => {}, briefsDir = null,
} = {}) {
  const ctx = { fetchFn, readFn, env, onError, briefsDir };
  const monday = weekStart(now);
  const startMs = Date.parse(`${monday}T00:00:00+09:00`);
  const today = kstParts(now).date;
  const [teamPart, discord, plan, brief] = await Promise.all([
    teamSections(project, ctx, monday, startMs), discordSection(project, ctx), planSection(project, ctx, today), briefSection(project, ctx, now),
  ]);
  const current = plan.current ?? null;
  const exceptions = exceptionsOf({ current, people: teamPart.team.people, reviews: brief.reviews ?? [] });
  const health = healthOf({ planState: plan.state, current, exceptions });
  return { id: project.id, name: project.name, weekStart: monday, ...teamPart, discord, plan, health, exceptions, brief };
}

/** Row for the Projects list. Discord timestamps share one ISO format, so string max works. */
export function listItem(d) {
  const ts = d.discord.channels.flatMap((c) => c.messages.map((m) => m.ts)).sort().at(-1) ?? null;
  // Carry the state so a broken source never reads as "not judged yet" on the list.
  const state = d.team.state !== 'ok' ? d.team.state : d.ledger.state === 'error' ? 'error' : 'ok';
  return {
    id: d.id, name: d.name, state, summary: d.team.summary, lastMessageAt: ts,
    health: d.health, currentId: d.plan.current?.id ?? null, daysLeft: d.plan.current?.daysLeft ?? null, exceptionCount: d.exceptions.length,
  };
}
