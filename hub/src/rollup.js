// Day rollup — derives the Today summary ON READ from raw events (no cache table; late events
// are handled for free because every read recomputes). Sprint 6, eng-reviewed:
//   D3/D7 hand-rolled TZ math (2-pass Intl) — user tz has no DST; DST held by tests
//   D4    own aggregate SQL, NOT queryTimeline (its 1000-row clamp would truncate heartbeats)
//   D5    a commit belongs to its AUTHOR day (ts_device) — late-flushed work lands on ITS day
//   D8    liveness by ts_hub (device clocks untrusted) + sensor health from the last heartbeat
//
//   date+tz ──▶ localDayRange ──▶ [startMs, endMs) ──▶ aggregate heartbeats (per device)
//                                                  ├─▶ fetch commits, dedupe (repoId, sha)
//   now ─────▶ todayInTz ──▶ isToday ──▶ status: normal | quiet | offline (+ sensorDegraded)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OFFLINE_AFTER_MS = 15 * 60_000; // 5 missed 180s collector intervals (hysteresis)

/** Throws if tz is not a real IANA timezone (Intl is the authority). */
export function assertTz(tz) {
  if (typeof tz !== 'string' || !tz) throw new Error('bad tz');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new Error('bad tz');
  }
}

export function assertDate(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error('bad date');
  }
}

/** What a UTC instant reads as on the wall clock in tz, minus the instant = the tz offset. */
function tzOffsetMs(utcMs, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
  );
  const wallAsUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    parts.hour === '24' ? 0 : Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  return wallAsUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Epoch ms of local midnight for dateStr in tz. 2-pass: derive the offset AT the candidate
    instant, re-derive after adjusting — converges across DST boundaries. */
function localMidnightMs(dateStr, tz) {
  const utcMidnight = Date.parse(`${dateStr}T00:00:00Z`);
  let guess = utcMidnight;
  for (let i = 0; i < 2; i += 1) guess = utcMidnight - tzOffsetMs(guess, tz);
  return guess;
}

/** [startMs, endMs) covering the local date in tz. End = next date's midnight, so a 23h/25h
    DST day has the correct real length. */
export function localDayRange(dateStr, tz) {
  assertDate(dateStr);
  assertTz(tz);
  const next = new Date(Date.parse(`${dateStr}T00:00:00Z`) + 36 * 3600_000); // safely inside next day
  const nextStr = next.toISOString().slice(0, 10);
  return [localMidnightMs(dateStr, tz), localMidnightMs(nextStr, tz)];
}

/** The local date (YYYY-MM-DD) that `nowMs` falls on in tz — NEVER the hub's own clock date. */
export function todayInTz(nowMs, tz) {
  assertTz(tz);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(nowMs));
}

/**
 * Build the day rollup. Own prepared statements on purpose (D4): the heartbeat aggregate
 * transfers zero rows so a 1000+ beat day (multi-device) can't truncate, and /timeline's
 * clamped query stays untouched.
 */
export function buildRollup(db, { date, tz, now }) {
  assertDate(date);
  assertTz(tz);
  const [startMs, endMs] = localDayRange(date, tz);

  // Pulse — per device (D8: one healthy collector must not mask a dead one).
  const devices = db.prepare(`
    SELECT device_id AS deviceId, COUNT(*) AS beats,
           MIN(ts_device) AS first, MAX(ts_device) AS last
    FROM events WHERE kind = 'heartbeat' AND ts_device >= ? AND ts_device < ?
    GROUP BY device_id ORDER BY device_id
  `).all(startMs, endMs);
  const pulse = {
    devices,
    beats: devices.reduce((n, d) => n + d.beats, 0),
    first: devices.length ? Math.min(...devices.map((d) => d.first)) : null,
    last: devices.length ? Math.max(...devices.map((d) => d.last)) : null,
  };

  // Commits — author day (D5), deduped across devices by (repoId, sha) (D8).
  const rows = db.prepare(`
    SELECT payload FROM events
    WHERE kind = 'commit_seen' AND ts_device >= ? AND ts_device < ?
    ORDER BY ts_device DESC
  `).all(startMs, endMs);
  const seen = new Set();
  const byRepo = new Map();
  for (const r of rows) {
    const p = JSON.parse(r.payload);
    const key = `${p.repoId}\n${p.sha}`;
    if (seen.has(key)) continue; // same commit observed by another device
    seen.add(key);
    if (!byRepo.has(p.repoId)) byRepo.set(p.repoId, []);
    byRepo.get(p.repoId).push({ sha: p.sha, subject: p.subject, authorTs: p.author_ts });
  }
  const commits = [...byRepo.entries()].map(([repoId, list]) => ({ repoId, commits: list }));
  const commitCount = seen.size;

  // Sessions (v1b) — emitted on END with ts_device = started, so the day query attributes a
  // session to the day the work began. Durations are poll-granularity estimates (~).
  const sessions = db.prepare(`
    SELECT device_id, payload FROM events
    WHERE kind = 'session_observed' AND ts_device >= ? AND ts_device < ?
    ORDER BY ts_device DESC
  `).all(startMs, endMs).map((r) => {
    const p = JSON.parse(r.payload);
    return { tool: p.tool, cwd: p.cwd, started: p.started, ended: p.ended, durationMs: p.ended - p.started, deviceId: r.device_id };
  });

  // Liveness — ts_hub of the most recent heartbeat EVER (not just today): "is the collector
  // reporting NOW". Device clocks are untrusted for liveness (D8).
  // NOTE(fan-out): this reads the latest heartbeat ACROSS devices — fine for v1's single
  // collector, but with 2+ devices a live one masks a dead one's liveness AND sensor health.
  // When fan-out lands, make liveness + sensorDegraded per-device (pulse already is).
  const lastHb = db.prepare(`
    SELECT ts_hub AS tsHub, payload FROM events
    WHERE kind = 'heartbeat' ORDER BY ts_hub DESC LIMIT 1
  `).get();
  const alive = Boolean(lastHb) && now - lastHb.tsHub < OFFLINE_AFTER_MS;

  // Status — "today" judged in the REQUEST's tz, never the hub clock (review fold, D3).
  // Offline is a NOW concept: past dates never claim it (design: not observed ≠ bug).
  const isToday = todayInTz(now, tz) === date;
  const hadActivity = commitCount > 0 || sessions.length > 0; // sessions count as a real day too
  let status;
  if (isToday && !alive) status = 'offline';
  else status = hadActivity ? 'normal' : 'quiet';

  // Sensor health — a broken git scan must not masquerade as a quiet day (D8/codex).
  let sensorDegraded = false;
  if (isToday && alive) {
    const p = JSON.parse(lastHb.payload);
    sensorDegraded = Number(p.reposFailed) > 0;
  }

  return { date, tz, status, sensorDegraded, commitCount, commits, sessions, pulse };
}
