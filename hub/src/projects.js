// GET /api/projects + GET /api/projects/:id — what each team project looks like right now.
//
// Facts come from where they already live: penalty-bot's config.json / ledger.json on this same
// server, GitHub for this week's PRs, Discord for recent messages. Nothing is copied here.
// Every source reports ok | error | unconfigured on its own: a failed fetch must never render
// as "no activity", and a missing ledger must never render as "everyone passed".
import { readFile } from 'node:fs/promises';
import { kstParts } from './market.js';

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

/** This person's PRs touched since Monday 00:00 KST (penalty-bot's lenient rule). */
export function filterPrs(pulls, login, startMs) {
  if (!login) return [];
  const me = login.toLowerCase();
  return pulls
    .filter(({ pr }) => pr.user?.login?.toLowerCase() === me && Date.parse(pr.updated_at) >= startMs)
    .map(({ repo, pr }) => ({
      label: `${repo.split('_').at(-1)}#${pr.number}`,
      title: pr.title,
      url: pr.html_url,
      state: pr.merged_at ? 'merged' : pr.state,
    }));
}

export function mapMessage(m) {
  return {
    id: m.id,
    author: m.author?.global_name ?? m.author?.username ?? '?',
    content: m.content ?? '',
    ts: m.timestamp,
    attachments: m.attachments?.length ?? 0,
  };
}
