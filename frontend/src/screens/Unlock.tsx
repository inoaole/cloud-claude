import { useCallback, useEffect, useRef, useState } from 'react';
import { login } from '../lib/api';
import styles from './Unlock.module.css';

const MAX = 12;
const MIN_DOTS = 4;

// Visual phases (design-review): idle → submitting → (success | wrong | locked | nopin).
type Phase = 'idle' | 'submitting' | 'wrong' | 'locked' | 'nopin' | 'success';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'go'] as const;
type Key = (typeof KEYS)[number];

export function Unlock({ onAuthed }: { onAuthed: () => void }) {
  const [pin, setPin] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [lockLeft, setLockLeft] = useState(0);
  const lockTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (lockTimer.current) clearInterval(lockTimer.current); }, []);

  const startLockout = useCallback((seconds: number) => {
    setPhase('locked');
    setLockLeft(seconds);
    if (lockTimer.current) clearInterval(lockTimer.current);
    lockTimer.current = setInterval(() => {
      setLockLeft((n) => {
        if (n <= 1) {
          if (lockTimer.current) clearInterval(lockTimer.current);
          setPhase('idle');
          return 0;
        }
        return n - 1;
      });
    }, 1000);
  }, []);

  const submit = useCallback(async (value: string) => {
    setPhase('submitting');
    const res = await login(value);
    switch (res.kind) {
      case 'ok':
        setPhase('success');
        setTimeout(onAuthed, 220); // let the fade play before swapping to the app
        break;
      case 'locked':
        setPin('');
        startLockout(res.retryAfter);
        break;
      case 'no_pin':
        setPin('');
        setPhase('nopin');
        break;
      case 'bad_pin':
      case 'unreachable':
        setPin('');
        setPhase('wrong');
        break;
    }
  }, [onAuthed, startLockout]);

  const onKey = useCallback((k: Key) => {
    if (phase === 'submitting' || phase === 'locked' || phase === 'nopin' || phase === 'success') return;
    if (k === 'del') {
      setPhase('idle');
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (k === 'go') {
      setPin((p) => { if (p) void submit(p); return p; });
      return;
    }
    // digit
    setPin((p) => {
      const next = phase === 'wrong' ? k : (p.length < MAX ? p + k : p);
      return next;
    });
    if (phase === 'wrong') setPhase('idle');
  }, [phase, submit]);

  // Physical keyboard support (desktop / dev); phone uses the on-screen keypad.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) onKey(e.key as Key);
      else if (e.key === 'Backspace') onKey('del');
      else if (e.key === 'Enter') onKey('go');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onKey]);

  const dotCount = Math.max(pin.length, MIN_DOTS);
  const isError = phase === 'wrong' || phase === 'locked' || phase === 'nopin';
  const keypadDisabled = phase === 'submitting' || phase === 'locked' || phase === 'nopin' || phase === 'success';

  let sub = 'Enter PIN to unlock';
  if (phase === 'wrong') sub = 'Wrong PIN';
  else if (phase === 'nopin') sub = 'No PIN set on the hub';
  else if (phase === 'locked') sub = `Too many attempts — retry in ${lockLeft}s`;

  return (
    <div className={`${styles.unlock} ${phase === 'success' ? styles.exit : ''}`}>
      <div className={styles.logo}>cloud-claude</div>
      <div className={`${styles.sub} ${isError ? styles.error : ''}`} role="status" aria-live="polite">
        {sub}
      </div>

      <div className={`${styles.dots} ${phase === 'wrong' ? styles.shake : ''}`} data-testid="pin-dots" aria-label="PIN entry">
        {Array.from({ length: dotCount }, (_, i) => (
          <i key={i} data-filled={i < pin.length} className={i < pin.length ? styles.filled : ''} />
        ))}
      </div>

      <div className={styles.keypad} data-disabled={keypadDisabled}>
        {KEYS.map((k) => {
          if (k === 'del') {
            return (
              <button key={k} type="button" className={`${styles.key} ${styles.alt}`}
                onClick={() => onKey(k)} disabled={keypadDisabled} aria-label="Delete">⌫</button>
            );
          }
          if (k === 'go') {
            return (
              <button key={k} type="button"
                className={`${styles.key} ${styles.alt} ${phase === 'submitting' ? styles.pulse : ''}`}
                onClick={() => onKey(k)} disabled={keypadDisabled || !pin} aria-label="Submit">→</button>
            );
          }
          return (
            <button key={k} type="button" className={styles.key}
              onClick={() => onKey(k)} disabled={keypadDisabled}>{k}</button>
          );
        })}
      </div>
    </div>
  );
}
