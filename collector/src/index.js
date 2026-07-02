// Collector entrypoint — ONE pass, then exit. launchd fires this every intervalSec (fresh process
// each time, not a resident daemon). Each run: scan git repos → build a heartbeat → validate →
// append to the on-disk outbox → flush to the hub → persist state atomically.
import { SCHEMA_VERSION, commitEventId, heartbeatEventId, validateEvent, V1_KINDS }
  from '../../shared/schema.js';
import { loadConfig, STATE_FILE } from './config.js';
import { loadState, saveState } from './state.js';
import { gitScan } from './git.js';
import { makePoster, flush } from './outbox.js';

function log(event, extra = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...extra }));
}

/** Build this run's new events (commit_seen per new commit + one heartbeat). Mutates state.repos. */
export async function collectEvents(cfg, state, runStarted) {
  const events = [];
  let reposFailed = 0; // sensor health: a broken git scan must not masquerade as a quiet day
  for (const repo of cfg.repos) {
    let scan;
    try {
      scan = await gitScan(repo.path, state.repos[repo.id]);
    } catch (err) {
      log('git_scan_error', { repo: repo.id, msg: String(err?.message || err) });
      reposFailed += 1;
      continue; // skip this repo this run; watermark unchanged
    }
    if (scan.rebaselined) log('git_rebaselined', { repo: repo.id, head: scan.head });
    for (const c of scan.commits) {
      events.push({
        event_id: commitEventId(cfg.deviceId, repo.id, c.sha),
        device_id: cfg.deviceId,
        kind: 'commit_seen',
        ts_device: c.author_ts,
        schema_version: SCHEMA_VERSION,
        payload: { repoId: repo.id, sha: c.sha, subject: c.subject, author_ts: c.author_ts },
      });
    }
    state.repos[repo.id] = scan.head; // advance the watermark
  }

  // Heartbeat: id keyed on this run's start ms (idempotent across THIS run's outbox retries).
  // Carries sensor health so the hub can tell "quiet day" from "scanner broken" (Sprint 6).
  events.push({
    event_id: heartbeatEventId(cfg.deviceId, runStarted),
    device_id: cfg.deviceId,
    kind: 'heartbeat',
    ts_device: runStarted,
    schema_version: SCHEMA_VERSION,
    payload: { intervalSec: cfg.intervalSec, reposOk: cfg.repos.length - reposFailed, reposFailed },
  });

  // Validate before enqueue (fail fast) — a bad event never reaches the outbox.
  return events.filter((e) => {
    const err = validateEvent(e, V1_KINDS);
    if (err) log('event_invalid_dropped', { kind: e.kind, err });
    return !err;
  });
}

export async function runOnce({ cfg, stateFile = STATE_FILE, runStarted, post } = {}) {
  const conf = cfg || loadConfig();
  const state = loadState(stateFile);
  const started = runStarted ?? Date.now();

  const fresh = await collectEvents(conf, state, started);
  state.outbox.push(...fresh);

  const poster = post || makePoster(conf);
  const { sent, dropped } = await flush(state.outbox, poster);
  state.outbox = state.outbox.slice(sent);

  saveState(stateFile, state);
  log('run_done', { newEvents: fresh.length, sent, dropped: dropped.length, outboxRemaining: state.outbox.length });
  return { newEvents: fresh.length, sent, dropped: dropped.length, outboxRemaining: state.outbox.length };
}

// Run when invoked directly (launchd / CLI), not when imported by tests.
const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  runOnce().catch((err) => {
    log('run_fatal', { msg: String(err?.message || err) });
    process.exit(1);
  });
}
