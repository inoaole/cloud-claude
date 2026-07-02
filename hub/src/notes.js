// One-line evening reflection notes (Sprint 6). A note is a MUTABLE artifact (tonight's line
// gets edited), so it lives in its own table — the events table stays append-only observations.
// Keyed by local date alone: one line per day of the user's life, wherever it was typed.
// Pure-handler pattern (like ingest.js) so the logic tests without HTTP.

export const NOTE_MAX = 500; // code points, not bytes — emoji count as 1

/** "One line" is a contract: newlines/control chars collapse to single spaces server-side. */
export function normalizeText(text) {
  if (typeof text !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/ {2,}/g, ' ').trim();
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Upsert the day's note. Returns { status, body } for the route to forward. */
export function handleSaveNote(db, body, now = Date.now()) {
  const date = body?.date;
  const tz = typeof body?.tz === 'string' && body.tz ? body.tz : null;
  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    return { status: 400, body: { error: 'bad_date' } };
  }
  if (!tz) return { status: 400, body: { error: 'bad_tz' } };
  const text = normalizeText(body?.text);
  if (!text) return { status: 400, body: { error: 'empty_text' } }; // edit, don't erase (v1)
  if ([...text].length > NOTE_MAX) return { status: 400, body: { error: 'text_too_long', max: NOTE_MAX } };

  db.prepare(`
    INSERT INTO notes (date, tz, text, created_at, updated_at)
    VALUES (@date, @tz, @text, @now, @now)
    ON CONFLICT(date) DO UPDATE SET text = @text, tz = @tz, updated_at = @now
  `).run({ date, tz, text, now });
  return { status: 200, body: { ok: true, date, text } };
}

/** The day's note, or null. */
export function getNote(db, date) {
  const row = db.prepare('SELECT date, tz, text, created_at, updated_at FROM notes WHERE date = ?').get(date);
  return row ?? null;
}
