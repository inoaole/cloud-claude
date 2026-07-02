import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectEvents } from './index.js';

let repo;
before(() => {
  repo = mkdtempSync(path.join(os.tmpdir(), 'cc-idx-'));
  execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', 'base'], {
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });
});
after(() => rmSync(repo, { recursive: true, force: true }));

const cfg = (repos) => ({ deviceId: 'mbp', intervalSec: 180, repos });

test('heartbeat carries sensor health: all repos ok', async () => {
  const events = await collectEvents(cfg([{ id: 'r1', path: repo }]), { repos: {}, outbox: [] }, 1700000000000);
  const hb = events.find((e) => e.kind === 'heartbeat');
  assert.deepEqual(
    { ok: hb.payload.reposOk, failed: hb.payload.reposFailed },
    { ok: 1, failed: 0 },
  );
});

test('broken repo path → reposFailed counted, run still produces the heartbeat', async () => {
  const events = await collectEvents(
    cfg([{ id: 'good', path: repo }, { id: 'gone', path: '/no/such/repo' }]),
    { repos: {}, outbox: [] }, 1700000000000,
  );
  const hb = events.find((e) => e.kind === 'heartbeat');
  assert.equal(hb.payload.reposOk, 1);
  assert.equal(hb.payload.reposFailed, 1); // git breakage can't masquerade as a quiet day
});
