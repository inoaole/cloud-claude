import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flush, verdictFor } from './outbox.js';

const mk = (n) => Array.from({ length: n }, (_, i) => ({ event_id: `e${i}` }));

test('verdictFor: auth + transient → keep (never lose data); only 400 → drop', () => {
  // 401/403 are config-fixable → keep so events survive until the token is corrected.
  assert.equal(verdictFor(401), 'keep');
  assert.equal(verdictFor(403), 'keep');
  assert.equal(verdictFor(429), 'keep');
  assert.equal(verdictFor(500), 'keep');
  assert.equal(verdictFor(503), 'keep');
  // 400 = malformed payload, retrying verbatim can't succeed → drop.
  assert.equal(verdictFor(400), 'drop');
  assert.equal(verdictFor(404), 'drop');
});

test('all ok → whole outbox consumed', async () => {
  const seen = [];
  const { sent, dropped } = await flush(mk(5), async (b) => { seen.push(b.length); return 'ok'; }, { max: 2 });
  assert.equal(sent, 5);
  assert.equal(dropped.length, 0);
  assert.deepEqual(seen, [2, 2, 1]); // batched by max=2
});

test("'keep' stops the flush (network/5xx) — rest stays", async () => {
  let calls = 0;
  const { sent } = await flush(mk(6), async () => { calls += 1; return calls === 1 ? 'ok' : 'keep'; }, { max: 2 });
  assert.equal(sent, 2);   // only the first batch consumed
  assert.equal(calls, 2);  // stopped after the 'keep'
});

test("'drop' consumes AND records (poison / 4xx that won't recover)", async () => {
  const { sent, dropped } = await flush(mk(4), async (b) => (b[0].event_id === 'e0' ? 'drop' : 'ok'), { max: 2 });
  assert.equal(sent, 4);            // both batches consumed
  assert.equal(dropped.length, 2);  // first batch was dropped
});

test('empty outbox → nothing sent', async () => {
  let called = false;
  const { sent } = await flush([], async () => { called = true; return 'ok'; });
  assert.equal(sent, 0);
  assert.equal(called, false);
});
