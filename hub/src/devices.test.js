import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPeer, probeDevice, probeAll } from './devices.js';

// A fake `tailscale status --json` with one online peer + one offline peer.
const status = {
  Self: { HostName: 'cloud-claude-hub', DNSName: 'cloud-claude-hub.tail.ts.net.', TailscaleIPs: ['100.76.104.123'], Online: true },
  Peer: {
    a: { HostName: 'jonghyun--macbookpro', DNSName: 'jonghyun--macbookpro.tail.ts.net.', TailscaleIPs: ['100.66.78.59'], Online: true },
    b: { HostName: 'desktop-de6a81o', DNSName: 'desktop-de6a81o.tail.ts.net.', TailscaleIPs: ['100.99.1.2'], Online: false },
  },
};

const mac = { id: 'macbook-pro', label: 'MacBook Pro', os: 'macos', tailnet: 'jonghyun--macbookpro', sshHost: '100.66.78.59', enabled: true };
const hub = { id: 'hub', label: 'Ubuntu hub', os: 'linux', tailnet: 'cloud-claude-hub', role: 'hub', enabled: true };

test('findPeer matches by MagicDNS name and by IP', () => {
  assert.equal(findPeer(mac, status).HostName, 'jonghyun--macbookpro');
  assert.equal(findPeer({ sshHost: '100.66.78.59' }, status).HostName, 'jonghyun--macbookpro');
  assert.equal(findPeer({ tailnet: 'nope' }, status), null);
});

test('disabled device → disabled (no probe)', async () => {
  const r = await probeDevice({ ...mac, enabled: false }, status, { tcp: () => assert.fail('should not probe') });
  assert.equal(r.status, 'disabled');
  assert.equal(r.reason, 'disabled');
});

test('hub role → online without probing', async () => {
  const r = await probeDevice(hub, status, { tcp: () => assert.fail('should not probe') });
  assert.equal(r.status, 'online');
  assert.equal(r.detail, 'This hub');
});

test('online peer + open SSH port → online', async () => {
  const r = await probeDevice(mac, status, { tcp: async () => 'open' });
  assert.equal(r.status, 'online');
  assert.equal(r.reason, null);
});

test('online peer + refused → ssh-closed', async () => {
  const r = await probeDevice(mac, status, { tcp: async () => 'refused' });
  assert.equal(r.status, 'offline');
  assert.equal(r.reason, 'ssh-closed');
});

test('online peer + timeout → firewall', async () => {
  const r = await probeDevice(mac, status, { tcp: async () => 'timeout' });
  assert.equal(r.reason, 'firewall');
});

test('peer offline → asleep (no TCP probe needed)', async () => {
  const dev = { id: 'desktop', label: 'Desktop', tailnet: 'desktop-de6a81o', enabled: true };
  const r = await probeDevice(dev, status, { tcp: () => assert.fail('should not probe a sleeping peer') });
  assert.equal(r.reason, 'asleep');
});

test('not on tailnet → not-on-tailnet', async () => {
  const dev = { id: 'ghost', label: 'Ghost', tailnet: 'ghost', enabled: true };
  const r = await probeDevice(dev, status, { tcp: async () => 'open' });
  assert.equal(r.reason, 'not-on-tailnet');
});

test('probeAll returns render-shaped rows', async () => {
  const rows = await probeAll([mac, hub], status, { tcp: async () => 'open' });
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => [r.id, r.label, r.isHub, r.status]),
    [['macbook-pro', 'MacBook Pro', false, 'online'], ['hub', 'Ubuntu hub', true, 'online']],
  );
});
