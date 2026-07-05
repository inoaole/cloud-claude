import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { handleSaveNote, getNote, normalizeText, NOTE_MAX } from './notes.js';

const TZ = 'Asia/Seoul';

test('normalizeText: newlines/tabs/controls collapse to single spaces, trimmed', () => {
  assert.equal(normalizeText('one\nline\tonly\r\n '), 'one line only');
  assert.equal(normalizeText('  spaced   out  '), 'spaced out');
  assert.equal(normalizeText(123), '');
});

test('create then edit: text replaces, created_at stays, updated_at moves', () => {
  const db = openDb(':memory:');
  assert.equal(handleSaveNote(db, { date: '2026-07-02', tz: TZ, text: 'first' }, 1000).status, 200);
  const r = handleSaveNote(db, { date: '2026-07-02', tz: TZ, text: 'edited' }, 2000);
  assert.equal(r.status, 200);
  const note = getNote(db, '2026-07-02');
  assert.equal(note.text, 'edited');
  assert.equal(note.created_at, 1000);
  assert.equal(note.updated_at, 2000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 1); // one row per day
});

test('rapid double-save: last write wins, one row', () => {
  const db = openDb(':memory:');
  handleSaveNote(db, { date: '2026-07-02', tz: TZ, text: 'tap one' }, 1000);
  handleSaveNote(db, { date: '2026-07-02', tz: TZ, text: 'tap two' }, 1001);
  assert.equal(getNote(db, '2026-07-02').text, 'tap two');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 1);
});

test('cap counts code points: 500 emoji pass, 501 rejected', () => {
  const db = openDb(':memory:');
  const ok = handleSaveNote(db, { date: '2026-07-02', tz: TZ, text: '😀'.repeat(NOTE_MAX) });
  assert.equal(ok.status, 200);
  const over = handleSaveNote(db, { date: '2026-07-02', tz: TZ, text: '😀'.repeat(NOTE_MAX + 1) });
  assert.equal(over.status, 400);
  assert.equal(over.body.error, 'text_too_long');
});

test('empty (or whitespace-only) text → 400, existing note untouched', () => {
  const db = openDb(':memory:');
  handleSaveNote(db, { date: '2026-07-02', tz: TZ, text: 'keep me' });
  const r = handleSaveNote(db, { date: '2026-07-02', tz: TZ, text: ' \n\t ' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'empty_text');
  assert.equal(getNote(db, '2026-07-02').text, 'keep me');
});

test('bad date / missing tz → 400', () => {
  const db = openDb(':memory:');
  assert.equal(handleSaveNote(db, { date: '07-02', tz: TZ, text: 'x' }).status, 400);
  assert.equal(handleSaveNote(db, { date: '2026-07-02', text: 'x' }).status, 400);
});

test('getNote: null for a day with no note', () => {
  const db = openDb(':memory:');
  assert.equal(getNote(db, '2026-01-01'), null);
});
