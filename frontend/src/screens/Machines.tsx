import { useCallback, useEffect, useState } from 'react';
import { Group } from '../components/Group';
import { Cell } from '../components/Cell';
import { Stub } from '../components/Stub';
import { getDevices, type Device, type DeviceStatus } from '../lib/api';
import { IconMachines } from '../components/icons';
import styles from './Machines.module.css';

const OS_LABEL: Record<string, string> = { macos: 'macOS', linux: 'Linux', windows: 'Windows' };

function StatusDot({ status }: { status: DeviceStatus }) {
  return <span className={`${styles.dot} ${styles[status]}`} aria-hidden />;
}

/** Online rows show just the name (calm); offline/disabled show the distinguished reason. */
function subtitleFor(d: Device): string | undefined {
  if (d.status === 'online') return d.isHub ? 'This hub' : (d.os ? OS_LABEL[d.os] ?? d.os : undefined);
  return d.detail ?? undefined;
}

type State =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; devices: Device[] };

export function Machines() {
  const [state, setState] = useState<State>({ phase: 'loading' });

  const load = useCallback(() => {
    let alive = true;
    setState({ phase: 'loading' });
    getDevices()
      .then((devices) => { if (alive) setState({ phase: 'ready', devices }); })
      .catch(() => { if (alive) setState({ phase: 'error' }); });
    return () => { alive = false; };
  }, []);

  useEffect(() => load(), [load]);

  if (state.phase === 'loading') {
    return <p className={styles.hint}>Checking devices…</p>;
  }

  if (state.phase === 'error') {
    return (
      <div className={styles.center}>
        <p className={styles.hint}>Couldn't reach the hub.</p>
        <button type="button" className={styles.retry} onClick={load}>Retry</button>
      </div>
    );
  }

  if (state.devices.length === 0) {
    return <Stub icon={IconMachines} title="No devices configured" note="Add devices to the hub's devices.json allowlist to see them here." />;
  }

  const online = state.devices.filter((d) => d.status === 'online').length;

  return (
    <>
      <Group header={`${online}/${state.devices.length} online`}>
        {state.devices.map((d) => (
          <Cell
            key={d.id}
            leading={<StatusDot status={d.status} />}
            title={<span className={d.status === 'disabled' ? styles.disabledLabel : undefined}>{d.label}</span>}
            subtitle={subtitleFor(d)}
            value={d.isHub ? 'Hub' : undefined}
            disclosure={false}
          />
        ))}
      </Group>
      <button type="button" className={styles.recheck} onClick={load}>Recheck</button>
    </>
  );
}
