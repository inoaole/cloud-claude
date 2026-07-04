import { useCallback, useEffect, useRef, useState } from 'react';
import { Group } from '../components/Group';
import { Cell } from '../components/Cell';
import { Composer } from '../components/Composer';
import { getRollup, saveNote, type Rollup } from '../lib/api';
import styles from './Today.module.css';

/* Today — the evening reflection (Sprint 6, A/Journal reading-first).
   One fetch renders the day: commits (author-day), the ~pulse line, an honest status
   (normal / quiet day / no data — offline / sensor issue), and the one-line composer.
   The local DATE is recomputed on every focus so a PWA left open past midnight writes
   tonight's line onto the right day. */

/** The user's local date + IANA tz, from the BROWSER (the phone travels; hub tz is fallback). */
function localNow(): { date: string; tz: string } {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return { date, tz };
}

/** The header shows the DATE STRING's weekday — format in UTC on purpose: re-projecting into
    the user's tz would shift the day for UTC+13/+14 (noon UTC is already tomorrow there). */
function headerFor(date: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })
    .format(new Date(`${date}T12:00:00Z`));
}

function hhmm(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
}

/** `~2h 10m` — always the estimate affordance: a poller observed snapshots, not exact times. */
function approxDuration(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return `~${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `~${h}h ${m}m` : `~${h}h`;
}

/** Honest status line under the date. Muted mono + dot — informational, never alarm-colored. */
function StatusLine({ rollup }: { rollup: Rollup }) {
  if (rollup.status === 'offline') {
    return <p className={`${styles.status} ${styles.offline}`}><span className={styles.dot} /> no data — offline</p>;
  }
  if (rollup.sensorDegraded) {
    return <p className={`${styles.status} ${styles.degraded}`}><span className={styles.dot} /> sensor issue — check collector log</p>;
  }
  if (rollup.status === 'quiet') {
    return <p className={styles.status}><span className={styles.dot} /> quiet day</p>;
  }
  return null; // a normal day speaks through its content
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; rollup: Rollup };
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function Today() {
  const [{ date, tz }, setDay] = useState(localNow);
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [draft, setDraft] = useState('');
  const [save, setSave] = useState<SaveState>('idle');
  const [browserOffline, setBrowserOffline] = useState(!navigator.onLine);
  const draftTouched = useRef(false); // never clobber typing with a refetched note

  const load = useCallback((d: string, z: string) => {
    let alive = true;
    setState({ phase: 'loading' });
    getRollup(d, z)
      .then((rollup) => {
        if (!alive) return;
        setState({ phase: 'ready', rollup });
        if (!draftTouched.current && rollup.note) setDraft(rollup.note.text);
      })
      .catch(() => { if (alive) setState({ phase: 'error' }); });
    return () => { alive = false; };
  }, []);

  useEffect(() => load(date, tz), [load, date, tz]);

  // Focus/visibility: recompute the local date (midnight rollover) and refresh the day.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const now = localNow();
      if (now.date !== date || now.tz !== tz) {
        draftTouched.current = false;
        setDraft('');
        setSave('idle');
        setDay(now); // date change triggers the load effect
      } else {
        load(date, tz);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [date, tz, load]);

  useEffect(() => {
    const on = () => setBrowserOffline(false);
    const off = () => setBrowserOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const submit = () => {
    const text = draft.trim();
    if (!text || save === 'saving') return;
    setSave('saving');
    saveNote(date, tz, text)
      .then(() => { setSave('saved'); setTimeout(() => setSave((s) => (s === 'saved' ? 'idle' : s)), 2000); })
      .catch(() => setSave('error')); // keep the typed text — retry is one tap
  };

  return (
    <div className={styles.screen}>
      <div className={styles.scroll}>
        <h1 className={styles.date}>{headerFor(date)}</h1>
        {browserOffline && <p className={`${styles.status} ${styles.offline}`}><span className={styles.dot} /> you're offline</p>}

        {state.phase === 'loading' && <p className={styles.hint}>Reading your day…</p>}

        {state.phase === 'error' && (
          <div className={styles.center}>
            <p className={styles.hint}>Couldn't reach the hub.</p>
            <button type="button" className={styles.retry} onClick={() => load(date, tz)}>Retry</button>
          </div>
        )}

        {state.phase === 'ready' && (
          <>
            <StatusLine rollup={state.rollup} />

            {state.rollup.sessions.length > 0 && (
              <Group header="Sessions">
                {state.rollup.sessions.map((s, i) => (
                  <Cell
                    key={`${i}-${s.tool}-${s.started}-${s.deviceId}`}
                    title={<>{s.tool} <span className={styles.mono}>{approxDuration(s.durationMs)}</span></>}
                    subtitle={<span className={styles.mono}>{s.cwd ?? s.deviceId} · {hhmm(s.started, tz)}–{hhmm(s.ended, tz)}</span>}
                  />
                ))}
              </Group>
            )}

            {state.rollup.commits.map((repo) => (
              <Group key={repo.repoId} header={repo.repoId}>
                {repo.commits.map((c) => (
                  <Cell
                    key={c.sha}
                    title={c.subject}
                    subtitle={<span className={styles.mono}>{c.sha.slice(0, 7)} · {hhmm(c.authorTs, tz)}</span>}
                  />
                ))}
              </Group>
            ))}

            {state.rollup.pulse.beats > 0 && state.rollup.pulse.first != null && state.rollup.pulse.last != null && (
              <p className={styles.pulse}>
                ~active {hhmm(state.rollup.pulse.first, tz)}–{hhmm(state.rollup.pulse.last, tz)} · {state.rollup.pulse.beats} beats
              </p>
            )}
          </>
        )}
      </div>

      <div className={styles.composerWrap}>
        {save === 'saved' && <span className={styles.savedCheck} aria-label="saved">✓</span>}
        {save === 'error' && <p className={styles.saveError}>Couldn't save — your line is kept. Try again.</p>}
        <Composer
          value={draft}
          onChange={(v) => { draftTouched.current = true; setDraft(v); }}
          onSubmit={submit}
          ready={state.phase === 'ready' && save !== 'saving'}
          placeholder="One line about today"
          ariaLabel="One line about today"
          sendLabel="Save"
        />
      </div>
    </div>
  );
}
