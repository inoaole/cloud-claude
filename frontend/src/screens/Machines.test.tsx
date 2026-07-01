import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Machines } from './Machines';
import { getDevices, type Device } from '../lib/api';

vi.mock('../lib/api', () => ({ getDevices: vi.fn() }));
const mockGet = vi.mocked(getDevices);

const renderMachines = () => render(<MemoryRouter><Machines /></MemoryRouter>);

const devices: Device[] = [
  { id: 'macbook-pro', label: 'MacBook Pro', os: 'macos', isHub: false, status: 'online', reason: null, detail: null },
  { id: 'hub', label: 'Ubuntu hub', os: 'linux', isHub: true, status: 'online', reason: null, detail: 'This hub' },
  { id: 'mac-mini', label: 'Mac mini', os: 'macos', isHub: false, status: 'offline', reason: 'asleep', detail: 'Offline or asleep' },
  { id: 'desktop', label: 'Desktop', os: 'windows', isHub: false, status: 'disabled', reason: 'disabled', detail: 'Turned off in config' },
];

describe('Machines', () => {
  beforeEach(() => mockGet.mockReset());

  it('renders the online count and distinguished offline reasons', async () => {
    mockGet.mockResolvedValue(devices);
    renderMachines();

    expect(await screen.findByText('2/4 online')).toBeInTheDocument();
    expect(screen.getByText('MacBook Pro')).toBeInTheDocument();
    expect(screen.getByText('Hub')).toBeInTheDocument(); // hub tag
    expect(screen.getByText('Offline or asleep')).toBeInTheDocument(); // sleeping mac mini
    expect(screen.getByText('Turned off in config')).toBeInTheDocument(); // disabled desktop
  });

  it('shows an error with retry, then recovers', async () => {
    const user = userEvent.setup();
    mockGet.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(devices);
    renderMachines();

    expect(await screen.findByText("Couldn't reach the hub.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('2/4 online')).toBeInTheDocument();
  });

  it('honest-quiet empty state when no devices are configured', async () => {
    mockGet.mockResolvedValue([]);
    renderMachines();
    expect(await screen.findByText('No devices configured')).toBeInTheDocument();
  });
});
