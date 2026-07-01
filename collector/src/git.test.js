import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitScan, headSha } from './git.js';

let repo;
const git = (...args) => execFileSync('git', ['-C', repo, ...args], {
  stdio: 'pipe',
  env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
}).toString().trim();

before(() => {
  repo = mkdtempSync(path.join(os.tmpdir(), 'cc-git-'));
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'first');
});
after(() => rmSync(repo, { recursive: true, force: true }));

test('first run (no watermark) → baseline HEAD, emit nothing', async () => {
  const r = await gitScan(repo, undefined);
  assert.equal(r.commits.length, 0);
  assert.equal(r.rebaselined, true);
  assert.equal(r.head, await headSha(repo));
});

test('new commits in <lastSha>..HEAD → returned newest-first', async () => {
  const base = await headSha(repo);
  git('commit', '-q', '--allow-empty', '-m', 'second');
  git('commit', '-q', '--allow-empty', '-m', 'third');
  const r = await gitScan(repo, base);
  assert.equal(r.commits.length, 2);
  assert.deepEqual(r.commits.map((c) => c.subject), ['third', 'second']); // newest first
  assert.ok(Number.isFinite(r.commits[0].author_ts) && r.commits[0].author_ts > 0);
  assert.equal(r.head, await headSha(repo));
});

test('lastSha === HEAD → nothing new', async () => {
  const head = await headSha(repo);
  const r = await gitScan(repo, head);
  assert.equal(r.commits.length, 0);
  assert.equal(r.rebaselined, false);
});

test('unknown lastSha (rebase/gc) → re-baseline, emit nothing (no history dump)', async () => {
  const r = await gitScan(repo, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
  assert.equal(r.commits.length, 0);
  assert.equal(r.rebaselined, true);
  assert.equal(r.head, await headSha(repo));
});
