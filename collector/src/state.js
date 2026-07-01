// On-disk collector state: per-repo git watermark + the outbox (events not yet accepted by the hub).
// Written ATOMICALLY (tmp + rename) so a run killed mid-write can't corrupt watermarks (which would
// duplicate commits) or the outbox (which would strand events).
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const OUTBOX_MAX = 5000; // safety cap if the hub is unreachable for a long time (drop oldest)

/** Load state.json. Missing/corrupt → a fresh empty state (never crash the run). */
export function loadState(file) {
  try {
    const s = JSON.parse(readFileSync(file, 'utf8'));
    return {
      repos: s.repos && typeof s.repos === 'object' ? s.repos : {},
      outbox: Array.isArray(s.outbox) ? s.outbox : [],
    };
  } catch {
    return { repos: {}, outbox: [] };
  }
}

/** Persist state atomically. Trims the outbox to OUTBOX_MAX (keeps newest). */
export function saveState(file, state) {
  mkdirSync(path.dirname(file), { recursive: true });
  const outbox = state.outbox.length > OUTBOX_MAX ? state.outbox.slice(-OUTBOX_MAX) : state.outbox;
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ repos: state.repos, outbox }, null, 2));
  renameSync(tmp, file); // atomic on POSIX — readers see old-or-new, never a partial file
}
