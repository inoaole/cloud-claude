// Outbox flush — hand the queued events to the hub /ingest, in batches, from the front.
// Verdict per batch decides what happens to those events:
//   'ok'   → hub accepted (or dup-ignored) → consume (remove from outbox)
//   'drop' → 4xx that retrying can't fix (bad token config / poison event) → consume + log
//   'keep' → network error / 429 / 5xx → STOP; leave this batch and the rest for next run
import { INGEST_MAX } from '../../hub/src/ingest.js';

const POST_TIMEOUT_MS = 10_000; // don't let a half-open hub hang the whole run (→ launchd stalls)

/**
 * Map a non-2xx status to a verdict.
 *   keep → transient OR fixable-by-config (network/429/5xx AND 401/403 auth). NEVER lose data on a
 *          misconfigured token — the outbox holds it (bounded by OUTBOX_MAX) until the config is fixed.
 *   drop → 400 only: the payload itself is malformed, so retrying it verbatim can never succeed.
 */
export function verdictFor(status) {
  if (status === 429 || status >= 500 || status === 401 || status === 403) return 'keep';
  return 'drop';
}

/** Build the real poster (uses global fetch). Returns a fn: (events) => 'ok'|'drop'|'keep'. */
export function makePoster(cfg) {
  return async function post(events) {
    let res;
    try {
      res = await fetch(`${cfg.hubUrl}/ingest`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cfg.ingestToken}`,
        },
        body: JSON.stringify({ device_id: cfg.deviceId, events }),
        signal: AbortSignal.timeout(POST_TIMEOUT_MS),
      });
    } catch {
      return 'keep'; // hub unreachable / timed out — try again next run
    }
    return res.ok ? 'ok' : verdictFor(res.status);
  };
}

/**
 * Flush the outbox through `post` in batches of ≤ INGEST_MAX. Stops at the first 'keep'.
 * Returns { sent, dropped } — `sent` = count consumed from the front (ok + drop).
 */
export async function flush(outbox, post, { max = INGEST_MAX } = {}) {
  let sent = 0;
  const dropped = [];
  for (let i = 0; i < outbox.length; i += max) {
    const batch = outbox.slice(i, i + max);
    const verdict = await post(batch);
    if (verdict === 'keep') break;
    sent += batch.length;
    if (verdict === 'drop') dropped.push(...batch);
  }
  return { sent, dropped };
}
