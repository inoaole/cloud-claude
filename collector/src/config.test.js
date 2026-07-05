import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './config.js';

let dir;
function write(obj) {
  dir = mkdtempSync(path.join(os.tmpdir(), 'cc-cfg-'));
  const file = path.join(dir, 'config.json');
  writeFileSync(file, typeof obj === 'string' ? obj : JSON.stringify(obj));
  return file;
}
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

const base = {
  hubUrl: 'https://hub.example/', deviceId: 'macbook-pro', ingestToken: 'tok',
  repos: [{ id: 'r1', path: '/a' }],
};

test('valid config loads; trailing slash trimmed; interval defaulted', () => {
  const cfg = loadConfig(write(base));
  assert.equal(cfg.hubUrl, 'https://hub.example'); // trailing / trimmed
  assert.equal(cfg.intervalSec, 180);              // default
  assert.equal(cfg.repos.length, 1);
});

test('missing required fields throw with names', () => {
  assert.throws(() => loadConfig(write({ ...base, ingestToken: undefined })), /ingestToken/);
  assert.throws(() => loadConfig(write({ ...base, repos: 'nope' })), /repos/);
});

test('repo missing id/path throws', () => {
  assert.throws(() => loadConfig(write({ ...base, repos: [{ id: 'x' }] })), /needs \{id, path\}/);
});

test('duplicate repo id throws (would collide event ids)', () => {
  const dup = { ...base, repos: [{ id: 'r1', path: '/a' }, { id: 'r1', path: '/b' }] };
  assert.throws(() => loadConfig(write(dup)), /duplicate repo id/);
});

test('missing file throws a clear error', () => {
  assert.throws(() => loadConfig('/no/such/config.json'), /not found or invalid/);
});
