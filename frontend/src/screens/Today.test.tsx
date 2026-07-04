import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Today } from './Today';
import { getRollup, saveNote, type Rollup } from '../lib/api';

vi.mock('../lib/api', () => ({ getRollup: vi.fn(), saveNote: vi.fn() }));
const mockRollup = vi.mocked(getRollup);
const mockSave = vi.mocked(saveNote);

const base: Rollup = {
  date: '2026-07-02',
  tz: 'Asia/Seoul',
  status: 'normal',
  sensorDegraded: false,
  commitCount: 2,
  commits: [{
    repoId: 'cloud-claude',
    commits: [
      { sha: 'abc1234def', subject: 'feat: rollup endpoint', authorTs: 1782990000000 },
      { sha: 'def5678abc', subject: 'fix: tz boundary', authorTs: 1782980000000 },
    ],
  }],
  sessions: [],
  pulse: { devices: [{ deviceId: 'macbook-pro', beats: 47, first: 1782950000000, last: 1782995000000 }], beats: 47, first: 1782950000000, last: 1782995000000 },
  note: null,
};

describe('Today', () => {
  beforeEach(() => {
    mockRollup.mockReset();
    mockSave.mockReset();
  });

  it('renders commits grouped by repo + the ~pulse line', async () => {
    mockRollup.mockResolvedValue(base);
    render(<Today />);

    expect(await screen.findByText('feat: rollup endpoint')).toBeInTheDocument();
    expect(screen.getByText('cloud-claude')).toBeInTheDocument();
    expect(screen.getByText(/~active .+–.+ · 47 beats/)).toBeInTheDocument();
    expect(screen.queryByText('quiet day')).not.toBeInTheDocument(); // normal day = no status line
  });

  it('sessions render above commits with ~duration and cwd (v1b)', async () => {
    mockRollup.mockResolvedValue({
      ...base,
      sessions: [
        { tool: 'claude', cwd: 'cloud_claude', started: 1782980000000, ended: 1782987800000, durationMs: 7800000, deviceId: 'macbook-pro' },
        { tool: 'tmux', cwd: null, started: 1782970000000, ended: 1782980000000, durationMs: 10000000, deviceId: 'macbook-pro' },
      ],
    });
    render(<Today />);

    expect(await screen.findByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('~2h 10m')).toBeInTheDocument(); // the estimate affordance
    expect(screen.getByText(/cloud_claude · \d{2}:\d{2}–\d{2}:\d{2}/)).toBeInTheDocument();
    expect(screen.getByText(/macbook-pro · \d{2}:\d{2}/)).toBeInTheDocument(); // null cwd falls back to device
  });

  it('quiet day and offline are visually distinct states, not errors', async () => {
    mockRollup.mockResolvedValue({ ...base, status: 'quiet', commitCount: 0, commits: [] });
    const { unmount } = render(<Today />);
    expect(await screen.findByText('quiet day')).toBeInTheDocument();
    unmount();

    mockRollup.mockResolvedValue({ ...base, status: 'offline', commitCount: 0, commits: [] });
    render(<Today />);
    expect(await screen.findByText('no data — offline')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument(); // not an error
  });

  it('sensor issue is surfaced instead of masquerading as a quiet day', async () => {
    mockRollup.mockResolvedValue({ ...base, status: 'quiet', sensorDegraded: true, commitCount: 0, commits: [] });
    render(<Today />);
    expect(await screen.findByText(/sensor issue/)).toBeInTheDocument();
    expect(screen.queryByText('quiet day')).not.toBeInTheDocument();
  });

  it('hub unreachable → error + retry recovers', async () => {
    const user = userEvent.setup();
    mockRollup.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(base);
    render(<Today />);

    expect(await screen.findByText("Couldn't reach the hub.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('feat: rollup endpoint')).toBeInTheDocument();
  });

  it('saves a line → quiet check appears; existing note pre-fills', async () => {
    const user = userEvent.setup();
    mockRollup.mockResolvedValue({ ...base, note: { date: '2026-07-02', text: 'yesterday I wrote this' } });
    mockSave.mockResolvedValue();
    render(<Today />);

    const input = await screen.findByLabelText('One line about today');
    expect(input).toHaveValue('yesterday I wrote this');

    await user.clear(input);
    await user.type(input, 'shipped the rollup');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByLabelText('saved')).toBeInTheDocument();
    expect(mockSave).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'shipped the rollup');
  });

  it('save failure keeps the typed text and shows retry copy', async () => {
    const user = userEvent.setup();
    mockRollup.mockResolvedValue(base);
    mockSave.mockRejectedValue(new Error('down'));
    render(<Today />);

    const input = await screen.findByLabelText('One line about today');
    await user.type(input, 'precious line');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/your line is kept/)).toBeInTheDocument();
    expect(input).toHaveValue('precious line'); // no data loss
  });

  it('refetches when the tab becomes visible again', async () => {
    mockRollup.mockResolvedValue(base);
    render(<Today />);
    await screen.findByText('feat: rollup endpoint');
    expect(mockRollup).toHaveBeenCalledTimes(1);

    fireEvent(document, new Event('visibilitychange'));
    expect(mockRollup).toHaveBeenCalledTimes(2); // same date → plain refetch
  });
});
