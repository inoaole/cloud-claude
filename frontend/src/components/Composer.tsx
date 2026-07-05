import { type RefObject, useRef } from 'react';
import styles from './Composer.module.css';

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  ready: boolean;
  placeholder: string;
  ariaLabel: string;
  /** When busy, the primary button becomes Stop → onStop. */
  busy?: boolean;
  onStop?: () => void;
  sendLabel?: string;
  /** Optional external ref (e.g. a screen wanting to focus the input on a tap-to-edit). */
  inputRef?: RefObject<HTMLInputElement>;
}

/** Shared bottom composer for Agent + Shell (input + Send / Stop). Owns focus. */
export function Composer({ value, onChange, onSubmit, ready, placeholder, ariaLabel, busy, onStop, sendLabel = 'Send', inputRef }: ComposerProps) {
  const internal = useRef<HTMLInputElement>(null);
  const ref: RefObject<HTMLInputElement> = inputRef ?? internal;
  return (
    <form className={styles.composer} onSubmit={(e) => { e.preventDefault(); onSubmit(); ref.current?.focus(); }}>
      <input
        ref={ref}
        className={styles.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false}
        enterKeyHint="send" aria-label={ariaLabel}
      />
      {busy
        ? <button type="button" className={styles.stop} onClick={onStop}>Stop</button>
        : <button type="submit" className={styles.send} disabled={!value.trim() || !ready}>{sendLabel}</button>}
    </form>
  );
}
