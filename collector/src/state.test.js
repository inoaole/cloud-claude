import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadState, saveState } from './state.js';

let dir;
function tmp() { dir = mkdtempSync(path.join(os.tmpdir(), 'cc-state-')); return path.join(dir, 'state.json'); }
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

test('missing file → empty state', () => {
  assert.deepEqual(loadState(tmp()), { repos: {}, sessions: {}, outbox: [] });
});

test('save then load round-trips; no leftover tmp file', () => {
  const file = tmp();
  saveState(file, { repos: { 'cloud-claude': 'abc' }, sessions: {}, outbox: [{ event_id: 'e1' }] });
  assert.deepEqual(loadState(file), { repos: { 'cloud-claude': 'abc' }, sessions: {}, outbox: [{ event_id: 'e1' }] });
  assert.ok(existsSync(file));
  assert.ok(!readdirSync(dir).some((f) => f.endsWith('.tmp'))); // tmp renamed away
});

test('corrupt json → empty state (never crash the run)', () => {
  const file = tmp();
  saveState(file, { repos: {}, sessions: {}, outbox: [] });
  writeFileSync(file, '{ not json');
  assert.deepEqual(loadState(file), { repos: {}, sessions: {}, outbox: [] });
});

test('outbox trimmed to the newest OUTBOX_MAX', () => {
  const file = tmp();
  const big = Array.from({ length: 5001 }, (_, i) => ({ event_id: `e${i}` }));
  saveState(file, { repos: {}, outbox: big });
  const back = loadState(file);
  assert.equal(back.outbox.length, 5000);
  assert.equal(back.outbox[back.outbox.length - 1].event_id, 'e5000'); // kept the newest
});
