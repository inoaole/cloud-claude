import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeDevice, bearer, tokenMatches } from './bearer-auth.js';

const TOKEN = 'tok-secret-abc';
const devices = [
  { id: 'macbook-pro', ingestToken: TOKEN },
  { id: 'briefing-runner', ingestToken: 'tok-briefing' },
  { id: 'notoken' },
  { id: 'disabled', ingestToken: TOKEN, enabled: false },
];

test('bearer() extracts only a Bearer token', () => {
  assert.equal(bearer('Bearer xyz'), 'xyz');
  assert.equal(bearer('Basic xyz'), null);
  assert.equal(bearer(undefined), null);
  assert.equal(bearer(''), null);
});

test('tokenMatches() is length-guarded and exact', () => {
  assert.equal(tokenMatches(TOKEN, TOKEN), true);
  assert.equal(tokenMatches('short', TOKEN), false);   // differing length must not throw
  assert.equal(tokenMatches('', TOKEN), false);
  assert.equal(tokenMatches(undefined, TOKEN), false);
  assert.equal(tokenMatches(TOKEN, undefined), false);
});

test('authorizeDevice resolves a known device with the right token', () => {
  assert.equal(authorizeDevice(devices, 'macbook-pro', `Bearer ${TOKEN}`).id, 'macbook-pro');
});

test('authorizeDevice rejects unknown device, missing token, wrong token', () => {
  assert.equal(authorizeDevice(devices, 'ghost', `Bearer ${TOKEN}`), null);
  assert.equal(authorizeDevice(devices, 'notoken', `Bearer ${TOKEN}`), null);
  assert.equal(authorizeDevice(devices, 'macbook-pro', 'Bearer wrong-token'), null);
  assert.equal(authorizeDevice(devices, 'macbook-pro', undefined), null);
});

test('enabled:false revokes access', () => {
  assert.equal(authorizeDevice(devices, 'disabled', `Bearer ${TOKEN}`), null);
});

test("one device's token does not authorize another device", () => {
  // The briefing runner and the collectors share this helper; a leaked token must
  // stay scoped to the device it belongs to.
  assert.equal(authorizeDevice(devices, 'macbook-pro', 'Bearer tok-briefing'), null);
  assert.equal(authorizeDevice(devices, 'briefing-runner', `Bearer ${TOKEN}`), null);
});
