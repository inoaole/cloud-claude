// Git scan — the correctness core of v1a. Diffs each repo against its stored watermark (last HEAD
// we reported) and returns the NEW commits since then.
//
// Two rules that keep this safe:
//  1. First run (no watermark): baseline at HEAD, emit NOTHING. We start "from now" — no backfill
//     of the whole repo history (which would flood /ingest past its 200/64kb cap).
//  2. Use a revision RANGE `<lastSha>..HEAD`, NOT `git log --since=<sha>` (`--since` takes a DATE,
//     not a commit — a classic footgun). If the range errors (rebase/gc rewrote history and
//     lastSha is unknown), re-baseline to HEAD and emit nothing rather than dumping history.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const US = '\x1f'; // unit separator between fields (safe: %s subject is single-line)
const FMT = `%H${US}%s${US}%at`;
const OPTS = { timeout: 15_000, maxBuffer: 8 * 1024 * 1024 };

/** Current HEAD sha of a repo. */
export async function headSha(repoPath) {
  const { stdout } = await execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], OPTS);
  return stdout.trim();
}

/**
 * Scan one repo. Returns { commits, head, rebaselined }:
 *  - commits: [{ sha, subject, author_ts }] newest-first (author_ts in epoch MS), [] on first run.
 *  - head: the sha to store as the new watermark.
 *  - rebaselined: true when we had to reset (unknown lastSha) — logged, not an error.
 */
export async function gitScan(repoPath, lastSha) {
  const head = await headSha(repoPath);
  if (!lastSha || lastSha === head) return { commits: [], head, rebaselined: !lastSha };

  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      'git', ['-C', repoPath, 'log', `--format=${FMT}`, `${lastSha}..HEAD`], OPTS,
    ));
  } catch {
    // lastSha no longer reachable (rebase/gc/force-push) → re-baseline, emit nothing.
    return { commits: [], head, rebaselined: true };
  }

  const commits = stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, subject, at] = line.split(US);
      return { sha, subject, author_ts: Number(at) * 1000 }; // git %at is seconds → ms
    });
  return { commits, head, rebaselined: false };
}
