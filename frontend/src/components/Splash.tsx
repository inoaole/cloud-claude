import styles from './Splash.module.css';

interface SplashProps {
  message?: string;
  action?: { label: string; onClick: () => void };
}

/** Minimal logo-on-black shown while the boot auth check runs, or on hub-unreachable
    error. Deliberately NOT the app or the unlock screen — avoids a protected-UI flash. */
export function Splash({ message, action }: SplashProps) {
  return (
    <div className={styles.splash}>
      <div className={styles.logo}>cloud-claude</div>
      {message && <p className={styles.message}>{message}</p>}
      {action && (
        <button type="button" className={styles.action} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
