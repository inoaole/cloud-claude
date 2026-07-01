import { useEffect, useState } from 'react';
import { Group } from '../components/Group';
import { Cell } from '../components/Cell';
import { getHealth, logout } from '../lib/api';
import { useAuth } from '../lib/auth';

export function Settings() {
  const { signOut } = useAuth();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getHealth().then((h) => { if (alive) setVersion(h.ok ? (h.version ?? null) : null); });
    return () => { alive = false; };
  }, []);

  async function handleLock() {
    await logout();
    signOut();
  }

  return (
    <>
      <Group header="Hub">
        <Cell title="Connection" value={version ? 'Online' : 'Offline'} disclosure={false} />
        <Cell title="Version" value={version ? `v${version}` : '—'} disclosure={false} />
      </Group>

      <Group header="Session">
        <Cell title="Lock" subtitle="End this session and require the PIN again" onClick={handleLock} />
      </Group>
    </>
  );
}
